import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManualRepository } from '../apps/api/src/manual.js';
import { prepareJob } from '../apps/api/src/job-policy.js';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { ProductionRepository } from '../apps/api/src/db/production.js';
import { advanceCoordinator } from '../apps/api/src/coordinator.js';
import { ensureSceneFollowups } from '../apps/api/src/scene-followups.js';
import { orchestrationHarness } from './support/orchestration.js';
import { researchData, scriptData } from './support/content.js';
import { manualResultSchema } from '@video-studio/contracts';
let h: Awaited<ReturnType<typeof orchestrationHarness>>; let manual: ManualRepository;
beforeEach(async () => { h = await orchestrationHarness(); manual = new ManualRepository(h.db, h.runtime); });
afterEach(async () => { await h.dispose(); });
async function waiting(kind: 'RESEARCH' | 'SCRIPT' | 'DIRECTION' | 'ASSET', options = {}) { const j = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind, executionTarget: 'MANUAL', ...options }); await h.jobs.tick(h.owner, h.project); await prepareJob(h.db, h.owner, j.id, h.runtime); return (await h.jobs.get(h.owner, j.id))!; }
async function approve() { const cp = (await h.jobs.checkpoints(h.owner, h.project)).find((c) => c.status === 'PENDING')!; await new ProductionRepository(h.db, h.runtime).approve(h.owner, cp.id, crypto.randomUUID(), { expectedRevision: cp.revision, subjectVersionId: cp.subjectVersionId }); }
describe('F5-03 resultados manuales persistentes', { timeout: 60000 }, () => {
  it('research/script idempotentes y atómicos; revisión explícita y sucesor sin navegador', async () => {
    const j = await waiting('RESEARCH'); const packet = await manual.packet(h.owner, j.id); expect(packet.prompt).toContain('Contrato'); const key = crypto.randomUUID(); const input = { expectedRevision: j.revision, result: { kind: 'RESEARCH', data: researchData() } };
    const results = await Promise.all([manual.submit(h.owner, j.id, key, input), manual.submit(h.owner, j.id, key, input)]); expect(results[0]).toEqual(results[1]); expect(await h.jobs.attempts(h.owner, j.id)).toHaveLength(1);
    await expect(manual.submit(h.owner, j.id, key, { ...input, expectedRevision: j.revision + 1 })).rejects.toThrow('JOB_CONFLICT');
    await advanceCoordinator(h.db, h.runtime); await advanceCoordinator(h.db, h.runtime); const script = (await h.jobs.list(h.owner, { projectId: h.project })).items.find((j) => j.kind === 'SCRIPT')!;
    const saved = await manual.submit(h.owner, script.id, crypto.randomUUID(), { expectedRevision: script.revision, result: { kind: 'SCRIPT', data: scriptData() } }); expect(saved.status).toBe('WAITING_APPROVAL'); expect((await h.jobs.project(h.owner, h.project)).active_script_version_id).toBeNull();
    await approve(); await advanceCoordinator(h.db, h.runtime); expect((await h.jobs.list(h.owner, { projectId: h.project })).items.some((j) => j.kind === 'DIRECTION')).toBe(true);
    await expect(manual.packet(h.other, j.id)).rejects.toThrow('JOB_NOT_FOUND'); expect((await h.db.prepare('SELECT count(*) n FROM usage_records').first<{ n: number }>())!.n).toBe(0);
  });
  it('inputs inválidos, revisión antigua, pausa e incertidumbre no crean candidatas', async () => {
    const j = await waiting('SCRIPT'); const input = { expectedRevision: j.revision, result: { kind: 'SCRIPT', data: scriptData() } };
    await expect(manual.submit(h.owner, j.id, crypto.randomUUID(), { ...input, expectedRevision: j.revision + 1 })).rejects.toThrow();
    await h.db.prepare('UPDATE projects SET pause_requested=1 WHERE id=?').bind(h.project).run(); await expect(manual.submit(h.owner, j.id, crypto.randomUUID(), input)).rejects.toThrow();
    expect((await h.db.prepare('SELECT count(*) n FROM script_versions').first<{ n: number }>())!.n).toBe(0);
    await h.db.prepare('UPDATE projects SET pause_requested=0 WHERE id=?').bind(h.project).run(); await h.db.prepare(`UPDATE jobs SET error_json='{"code":"UNKNOWN_OUTCOME","message":"Incierto","retryable":false}' WHERE id=?`).bind(j.id).run(); await expect(manual.submit(h.owner, j.id, crypto.randomUUID(), input)).rejects.toThrow();
    expect(manualResultSchema.safeParse({ kind: 'RESEARCH', data: { ...researchData(), claims: [{ id: 'x', statement: 'Sin fuente', sourceIds: [], confidence: 'HIGH' }] } }).success).toBe(false);
  });
  it('dirección y stock verificados, conserva activa; rechaza recurso ajeno', async () => {
    const s = await waiting('SCRIPT'); await manual.submit(h.owner, s.id, crypto.randomUUID(), { expectedRevision: s.revision, result: { kind: 'SCRIPT', data: scriptData() } }); await approve(); await advanceCoordinator(h.db, h.runtime);
    const direction = (await h.jobs.list(h.owner, { projectId: h.project })).items.find((j) => j.kind === 'DIRECTION')!; const packet = await manual.packet(h.owner, direction.id); const result = manualResultSchema.parse(JSON.parse(packet.template));
    const short = await manual.catalog.createAsset(h.owner, h.project, { type: 'VIDEO', mime: 'video/mp4', bytes: 128, checksum: 'd'.repeat(64), durationMs: 500, width: 2, height: 2, origin: 'MANUAL', license: { source: 'Fixture', rightsAcknowledged: true }, prompt: null }); await h.db.prepare("UPDATE assets SET availability='LOCAL_ONLY' WHERE id=?").bind(short.id).run();
    if (result.kind !== 'DIRECTION') throw new Error('EXPECTED_DIRECTION');
    await expect(manual.submit(h.owner, direction.id, crypto.randomUUID(), { expectedRevision: direction.revision, result: { ...result, data: { ...result.data, shots: [{ ...result.data.shots[0]!, type: 'VIDEO', assetId: short.id }] } } })).rejects.toThrow('JOB_CONFLICT');
    await manual.submit(h.owner, direction.id, crypto.randomUUID(), { expectedRevision: direction.revision, result }); await approve();
    const catalog = new CatalogRepository(h.db); const scene = (await catalog.getScene(h.owner, h.project, direction.sceneId!))!; const base = (await catalog.getSceneVersion(h.owner, h.project, scene.activeVersionId!))!;
    const asset = await catalog.createAsset(h.owner, h.project, { type: 'IMAGE', mime: 'image/png', bytes: 16, checksum: 'b'.repeat(64), durationMs: null, width: 2, height: 2, origin: 'MANUAL', license: { source: 'Fixture propio', rightsAcknowledged: true }, prompt: null }); await h.db.prepare("UPDATE assets SET availability='REMOTE_AVAILABLE' WHERE id=?").bind(asset.id).run();
    const job = await waiting('ASSET', { sceneId: scene.id, inputRefs: [{ kind: 'SCENE_VERSION', id: base.id, hash: base.contentHash }] });
    await expect(manual.submit(h.owner, job.id, crypto.randomUUID(), { expectedRevision: job.revision, result: { kind: 'ASSET', assets: [{ shotOrder: 0, assetId: crypto.randomUUID() }] } })).rejects.toThrow('JOB_NOT_FOUND');
    const saved = await manual.submit(h.owner, job.id, crypto.randomUUID(), { expectedRevision: job.revision, result: { kind: 'ASSET', assets: [{ shotOrder: 0, assetId: asset.id }] } }); expect(saved.status).toBe('WAITING_APPROVAL'); expect((await catalog.getScene(h.owner, h.project, scene.id))!.activeVersionId).toBe(base.id); await approve(); expect((await catalog.getSceneVersion(h.owner, h.project, saved.outputRef!.id))!.shots[0]!.assetId).toBe(asset.id);
    // Catalog compatibility permits old metadata-only resources. Followups must still
    // detect an assigned video which is too short after a timing edit.
    await ensureSceneFollowups(h.db, h.owner, h.project, h.runtime);
    const active = (await catalog.getSceneVersion(h.owner, h.project, saved.outputRef!.id))!;
    const changed = manual.sceneInput(active); changed.shots = [{ ...changed.shots[0]!, type: 'VIDEO', assetId: short.id }];
    const candidate = await catalog.createSceneVersion(h.owner, h.project, scene.id, changed); const current = (await catalog.getScene(h.owner, h.project, scene.id))!; await catalog.activateSceneVersion(h.owner, h.project, scene.id, candidate.id, current.revision);
    await ensureSceneFollowups(h.db, h.owner, h.project, h.runtime); expect((await h.jobs.list(h.owner, { projectId: h.project })).items.some((j) => j.kind === 'ASSET' && j.outputRef === null)).toBe(true);
  });
});
