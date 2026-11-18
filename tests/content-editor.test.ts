import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scriptListSchema } from '@video-studio/contracts';
import { orchestrationHarness } from './support/orchestration.js';
import { researchData, scriptData } from './support/content.js';
import { ContentRepository } from '../apps/api/src/db/content.js';
import { sceneVersionFixture } from '@video-studio/testkit';
import { advanceCoordinator } from '../apps/api/src/coordinator.js';
import { authHarness } from './support/d1.js';

let h: Awaited<ReturnType<typeof orchestrationHarness>>; let repo: ContentRepository;
beforeEach(async () => { h = await orchestrationHarness(); repo = new ContentRepository(h.db, h.runtime); });
afterEach(async () => { await h.dispose(); });
describe('F4-03 editor privado y versiones', { timeout: 30000 }, () => {
  it('investigación idempotente, fuentes propias y rechazo de relaciones ajenas', async () => {
    const input = { expectedRevision: 1, baseVersionId: null, data: researchData() }; const op = crypto.randomUUID();
    const [a, b] = await Promise.all([repo.saveResearch(h.owner, h.project, op, input), repo.saveResearch(h.owner, h.project, op, input)]); expect(a).toEqual(b);
    expect((await repo.list(h.owner, h.project, 'research')).items).toHaveLength(1);
    await expect(repo.saveResearch(h.owner, h.project, op, { ...input, data: { ...input.data, uncertainties: [] } })).rejects.toThrow('JOB_CONFLICT');
    await expect(repo.saveResearch(h.other, h.foreign, crypto.randomUUID(), { ...input, baseVersionId: a.versionId })).rejects.toThrow();
    await expect(repo.saveResearch(h.owner, h.project, crypto.randomUUID(), { ...input, data: { ...input.data, claims: [{ id: 'bad', statement: 'Inventada', sourceIds: ['missing'], confidence: 'HIGH' }] } })).rejects.toThrow();
  });
  it('guardar no activa, activación explícita conserva versión y planifica sin navegador', async () => {
    const saved = await repo.saveScript(h.owner, h.project, crypto.randomUUID(), { expectedRevision: 1, baseVersionId: null, researchVersionId: null, data: scriptData() });
    expect((await h.jobs.project(h.owner, h.project)).active_script_version_id).toBeNull();
    const active = await repo.activate(h.owner, h.project, 'script', saved.versionId, crypto.randomUUID(), { expectedRevision: saved.revision, acknowledgeImpact: true });
    await advanceCoordinator(h.db, h.runtime); expect((await h.jobs.list(h.owner, { projectId: h.project })).items[0]?.kind).toBe('DIRECTION');
    const edit = { expectedRevision: (await h.jobs.project(h.owner, h.project)).revision, baseVersionId: saved.versionId, researchVersionId: null, data: { ...scriptData(), hook: 'Nueva apertura' } };
    const next = await repo.saveScript(h.owner, h.project, crypto.randomUUID(), edit);
    expect((await h.jobs.project(h.owner, h.project)).active_script_version_id).toBe(saved.versionId);
    await expect(repo.activate(h.owner, h.project, 'script', next.versionId, crypto.randomUUID(), { expectedRevision: active.revision, acknowledgeImpact: true })).rejects.toThrow('JOB_CONFLICT');
    const list = scriptListSchema.parse(await repo.list(h.owner, h.project, 'script')); expect(list.items.map((v) => v.status)).toEqual(['CANDIDATE', 'APPROVED']);
  });
  it('edición de escena conserva payload anterior, tomas, audio y parent exacto', async () => {
    const script = await repo.catalog.createScript(h.owner, h.project, { researchVersionId: null, data: scriptData(), targetDurationMs: 60000 });
    const active = await repo.catalog.activateScript(h.owner, h.project, script.id, 1); const scene = await repo.catalog.createScene(h.owner, h.project, { stableKey: 'scene-one', orderIndex: 0 });
    const version = await repo.catalog.createSceneVersion(h.owner, h.project, scene.id, sceneVersionFixture(script.id));
    await repo.catalog.activateSceneVersion(h.owner, h.project, scene.id, version.id, scene.revision);
    const input = { ...sceneVersionFixture(script.id), parentVersionId: version.id, narration: 'Nueva narración' };
    const saved = await repo.saveScene(h.owner, scene.id, crypto.randomUUID(), { expectedRevision: active.revision, baseVersionId: version.id, input });
    expect((await repo.catalog.getScene(h.owner, h.project, scene.id))?.activeVersionId).toBe(version.id);
    expect((await repo.catalog.getSceneVersion(h.owner, h.project, version.id))?.narration).toBe(version.narration);
    await repo.activate(h.owner, h.project, 'scene', saved.versionId, crypto.randomUUID(), { expectedRevision: saved.revision, acknowledgeImpact: true });
    expect((await repo.scene(h.owner, scene.id)).versions).toHaveLength(2);
    await expect(repo.saveScene(h.other, scene.id, crypto.randomUUID(), { expectedRevision: 1, baseVersionId: version.id, input })).rejects.toThrow('JOB_NOT_FOUND');
    await expect(repo.saveScene(h.owner, scene.id, crypto.randomUUID(), { expectedRevision: saved.revision + 1, baseVersionId: version.id, input })).rejects.toThrow('JOB_CONFLICT');
  });
  it('rutas reales exigen sesión/origen y mantienen contrato de error seguro', async () => {
    const api = await authHarness();
    try {
      const origin = api.origin; const password = `Fixture-${crypto.randomUUID()}`;
      const bootstrap = await api.fetch('/api/v1/bootstrap', { method: 'POST', headers: { origin, authorization: `Bearer ${api.bootstrapToken}`, 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Editor', email: 'editor@example.invalid', password }) }); expect(bootstrap.status).toBe(200);
      const login = await api.fetch('/api/v1/auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'editor@example.invalid', password }) }); const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      expect((await api.fetch(`/api/v1/projects/${h.project}/scripts`)).status).toBe(401);
      expect((await api.fetch(`/api/v1/scenes/${crypto.randomUUID()}`, { headers: { cookie } })).status).toBe(404);
      const write = await api.fetch(`/api/v1/projects/${h.project}/scripts`, { method: 'POST', headers: { cookie, origin: 'https://foreign.invalid', 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: '{}' }); expect(write.status).toBe(403);
      expect(JSON.stringify(await write.json())).not.toContain(password);
    } finally { await api.dispose(); }
  });
});
