import type { Hono } from 'hono';
import { contentMutationSchema, researchListSchema, scriptListSchema, scenesListSchema, sceneDetailSchema, uuidSchema, regenerationResponseSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { authContext } from './auth/routes.js';
import { requirePrivateAccess } from './private-access.js';
import { endpoint } from './orchestration.js';
import { ContentRepository } from './db/content.js';
import { JobNotFound } from './db/jobs.js';
import { regenerateScene, regenerationImpact } from './regeneration.js';
import { prepareJob } from './job-policy.js';

export function registerContent(app: Hono<ApiEnv>) {
  app.use('/api/v1/scenes/*', requirePrivateAccess);
  for (const kind of ['research', 'scripts'] as const) {
    app.get(`/api/v1/projects/:id/${kind}`, endpoint(async (c) => {
      const repo = new ContentRepository(authContext(c)!.db); const result = await repo.list(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), kind === 'scripts' ? 'script' : 'research', c.req.query('cursor'));
      return c.json((kind === 'scripts' ? scriptListSchema : researchListSchema).parse(result));
    }));
    app.post(`/api/v1/projects/:id/${kind}`, endpoint(async (c) => {
      const repo = new ContentRepository(authContext(c)!.db); const args = [c.get('user')!.id, uuidSchema.parse(c.req.param('id')), uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null)] as const;
      return c.json(contentMutationSchema.parse(await (kind === 'scripts' ? repo.saveScript(...args) : repo.saveResearch(...args))), 201);
    }));
    app.post(`/api/v1/projects/:id/${kind}/:version/activate`, endpoint(async (c) => c.json(contentMutationSchema.parse(await new ContentRepository(authContext(c)!.db).activate(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), kind === 'scripts' ? 'script' : 'research', uuidSchema.parse(c.req.param('version')), uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null))))));
  }
  app.get('/api/v1/projects/:id/scenes', endpoint(async (c) => c.json(scenesListSchema.parse(await new ContentRepository(authContext(c)!.db).scenes(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), c.req.query('cursor'))))));
  app.get('/api/v1/scenes/:id', endpoint(async (c) => c.json(sceneDetailSchema.parse(await new ContentRepository(authContext(c)!.db).scene(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), c.req.query('cursor'))))));
  app.get('/api/v1/scenes/:id/impact', endpoint(async (c) => { await new ContentRepository(authContext(c)!.db).sceneScope(c.get('user')!.id, uuidSchema.parse(c.req.param('id'))); return c.json(regenerationImpact(c.req.query('scope'))); }));
  app.post('/api/v1/scenes/:id/regenerate', endpoint(async (c) => {
    const db = authContext(c)!.db; const owner = c.get('user')!.id; const repo = new ContentRepository(db);
    const job = await regenerateScene(db, owner, uuidSchema.parse(c.req.param('id')), uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null));
    if (['PENDING', 'READY'].includes((await repo.jobs.get(owner, job.id))!.status)) { await repo.jobs.tick(owner, job.projectId); await prepareJob(db, owner, job.id); }
    return c.json(regenerationResponseSchema.parse(job), 202);
  }));
  app.patch('/api/v1/scenes/:id', endpoint(async (c) => c.json(contentMutationSchema.parse(await new ContentRepository(authContext(c)!.db).saveScene(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null))), 201)));
  app.post('/api/v1/scenes/:id/versions/:version/activate', endpoint(async (c) => {
    const repo = new ContentRepository(authContext(c)!.db); const owner = c.get('user')!.id; const sceneId = uuidSchema.parse(c.req.param('id')); const project = await repo.sceneScope(owner, sceneId); const versionId = uuidSchema.parse(c.req.param('version'));
    if ((await repo.catalog.getSceneVersion(owner, project, versionId))?.sceneId !== sceneId) throw new JobNotFound();
    return c.json(contentMutationSchema.parse(await repo.activate(owner, project, 'scene', versionId, uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null))));
  }));
}
