import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHarness } from './support/d1.js';
import { checkpointDtoSchema, jobsListSchema, productionSchema, projectDetailSchema, providerDtoSchema, startResponseSchema } from '@video-studio/contracts';
import { fixtureId, projectInputFixture, sceneVersionFixture, scriptFixture } from '@video-studio/testkit';
import { JobRepository } from '../apps/api/src/db/jobs.js';
import { JobRunnerRepository } from '../apps/api/src/db/job-runner.js';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { createAuth } from '../apps/api/src/auth/service.js';

let h: Awaited<ReturnType<typeof authHarness>>; let cookie: string; const owner = fixtureId(700);
beforeEach(async () => {
  h = await authHarness(); const password = `Fixture-${crypto.randomUUID()}`;
  expect((await request('POST', '/bootstrap', { name: 'Fixture', email: 'orchestration@example.invalid', password }, '', { authorization: `Bearer ${h.bootstrapToken}`, 'idempotency-key': owner })).status).toBe(200);
  const login = await request('POST', '/auth/sign-in/email', { email: 'orchestration@example.invalid', password }, '');
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}, 30000);
afterEach(async () => { await h?.dispose(); });
function request(method: string, path: string, body?: unknown, session = cookie, extra: Record<string, string> = {}) {
  return h.fetch(`/api/v1${path}`, { method, headers: { origin: h.origin, 'content-type': 'application/json', cookie: session, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function project(wizardStep = 5) {
  const response = await request('POST', '/projects', { ...projectInputFixture(), wizardStep }, cookie, { 'idempotency-key': crypto.randomUUID() });
  expect(response.status).toBe(201); return projectDetailSchema.parse(await response.json());
}
async function checkpoint(projectId: string, version?: Awaited<ReturnType<CatalogRepository['createScript']>>, blocking = false) {
  const script = version ?? await new CatalogRepository(h.db).createScript(owner, projectId, scriptFixture());
  const jobs = new JobRepository(h.db); const runner = new JobRunnerRepository(h.db);
  const job = await jobs.create(owner, projectId, crypto.randomUUID(), { kind: 'SCRIPT', executionTarget: 'CLOUD' });
  const lease = await runner.claim(owner, projectId, fixtureId(701));
  expect(lease?.job.id).toBe(job.id);
  await runner.complete(owner, job.id, lease!.leaseToken, { kind: 'SCRIPT', id: script.id, hash: script.contentHash }, blocking);
  return { script, job, cp: (await jobs.checkpoints(owner, projectId)).find((cp) => cp.jobId === job.id) };
}
describe('F3-04 · API privada de orquestación workerd/D1', { timeout: 30000 }, () => {
  it('inicio concurrente/idempotente crea un solo job y overview sin porcentaje inventado', async () => {
    const p = await project(); const op = crypto.randomUUID();
    const start = () => request('POST', `/projects/${p.id}/start`, { expectedRevision: p.revision }, cookie, { 'idempotency-key': op });
    const responses = await Promise.all([start(), start()]); expect(responses.map((r) => r.status)).toEqual([202, 202]);
    const bodies = await Promise.all(responses.map((r) => r.json())); expect(bodies[0]).toEqual(bodies[1]); startResponseSchema.parse(bodies[0]);
    const overview = productionSchema.parse(await (await request('GET', `/projects/${p.id}/production`)).json());
    expect(overview.progress).toEqual({ completedJobs: 0, registeredJobs: 1, plannedTotal: null }); expect(overview.jobs[0]?.status).toBe('WAITING_MANUAL');
    expect(overview.project.status).toBe('WAITING_RESOURCE'); expect(overview.agent).toBe('NOT_CONFIGURED');
    expect((await request('POST', `/projects/${p.id}/start`, { expectedRevision: p.revision + 1 }, cookie, { 'idempotency-key': op })).status).toBe(409);
  });
  it('borrador incompleto/revisión vieja no crea jobs huérfanos; Origin y sesión se validan', async () => {
    const p = await project(2);
    expect((await request('POST', `/projects/${p.id}/start`, { expectedRevision: p.revision }, cookie, { 'idempotency-key': crypto.randomUUID() })).status).toBe(409);
    expect(await h.db.prepare('SELECT count(*) AS n FROM jobs').first()).toEqual({ n: 0 });
    expect((await request('GET', '/jobs', undefined, '')).status).toBe(401);
    expect((await request('POST', `/projects/${p.id}/start`, { expectedRevision: 1 }, cookie, { origin: 'https://foreign.invalid', 'idempotency-key': crypto.randomUUID() })).status).toBe(403);
  });
  it('pause/resume son idempotentes y respetan expectedRevision', async () => {
    const p = await project(); await request('POST', `/projects/${p.id}/start`, { expectedRevision: 1 }, cookie, { 'idempotency-key': crypto.randomUUID() });
    const current = productionSchema.parse(await (await request('GET', `/projects/${p.id}/production`)).json()); const key = crypto.randomUUID();
    const pause = () => request('POST', `/projects/${p.id}/pause`, { expectedRevision: current.project.revision }, cookie, { 'idempotency-key': key });
    const first = await pause(); expect(first.status).toBe(202); const paused = await first.json() as { revision: number };
    expect(await (await pause()).json()).toEqual(paused);
    const resumed = await request('POST', `/projects/${p.id}/resume`, { expectedRevision: paused.revision }, cookie, { 'idempotency-key': crypto.randomUUID() }); expect(resumed.status).toBe(202);
    expect((await request('POST', `/projects/${p.id}/pause`, { expectedRevision: 1 }, cookie, { 'idempotency-key': crypto.randomUUID() })).status).toBe(409);
  });
  it('T11 checkpoint viejo da 409; aprobar exacta activa y conserva historial sin duplicar', async () => {
    const p = await project(); const first = await checkpoint(p.id); const second = await checkpoint(p.id);
    const old = await request('POST', `/checkpoints/${first.cp!.id}/approve`, { expectedRevision: 1, subjectVersionId: first.script.id }, cookie, { 'idempotency-key': crypto.randomUUID() }); expect(old.status).toBe(409);
    const key = crypto.randomUUID(); const approve = () => request('POST', `/checkpoints/${second.cp!.id}/approve`, { expectedRevision: 1, subjectVersionId: second.script.id }, cookie, { 'idempotency-key': key });
    const response = await approve(); expect(response.status).toBe(200); const approved = checkpointDtoSchema.parse(await response.json());
    expect(approved.status).toBe('APPROVED'); expect(await (await approve()).json()).toEqual(approved);
    expect(await h.db.prepare('SELECT active_script_version_id FROM projects WHERE id=?').bind(p.id).first()).toEqual({ active_script_version_id: second.script.id });
    expect((await new CatalogRepository(h.db).getScript(owner, p.id, first.script.id))?.status).toBe('CANDIDATE');
  });
  it('T10 AUTO no tiene checkpoint ordinario; blocker sí requiere aprobación', async () => {
    const p = await project(); await h.db.prepare("UPDATE projects SET mode='AUTO' WHERE id=?").bind(p.id).run();
    expect((await checkpoint(p.id)).cp).toBeUndefined(); const blocked = await checkpoint(p.id, undefined, true); expect(blocked.cp?.blocking).toBe(true);
    const overview = productionSchema.parse(await (await request('GET', `/projects/${p.id}/production`)).json()); expect(overview.checkpoints).toHaveLength(1);
  });
  it('aprobación concurrente de dirección activa una sola versión compatible con el guion', async () => {
    const p = await project(); const catalog = new CatalogRepository(h.db);
    const script = await catalog.createScript(owner, p.id, scriptFixture()); await catalog.activateScript(owner, p.id, script.id, 1);
    const scene = await catalog.createScene(owner, p.id, { stableKey: 'opening', orderIndex: 0 });
    const version = await catalog.createSceneVersion(owner, p.id, scene.id, sceneVersionFixture(script.id));
    const jobs = new JobRepository(h.db); const runner = new JobRunnerRepository(h.db);
    const job = await jobs.create(owner, p.id, crypto.randomUUID(), { kind: 'DIRECTION', executionTarget: 'CLOUD', sceneId: scene.id, inputRefs: [{ kind: 'SCRIPT', id: script.id, hash: script.contentHash }] });
    const lease = (await runner.claim(owner, p.id, fixtureId(703)))!;
    await runner.complete(owner, job.id, lease.leaseToken, { kind: 'SCENE_VERSION', id: version.id, hash: version.contentHash });
    const cp = (await jobs.checkpoints(owner, p.id))[0]!; const key = crypto.randomUUID();
    const approve = () => request('POST', `/checkpoints/${cp.id}/approve`, { expectedRevision: cp.revision, subjectVersionId: version.id }, cookie, { 'idempotency-key': key });
    const responses = await Promise.all([approve(), approve()]); expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    expect(await catalog.getScene(owner, p.id, scene.id)).toMatchObject({ activeVersionId: version.id, revision: 2 });
  });
  it('listado cursor/estado, detalles sin token y configuración manual real', async () => {
    const p = await project(); const jobs = new JobRepository(h.db);
    for (let i = 0; i < 3; i++) await jobs.create(owner, p.id, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD' });
    const first = jobsListSchema.parse(await (await request('GET', '/jobs?limit=1&status=PENDING')).json()); expect(first.items).toHaveLength(1);
    const next = jobsListSchema.parse(await (await request('GET', `/jobs?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).json()); expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
    const detail = await (await request('GET', `/jobs/${first.items[0]!.id}`)).json(); expect(JSON.stringify(detail)).not.toContain('leaseToken'); expect(detail).not.toHaveProperty('payload');
    const provider = await request('POST', '/providers', { name: 'Texto manual', kind: 'TEXT' }, cookie, { 'idempotency-key': crypto.randomUUID() }); expect(provider.status).toBe(201);
    const config = providerDtoSchema.parse(await provider.json()); expect(config.status).toBe('MANUAL_ONLY'); expect(config).not.toHaveProperty('credentialRef');
  });
  it('T02 otro usuario no accede a job/checkpoint/usage ni aprueba recursos ajenos', async () => {
    const p = await project(); const c = await checkpoint(p.id); const password = `Fixture-${crypto.randomUUID()}`;
    await createAuth(h.db, { origin: h.origin, secret: h.secret }, fixtureId(702)).api.signUpEmail({ body: { name: 'Otro', email: 'other-orchestration@example.invalid', password } });
    const login = await request('POST', '/auth/sign-in/email', { email: 'other-orchestration@example.invalid', password });
    const other = login.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
    expect(jobsListSchema.parse(await (await request('GET', '/jobs', undefined, other)).json()).items).toEqual([]);
    for (const path of [`/jobs/${c.job.id}`, `/projects/${p.id}/production`, `/projects/${p.id}/checkpoints`, `/projects/${p.id}/usage`]) expect((await request('GET', path, undefined, other)).status).toBe(404);
    expect((await request('POST', `/checkpoints/${c.cp!.id}/approve`, { expectedRevision: 1, subjectVersionId: c.script.id }, other, { 'idempotency-key': crypto.randomUUID() })).status).toBe(404);
  });
});
