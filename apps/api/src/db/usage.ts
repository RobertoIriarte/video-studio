import { z } from 'zod';
import { reservationDtoSchema, reservationInputSchema, usageDtoSchema, uuidSchema } from '@video-studio/contracts';
import type { ReservationInput } from '@video-studio/contracts';
import type { Database, Statement } from './connection.js';
import { JobConflict, JobNotFound, JobRepository, batchChanges, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import { ProviderRepository } from './providers.js';
import { catalogHash } from './catalog.js';

export class ReservationBlocked extends JobConflict {}
function decode(row: Record<string, unknown>) {
  return reservationDtoSchema.parse({ id: row.id, projectId: row.project_id, jobId: row.job_id, providerId: row.provider_id, eventKey: row.event_key,
    status: row.status, amountMicros: row.amount_micros, units: row.units, currency: row.currency });
}
export class UsageRepository {
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime) {}
  async reserve(owner: string, project: string, raw: ReservationInput) {
    const input = reservationInputSchema.parse(raw); const hash = await catalogHash({ project, input }); const jobs = new JobRepository(this.db, this.runtime);
    await jobs.project(owner, project);
    const previous = await this.db.prepare('SELECT * FROM usage_records WHERE owner_id=? AND event_key=?').bind(owner, input.eventKey).first<Record<string, unknown>>();
    if (previous) { if (previous.request_hash !== hash) throw new JobConflict(); return decode(previous); }
    const provider = await new ProviderRepository(this.db).get(owner, input.providerId); if (!provider) throw new JobNotFound();
    const job = await jobs.get(owner, input.jobId); if (!job || job.projectId !== project) throw new JobNotFound();
    const amount = input.amountMicros ?? provider.limits.maxCostPerJobMicros;
    if (amount === null || provider.limits.quotaUnits === null || (provider.limits.maxCostPerJobMicros !== null && amount > provider.limits.maxCostPerJobMicros)) throw new ReservationBlocked();
    const nowMs = this.runtime.now(); const now = new Date(nowMs).toISOString(); const window = Math.floor(nowMs / provider.limits.windowMs) * provider.limits.windowMs;
    const id = this.runtime.uuid();
    try {
      await this.db.prepare(`INSERT INTO usage_records (id,owner_id,project_id,job_id,provider_id,event_key,request_hash,status,amount_micros,reserved_micros,currency,units,reserved_units,window_start,units_json,created_at,updated_at)
        SELECT ?,p.owner_id,p.id,?,c.id,?,?,'RESERVED',?,?,?, ?,?,?,?, ?,? FROM projects p JOIN project_settings s ON s.project_id=p.id JOIN provider_configs c ON c.owner_id=p.owner_id
        WHERE p.id=? AND p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=0 AND c.id=? AND c.enabled=1 AND c.status='AVAILABLE' AND c.integration_mode='MOCK'
        AND c.revision=? AND s.budget_currency=? AND json_extract(c.pricing_json,'$.currency')=?
        AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=? AND j.project_id=p.id AND j.status IN('PENDING','READY','RUNNING'))
        AND ? <= s.max_cost_micros-COALESCE((SELECT sum(u.amount_micros) FROM usage_records u WHERE u.project_id=p.id AND u.currency=? AND u.status IN('RESERVED','SETTLED','UNKNOWN')),0)
        AND (?=0 OR NOT EXISTS(SELECT 1 FROM usage_records u WHERE u.project_id=p.id AND u.status='UNKNOWN'))
        AND ? <= json_extract(c.limits_json,'$.quotaUnits')-COALESCE((SELECT sum(u.units) FROM usage_records u WHERE u.provider_id=c.id AND u.window_start=? AND u.status IN('RESERVED','SETTLED','UNKNOWN')),0)
        AND (SELECT count(*) FROM usage_records u WHERE u.provider_id=c.id AND u.status IN('RESERVED','UNKNOWN')) < json_extract(c.limits_json,'$.concurrency')`)
        .bind(id, input.jobId, input.eventKey, hash, amount, amount, input.currency, input.units, input.units, window,
          JSON.stringify({ costKnown: input.amountMicros !== null, integrationMode: provider.integrationMode }), now, now, project, owner, input.providerId, provider.revision, input.currency, input.currency,
          input.jobId, amount, input.currency, amount, input.units, window).run();
    } catch (error) {
      const replay = await this.db.prepare('SELECT * FROM usage_records WHERE owner_id=? AND event_key=?').bind(owner, input.eventKey).first<Record<string, unknown>>();
      if (replay) { if (replay.request_hash !== hash) throw new JobConflict(); return decode(replay); }
      if (await this.db.prepare("SELECT id FROM usage_records WHERE job_id=? AND status IN('RESERVED','UNKNOWN')").bind(input.jobId).first()) throw new ReservationBlocked();
      throw error;
    }
    const row = await this.db.prepare('SELECT * FROM usage_records WHERE owner_id=? AND event_key=?').bind(owner, input.eventKey).first<Record<string, unknown>>();
    if (!row) throw new ReservationBlocked(); if (row.request_hash !== hash) throw new JobConflict(); return decode(row);
  }
  async summary(owner: string, project: string) {
    await new JobRepository(this.db, this.runtime).project(owner, project);
    const settings = await this.db.prepare('SELECT budget_currency,max_cost_micros FROM project_settings WHERE project_id=?').bind(project).first<{ budget_currency: string; max_cost_micros: number }>();
    const rows = await this.db.prepare('SELECT status,COALESCE(sum(amount_micros),0) AS amount FROM usage_records WHERE project_id=? AND currency=? GROUP BY status').bind(project, settings!.budget_currency).all<{ status: string; amount: number }>();
    const amount = (status: string) => rows.results.find((r) => r.status === status)?.amount ?? 0;
    return usageDtoSchema.parse({ currency: settings!.budget_currency, budgetMaxMicros: settings!.max_cost_micros, reservedMicros: amount('RESERVED'), settledMicros: amount('SETTLED'), unknownMicros: amount('UNKNOWN'),
      remainingMicros: Math.max(0, settings!.max_cost_micros - amount('RESERVED') - amount('SETTLED') - amount('UNKNOWN')) });
  }
  async settle(owner: string, eventKey: string, actualMicros: number, units: number) {
    z.int().nonnegative().parse(actualMicros); z.int().nonnegative().parse(units);
    const result = await this.db.batch([this.db.prepare(`UPDATE usage_records SET status=CASE WHEN ?<=reserved_micros AND ?<=reserved_units THEN 'SETTLED' ELSE 'UNKNOWN' END,
      amount_micros=CASE WHEN ?<=reserved_micros AND ?<=reserved_units THEN ? ELSE reserved_micros END,
      units=CASE WHEN ?<=reserved_micros AND ?<=reserved_units THEN ? ELSE reserved_units END,observed_micros=?,updated_at=?
      WHERE owner_id=? AND event_key=? AND status IN('RESERVED','UNKNOWN')`).bind(actualMicros, units, actualMicros, units, actualMicros, actualMicros, units, units, actualMicros, new Date(this.runtime.now()).toISOString(), uuidSchema.parse(owner), uuidSchema.parse(eventKey))]);
    if (batchChanges(result) !== 1) {
      const current = await this.db.prepare('SELECT status,amount_micros,units FROM usage_records WHERE owner_id=? AND event_key=?').bind(owner, eventKey).first<{ status: string; amount_micros: number; units: number }>();
      if (current?.status === 'SETTLED' && current.amount_micros === actualMicros && current.units === units) return;
      throw new JobConflict();
    }
  }
  async markUnknown(owner: string, eventKey: string) {
    const result = await this.db.batch([this.db.prepare("UPDATE usage_records SET status='UNKNOWN',updated_at=? WHERE owner_id=? AND event_key=? AND status IN('RESERVED','UNKNOWN')")
      .bind(new Date(this.runtime.now()).toISOString(), uuidSchema.parse(owner), uuidSchema.parse(eventKey))]);
    if (batchChanges(result) !== 1) throw new JobConflict();
  }
  async releaseUnstarted(owner: string, eventKey: string) {
    const result = await this.db.batch([this.db.prepare(`UPDATE usage_records SET status='RELEASED',updated_at=? WHERE owner_id=? AND event_key=? AND status='RESERVED'
      AND NOT EXISTS(SELECT 1 FROM job_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.id=usage_records.job_id AND a.attempt_no=j.attempt_count AND a.external_started=1)`)
      .bind(new Date(this.runtime.now()).toISOString(), uuidSchema.parse(owner), uuidSchema.parse(eventKey))]);
    if (batchChanges(result) !== 1) {
      const current = await this.db.prepare('SELECT status FROM usage_records WHERE owner_id=? AND event_key=?').bind(owner, eventKey).first<{ status: string }>();
      if (current?.status === 'RELEASED') return;
      throw new JobConflict();
    }
  }
}

export type ActualUsage = { amountMicros: number; units: number };
export function usageTransitionStatement(db: Database, jobId: string, mutation: string, now: string, outcome: 'SUCCEEDED' | 'UNKNOWN' | 'RELEASED', actual?: ActualUsage, verified = false): Statement {
  if (actual) { z.int().nonnegative().parse(actual.amountMicros); z.int().nonnegative().parse(actual.units); }
  if (outcome === 'SUCCEEDED' && actual) return db.prepare(`UPDATE usage_records SET status=CASE WHEN ?<=reserved_micros AND ?<=reserved_units THEN 'SETTLED' ELSE 'UNKNOWN' END,
    amount_micros=CASE WHEN ?<=reserved_micros AND ?<=reserved_units THEN ? ELSE reserved_micros END,
    units=CASE WHEN ?<=reserved_micros AND ?<=reserved_units THEN ? ELSE reserved_units END,observed_micros=?,updated_at=?
    WHERE job_id=? AND status IN('RESERVED','UNKNOWN') AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND mutation_token=?)`)
    .bind(actual.amountMicros, actual.units, actual.amountMicros, actual.units, actual.amountMicros, actual.amountMicros, actual.units, actual.units, actual.amountMicros, now, jobId, jobId, mutation);
  return db.prepare(`UPDATE usage_records SET status=?,updated_at=? WHERE job_id=? AND status IN(${verified ? "'RESERVED','UNKNOWN'" : "'RESERVED'"}) AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND mutation_token=?)`)
    .bind(outcome === 'RELEASED' ? 'RELEASED' : 'UNKNOWN', now, jobId, jobId, mutation);
}
