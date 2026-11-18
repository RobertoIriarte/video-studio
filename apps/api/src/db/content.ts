import { z } from 'zod';
import { catalogDataSchema, contentActivateSchema, contentMutationSchema, researchSaveSchema, scriptSaveSchema, sceneSaveSchema, researchOutputSchema, validateScriptClaims, uuidSchema } from '@video-studio/contracts';
import type { Database, Statement } from './connection.js';
import { CatalogRepository, catalogHash, voiceStatements } from './catalog.js';
import { JobConflict, JobNotFound, JobRepository, batchChanges, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import type { PublicationGate } from './job-runner.js';
import { sceneInvalidation, scriptInvalidation } from './invalidation.js';

export class ContentRepository {
  readonly catalog: CatalogRepository; readonly jobs: JobRepository;
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime) { this.catalog = new CatalogRepository(db); this.jobs = new JobRepository(db, runtime); }
  async sceneScope(owner: string, id: string) {
    const row = await this.db.prepare('SELECT s.project_id FROM scenes s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.owner_id=? AND s.archived_at IS NULL AND p.archived_at IS NULL').bind(uuidSchema.parse(id), uuidSchema.parse(owner)).first<{ project_id: string }>();
    if (!row) throw new JobNotFound(); return row.project_id;
  }
  async list(owner: string, project: string, kind: 'research' | 'script', cursor?: string) {
    const state = await this.jobs.project(owner, project); const before = cursor ? z.coerce.number().int().positive().parse(cursor) : Number.MAX_SAFE_INTEGER;
    const page = await this.db.prepare(`SELECT id,version_no FROM ${kind === 'research' ? 'research_versions' : 'script_versions'} WHERE project_id=? AND version_no<? ORDER BY version_no DESC LIMIT 26`).bind(project, before).all<{ id: string; version_no: number }>();
    const items = await Promise.all(page.results.slice(0, 25).map(({ id }) => kind === 'research' ? this.catalog.getResearch(owner, project, id) : this.catalog.getScript(owner, project, id)));
    return { items, nextCursor: page.results.length > 25 ? String(page.results[24]!.version_no) : null, revision: state.revision, ...(kind === 'script' ? { activeVersionId: state.active_script_version_id } : {}) };
  }
  async scenes(owner: string, project: string, cursor?: string) {
    const state = await this.jobs.project(owner, project); let after = -1;
    if (cursor) { after = z.coerce.number().int().nonnegative().parse(cursor); }
    const rows = await this.db.prepare(`WITH summaries AS (SELECT s.*,v.id AS latest_id,COALESCE(v.duration_ms,0) AS duration,v.status AS version_status,
      (SELECT count(*) FROM shots t WHERE t.scene_version_id=v.id) AS shot_count FROM scenes s LEFT JOIN scene_versions v ON v.id=COALESCE(s.active_version_id,(SELECT id FROM scene_versions x WHERE x.scene_id=s.id ORDER BY version_no DESC LIMIT 1)) WHERE s.project_id=? AND s.archived_at IS NULL),
      timed AS (SELECT *,COALESCE(sum(duration) OVER (ORDER BY order_index,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS start_ms FROM summaries)
      SELECT * FROM timed ORDER BY order_index,id LIMIT 26 OFFSET ?`).bind(project, after + 1).all<Record<string, unknown>>();
    return { revision: state.revision, items: rows.results.slice(0, 25).map((s) => ({ id: s.id, projectId: project, stableKey: s.stable_key, orderIndex: s.order_index, activeVersionId: s.active_version_id, revision: s.revision, title: s.stable_key, latestVersionId: s.latest_id, durationMs: s.duration, startMs: s.start_ms, shotCount: s.shot_count, status: s.version_status ?? 'PENDING' })), nextCursor: rows.results.length > 25 ? String(after + 25) : null };
  }
  async scene(owner: string, id: string, cursor?: string) {
    const project = await this.sceneScope(owner, id); const state = await this.jobs.project(owner, project);
    const before = cursor ? z.coerce.number().int().positive().parse(cursor) : Number.MAX_SAFE_INTEGER;
    const rows = await this.db.prepare('SELECT id,version_no FROM scene_versions WHERE scene_id=? AND version_no<? ORDER BY version_no DESC LIMIT 26').bind(id, before).all<{ id: string; version_no: number }>();
    return { scene: (await this.catalog.getScene(owner, project, id))!, revision: state.revision, versions: await Promise.all(rows.results.slice(0, 25).map((r) => this.catalog.getSceneVersion(owner, project, r.id))), nextCursor: rows.results.length > 25 ? String(rows.results[24]!.version_no) : null };
  }
  async mutate(owner: string, project: string, operation: string, hash: string, expected: number, versionId: string, action: 'CONTENT_CREATED' | 'CONTENT_ACTIVATED' | 'REGEN_REQUESTED', build: (gate: PublicationGate) => Statement[], precondition?: PublicationGate) {
    await this.jobs.project(owner, project); const previous = await this.jobs.receipt(owner, project, operation, hash); if (previous) return contentMutationSchema.parse(previous);
    const token = this.runtime.uuid(); const now = this.jobs.timestamp(); const result = { versionId, revision: expected + 1 };
    const g = { sql: 'EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND mutation_token=? AND revision=?)', values: [project, owner, token, expected + 1] };
    const statements = [this.db.prepare(`UPDATE projects SET revision=revision+1,mutation_token=?,updated_at=max(updated_at,?) WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL ${precondition ? `AND ${precondition.sql}` : ''}`).bind(token, now, project, owner, expected, ...(precondition?.values ?? [])), ...build(g),
      this.db.prepare(`INSERT INTO content_changes SELECT ?,?,?,?,?,? WHERE ${g.sql}`).bind(this.runtime.uuid(), project, owner, versionId, action, now, ...g.values),
      this.db.prepare(`INSERT INTO job_commands SELECT ?,?,?,? WHERE ${g.sql}`).bind(project, operation, hash, JSON.stringify(result), ...g.values)];
    try { if (batchChanges(await this.db.batch(statements)) !== 1) throw new JobConflict(); }
    catch (error) { const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return contentMutationSchema.parse(replay); throw error; }
    return result;
  }
  async saveResearch(owner: string, project: string, operation: string, raw: unknown) {
    const input = researchSaveSchema.parse(raw); const hash = await catalogHash({ action: 'SAVE_RESEARCH', project, input });
    const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return contentMutationSchema.parse(replay);
    if (input.baseVersionId && !await this.catalog.getResearch(owner, project, input.baseVersionId)) throw new JobNotFound();
    catalogDataSchema.parse(input.data);
    const data = input.data; const sources = data.sources.map((s) => ({ url: s.url, title: s.title, acquiredAt: s.acquiredAt, notes: s.notes, provenance: s.provenance, accessStatus: s.accessStatus }));
    const contentHash = await catalogHash({ data, sources }); const id = this.runtime.uuid(); const now = this.jobs.timestamp();
    return this.mutate(owner, project, operation, hash, input.expectedRevision, id, 'CONTENT_CREATED', (g) => [
      this.db.prepare(`INSERT INTO research_versions (id,project_id,version_no,data_json,content_hash,status,created_at) SELECT ?,?,COALESCE(MAX(version_no),0)+1,?,?,'DRAFT',? FROM research_versions WHERE project_id=? HAVING ${g.sql}`).bind(id, project, JSON.stringify(data), contentHash, now, project, ...g.values),
      ...sources.map((s) => this.db.prepare(`INSERT INTO sources SELECT ?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(this.runtime.uuid(), id, s.url, s.title, s.acquiredAt, s.notes, s.provenance, s.accessStatus, ...g.values)),
      this.db.prepare(`UPDATE research_versions SET status='CANDIDATE' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
    ]);
  }
  async saveScript(owner: string, project: string, operation: string, raw: unknown) {
    const input = scriptSaveSchema.parse(raw); const hash = await catalogHash({ action: 'SAVE_SCRIPT', project, input });
    catalogDataSchema.parse(input.data);
    const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return contentMutationSchema.parse(replay);
    if (input.baseVersionId && !await this.catalog.getScript(owner, project, input.baseVersionId)) throw new JobNotFound();
    const research = input.researchVersionId ? await this.catalog.getResearch(owner, project, input.researchVersionId) : null;
    if (input.researchVersionId && !research) throw new JobNotFound();
    if (research && !['CANDIDATE', 'APPROVED'].includes(research.status)) throw new JobConflict();
    try { validateScriptClaims(input.data, research ? researchOutputSchema.parse(research.data) : null); } catch { throw new JobConflict(); }
    const duration = input.data.sections.reduce((n, s) => n + s.targetDurationMs, 0); if (!Number.isSafeInteger(duration)) throw new JobConflict();
    const id = this.runtime.uuid(); const now = this.jobs.timestamp(); const contentHash = await catalogHash({ researchVersionId: input.researchVersionId, data: input.data, targetDurationMs: duration });
    return this.mutate(owner, project, operation, hash, input.expectedRevision, id, 'CONTENT_CREATED', (g) => [this.db.prepare(`INSERT INTO script_versions (id,project_id,research_version_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) SELECT ?,?,?,COALESCE(MAX(version_no),0)+1,?,?,?,'CANDIDATE',? FROM script_versions WHERE project_id=? HAVING ${g.sql}`).bind(id, project, input.researchVersionId, JSON.stringify(input.data), contentHash, duration, now, project, ...g.values)]);
  }
  async saveScene(owner: string, sceneId: string, operation: string, raw: unknown) {
    const project = await this.sceneScope(owner, sceneId); const body = sceneSaveSchema.parse(raw); const hash = await catalogHash({ action: 'SAVE_SCENE', sceneId, body });
    const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return contentMutationSchema.parse(replay);
    const base = await this.catalog.getSceneVersion(owner, project, body.baseVersionId); const scene = (await this.catalog.getScene(owner, project, sceneId))!;
    if (!base || base.sceneId !== sceneId) throw new JobNotFound();
    const input = await this.catalog.validateSceneVersion(owner, project, sceneId, body.input);
    if (input.parentVersionId !== scene.activeVersionId || input.scriptVersionId !== (await this.jobs.project(owner, project)).active_script_version_id) throw new JobConflict();
    if (base.narration !== input.narration) {
      input.assetLinks = input.assetLinks.filter((l) => !['VOICE', 'VISUAL'].includes(l.role)); input.shots = input.shots.map((s) => ({ ...s, assetId: null }));
      delete input.voiceSegments; input.direction = { ...input.direction, narrationReviewRequired: true };
    }
    const id = this.runtime.uuid(); const contentHash = await catalogHash(input); const now = this.jobs.timestamp();
    return this.mutate(owner, project, operation, hash, body.expectedRevision, id, 'CONTENT_CREATED', (g) => [
      this.db.prepare(`INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,parent_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at) SELECT ?,?,?,?,?,COALESCE(MAX(version_no),0)+1,?,?,?,?,'DRAFT',?,? FROM scene_versions WHERE scene_id=? HAVING ${g.sql}`).bind(id, project, sceneId, input.scriptVersionId, input.parentVersionId, input.narration, JSON.stringify(input.direction), input.durationMs, input.generationScope, contentHash, now, sceneId, ...g.values),
      ...input.shots.map((s) => this.db.prepare(`INSERT INTO shots SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(this.runtime.uuid(), project, id, s.orderIndex, s.durationMs, s.type, s.prompt, JSON.stringify(s.camera), JSON.stringify(s.transition), s.assetId, ...g.values)),
      ...input.assetLinks.map((l) => this.db.prepare(`INSERT INTO asset_links SELECT ?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(this.runtime.uuid(), project, id, l.assetId, l.role, l.offsetMs, l.trimStartMs, l.trimEndMs, ...g.values)),
      ...voiceStatements(this.db, project, id, input, g, this.runtime.uuid),
      this.db.prepare(`UPDATE scene_versions SET status='CANDIDATE' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
    ], { sql: 'EXISTS(SELECT 1 FROM scenes WHERE id=? AND revision=? AND active_version_id IS ?)', values: [sceneId, scene.revision, input.parentVersionId] });
  }
  async activate(owner: string, project: string, kind: 'research' | 'script' | 'scene', id: string, operation: string, raw: unknown) {
    const input = contentActivateSchema.parse(raw); const hash = await catalogHash({ action: 'ACTIVATE_CONTENT', project, kind, id, input });
    const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return contentMutationSchema.parse(replay);
    const version = kind === 'research' ? await this.catalog.getResearch(owner, project, id) : kind === 'script' ? await this.catalog.getScript(owner, project, id) : await this.catalog.getSceneVersion(owner, project, id);
    if (!version) throw new JobNotFound(); if (version.status !== 'CANDIDATE') throw new JobConflict();
    if ('researchVersionId' in version && version.researchVersionId) { const research = await this.catalog.getResearch(owner, project, version.researchVersionId); if (!research || !['CANDIDATE', 'APPROVED'].includes(research.status)) throw new JobConflict(); }
    const table = kind === 'research' ? 'research_versions' : kind === 'script' ? 'script_versions' : 'scene_versions';
    let scene: Awaited<ReturnType<CatalogRepository['getScene']>> = null;
    if ('sceneId' in version) { scene = await this.catalog.getScene(owner, project, version.sceneId); if (!scene || scene.activeVersionId !== version.parentVersionId || (await this.jobs.project(owner, project)).active_script_version_id !== version.scriptVersionId) throw new JobConflict(); }
    const invalidate = kind === 'scene' ? await sceneInvalidation(this.db, owner, project, scene!.activeVersionId, id) : kind === 'script' ? scriptInvalidation(this.db, project, (await this.jobs.project(owner, project)).active_script_version_id, id) : () => [];
    return this.mutate(owner, project, operation, hash, input.expectedRevision, id, 'CONTENT_ACTIVATED', (g) => {
      const statements = [this.db.prepare(`UPDATE ${table} SET status='APPROVED' WHERE id=? AND status='CANDIDATE' AND ${g.sql}`).bind(id, ...g.values)];
      if (kind === 'script') { statements.push(this.db.prepare(`UPDATE script_versions SET status='SUPERSEDED' WHERE id=(SELECT active_script_version_id FROM projects WHERE id=?) AND id<>? AND status='APPROVED' AND ${g.sql}`).bind(project, id, ...g.values)); statements.push(this.db.prepare(`UPDATE projects SET active_script_version_id=?,status=CASE WHEN status='DRAFT' THEN 'RUNNING' ELSE status END WHERE id=? AND ${g.sql}`).bind(id, project, ...g.values)); }
      if (scene) { statements.push(this.db.prepare(`UPDATE scene_versions SET status='SUPERSEDED' WHERE id=? AND status='APPROVED' AND ${g.sql}`).bind(scene.activeVersionId, ...g.values)); statements.push(this.db.prepare(`UPDATE scenes SET active_version_id=?,revision=revision+1 WHERE id=? AND ${g.sql}`).bind(id, scene.id, ...g.values)); }
      statements.push(...invalidate(g));
      if (kind !== 'research') statements.push(this.db.prepare(`UPDATE projects SET status=CASE WHEN pause_requested=1 THEN 'PAUSED' ELSE 'RUNNING' END WHERE id=? AND ${g.sql}`).bind(project, ...g.values));
      statements.push(this.db.prepare(`UPDATE checkpoints SET status='APPROVED',reviewed_by=?,reviewed_at=?,revision=revision+1 WHERE project_id=? AND subject_version_id=? AND status='PENDING' AND ${g.sql}`).bind(owner, this.jobs.timestamp(), project, id, ...g.values));
      statements.push(this.db.prepare(`UPDATE jobs SET status='SUCCEEDED',revision=revision+1,updated_at=? WHERE project_id=? AND status='WAITING_APPROVAL' AND json_extract(output_ref,'$.id')=? AND ${g.sql}`).bind(this.jobs.timestamp(), project, id, ...g.values));
      return statements;
    }, { sql: `EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='CANDIDATE')${scene ? ' AND EXISTS(SELECT 1 FROM scenes WHERE id=? AND revision=? AND active_version_id IS ?)' : ''}`, values: [id, ...(scene ? [scene.id, scene.revision, scene.activeVersionId] : [])] });
  }
}
