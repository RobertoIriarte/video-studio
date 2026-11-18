import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { researchOutputSchema, scriptOutputSchema, validateAgentOutput, validateScriptClaims } from '@video-studio/contracts';
import { MockTextAdapter } from '../packages/providers/src/index.js';
import { orchestrationHarness } from './support/orchestration.js';
import { providerFixture } from './support/provider-fixtures.js';
import { ProviderRepository } from '../apps/api/src/db/providers.js';
import { advanceCoordinator } from '../apps/api/src/coordinator.js';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { ProductionRepository } from '../apps/api/src/db/production.js';
import { executeMockContent } from '../apps/api/src/content-executor.js';
import { prepareJob } from '../apps/api/src/job-policy.js';

let h: Awaited<ReturnType<typeof orchestrationHarness>>;
beforeEach(async () => { h = await orchestrationHarness(); });
afterEach(async () => { await h.dispose(); });
const request = { role: 'RESEARCH' as const, title: 'Tema sintético', inputText: 'https://example.invalid/propia', inputType: 'SOURCES', language: 'es', targetDurationMs: 60000, now: '2026-01-01T00:00:00.000Z' };
const context = () => ({ ownerId: h.owner, projectId: h.project, idempotencyKey: crypto.randomUUID(), timeoutMs: 10000, signal: AbortSignal.timeout(10000) });
describe('F4-01 agentes estructurados y publicación D1', { timeout: 30000 }, () => {
  it('fuentes propias, sin hechos/enlaces inventados, reparación acotada y claims trazables', async () => {
    const adapter = new MockTextAdapter(); const research = researchOutputSchema.parse(await adapter.start(request, context()));
    expect(research.sources[0]?.url).toBe(request.inputText); expect(research.claims).toEqual([]); expect(research.metadata.simulated).toBe(true);
    expect(researchOutputSchema.safeParse({ ...research, claims: [{ id: 'bad', statement: 'Falso', sourceIds: ['missing'], confidence: 'HIGH' }] }).success).toBe(false);
    let calls = 0; await expect(validateAgentOutput(researchOutputSchema, async () => { calls++; return {}; })).rejects.toThrow('INVALID_AGENT_OUTPUT'); expect(calls).toBe(2);
    calls = 0; expect(await validateAgentOutput(researchOutputSchema, async (repair) => { calls++; return repair ? research : {}; })).toEqual(research); expect(calls).toBe(2);
    const script = scriptOutputSchema.parse(await adapter.start({ ...request, role: 'SCRIPT' }, context()));
    expect(() => validateScriptClaims({ ...script, sections: script.sections.map((s) => ({ ...s, claimIds: ['invented'] })) }, research)).toThrow('UNKNOWN_CLAIM');
  });
  it('research → script supervisado: salida validada, historial, reserva cero y aprobación exacta', async () => {
    await new ProviderRepository(h.db, true).create(h.owner, crypto.randomUUID(), providerFixture());
    const first = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'RESEARCH', executionTarget: 'CLOUD' });
    await advanceCoordinator(h.db, h.runtime); expect((await h.jobs.get(h.owner, first.id))?.status).toBe('SUCCEEDED');
    const research = await new CatalogRepository(h.db).getResearch(h.owner, h.project, (await h.jobs.get(h.owner, first.id))!.outputRef!.id);
    expect(researchOutputSchema.parse(research!.data).uncertainties.length).toBeGreaterThan(0);
    await advanceCoordinator(h.db, h.runtime); const jobs = await h.jobs.list(h.owner, { projectId: h.project });
    const script = jobs.items.find((j) => j.kind === 'SCRIPT')!; expect(script.status).toBe('WAITING_APPROVAL'); expect(jobs.items).toHaveLength(2);
    const cp = (await h.jobs.checkpoints(h.owner, h.project))[0]!;
    await new ProductionRepository(h.db, h.runtime).approve(h.owner, cp.id, crypto.randomUUID(), { expectedRevision: cp.revision, subjectVersionId: cp.subjectVersionId });
    expect((await h.jobs.project(h.owner, h.project)).active_script_version_id).toBe(cp.subjectVersionId);
    expect((await h.db.prepare("SELECT count(*) AS n FROM usage_records WHERE status='SETTLED' AND amount_micros=0").first<{ n: number }>())?.n).toBe(2);
  });
  it('AUTO publica/activa sin checkpoint; manual no se presenta como integrado', async () => {
    await h.db.prepare("UPDATE projects SET mode='AUTO' WHERE id=?").bind(h.project).run();
    await new ProviderRepository(h.db, true).create(h.owner, crypto.randomUUID(), providerFixture());
    await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'SCRIPT', executionTarget: 'CLOUD' });
    await advanceCoordinator(h.db, h.runtime); expect((await h.jobs.project(h.owner, h.project)).active_script_version_id).not.toBeNull(); expect(await h.jobs.checkpoints(h.owner, h.project)).toEqual([]);
    const manual = await h.jobs.create(h.other, h.foreign, crypto.randomUUID(), { kind: 'RESEARCH', executionTarget: 'CLOUD' });
    await h.jobs.tick(h.other, h.foreign); await prepareJob(h.db, h.other, manual.id, h.runtime);
    expect((await h.jobs.get(h.other, manual.id))?.status).toBe('WAITING_MANUAL');
  });
  it('un lease vencido no inserta candidatos ni checkpoint; conserva intento', async () => {
    const j = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'SCRIPT', executionTarget: 'CLOUD' });
    const lease = await h.runner.claim(h.owner, h.project, crypto.randomUUID(), 'CLOUD', 1000); h.advance(1001);
    const id = crypto.randomUUID(); const hash = 'a'.repeat(64);
    await expect(h.runner.publishContent(h.owner, j.id, lease!.leaseToken, { kind: 'SCRIPT', id, hash }, { before: (g) => [h.db.prepare(`INSERT INTO script_versions (id,project_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) SELECT ?,?,1,'{}',?,1000,'CANDIDATE',? WHERE ${g.sql}`).bind(id, h.project, hash, h.jobs.timestamp(), ...g.values)] })).rejects.toThrow();
    expect(await h.db.prepare('SELECT id FROM script_versions WHERE id=?').bind(id).first()).toBeNull(); expect(await h.jobs.checkpoints(h.owner, h.project)).toEqual([]);
    expect(await executeMockContent(h.db, h.owner, h.project, h.runtime)).toBe(false);
  });
});
