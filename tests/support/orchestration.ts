import { applyMigrations, d1Harness } from './d1.js';
import { fixtureId, FIXTURE_TIMESTAMP, projectInputFixture } from '@video-studio/testkit';
import { ProjectRepository } from '../../apps/api/src/db/repositories.js';
import { JobRepository } from '../../apps/api/src/db/jobs.js';
import { JobRunnerRepository } from '../../apps/api/src/db/job-runner.js';

export async function orchestrationHarness() {
  const h = await d1Harness();
  try {
    await applyMigrations(h.db);
    const owner = fixtureId(500); const other = fixtureId(501); const project = fixtureId(502); const foreign = fixtureId(503);
    for (const id of [owner, other]) await h.db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)')
      .bind(id, 'Fixture', `${id}@example.invalid`, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
    for (const [id, user] of [[project, owner], [foreign, other]]) await new ProjectRepository(h.db).create(user!, projectInputFixture(), { id: id!, now: FIXTURE_TIMESTAMP });
    let now = Date.parse(FIXTURE_TIMESTAMP);
    const runtime = { now: () => now, uuid: () => crypto.randomUUID() };
    return { ...h, owner, other, project, foreign, runtime, advance: (ms: number) => { now += ms; },
      jobs: new JobRepository(h.db, runtime), runner: new JobRunnerRepository(h.db, runtime, () => 0) };
  } catch (error) { await h.dispose(); throw error; }
}
