import { z } from 'zod';
import { directionOutputSchema, researchOutputSchema, scriptOutputSchema, sceneVersionInputSchema, validateAgentOutput, validateScriptClaims } from '@video-studio/contracts';
import { MockDirectorAdapter, MockTextAdapter } from '@video-studio/providers';
import { directionPreset, modalityAssetType, planShotDurations } from '@video-studio/domain';
import type { Database } from './db/connection.js';
import { CatalogRepository, catalogHash, voiceStatements } from './db/catalog.js';
import { JobRunnerRepository, LeaseLost } from './db/job-runner.js';
import { JobRepository, defaultJobRuntime } from './db/jobs.js';
import type { JobRuntime } from './db/jobs.js';
import { ProjectRepository } from './db/repositories.js';
import { ProviderRepository } from './db/providers.js';
import { UsageRepository } from './db/usage.js';

export async function executeMockContent(db: Database, owner: string, project: string, runtime: JobRuntime = defaultJobRuntime) {
  const runner = new JobRunnerRepository(db, runtime); const lease = await runner.claim(owner, project, runtime.uuid(), 'CLOUD', 90000, true);
  if (!lease) return false;
  try {
    const provider = lease.job.providerId && await new ProviderRepository(db).get(owner, lease.job.providerId);
    if (!provider || provider.adapterKey !== 'MOCK_FIXTURE' || provider.integrationMode !== 'MOCK' || !provider.enabled) { await runner.fail(owner, lease.job.id, lease.leaseToken, 'UNSUPPORTED_CAPABILITY'); return false; }
    const stored = await new ProjectRepository(db).get(owner, project); if (!stored) throw new Error('INVALID_INPUT');
    const record = { ...stored.project, inputText: stored.inputText };
    const usage = new UsageRepository(db, runtime);
    await usage.reserve(owner, project, { jobId: lease.job.id, providerId: provider.id, eventKey: lease.attemptId, amountMicros: 0, units: 1, currency: record.settings.budget.currency });
    const adapter = new MockTextAdapter(); const now = runner.jobs.timestamp(); const id = runtime.uuid(); const catalog = new CatalogRepository(db);
    const role = z.enum(['RESEARCH', 'SCRIPT', 'DIRECTION']).parse(lease.job.kind);
    const request = { role: role === 'RESEARCH' ? 'RESEARCH' as const : 'SCRIPT' as const, title: record.title, inputText: record.inputText, inputType: record.inputType, language: record.settings.language, targetDurationMs: record.settings.targetDurationMs, now };
    const context = { ownerId: owner, projectId: project, idempotencyKey: lease.job.id, timeoutMs: 10000, signal: AbortSignal.timeout(10000) };
    if (role === 'DIRECTION') {
      const scriptRef = lease.inputRefs.find((r) => r.kind === 'SCRIPT');
      const script = scriptOutputSchema.parse((await catalog.getScript(owner, project, scriptRef!.id))?.data);
      const payload = z.object({ sectionKey: z.string(), regeneration: z.boolean().optional(), scope: sceneVersionInputSchema.shape.generationScope.optional(), instruction: z.string().optional() }).parse(lease.payload); const section = script.sections.find((s) => s.stableKey === payload.sectionKey);
      if (!section || !lease.job.sceneId) throw new Error('INVALID_INPUT');
      const scene = (await catalog.getScene(owner, project, lease.job.sceneId))!;
      const baseRef = lease.inputRefs.find((r) => r.kind === 'SCENE_VERSION'); const base = baseRef ? await catalog.getSceneVersion(owner, project, baseRef.id) : null;
      if (payload.regeneration && (!base || base.id !== scene.activeVersionId)) throw new Error('INVALID_INPUT');
      const duration = base?.durationMs ?? section.targetDurationMs;
      const narration = base && payload.scope === 'NARRATION' ? `Simulación de narración: ${base.narration} ${payload.instruction || 'Nueva versión candidata.'}` : base?.narration ?? section.narration;
      const shotDurations = base?.shots.length ? base.shots.map((s) => s.durationMs) : planShotDurations(duration);
      const plan = await validateAgentOutput(directionOutputSchema, () => new MockDirectorAdapter().start({ ...directionPreset(record.settings.style), stableKey: scene.stableKey, narration, durationMs: duration, language: record.settings.language,
        shots: shotDurations.map((durationMs, i) => ({ durationMs, assetType: modalityAssetType(record.settings.modality, i) })) }, context));
      const directed = plan.scenes[0]!;
      const input = sceneVersionInputSchema.parse({ scriptVersionId: scriptRef!.id, parentVersionId: scene.activeVersionId, narration: directed.narration, direction: { ...plan, modality: record.settings.modality, style: record.settings.style, musicMood: directed.musicMood, sfx: directed.sfx, continuityNotes: directed.continuityNotes }, durationMs: directed.durationMs, generationScope: payload.scope ?? 'ALL',
        shots: directed.shotPlans.map((s, orderIndex) => ({ orderIndex, durationMs: s.durationMs, type: s.assetType, prompt: `${s.visualPrompt}${payload.instruction ? ` Instrucción aportada como datos: ${payload.instruction}` : ''}`, camera: { framing: s.framing, movement: s.cameraMotion, light: s.light, composition: s.composition }, transition: base?.shots[orderIndex]?.transition ?? { type: s.transition }, assetId: null })), assetLinks: base && payload.scope !== 'ALL' ? base.assetLinks.filter((l) => l.role !== 'VISUAL' && (payload.scope !== 'NARRATION' || l.role !== 'VOICE')).map(({ assetId, role, offsetMs, trimStartMs, trimEndMs }) => ({ assetId, role, offsetMs, trimStartMs, trimEndMs })) : [] });
      if (base && payload.scope === 'VISUAL') { input.narration = base.narration; for (const key of ['musicMood', 'sfx', 'ambience', 'edit']) { if (key in base.direction) input.direction[key] = base.direction[key]!; else delete input.direction[key]; } }
      if (base?.voiceSegments.length && payload.scope === 'VISUAL') input.voiceSegments = base.voiceSegments;
      await catalog.validateSceneVersion(owner, project, scene.id, input);
      const hash = await catalogHash(input);
      await runner.publishContent(owner, lease.job.id, lease.leaseToken, { kind: 'SCENE_VERSION', id, hash }, { requireReview: !!scene.activeVersionId || !!payload.regeneration, before: (gate) => {
        const g = { sql: `${gate.sql} AND EXISTS(SELECT 1 FROM scenes WHERE id=? AND revision=? AND active_version_id IS ?)`, values: [...gate.values, scene.id, scene.revision, scene.activeVersionId] }; return [
        db.prepare(`INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,parent_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at) SELECT ?,?,?,?,?,COALESCE(MAX(version_no),0)+1,?,?,?,?,'DRAFT',?,? FROM scene_versions WHERE scene_id=? HAVING ${g.sql}`).bind(id, project, scene.id, input.scriptVersionId, input.parentVersionId, input.narration, JSON.stringify(input.direction), input.durationMs, input.generationScope, hash, now, scene.id, ...g.values),
        ...input.shots.map((s) => db.prepare(`INSERT INTO shots SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(runtime.uuid(), project, id, s.orderIndex, s.durationMs, s.type, s.prompt, JSON.stringify(s.camera), JSON.stringify(s.transition), null, ...g.values)),
        ...input.assetLinks.map((l) => db.prepare(`INSERT INTO asset_links SELECT ?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(runtime.uuid(), project, id, l.assetId, l.role, l.offsetMs, l.trimStartMs, l.trimEndMs, ...g.values)),
        ...voiceStatements(db, project, id, input, g, runtime.uuid),
        db.prepare(`UPDATE scene_versions SET status='CANDIDATE' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
      ]; }, after: (g, automatic) => !automatic ? [] : [
        db.prepare(`UPDATE scene_versions SET status='SUPERSEDED' WHERE id=? AND status='APPROVED' AND ${g.sql}`).bind(scene.activeVersionId, ...g.values),
        db.prepare(`UPDATE scene_versions SET status='APPROVED' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
        db.prepare(`UPDATE scenes SET active_version_id=?,revision=revision+1 WHERE id=? AND ${g.sql}`).bind(id, scene.id, ...g.values),
      ] });
    } else if (role === 'RESEARCH') {
      const data = await validateAgentOutput(researchOutputSchema, () => adapter.start(request, context));
      const sources = data.sources.map((s) => ({ url: s.url, title: s.title, acquiredAt: s.acquiredAt, notes: s.notes, provenance: s.provenance, accessStatus: s.accessStatus }));
      const hash = await catalogHash({ data, sources });
      await runner.publishContent(owner, lease.job.id, lease.leaseToken, { kind: 'RESEARCH', id, hash }, { before: (g) => [
        db.prepare(`INSERT INTO research_versions (id,project_id,version_no,data_json,content_hash,status,created_at) SELECT ?,?,COALESCE(MAX(version_no),0)+1,?,?,'DRAFT',? FROM research_versions WHERE project_id=? HAVING ${g.sql}`).bind(id, project, JSON.stringify(data), hash, now, project, ...g.values),
        ...sources.map((s) => db.prepare(`INSERT INTO sources SELECT ?,?,?,?,?,?,?,? WHERE ${g.sql}`).bind(runtime.uuid(), id, s.url, s.title, s.acquiredAt, s.notes, s.provenance, s.accessStatus, ...g.values)),
        db.prepare(`UPDATE research_versions SET status='CANDIDATE' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
      ], after: (g) => [db.prepare(`UPDATE research_versions SET status='APPROVED' WHERE id=? AND ${g.sql}`).bind(id, ...g.values)] });
    } else {
      const ref = lease.inputRefs.find((r) => r.kind === 'RESEARCH');
      const research = ref ? researchOutputSchema.parse((await catalog.getResearch(owner, project, ref.id))?.data) : null;
      const data = await validateAgentOutput(scriptOutputSchema, () => adapter.start(request, context)); validateScriptClaims(data, research);
      const hash = await catalogHash({ researchVersionId: ref?.id ?? null, data, targetDurationMs: record.settings.targetDurationMs });
      await runner.publishContent(owner, lease.job.id, lease.leaseToken, { kind: 'SCRIPT', id, hash }, { requireReview: !!(await runner.jobs.project(owner, project)).active_script_version_id, before: (g) => [
        db.prepare(`INSERT INTO script_versions (id,project_id,research_version_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) SELECT ?,?,?,COALESCE(MAX(version_no),0)+1,?,?,?,'CANDIDATE',? FROM script_versions WHERE project_id=? HAVING ${g.sql}`).bind(id, project, ref?.id ?? null, JSON.stringify(data), hash, record.settings.targetDurationMs, now, project, ...g.values),
      ], after: (g, automatic) => !automatic ? [] : [
        db.prepare(`UPDATE script_versions SET status='SUPERSEDED' WHERE id=(SELECT active_script_version_id FROM projects WHERE id=?) AND ${g.sql}`).bind(project, ...g.values),
        db.prepare(`UPDATE script_versions SET status='APPROVED' WHERE id=? AND ${g.sql}`).bind(id, ...g.values),
        db.prepare(`UPDATE projects SET active_script_version_id=?,revision=revision+1 WHERE id=? AND ${g.sql}`).bind(id, project, ...g.values),
      ] });
    }
    return true; // El coordinador retoma fanout persistente fuera del manejo de fallos del intento.
  } catch (error) {
    if (error instanceof LeaseLost) return false;
    await runner.fail(owner, lease.job.id, lease.leaseToken, 'INVALID_INPUT'); return false;
  }
}

// Reanudable tras corte entre publicación y planificación. Clave derivada del padre, sin duplicados.
export async function enqueueContentSuccessor(db: Database, owner: string, parentId: string, runtime: JobRuntime = defaultJobRuntime) {
  const jobs = new JobRepository(db, runtime); const parent = await jobs.get(owner, parentId);
  if (!parent || parent.status !== 'SUCCEEDED' || !parent.outputRef) return;
  if (parent.kind === 'RESEARCH') await jobs.create(owner, parent.projectId, parent.id, { kind: 'SCRIPT', executionTarget: 'CLOUD', dependencies: [parent.id], inputRefs: [parent.outputRef], payload: { predecessor: parent.id } });
  else if (parent.kind === 'SCRIPT') {
    await ensureScriptDirection(db, owner, parent.projectId, parent.outputRef.id, runtime);
  } else return;
  await db.prepare('INSERT OR IGNORE INTO content_expansions VALUES (?,?)').bind(parent.id, jobs.timestamp()).run();
}

export async function ensureScriptDirection(db: Database, owner: string, project: string, scriptId: string, runtime: JobRuntime = defaultJobRuntime) {
    if (await db.prepare('SELECT script_version_id FROM direction_expansions WHERE script_version_id=?').bind(scriptId).first()) return;
    const jobs = new JobRepository(db, runtime); const catalog = new CatalogRepository(db); const version = await catalog.getScript(owner, project, scriptId);
    const parsed = scriptOutputSchema.safeParse(version?.data); if (!parsed.success) return;
    if ((await jobs.project(owner, project)).active_script_version_id !== version!.id) return;
    const parent = await db.prepare("SELECT id FROM jobs WHERE project_id=? AND kind='SCRIPT' AND status='SUCCEEDED' AND json_extract(output_ref,'$.id')=? ORDER BY created_at,id LIMIT 1").bind(project, scriptId).first<{ id: string }>();
    const existing = new Set((await db.prepare("SELECT idempotency_key FROM jobs WHERE project_id=? AND kind='DIRECTION' AND json_extract(input_refs_json,'$[0].id')=?").bind(project, scriptId).all<{ idempotency_key: string }>()).results.map((r) => r.idempotency_key));
    let created = 0;
    for (const [index, section] of parsed.data.sections.entries()) {
      const hash = await catalogHash({ scriptId, section: section.stableKey });
      const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      if (existing.has(key)) continue;
      if (created >= 3) return;
      let scene = await db.prepare('SELECT id FROM scenes WHERE project_id=? AND stable_key=?').bind(project, section.stableKey).first<{ id: string }>();
      if (!scene) {
        await db.prepare('INSERT OR IGNORE INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,?,?,1)').bind(runtime.uuid(), project, section.stableKey, index).run();
        scene = await db.prepare('SELECT id FROM scenes WHERE project_id=? AND stable_key=?').bind(project, section.stableKey).first<{ id: string }>();
      }
      await jobs.create(owner, project, key, { kind: 'DIRECTION', executionTarget: 'CLOUD', sceneId: scene!.id, dependencies: parent ? [parent.id] : [], inputRefs: [{ kind: 'SCRIPT', id: scriptId, hash: version!.contentHash }], payload: { sectionKey: section.stableKey, predecessor: parent?.id ?? null } });
      created++;
    }
    await db.prepare('INSERT OR IGNORE INTO direction_expansions VALUES (?,?)').bind(scriptId, jobs.timestamp()).run();
}
