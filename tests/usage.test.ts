import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orchestrationHarness } from './support/orchestration.js';
import { providerFixture, reserveExternalFixture } from './support/provider-fixtures.js';
import { ProviderRepository } from '../apps/api/src/db/providers.js';
import { ReservationBlocked, UsageRepository } from '../apps/api/src/db/usage.js';
import { JobConflict, JobNotFound } from '../apps/api/src/db/jobs.js';
import { prepareJob } from '../apps/api/src/job-policy.js';
import { fixtureId } from '@video-studio/testkit';
import type { ReservationInput } from '@video-studio/contracts';

let h: Awaited<ReturnType<typeof orchestrationHarness>>; let providers: ProviderRepository; let usage: UsageRepository;
beforeEach(async () => { h = await orchestrationHarness(); providers = new ProviderRepository(h.db, true); usage = new UsageRepository(h.db, h.runtime); }, 30000);
afterEach(async () => { await h?.dispose(); });
async function setup() {
  await h.db.prepare('UPDATE project_settings SET max_cost_micros=1000 WHERE project_id=?').bind(h.project).run();
  const provider = await providers.create(h.owner, crypto.randomUUID(), providerFixture());
  const jobs = await Promise.all([1, 2].map(() => h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD' })));
  const quote = (index: number, amountMicros = 600): ReservationInput => ({ jobId: jobs[index]!.id, providerId: provider.id, eventKey: crypto.randomUUID(), amountMicros, units: 1, currency: 'USD' });
  return { provider, jobs, quote };
}
describe('F3-03 · ledger/quota D1 real (solo precios sintéticos)', { timeout: 30000 }, () => {
  it('T12 dos reservas concurrentes no exceden presupuesto y replay no duplica', async () => {
    const s = await setup(); const quotes = [s.quote(0), s.quote(1)];
    const outcomes = await Promise.allSettled(quotes.map((q) => usage.reserve(h.owner, h.project, q)));
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const index = outcomes.findIndex((o) => o.status === 'fulfilled'); const quote = quotes[index]!;
    const original = await usage.reserve(h.owner, h.project, quote); expect(await usage.reserve(h.owner, h.project, quote)).toEqual(original);
    expect(await usage.summary(h.owner, h.project)).toMatchObject({ reservedMicros: 600, remainingMicros: 400 });
    await expect(usage.reserve(h.owner, h.project, { ...quote, amountMicros: 100 })).rejects.toBeInstanceOf(JobConflict);
  });
  it('settlement libera sobrante, es idempotente y UNKNOWN conserva el tope', async () => {
    const s = await setup(); const quote = s.quote(0); await usage.reserve(h.owner, h.project, quote);
    await usage.settle(h.owner, quote.eventKey, 200, 1); await usage.settle(h.owner, quote.eventKey, 200, 1);
    expect(await usage.summary(h.owner, h.project)).toMatchObject({ settledMicros: 200, remainingMicros: 800 });
    const next = s.quote(1); await usage.reserve(h.owner, h.project, next); await usage.markUnknown(h.owner, next.eventKey);
    expect(await usage.summary(h.owner, h.project)).toMatchObject({ unknownMicros: 600, remainingMicros: 200 });
    await expect(usage.releaseUnstarted(h.owner, next.eventKey)).rejects.toBeInstanceOf(JobConflict);
  });
  it('cuota y concurrencia se comprueban dentro de la reserva; ventana se reinicia sin borrar', async () => {
    const s = await setup(); await providers.patch(h.owner, s.provider.id, { expectedRevision: 1, limits: { ...s.provider.limits, quotaUnits: 1, concurrency: 1 } });
    const q = s.quote(0, 100); await usage.reserve(h.owner, h.project, q);
    await expect(usage.reserve(h.owner, h.project, s.quote(1, 100))).rejects.toBeInstanceOf(ReservationBlocked);
    await usage.settle(h.owner, q.eventKey, 100, 1);
    await expect(usage.reserve(h.owner, h.project, s.quote(1, 100))).rejects.toBeInstanceOf(ReservationBlocked);
    h.advance(60000); expect((await usage.reserve(h.owner, h.project, s.quote(1, 100))).status).toBe('RESERVED');
  });
  it('precio no conocido exige tope aprobado; moneda/owner/proveedor incompatibles se rechazan', async () => {
    const s = await setup(); await providers.patch(h.owner, s.provider.id, { expectedRevision: 1, limits: { ...s.provider.limits, maxCostPerJobMicros: null } });
    await expect(usage.reserve(h.owner, h.project, { ...s.quote(0), amountMicros: null })).rejects.toBeInstanceOf(ReservationBlocked);
    await expect(usage.reserve(h.owner, h.project, { ...s.quote(0), currency: 'EUR' })).rejects.toBeInstanceOf(ReservationBlocked);
    await expect(usage.reserve(h.other, h.project, s.quote(0))).rejects.toBeInstanceOf(JobNotFound);
    await expect(providers.validatePreferred(h.other, [s.provider.id])).rejects.toBeInstanceOf(JobNotFound);
    expect((await providers.list(h.other))).toEqual([]);
    await expect(h.db.prepare('UPDATE provider_configs SET owner_id=? WHERE id=?').bind(h.other, s.provider.id).run()).rejects.toThrow('PROVIDER_IDENTITY_IMMUTABLE');
    const foreignProvider = await providers.create(h.other, crypto.randomUUID(), providerFixture());
    await expect(h.db.prepare(`INSERT INTO jobs (id,project_id,kind,execution_target,status,payload_json,input_refs_json,idempotency_key,input_hash,attempt_count,max_attempts,progress_json,revision,created_at,updated_at,selected_provider_id)
      VALUES (?,?,'VALIDATE_INPUT','CLOUD','PENDING','{}','[]',?,?,0,3,'{"message":"Fixture"}',1,?,?,?)`)
      .bind(crypto.randomUUID(), h.project, crypto.randomUUID(), 'a'.repeat(64), h.jobs.timestamp(), h.jobs.timestamp(), foreignProvider.id).run()).rejects.toThrow('JOB_PROVIDER_SCOPE');
  });
  it('BEGIN externo exige reserva; expiración incierta retiene saldo y reconciliación libera', async () => {
    const job = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD' });
    const lease = (await h.runner.claim(h.owner, h.project, fixtureId(600)))!;
    await expect(h.runner.beginExternalEffect(h.owner, job.id, lease.leaseToken)).rejects.toBeInstanceOf(JobConflict);
    const r = await reserveExternalFixture(h, job.id); await h.runner.beginExternalEffect(h.owner, job.id, lease.leaseToken);
    await expect(usage.releaseUnstarted(h.owner, r.eventKey)).rejects.toBeInstanceOf(JobConflict);
    h.advance(90001); await h.runner.recoverExpired(h.owner, h.project);
    expect((await usage.reserve(h.owner, h.project, { jobId: job.id, providerId: r.providerId, eventKey: r.eventKey, amountMicros: 0, units: 1, currency: 'USD' })).status).toBe('UNKNOWN');
    const unknown = (await h.jobs.get(h.owner, job.id))!;
    await h.runner.reconcileOutcome(h.owner, job.id, unknown.revision, { kind: 'NOT_ACCEPTED' });
    expect(await h.db.prepare('SELECT status FROM usage_records WHERE event_key=?').bind(r.eventKey).first()).toEqual({ status: 'RELEASED' });
  });
  it('fallo seguro libera reserva en el mismo batch; costo superior a cap queda UNKNOWN', async () => {
    const s = await setup(); const quote = s.quote(0, 100); await usage.reserve(h.owner, h.project, quote);
    const leased = (await h.runner.claim(h.owner, h.project, fixtureId(601)))!;
    // Puede reclamar cualquiera de los dos; reservar el reclamado si fuese el otro.
    if (leased.job.id !== s.jobs[0]!.id) await usage.reserve(h.owner, h.project, { ...s.quote(1, 100) });
    await h.runner.fail(h.owner, leased.job.id, leased.leaseToken, 'RATE_LIMIT');
    const status = await h.db.prepare('SELECT status FROM usage_records WHERE job_id=?').bind(leased.job.id).first(); expect(status).toEqual({ status: 'RELEASED' });
    const overflowJob = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD' });
    const r = await reserveExternalFixture(h, overflowJob.id);
    await usage.settle(h.owner, r.eventKey, 1, 1);
    expect(await h.db.prepare('SELECT status FROM usage_records WHERE event_key=?').bind(r.eventKey).first()).toEqual({ status: 'UNKNOWN' });
  });
  it('T13 capacidad no disponible conserva job y ofrece manual; mocks no se activan por la ruta normal', async () => {
    await expect(new ProviderRepository(h.db).create(h.owner, crypto.randomUUID(), providerFixture())).rejects.toBeInstanceOf(JobConflict);
    const job = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'RESEARCH', executionTarget: 'CLOUD' });
    const pending = await prepareJob(h.db, h.owner, job.id, h.runtime);
    expect(pending.status).toBe('WAITING_MANUAL'); expect(pending.id).toBe(job.id); expect(pending.error?.code).toBe('UNSUPPORTED_CAPABILITY');
    const config = { ...providerFixture(), adapterKey: 'MANUAL_ASSIST', integrationMode: 'MANUAL', name: 'Vía manual' };
    const manual = await new ProviderRepository(h.db).create(h.owner, crypto.randomUUID(), config);
    expect(manual.status).toBe('MANUAL_ONLY'); expect(manual).not.toHaveProperty('credentialRef');
  });
});
