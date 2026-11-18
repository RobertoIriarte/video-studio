import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estimateVoiceTimings, retimeShots } from '@video-studio/domain';
import { bytesHash, inspectMedia, sceneVersionInputSchema, sceneVersionSchema } from '@video-studio/contracts';
import { MockVoiceAdapter } from '../packages/providers/src/index.js';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { ManualRepository } from '../apps/api/src/manual.js';
import { ProductionRepository } from '../apps/api/src/db/production.js';
import { prepareJob } from '../apps/api/src/job-policy.js';
import { ensureSceneFollowups } from '../apps/api/src/scene-followups.js';
import { orchestrationHarness } from './support/orchestration.js';
import { scriptData } from './support/content.js';
let h: Awaited<ReturnType<typeof orchestrationHarness>>;
beforeEach(async () => { h = await orchestrationHarness(); }); afterEach(async () => { await h.dispose(); });
async function setup() {
  const catalog = new CatalogRepository(h.db); const script = await catalog.createScript(h.owner, h.project, { researchVersionId: null, data: scriptData(), targetDurationMs: 60000 }); await catalog.activateScript(h.owner, h.project, script.id, 1);
  const scene = await catalog.createScene(h.owner, h.project, { stableKey: 'scene-one', orderIndex: 0 });
  const asset = async (type: 'IMAGE' | 'VIDEO', durationMs: number | null) => { const a = await catalog.createAsset(h.owner, h.project, { type, mime: type === 'IMAGE' ? 'image/png' : 'video/mp4', bytes: 128, checksum: 'c'.repeat(64), durationMs, width: 2, height: 2, origin: 'MANUAL', license: { source: 'Fixture', rightsAcknowledged: true }, prompt: null }); await h.db.prepare("UPDATE assets SET availability='LOCAL_ONLY' WHERE id=?").bind(a.id).run(); return a; };
  const image = await asset('IMAGE', null); const video = await asset('VIDEO', 500);
  const base = await catalog.createSceneVersion(h.owner, h.project, scene.id, { scriptVersionId: script.id, parentVersionId: null, narration: 'Primera frase. Segunda frase.', direction: {}, durationMs: 1000, generationScope: 'ALL', shots: [image, video].map((a, i) => ({ orderIndex: i, durationMs: 500, type: a.type, prompt: 'Fixture', camera: {}, transition: {}, assetId: a.id })), assetLinks: [] }); await catalog.activateSceneVersion(h.owner, h.project, scene.id, base.id, 1);
  const tone = await new MockVoiceAdapter().start({ durationMs: 3000 }, { ownerId: h.owner, projectId: h.project, idempotencyKey: crypto.randomUUID(), timeoutMs: 1000, signal: AbortSignal.timeout(1000) }); const metadata = inspectMedia(tone.bytes, 'audio/wav')!;
  const audio = await catalog.createAsset(h.owner, h.project, { ...metadata, checksum: await bytesHash(tone.bytes), origin: 'MANUAL', license: { source: 'Tono sintético de fixture; no voz hablada', rightsAcknowledged: true }, prompt: 'MockVoiceAdapter speech=false' }); await h.db.prepare("UPDATE assets SET availability='LOCAL_ONLY' WHERE id=?").bind(audio.id).run();
  const job = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'VOICE', executionTarget: 'MANUAL', sceneId: scene.id, inputRefs: [{ kind: 'SCENE_VERSION', id: base.id, hash: base.contentHash }], payload: { scope: 'VOICE' } }); await h.jobs.tick(h.owner, h.project); await prepareJob(h.db, h.owner, job.id, h.runtime);
  return { catalog, scene, base, image, video, audio, job: (await h.jobs.get(h.owner, job.id))! };
}
describe('F5-04 voz importada/mock y timings', { timeout: 60000 }, () => {
  it('estimación explícita, suma exacta y WAV mock medible sin fingir voz hablada', async () => {
    expect(estimateVoiceTimings('Uno dos tres.', 1001)).toEqual([{ segmentIndex: 0, text: 'Uno', startMs: 0, endMs: 333 }, { segmentIndex: 1, text: 'dos', startMs: 333, endMs: 667 }, { segmentIndex: 2, text: 'tres.', startMs: 667, endMs: 1001 }]);
    expect(retimeShots([{ durationMs: 1 }, { durationMs: 2 }], 1001).reduce((n, s) => n + s.durationMs, 0)).toBe(1001); expect(() => retimeShots([{ durationMs: 1 }, { durationMs: 1 }], 1)).toThrow();
    const adapter = new MockVoiceAdapter(); expect(adapter.capabilities().speech).toBe(false); const result = await adapter.start({ durationMs: 1250 }, { ownerId: h.owner, projectId: h.project, idempotencyKey: crypto.randomUUID(), timeoutMs: 1000, signal: AbortSignal.timeout(1000) }); expect(inspectMedia(result.bytes, 'audio/wav')!.durationMs).toBe(1250); expect(result.simulated).toBe(true); expect(() => adapter.validate({ durationMs: 5001 })).toThrow();
  });
  it('duración real, candidata inmutable, retiming e invalidación al aprobar; preserva música y recursos anteriores', async () => {
    const s = await setup(); const ref = { kind: 'SCENE_VERSION', id: s.base.id, hash: s.base.contentHash };
    const render = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'RENDER', executionTarget: 'LOCAL', sceneId: s.scene.id, inputRefs: [ref] }); const music = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'ASSET', executionTarget: 'MANUAL', sceneId: s.scene.id, inputRefs: [ref], payload: { scope: 'MUSIC' } });
    const manual = new ManualRepository(h.db, h.runtime); const key = crypto.randomUUID(); const input = { expectedRevision: s.job.revision, result: { kind: 'VOICE', assetId: s.audio.id } }; const saved = await manual.submit(h.owner, s.job.id, key, input); expect(await manual.submit(h.owner, s.job.id, key, input)).toEqual(saved);
    const candidate = (await s.catalog.getSceneVersion(h.owner, h.project, saved.outputRef!.id))!; expect(candidate.durationMs).toBe(3000); expect(candidate.narration).toBe(s.base.narration); expect(candidate.shots[0]!.assetId).toBe(s.image.id); expect(candidate.shots[1]!.assetId).toBeNull(); expect(candidate.voiceSegments.at(-1)!.endMs).toBe(3000); expect(candidate.voiceSegments[0]!.alignment.method).toBe('ESTIMATED'); expect((await h.jobs.get(h.owner, render.id))!.status).toBe('PENDING');
    const cp = (await h.jobs.checkpoints(h.owner, h.project)).find((c) => c.status === 'PENDING')!; await new ProductionRepository(h.db, h.runtime).approve(h.owner, cp.id, crypto.randomUUID(), { expectedRevision: cp.revision, subjectVersionId: cp.subjectVersionId });
    expect((await h.jobs.get(h.owner, render.id))!.status).toBe('STALE'); expect((await h.jobs.get(h.owner, music.id))!.status).not.toBe('STALE'); expect((await s.catalog.getSceneVersion(h.owner, h.project, s.base.id))!.shots[1]!.assetId).toBe(s.video.id);
    await expect(h.db.prepare("UPDATE voice_segments SET text='changed' WHERE scene_version_id=?").bind(candidate.id).run()).rejects.toThrow(); await expect(h.db.prepare('DELETE FROM voice_segments WHERE scene_version_id=?').bind(candidate.id).run()).rejects.toThrow();
    await ensureSceneFollowups(h.db, h.owner, h.project, h.runtime); expect((await h.jobs.list(h.owner, { projectId: h.project })).items.filter((j) => j.kind === 'ALIGNMENT')).toHaveLength(0);
  });
  it('tiempos manuales exactos, cobertura/solapamiento/duración y ownership validados; contrato antiguo compatible', async () => {
    const s = await setup(); const manual = new ManualRepository(h.db, h.runtime); const segments = [{ segmentIndex: 0, text: 'Primera frase.', startMs: 100, endMs: 1200 }, { segmentIndex: 1, text: 'Segunda frase.', startMs: 1500, endMs: 2900 }];
    await expect(manual.submit(h.owner, s.job.id, crypto.randomUUID(), { expectedRevision: s.job.revision, result: { kind: 'VOICE', assetId: crypto.randomUUID(), segments } })).rejects.toThrow('JOB_NOT_FOUND');
    for (const changed of [[{ ...segments[0]!, endMs: 3100 }, segments[1]!], [{ ...segments[0]!, text: 'Texto diferente' }, segments[1]!]]) await expect(manual.submit(h.owner, s.job.id, crypto.randomUUID(), { expectedRevision: s.job.revision, result: { kind: 'VOICE', assetId: s.audio.id, segments: changed } })).rejects.toThrow();
    const saved = await manual.submit(h.owner, s.job.id, crypto.randomUUID(), { expectedRevision: s.job.revision, result: { kind: 'VOICE', assetId: s.audio.id, segments } }); const candidate = (await s.catalog.getSceneVersion(h.owner, h.project, saved.outputRef!.id))!; expect(candidate.voiceSegments.map(({ audioAssetId: _id, alignment: _a, ...timing }) => { void _id; void _a; return timing; })).toEqual(segments); expect(candidate.voiceSegments[0]!.alignment.method).toBe('MANUAL');
    const { voiceSegments: _old, ...oldDto } = s.base; void _old; expect(sceneVersionSchema.parse(oldDto).voiceSegments).toEqual([]); const oldInput = manual.sceneInput(s.base); expect(sceneVersionInputSchema.parse(oldInput).voiceSegments).toBeUndefined();
  });
});
