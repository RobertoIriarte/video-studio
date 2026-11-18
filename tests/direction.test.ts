import { afterEach, describe, expect, it } from 'vitest';
import { directionOutputSchema, scriptOutputSchema } from '@video-studio/contracts';
import { directionPreset, modalityAssetType, planShotDurations } from '@video-studio/domain';
import { MockTextAdapter } from '../packages/providers/src/index.js';
import { orchestrationHarness } from './support/orchestration.js';
import { providerFixture } from './support/provider-fixtures.js';
import { ProviderRepository } from '../apps/api/src/db/providers.js';
import { advanceCoordinator } from '../apps/api/src/coordinator.js';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { ProductionRepository } from '../apps/api/src/db/production.js';
import { enqueueContentSuccessor } from '../apps/api/src/content-executor.js';

let h: Awaited<ReturnType<typeof orchestrationHarness>> | undefined;
afterEach(async () => { await h?.dispose(); h = undefined; });
describe('F4-02 dirección', { timeout: 30000 }, () => {
  it('duración entera exacta, múltiples tomas y límite que obliga dividir', () => {
    for (const duration of [1, 2, 7999, 8000, 16001, 60000, 128000]) { const shots = planShotDurations(duration); expect(shots.reduce((a, b) => a + b, 0)).toBe(duration); expect(shots.every((s) => s > 0 && s <= 8000)).toBe(true); }
    expect(() => planShotDurations(128001)).toThrow('SCENE_DURATION_REQUIRES_SPLIT'); expect(() => planShotDurations(2.5)).toThrow();
  });
  it('modalidades y presets usan políticas diferentes y rechazan valores desconocidos', () => {
    expect(['DYNAMIC_IMAGES', 'HYBRID', 'CINEMATIC', 'EXPLAINER'].map((m) => [modalityAssetType(m, 0), modalityAssetType(m, 1)])).toEqual([['IMAGE', 'IMAGE'], ['IMAGE', 'VIDEO'], ['VIDEO', 'VIDEO'], ['GRAPHIC', 'GRAPHIC']]);
    expect(directionPreset('HORROR_MYSTERY').mood).toContain('Misterio'); expect(() => directionPreset('inventado')).toThrow(); expect(() => modalityAssetType('inventado', 0)).toThrow();
  });
  it('guion propio conserva sus palabras y divide sin duplicarlas', async () => {
    const inputText = Array.from({ length: 200 }, (_, i) => `palabra${i}`).join(' ');
    const script = scriptOutputSchema.parse(await new MockTextAdapter().start({ role: 'SCRIPT', title: 'Propio', inputText, inputType: 'SCRIPT', language: 'es', targetDurationMs: 180001, now: '2026-01-01T00:00:00.000Z' }, { ownerId: '', projectId: '', idempotencyKey: '', timeoutMs: 10000, signal: AbortSignal.timeout(10000) }));
    expect(script.sections.map((s) => s.narration).join(' ')).toBe(inputText); expect(script.sections.reduce((n, s) => n + s.targetDurationMs, 0)).toBe(180001); expect(script.sections).toHaveLength(4);
  });
  it('fanout reanudable, dirección por escena con checkpoint exacto y sin assets ficticios', async () => {
    h = await orchestrationHarness(); await new ProviderRepository(h.db, true).create(h.owner, crypto.randomUUID(), providerFixture());
    await h.db.prepare('UPDATE project_settings SET target_duration_ms=60000 WHERE project_id=?').bind(h.project).run();
    const job = await h.jobs.create(h.owner, h.project, crypto.randomUUID(), { kind: 'SCRIPT', executionTarget: 'CLOUD' }); await advanceCoordinator(h.db, h.runtime);
    const cp = (await h.jobs.checkpoints(h.owner, h.project))[0]!; await new ProductionRepository(h.db, h.runtime).approve(h.owner, cp.id, crypto.randomUUID(), { expectedRevision: cp.revision, subjectVersionId: cp.subjectVersionId });
    await Promise.all([enqueueContentSuccessor(h.db, h.owner, job.id, h.runtime), enqueueContentSuccessor(h.db, h.owner, job.id, h.runtime)]);
    expect((await h.jobs.list(h.owner, { projectId: h.project })).items.filter((j) => j.kind === 'DIRECTION')).toHaveLength(1);
    await advanceCoordinator(h.db, h.runtime); const directed = (await h.jobs.list(h.owner, { projectId: h.project })).items.find((j) => j.kind === 'DIRECTION')!;
    expect(directed.status).toBe('WAITING_APPROVAL'); const candidate = await new CatalogRepository(h.db).getSceneVersion(h.owner, h.project, directed.outputRef!.id);
    const { metadata, visualBible, warnings, scenes } = candidate!.direction; const plan = { metadata, visualBible, warnings, scenes };
    expect(directionOutputSchema.parse(plan).scenes[0]?.shotPlans).toHaveLength(8); expect(candidate!.shots.reduce((n, s) => n + s.durationMs, 0)).toBe(60000); expect(candidate!.shots.every((s) => s.assetId === null)).toBe(true);
    const directionCp = (await h.jobs.checkpoints(h.owner, h.project)).find((c) => c.stage === 'DIRECTION')!;
    await new ProductionRepository(h.db, h.runtime).approve(h.owner, directionCp.id, crypto.randomUUID(), { expectedRevision: directionCp.revision, subjectVersionId: directionCp.subjectVersionId });
    expect((await new CatalogRepository(h.db).getScene(h.owner, h.project, directed.sceneId!))?.activeVersionId).toBe(candidate!.id);
  });
});
