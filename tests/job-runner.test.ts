import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orchestrationHarness } from './support/orchestration.js';
import { JobConflict } from '../apps/api/src/db/jobs.js';
import { JobRunnerRepository, LeaseLost } from '../apps/api/src/db/job-runner.js';
import { advanceCoordinator } from '../apps/api/src/coordinator.js';
import { fixtureId, researchFixture, scriptFixture } from '@video-studio/testkit';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { failureDisposition, retryDelayMs } from '@video-studio/domain';
import { reserveExternalFixture } from './support/provider-fixtures.js';

let h: Awaited<ReturnType<typeof orchestrationHarness>>;
const workerA = fixtureId(510); const workerB = fixtureId(511);
beforeEach(async () => { h = await orchestrationHarness(); }, 30000);
afterEach(async () => { await h?.dispose(); });
const create = (extra: Record<string, unknown> = {}) => h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD', ...extra });
const claim = (worker = workerA) => h.runner.claim(h.owner, h.project, worker);

describe('F3-02 · leases/fencing/recovery D1', { timeout: 30000 }, () => {
  it('T05 dos workers no reclaman a la vez; completar es idempotente sin duplicar efectos', async () => {
    const job = await create(); const [a, b] = await Promise.all([claim(), claim(workerB)]);
    const winning = a ?? b; expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await h.jobs.attempts(h.owner, job.id))).toHaveLength(1);
    const done = await h.runner.complete(h.owner, job.id, winning!.leaseToken, null);
    expect(done.status).toBe('SUCCEEDED'); expect(await h.runner.complete(h.owner, job.id, winning!.leaseToken, null)).toEqual(done);
    expect((await h.jobs.activity(h.owner, h.project)).filter((e) => e.action === 'JOB_SUCCEEDED')).toHaveLength(1);
  });
  it('T05 lease expira; worker viejo no heartbeat/complete/fail ni publica después de nuevo claim', async () => {
    const job = await create(); const first = (await claim())!;
    h.advance(90001); expect(await h.runner.recoverExpired(h.owner, h.project)).toBe(1);
    expect((await h.jobs.get(h.owner, job.id))?.status).toBe('RETRY_SCHEDULED');
    expect(await claim(workerB)).toBeNull(); h.advance(15000);
    const second = (await claim(workerB))!; expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(h.runner.heartbeat(h.owner, job.id, first.leaseToken)).rejects.toBeInstanceOf(LeaseLost);
    await expect(h.runner.complete(h.owner, job.id, first.leaseToken, null)).rejects.toBeInstanceOf(LeaseLost);
    await expect(h.runner.fail(h.owner, job.id, first.leaseToken, 'TRANSIENT')).rejects.toBeInstanceOf(LeaseLost);
    await h.runner.complete(h.owner, job.id, second.leaseToken, null);
    expect((await h.jobs.attempts(h.owner, job.id)).map((a) => a.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });
  it('heartbeat renueva solo lease vigente y comunica pausa; token/owner falso se rechaza', async () => {
    const job = await create(); const leased = (await claim())!;
    h.advance(80000); expect(await h.runner.heartbeat(h.owner, job.id, leased.leaseToken)).toEqual({ pauseRequested: false });
    h.advance(20000); expect(await h.runner.recoverExpired(h.owner, h.project)).toBe(0);
    await expect(h.runner.heartbeat(h.other, job.id, leased.leaseToken)).rejects.toBeInstanceOf(LeaseLost);
    await expect(h.runner.heartbeat(h.owner, job.id, workerB)).rejects.toBeInstanceOf(LeaseLost);
    await expect(h.db.prepare('UPDATE job_attempts SET lease_token=? WHERE job_id=?').bind(workerB, job.id).run()).rejects.toThrow('ATTEMPT_IDENTITY_IMMUTABLE');
  });
  it('T07 backoff/Retry-After, agotamiento y auth no recuperable', async () => {
    const job = await create({ maxAttempts: 2 }); const first = (await claim())!;
    const failed = await h.runner.fail(h.owner, job.id, first.leaseToken, 'RATE_LIMIT', 60000);
    expect(failed.status).toBe('RETRY_SCHEDULED'); h.advance(59999); expect(await claim()).toBeNull(); h.advance(1);
    const second = (await claim())!; expect((await h.runner.fail(h.owner, job.id, second.leaseToken, 'TRANSIENT')).error?.code).toBe('ATTEMPTS_EXHAUSTED');
    const auth = await create();
    // Fixture cancela el fallo previo para aislar el caso de autenticación.
    await h.db.prepare("UPDATE jobs SET status='CANCELLED' WHERE id=?").bind(job.id).run();
    const authLease = (await claim())!; expect(authLease.job.id).toBe(auth.id);
    const result = await h.runner.fail(h.owner, auth.id, authLease.leaseToken, 'AUTH_REQUIRED'); expect(result.status).toBe('FAILED'); expect(result.nextRunAt).toBeNull();
    const op = crypto.randomUUID();
    const retry = await h.runner.retryFailed(h.owner, auth.id, op, result.revision);
    expect(await h.runner.retryFailed(h.owner, auth.id, op, result.revision)).toEqual(retry);
    expect((await claim())?.job.attempt).toBe(2);
    expect(retryDelayMs(1, 0)).toBe(15000); expect(retryDelayMs(2, 0)).toBe(60000); expect(retryDelayMs(10, 1)).toBe(600000);
    expect(failureDisposition('TRANSIENT', true).unknown).toBe(true);
  });
  it('T07/08 efecto externo incierto sobrevive reinicio y nunca reintenta sin reconciliar', async () => {
    const job = await create(); const leased = (await claim())!;
    await reserveExternalFixture(h, job.id); await h.runner.beginExternalEffect(h.owner, job.id, leased.leaseToken);
    await h.runner.recordExternalOperation(h.owner, job.id, leased.leaseToken, 'fixture-operation-1');
    h.advance(90001);
    const restarted = new JobRunnerRepository(h.db, h.runtime, () => 0);
    expect(await restarted.recoverExpired(h.owner, h.project)).toBe(1);
    const unknown = (await h.jobs.get(h.owner, job.id))!; expect(unknown.error?.code).toBe('UNKNOWN_OUTCOME');
    expect((await h.jobs.attempts(h.owner, job.id))[0]?.status).toBe('UNKNOWN');
    h.advance(86400000); expect(await restarted.claim(h.owner, h.project, workerB)).toBeNull();
    const resolved = await restarted.reconcileOutcome(h.owner, job.id, unknown.revision, { kind: 'NOT_ACCEPTED' });
    expect(resolved.status).toBe('RETRY_SCHEDULED'); h.advance(15000); expect(await claim(workerB)).not.toBeNull();
  });
  it('reconciliar resultado verificado cierra el mismo intento, sin nueva producción', async () => {
    const job = await create(); const leased = (await claim())!; await reserveExternalFixture(h, job.id); await h.runner.beginExternalEffect(h.owner, job.id, leased.leaseToken);
    const uncertain = await h.runner.fail(h.owner, job.id, leased.leaseToken, 'TRANSIENT');
    const done = await h.runner.reconcileOutcome(h.owner, job.id, uncertain.revision, { kind: 'VERIFIED_RESULT', output: null });
    expect(done.status).toBe('SUCCEEDED'); expect((await h.jobs.attempts(h.owner, job.id))).toHaveLength(1);
    await expect(h.runner.reconcileOutcome(h.owner, job.id, uncertain.revision, { kind: 'NOT_ACCEPTED' })).rejects.toBeInstanceOf(JobConflict);
  });
  it('T09 PAUSING no reclama más; completa irreversible o pausa segura y reanuda', async () => {
    const job = await create(); const next = await create({ dependencies: [job.id] }); const leased = (await claim())!;
    const p = await h.jobs.project(h.owner, h.project); const paused = await h.runner.pause(h.owner, h.project, p.revision);
    expect(paused.status).toBe('PAUSING'); expect(await claim(workerB)).toBeNull();
    expect(await h.runner.heartbeat(h.owner, job.id, leased.leaseToken)).toEqual({ pauseRequested: true });
    await expect(h.runner.resume(h.owner, h.project, paused.revision)).rejects.toBeInstanceOf(JobConflict);
    await h.runner.complete(h.owner, job.id, leased.leaseToken, null);
    const stopped = await h.jobs.project(h.owner, h.project); expect(stopped.status).toBe('PAUSED');
    await h.runner.resume(h.owner, h.project, stopped.revision); expect((await claim(workerB))?.job.id).toBe(next.id);
  });
  it('pausa segura conserva intento cancelado; una llamada externa iniciada no se cancela a ciegas', async () => {
    const job = await create(); const leased = (await claim())!;
    await h.runner.pause(h.owner, h.project, (await h.jobs.project(h.owner, h.project)).revision);
    await h.runner.pauseAtSafePoint(h.owner, job.id, leased.leaseToken); expect((await h.jobs.attempts(h.owner, job.id))[0]?.status).toBe('CANCELLED');
    await h.runner.resume(h.owner, h.project, (await h.jobs.project(h.owner, h.project)).revision);
    const next = (await claim())!; await reserveExternalFixture(h, job.id); await h.runner.beginExternalEffect(h.owner, job.id, next.leaseToken);
    await h.runner.pause(h.owner, h.project, (await h.jobs.project(h.owner, h.project)).revision);
    await expect(h.runner.pauseAtSafePoint(h.owner, job.id, next.leaseToken)).rejects.toBeInstanceOf(JobConflict);
  });
  it('T10 resultado real crea checkpoint supervisado; AUTO omite ordinario pero no blocker', async () => {
    const catalog = new CatalogRepository(h.db); const version = await catalog.createScript(h.owner, h.project, scriptFixture());
    const job = await create({ kind: 'SCRIPT' }); const leased = (await claim())!;
    const output = { kind: 'SCRIPT' as const, id: version.id, hash: version.contentHash };
    expect((await h.runner.complete(h.owner, job.id, leased.leaseToken, output)).status).toBe('WAITING_APPROVAL');
    expect((await h.jobs.checkpoints(h.owner, h.project))[0]?.subjectVersionId).toBe(version.id);
    await h.db.prepare("UPDATE projects SET mode='AUTO' WHERE id=?").bind(h.project).run();
    const automatic = await create({ kind: 'SCRIPT' }); const automaticLease = (await claim())!;
    expect((await h.runner.complete(h.owner, automatic.id, automaticLease.leaseToken, output)).status).toBe('SUCCEEDED');
    const blocked = await create({ kind: 'SCRIPT' }); const blockedLease = (await claim())!;
    expect((await h.runner.complete(h.owner, blocked.id, blockedLease.leaseToken, output, true)).status).toBe('WAITING_APPROVAL');
    expect(await catalog.getScript(h.owner, h.project, version.id)).toMatchObject({ status: 'CANDIDATE' });
  });
  it('coordinador sin navegador recupera leases y respeta persistencia/fecha', async () => {
    const job = await create(); const leased = (await claim())!; expect(leased.job.id).toBe(job.id);
    h.advance(90001); expect(await advanceCoordinator(h.db, h.runtime, () => 0)).toBe(1);
    expect((await h.jobs.get(h.owner, job.id))?.status).toBe('RETRY_SCHEDULED'); h.advance(16000);
    await advanceCoordinator(h.db, h.runtime, () => 0); expect((await h.jobs.get(h.owner, job.id))?.status).toBe('READY');
    const source = await new CatalogRepository(h.db).createResearch(h.owner, h.project, researchFixture());
    await create({ kind: 'SCRIPT', inputRefs: [{ kind: 'RESEARCH', id: source.id, hash: source.contentHash }] });
    await h.db.prepare("UPDATE research_versions SET status='INVALIDATED' WHERE id=?").bind(source.id).run();
    const fresh = await h.jobs.create(h.other, h.foreign, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD' });
    await h.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(new Date(h.runtime.now() + 60000).toISOString(), h.foreign).run();
    await advanceCoordinator(h.db, h.runtime, () => 0);
    expect((await h.jobs.get(h.other, fresh.id))?.status).toBe('READY'); // Un input obsoleto de otro proyecto no monopoliza el tick.
  });
});
