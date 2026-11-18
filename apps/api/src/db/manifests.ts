import { manifestActivateSchema, manifestDtoSchema, montageInputSchema, scriptOutputSchema } from '@video-studio/contracts';
import type { RenderManifest } from '@video-studio/contracts';
import { compileManifest } from '@video-studio/domain';
import type { Database } from './connection.js';
import { CatalogRepository, catalogHash } from './catalog.js';
import { ContentRepository } from './content.js';
import { JobConflict, JobNotFound, JobRepository, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import { currentManifestSql } from './manifest-current.js';
export { currentManifestSql } from './manifest-current.js';
export class ManifestRepository {
  readonly jobs: JobRepository; readonly catalog: CatalogRepository;
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime) { this.jobs = new JobRepository(db, runtime); this.catalog = new CatalogRepository(db); }
  async get(owner: string, project: string, id: string) {
    await this.jobs.project(owner, project); const row = await this.db.prepare('SELECT * FROM render_manifests WHERE id=? AND project_id=?').bind(id, project).first<Record<string, unknown>>(); if (!row) throw new JobNotFound();
    return manifestDtoSchema.parse({ id: row.id, projectId: project, versionNo: row.version_no, status: row.status, contentHash: row.content_hash, manifest: JSON.parse(String(row.manifest_json)), createdAt: row.created_at });
  }
  async current(project: string, id: string) { return !!await this.db.prepare(`SELECT id FROM render_manifests m WHERE m.id=? AND m.project_id=? AND ${currentManifestSql()}`).bind(id, project).first(); }
  async list(owner: string, project: string, cursor?: string) {
    const state = await this.jobs.project(owner, project); const active = await this.db.prepare('SELECT active_manifest_id FROM projects WHERE id=?').bind(project).first<{ active_manifest_id: string | null }>();
    const before = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER; if (!Number.isSafeInteger(before) || before < 1) throw new JobConflict();
    const rows = await this.db.prepare('SELECT id,version_no FROM render_manifests WHERE project_id=? AND version_no<? ORDER BY version_no DESC LIMIT 26').bind(project, before).all<{ id: string; version_no: number }>();
    return { revision: state.revision, activeId: active!.active_manifest_id, current: active!.active_manifest_id ? await this.current(project, active!.active_manifest_id) : false, items: await Promise.all(rows.results.slice(0,25).map((r) => this.get(owner, project, r.id))), nextCursor: rows.results.length > 25 ? String(rows.results[24]!.version_no) : null };
  }
  async save(owner: string, project: string, operation: string, raw: unknown) {
    const input = montageInputSchema.parse(raw); const requestHash = await catalogHash({ action: 'SAVE_MANIFEST', project, input }); const replay = await this.jobs.receipt(owner, project, operation, requestHash); if (replay) return replay;
    const state = await this.jobs.project(owner, project); if (!state.active_script_version_id) throw new JobConflict(); if (input.baseManifestId) await this.get(owner, project, input.baseManifestId);
    const script = (await this.catalog.getScript(owner, project, state.active_script_version_id))!;
    const parsedScript = scriptOutputSchema.safeParse(script.data); if (!parsedScript.success) throw new JobConflict(); const keys = parsedScript.data.sections.map((s) => s.stableKey);
    const rows = await this.db.prepare('SELECT active_version_id FROM scenes WHERE project_id=? AND archived_at IS NULL AND stable_key IN(SELECT value FROM json_each(?)) ORDER BY order_index,id LIMIT 101').bind(project, JSON.stringify(keys)).all<{ active_version_id: string | null }>();
    if (rows.results.length !== keys.length || rows.results.length > 100 || rows.results.some((r) => !r.active_version_id)) throw new JobConflict();
    const versions = []; const assets = new Map<string, NonNullable<Awaited<ReturnType<CatalogRepository['getAsset']>>>>();
    for (const r of rows.results) { const v = (await this.catalog.getSceneVersion(owner, project, r.active_version_id!))!; versions.push(v); for (const id of new Set([...v.shots.flatMap((s) => s.assetId ? [s.assetId] : []), ...v.assetLinks.filter((l) => l.role !== 'VISUAL').map((l) => l.assetId)])) { if (!assets.has(id)) { const asset = await this.catalog.getAsset(owner, project, id); if (!asset) throw new JobNotFound(); assets.set(id, asset); } } }
    let manifest: RenderManifest; try { manifest = compileManifest(project, script.id, script.contentHash, versions, [...assets.values()], input); } catch { throw new JobConflict(); }
    const id = this.runtime.uuid(); const hash = await catalogHash(manifest); const now = this.jobs.timestamp();
    return new ContentRepository(this.db, this.runtime).mutate(owner, project, operation, requestHash, input.expectedRevision, id, 'CONTENT_CREATED', (g) => [this.db.prepare(`INSERT INTO render_manifests SELECT ?,?,COALESCE(max(version_no),0)+1,'CANDIDATE',?,?,? FROM render_manifests WHERE project_id=? HAVING ${g.sql}`).bind(id, project, hash, JSON.stringify(manifest), now, project, ...g.values)], { sql: `EXISTS(SELECT 1 FROM projects WHERE id=? AND active_script_version_id=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM scenes s WHERE s.id=json_extract(r.value,'$.sceneId') AND s.active_version_id=json_extract(r.value,'$.sceneVersionId') AND s.archived_at IS NULL)) AND (SELECT count(*) FROM scenes WHERE project_id=? AND archived_at IS NULL AND stable_key IN(SELECT value FROM json_each(?)))=?`, values: [project, script.id, JSON.stringify(manifest.scenes), project, JSON.stringify(keys), manifest.scenes.length] });
  }
  async activate(owner: string, project: string, id: string, operation: string, raw: unknown) {
    const input = manifestActivateSchema.parse(raw); const hash = await catalogHash({ action: 'ACTIVATE_MANIFEST', project, id, input }); const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return replay;
    const version = await this.get(owner, project, id); if (version.status !== 'CANDIDATE') throw new JobConflict();
    return new ContentRepository(this.db, this.runtime).mutate(owner, project, operation, hash, input.expectedRevision, id, 'CONTENT_ACTIVATED', (g) => [
      this.db.prepare(`UPDATE render_manifests SET status='SUPERSEDED' WHERE id=(SELECT active_manifest_id FROM projects WHERE id=?) AND status='APPROVED' AND ${g.sql}`).bind(project, ...g.values),
      this.db.prepare(`UPDATE render_manifests SET status='APPROVED' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
      this.db.prepare(`UPDATE projects SET active_manifest_id=?,status=CASE WHEN pause_requested=1 THEN 'PAUSED' ELSE 'RUNNING' END WHERE id=? AND ${g.sql}`).bind(id, project, ...g.values),
      this.db.prepare(`UPDATE jobs SET status='STALE',lease_token=NULL,lease_until=NULL,agent_id=NULL,revision=revision+1 WHERE project_id=? AND kind IN('QA','RENDER','SEO') AND status NOT IN('STALE','CANCELLED') AND ${g.sql}`).bind(project, ...g.values),
      this.db.prepare(`UPDATE job_attempts SET status='CANCELLED',end_at=? WHERE status='RUNNING' AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=job_attempts.job_id AND j.project_id=? AND j.status='STALE') AND ${g.sql}`).bind(this.jobs.timestamp(), project, ...g.values),
    ], { sql: `EXISTS(SELECT 1 FROM render_manifests m WHERE m.id=? AND m.status='CANDIDATE' AND ${currentManifestSql()})`, values: [id] });
  }
}
