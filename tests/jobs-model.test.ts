import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, d1Harness, migrations } from './support/d1.js';
import { JobConflict, JobNotFound, JobRepository } from '../apps/api/src/db/jobs.js';
import { ProjectRepository } from '../apps/api/src/db/repositories.js';
import { CatalogRepository } from '../apps/api/src/db/catalog.js';
import { fixtureId, FIXTURE_TIMESTAMP, projectInputFixture, researchFixture } from '@video-studio/testkit';
import { jobDtoSchema, jobInputSchema } from '@video-studio/contracts';

let h: Awaited<ReturnType<typeof d1Harness>>; let jobs: JobRepository;
const owner = fixtureId(101); const other = fixtureId(102); const project = fixtureId(103); const foreign = fixtureId(104);
const input = () => ({ kind: 'VALIDATE_INPUT', executionTarget: 'CLOUD', payload: { schemaVersion: 1 } });
beforeEach(async () => {
  h = await d1Harness(); await applyMigrations(h.db);
  for (const id of [owner, other]) await h.db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)').bind(id, 'Fixture', `${id}@example.invalid`, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
  for (const [id, user] of [[project, owner], [foreign, other]]) await new ProjectRepository(h.db).create(user!, projectInputFixture(), { id: id!, now: FIXTURE_TIMESTAMP });
  jobs = new JobRepository(h.db, { now: () => Date.parse(FIXTURE_TIMESTAMP), uuid: () => crypto.randomUUID() });
}, 30000);
afterEach(async () => { await h?.dispose(); });

describe('F3-01 · jobs y esquema D1 real', { timeout: 30000 }, () => {
  it('T04 create concurrente/idempotente reproduce snapshot; distinto payload da conflicto', async () => {
    const key = fixtureId(200);
    const [a, b] = await Promise.all([jobs.create(owner, project, key, input()), jobs.create(owner, project, key, input())]);
    expect(a).toEqual(b); expect(jobDtoSchema.safeParse(a).success).toBe(true);
    await jobs.tick(owner, project);
    expect(await jobs.create(owner, project, key, input())).toEqual(a);
    await expect(jobs.create(owner, project, key, { ...input(), kind: 'RESEARCH' })).rejects.toBeInstanceOf(JobConflict);
    expect(await h.db.prepare('SELECT count(*) AS n FROM jobs').first()).toEqual({ n: 1 });
    expect((await jobs.activity(owner, project)).filter((e) => e.action === 'JOB_CREATED')).toHaveLength(1);
  });
  it('T06 dependencia pendiente impide READY; listo solo al terminar padre', async () => {
    const root = await jobs.create(owner, project, fixtureId(201), input());
    const child = await jobs.create(owner, project, fixtureId(202), { ...input(), dependencies: [root.id] });
    expect(await jobs.tick(owner, project)).toBe(1); expect((await jobs.get(owner, child.id))?.status).toBe('PENDING');
    await h.db.prepare("UPDATE jobs SET status='SUCCEEDED' WHERE id=?").bind(root.id).run();
    expect(await jobs.tick(owner, project)).toBe(1); expect((await jobs.get(owner, child.id))?.status).toBe('READY');
    expect(await jobs.tick(owner, project)).toBe(0);
  });
  it('ciclo y referencia cruzada rechazados también por SQL/FK', async () => {
    const a = await jobs.create(owner, project, fixtureId(203), input()); const b = await jobs.create(owner, project, fixtureId(204), { ...input(), dependencies: [a.id] });
    await expect(h.db.prepare('INSERT INTO job_dependencies VALUES (?,?,?)').bind(project, a.id, b.id).run()).rejects.toThrow('DAG_CYCLE');
    const c = await jobs.create(other, foreign, fixtureId(205), input());
    await expect(jobs.create(owner, project, fixtureId(206), { ...input(), dependencies: [c.id] })).rejects.toBeInstanceOf(JobNotFound);
    await expect(h.db.prepare('INSERT INTO job_dependencies VALUES (?,?,?)').bind(project, a.id, c.id).run()).rejects.toThrow();
    expect(await jobs.get(other, a.id)).toBeNull(); expect((await jobs.list(other)).items.map((j) => j.id)).toEqual([c.id]);
    await expect(jobs.activity(other, project)).rejects.toBeInstanceOf(JobNotFound);
    expect((await h.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
  it('ref de versión invalidada no queda READY; inputs no se reescriben ni se borran', async () => {
    const research = await new CatalogRepository(h.db).createResearch(owner, project, researchFixture());
    const job = await jobs.create(owner, project, fixtureId(207), { ...input(), kind: 'SCRIPT', inputRefs: [{ kind: 'RESEARCH', id: research.id, hash: research.contentHash }] });
    await h.db.prepare("UPDATE research_versions SET status='INVALIDATED' WHERE id=?").bind(research.id).run();
    expect(await jobs.tick(owner, project)).toBe(0);
    await expect(h.db.prepare("UPDATE jobs SET payload_json='{}' WHERE id=?").bind(job.id).run()).rejects.toThrow('JOB_INPUT_IMMUTABLE');
    await expect(h.db.prepare('DELETE FROM jobs WHERE id=?').bind(job.id).run()).rejects.toThrow('JOB_HISTORY_REQUIRED');
    expect((await jobs.list(owner)).items[0]).not.toHaveProperty('payload');
  });
  it('persistencia independiente de instancia, paginación, pausa y rangos', async () => {
    for (let i = 0; i < 3; i++) await jobs.create(owner, project, fixtureId(210 + i), input());
    const first = await jobs.list(owner, { limit: 1 }); const second = await new JobRepository(h.db).list(owner, { limit: 1, before: first.before! });
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    await h.db.prepare('UPDATE projects SET pause_requested=1 WHERE id=?').bind(project).run();
    expect(await jobs.tick(owner, project)).toBe(0);
    expect(jobInputSchema.safeParse({ ...input(), maxAttempts: 0 }).success).toBe(false);
    expect(jobInputSchema.safeParse({ ...input(), ownerId: other }).success).toBe(false);
    expect(await jobs.attempts(owner, first.items[0]!.id)).toEqual([]);
  });
  it('upgrade desde F2-04 preserva datos y añade tablas/índices/checkpoints', async () => {
    const isolated = await d1Harness();
    try {
      await applyMigrations(isolated.db, migrations.slice(0, 64));
      await isolated.db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)').bind(owner, 'Fixture', 'upgrade-jobs@example.invalid', FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
      const repo = new ProjectRepository(isolated.db); const before = await repo.create(owner, projectInputFixture(), { id: project, now: FIXTURE_TIMESTAMP });
      await applyMigrations(isolated.db, migrations.slice(64)); expect(await repo.get(owner, project)).toEqual(before);
      expect(await isolated.db.prepare('SELECT pause_requested FROM projects WHERE id=?').bind(project).first()).toEqual({ pause_requested: 0 });
      expect((await isolated.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await isolated.dispose(); }
  });
});
