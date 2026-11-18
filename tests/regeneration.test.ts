import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { affectedJobKinds, changedComponents, scopeComponents, sceneComponents } from '@video-studio/domain';
import { sceneVersionFixture } from '@video-studio/testkit';
import { orchestrationHarness } from './support/orchestration.js';
import { scriptData } from './support/content.js';
import { ContentRepository } from '../apps/api/src/db/content.js';
import { regenerateScene } from '../apps/api/src/regeneration.js';
import { ProviderRepository } from '../apps/api/src/db/providers.js';
import { providerFixture, reserveExternalFixture } from './support/provider-fixtures.js';
import { prepareJob } from '../apps/api/src/job-policy.js';
import { executeMockContent } from '../apps/api/src/content-executor.js';
import { ProductionRepository } from '../apps/api/src/db/production.js';
import { currentInputsSql } from '../apps/api/src/db/jobs.js';
import { ensureSceneFollowups } from '../apps/api/src/scene-followups.js';

let h: Awaited<ReturnType<typeof orchestrationHarness>>; let repo: ContentRepository;
beforeEach(async () => { h = await orchestrationHarness(); repo = new ContentRepository(h.db, h.runtime); });
afterEach(async () => { await h.dispose(); });
async function setup() {
  const script = await repo.catalog.createScript(h.owner, h.project, { researchVersionId: null, data: scriptData(), targetDurationMs: 60000 }); await repo.catalog.activateScript(h.owner, h.project, script.id, 1);
  const scene = await repo.catalog.createScene(h.owner, h.project, { stableKey: 'scene-one', orderIndex: 0 });
  const audio = [];
  for (const label of ['voice', 'music', 'ambience']) audio.push(await repo.catalog.createAsset(h.owner, h.project, { type: 'AUDIO', mime: 'audio/wav', bytes: 128, checksum: label[0] === 'v' ? 'a'.repeat(64) : label[0] === 'm' ? 'b'.repeat(64) : 'c'.repeat(64), durationMs: 10000, width: null, height: null, origin: 'MANUAL', license: { fixture: true }, prompt: null }));
  const input = { ...sceneVersionFixture(script.id), direction: { musicMood: 'Calma', ambience: 'Bosque', continuityNotes: 'Mantener eje' }, assetLinks: audio.map((a, i) => ({ assetId: a.id, role: (['VOICE', 'MUSIC', 'AMBIENCE'] as const)[i]!, offsetMs: 0, trimStartMs: 0, trimEndMs: 10000 })) };
  const base = await repo.catalog.createSceneVersion(h.owner, h.project, scene.id, input); await repo.catalog.activateSceneVersion(h.owner, h.project, scene.id, base.id, 1);
  const ref = { kind: 'SCENE_VERSION', id: base.id, hash: base.contentHash };
  return { script, scene, input, base, ref };
}
describe('F4-04 scopes, invalidación y conservación', { timeout: 30000 }, () => {
  it('política pura diferencia scopes; voz afecta timing, música no afecta narración', () => {
    expect(scopeComponents('MUSIC')).toEqual(['MUSIC']); expect(affectedJobKinds(['VISUAL'])).not.toContain('VOICE'); expect(affectedJobKinds(['MUSIC'])).not.toContain('ALIGNMENT');
    const before = Object.fromEntries(sceneComponents.map((c) => [c, 'a'])) as Record<typeof sceneComponents[number], string>;
    expect(changedComponents(before, { ...before, VOICE: 'b' })).toEqual(['VOICE', 'TIMING']); expect(() => scopeComponents('bogus')).toThrow();
  });
  it('visual crea candidata revisable incluso en AUTO; conserva voz/música y el render histórico', async () => {
    const s = await setup(); await h.db.prepare("UPDATE projects SET mode='AUTO' WHERE id=?").bind(h.project).run(); await new ProviderRepository(h.db, true).create(h.owner, crypto.randomUUID(), providerFixture());
    const voice = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'VOICE', executionTarget: 'CLOUD', inputRefs: [s.ref] });
    const music = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'ASSET', executionTarget: 'CLOUD', inputRefs: [s.ref], payload: { scope: 'MUSIC' } });
    const visual = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'ASSET', executionTarget: 'CLOUD', inputRefs: [s.ref] });
    const snapshot = { manifestHash: s.base.contentHash, sceneVersionId: s.base.id, fixture: true }; const render = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'RENDER', executionTarget: 'LOCAL', inputRefs: [s.ref], payload: snapshot });
    // Snapshot histórico sintético; no se declara un archivo de render real integrado.
    await h.db.prepare("UPDATE jobs SET status='SUCCEEDED',attempt_count=1 WHERE id=?").bind(render.id).run();
    await h.db.prepare("INSERT INTO job_attempts (id,job_id,attempt_no,request_id,lease_token,start_at,end_at,status,result_json) VALUES (?,?,1,?,?,?,?,'SUCCEEDED',?)").bind(crypto.randomUUID(), render.id, crypto.randomUUID(), crypto.randomUUID(), h.jobs.timestamp(), h.jobs.timestamp(), JSON.stringify(snapshot)).run();
    await h.db.prepare("UPDATE projects SET status='COMPLETED' WHERE id=?").bind(h.project).run();
    const op = crypto.randomUUID(); const request = { expectedRevision: 2, baseVersionId: s.base.id, scope: 'VISUAL', instruction: 'Nueva composición', providerId: null };
    const [job, replay] = await Promise.all([regenerateScene(h.db, h.owner, s.scene.id, op, request, h.runtime), regenerateScene(h.db, h.owner, s.scene.id, op, request, h.runtime)]); expect(job).toEqual(replay);
    expect((await h.jobs.project(h.owner, h.project)).status).toBe('RUNNING');
    await h.jobs.tick(h.owner, h.project); await prepareJob(h.db, h.owner, job.id, h.runtime); expect(await executeMockContent(h.db, h.owner, h.project, h.runtime)).toBe(true);
    const completed = (await h.jobs.get(h.owner, job.id))!; expect(completed.status).toBe('WAITING_APPROVAL'); expect((await repo.catalog.getScene(h.owner, h.project, s.scene.id))?.activeVersionId).toBe(s.base.id); expect((await h.jobs.get(h.owner, visual.id))?.status).toBe('READY');
    const candidate = (await repo.catalog.getSceneVersion(h.owner, h.project, completed.outputRef!.id))!; expect(candidate.narration).toBe(s.base.narration); expect(candidate.durationMs).toBe(s.base.durationMs); expect(candidate.direction.musicMood).toBe(s.base.direction.musicMood);
    expect(candidate.assetLinks.map((l) => [l.role, l.assetId]).sort()).toEqual(s.base.assetLinks.map((l) => [l.role, l.assetId]).sort());
    const cp = (await h.jobs.checkpoints(h.owner, h.project))[0]!; await new ProductionRepository(h.db, h.runtime).approve(h.owner, cp.id, crypto.randomUUID(), { expectedRevision: cp.revision, subjectVersionId: cp.subjectVersionId });
    expect((await h.jobs.get(h.owner, voice.id))?.status).toBe('READY'); expect((await h.jobs.get(h.owner, music.id))?.status).toBe('READY'); expect((await h.jobs.get(h.owner, visual.id))?.status).toBe('STALE'); expect((await h.jobs.get(h.owner, render.id))?.status).toBe('STALE');
    expect((await h.db.prepare(`SELECT ${currentInputsSql('j')} AS valid FROM jobs j WHERE j.id=?`).bind(voice.id).first<{ valid: number }>())?.valid).toBe(1);
    expect(JSON.parse((await h.db.prepare('SELECT payload_json FROM jobs WHERE id=?').bind(render.id).first<{ payload_json: string }>())!.payload_json)).toEqual(snapshot);
    expect((await h.jobs.attempts(h.owner, render.id))[0]?.status).toBe('SUCCEEDED');
    expect((await repo.catalog.getSceneVersion(h.owner, h.project, s.base.id))?.narration).toBe(s.base.narration);
    expect(await regenerateScene(h.db, h.owner, s.scene.id, op, request, h.runtime)).toEqual(job);
    await ensureSceneFollowups(h.db, h.owner, h.project, h.runtime); await ensureSceneFollowups(h.db, h.owner, h.project, h.runtime);
    const followups = await h.db.prepare("SELECT kind FROM jobs WHERE json_extract(payload_json,'$.followupVersionId')=?").bind(candidate.id).all<{ kind: string }>(); expect(followups.results.map((r) => r.kind)).toEqual(['ASSET']);
  });
  it('narración invalida voz/sync/visual y descendientes; otra escena e historial sobreviven', async () => {
    const s = await setup(); const second = await repo.catalog.createScene(h.owner, h.project, { stableKey: 'independent', orderIndex: 1 });
    const kinds = ['VOICE', 'ALIGNMENT', 'ASSET', 'EDIT', 'RENDER', 'SEO'] as const; const jobs = [];
    for (const kind of kinds) jobs.push(await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind, executionTarget: 'CLOUD', inputRefs: [s.ref] }));
    const independent = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: second.id, kind: 'VOICE', executionTarget: 'CLOUD' });
    const music = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'ASSET', executionTarget: 'CLOUD', inputRefs: [s.ref], payload: { scope: 'MUSIC' } });
    const saved = await repo.saveScene(h.owner, s.scene.id, crypto.randomUUID(), { expectedRevision: 2, baseVersionId: s.base.id, input: { ...s.input, parentVersionId: s.base.id, narration: 'Nueva narración autorizada.' } });
    await repo.activate(h.owner, h.project, 'scene', saved.versionId, crypto.randomUUID(), { expectedRevision: saved.revision, acknowledgeImpact: true });
    for (const j of jobs) expect((await h.jobs.get(h.owner, j.id))?.status).toBe('STALE'); expect((await h.jobs.get(h.owner, independent.id))?.status).toBe('PENDING'); expect((await h.jobs.get(h.owner, music.id))?.status).toBe('PENDING');
    expect((await repo.catalog.getSceneVersion(h.owner, h.project, saved.versionId))?.assetLinks.some((l) => l.role === 'VOICE')).toBe(false);
    await ensureSceneFollowups(h.db, h.owner, h.project, h.runtime); const work = await h.db.prepare("SELECT kind FROM jobs WHERE json_extract(payload_json,'$.followupVersionId')=? ORDER BY kind").bind(saved.versionId).all<{ kind: string }>(); expect(work.results.map((r) => r.kind)).toEqual(['ASSET', 'DIRECTION', 'VOICE']);
  });
  it('música conserva visual/voz; lease invalidado no publica y reserva incierta sigue retenida', async () => {
    const s = await setup(); const voice = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'VOICE', executionTarget: 'CLOUD', inputRefs: [s.ref] });
    const edit = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'EDIT', executionTarget: 'LOCAL', inputRefs: [s.ref] });
    await reserveExternalFixture(h, edit.id); const lease = await h.runner.claim(h.owner, h.project, crypto.randomUUID(), 'LOCAL'); expect(lease?.job.id).toBe(edit.id); await h.runner.beginExternalEffect(h.owner, edit.id, lease!.leaseToken);
    const saved = await repo.saveScene(h.owner, s.scene.id, crypto.randomUUID(), { expectedRevision: 2, baseVersionId: s.base.id, input: { ...s.input, parentVersionId: s.base.id, direction: { ...s.input.direction, musicMood: 'Tensión' } } });
    await repo.activate(h.owner, h.project, 'scene', saved.versionId, crypto.randomUUID(), { expectedRevision: saved.revision, acknowledgeImpact: true });
    expect((await h.jobs.get(h.owner, voice.id))?.status).toBe('READY'); expect((await h.jobs.get(h.owner, edit.id))?.error?.code).toBe('UNKNOWN_OUTCOME');
    await expect(h.runner.heartbeat(h.owner, edit.id, lease!.leaseToken)).rejects.toThrow(); expect((await h.db.prepare('SELECT status FROM usage_records WHERE job_id=?').bind(edit.id).first<{ status: string }>())?.status).toBe('UNKNOWN');
    const uncertain = (await h.jobs.get(h.owner, edit.id))!; await h.runner.reconcileOutcome(h.owner, edit.id, uncertain.revision, { kind: 'NOT_ACCEPTED' }); expect((await h.jobs.get(h.owner, edit.id))?.status).toBe('STALE'); expect((await h.db.prepare('SELECT status FROM usage_records WHERE job_id=?').bind(edit.id).first<{ status: string }>())?.status).toBe('RELEASED');
  });
  it('guion nuevo invalida derivados anteriores sin borrar escenas/versiones', async () => {
    const s = await setup(); const asset = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { sceneId: s.scene.id, kind: 'ASSET', executionTarget: 'CLOUD', inputRefs: [s.ref] });
    const saved = await repo.saveScript(h.owner, h.project, crypto.randomUUID(), { expectedRevision: 2, baseVersionId: s.script.id, researchVersionId: null, data: { ...scriptData(), hook: 'Nuevo guion global.' } });
    await repo.activate(h.owner, h.project, 'script', saved.versionId, crypto.randomUUID(), { expectedRevision: saved.revision, acknowledgeImpact: true });
    expect((await repo.catalog.getScene(h.owner, h.project, s.scene.id))?.activeVersionId).toBeNull(); expect((await repo.catalog.getSceneVersion(h.owner, h.project, s.base.id))?.status).toBe('INVALIDATED'); expect((await h.jobs.get(h.owner, asset.id))?.status).toBe('STALE');
    await expect(regenerateScene(h.db, h.other, s.scene.id, crypto.randomUUID(), { expectedRevision: 1, baseVersionId: s.base.id, scope: 'VISUAL' }, h.runtime)).rejects.toThrow('JOB_NOT_FOUND');
  });
});
