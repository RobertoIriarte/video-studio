import { integrationReviews } from '@video-studio/providers';
import { integrationReviewsSchema } from '@video-studio/contracts';
import type { Context, Handler, Hono } from 'hono';
import { z } from 'zod';
import { checkpointApproveSchema, checkpointDtoSchema, checkpointViewSchema, jobCursorSchema, jobDetailSchema, jobsListSchema, jobsQuerySchema, manualProviderCreateSchema,
  productionSchema, projectControlSchema, providerDtoSchema, providerListSchema, providerPatchSchema, revisionInputSchema, safeValidationIssues, startResponseSchema, usageDtoSchema, uuidSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { errorBody } from './app.js';
import { requirePrivateAccess } from './private-access.js';
import { authContext } from './auth/routes.js';
import { JobConflict, JobNotFound, JobRepository } from './db/jobs.js';
import { ProductionRepository } from './db/production.js';
import { JobRunnerRepository } from './db/job-runner.js';
import { ProviderRepository } from './db/providers.js';
import { UsageRepository } from './db/usage.js';
import { prepareJob } from './job-policy.js';
import { CatalogConflict, CatalogNotFound } from './db/catalog.js';

const idParam = (c: Context<ApiEnv>) => { const id = uuidSchema.safeParse(c.req.param('id')); if (!id.success) throw new JobNotFound(); return id.data; };
const operation = (c: Context<ApiEnv>) => uuidSchema.parse(c.req.header('idempotency-key'));
const body = (c: Context<ApiEnv>) => c.req.json<unknown>().catch(() => null);
export function endpoint(fn: Handler<ApiEnv>): Handler<ApiEnv> {
  return async (c, next) => {
    try { return await fn(c, next); }
    catch (error) {
      if (error instanceof JobNotFound || error instanceof CatalogNotFound) return c.json(errorBody(c.get('requestId'), 'NOT_FOUND', 'Recurso no encontrado.', false), 404);
      if (error instanceof JobConflict || error instanceof CatalogConflict) return c.json(errorBody(c.get('requestId'), 'CONFLICT', 'El recurso cambió o la operación no es compatible. Actualiza antes de continuar.', false), 409);
      if (error instanceof z.ZodError) return c.json({ error: { ...errorBody(c.get('requestId'), 'INVALID_INPUT', 'Revisa los datos de entrada.', false).error, details: { issues: safeValidationIssues(error) } } }, 400);
      throw error;
    }
  };
}
export function registerOrchestration(app: Hono<ApiEnv>) {
  for (const prefix of ['jobs', 'providers', 'checkpoints']) { app.use(`/api/v1/${prefix}`, requirePrivateAccess); app.use(`/api/v1/${prefix}/*`, requirePrivateAccess); }
  app.get('/api/v1/providers/integrations', endpoint((c) => c.json(integrationReviewsSchema.parse({ items: integrationReviews }))));
  app.get('/api/v1/jobs', endpoint(async (c) => {
    const query = jobsQuerySchema.parse(c.req.query()); let before;
    try { before = query.cursor ? jobCursorSchema.parse(JSON.parse(atob(query.cursor)) as unknown) : undefined; }
    catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Invalid cursor' }]); }
    const result = await new JobRepository(authContext(c)!.db).list(c.get('user')!.id, { ...query, before });
    return c.json(jobsListSchema.parse({ items: result.items, nextCursor: result.before ? btoa(JSON.stringify(result.before)) : null }));
  }));
  app.get('/api/v1/jobs/:id', endpoint(async (c) => {
    const id = idParam(c); const jobs = new JobRepository(authContext(c)!.db); const job = await jobs.get(c.get('user')!.id, id); if (!job) throw new JobNotFound();
    const dependencies = await jobs.db.prepare('SELECT depends_on_id FROM job_dependencies WHERE job_id=? ORDER BY depends_on_id').bind(id).all<{ depends_on_id: string }>();
    return c.json(jobDetailSchema.parse({ ...job, attempts: await jobs.attempts(c.get('user')!.id, id), dependencies: dependencies.results.map((d) => d.depends_on_id) }));
  }));
  app.get('/api/v1/projects/:id/production', endpoint(async (c) => c.json(productionSchema.parse(await new ProductionRepository(authContext(c)!.db).overview(c.get('user')!.id, idParam(c))))));
  app.get('/api/v1/projects/:id/usage', endpoint(async (c) => c.json(usageDtoSchema.parse(await new UsageRepository(authContext(c)!.db).summary(c.get('user')!.id, idParam(c))))));
  app.get('/api/v1/projects/:id/checkpoints', endpoint(async (c) => c.json(z.array(checkpointViewSchema).max(25).parse(await new ProductionRepository(authContext(c)!.db).checkpointViews(c.get('user')!.id, idParam(c))))));
  app.post('/api/v1/projects/:id/start', endpoint(async (c) => {
    const input = revisionInputSchema.parse(await body(c)); const id = idParam(c); const key = operation(c); const owner = c.get('user')!.id; const db = authContext(c)!.db; const jobs = new JobRepository(db);
    const project = await db.prepare('SELECT input_type FROM projects WHERE id=? AND owner_id=? AND archived_at IS NULL').bind(id, owner).first<{ input_type: string }>();
    if (!project) throw new JobNotFound();
    const job = await jobs.create(owner, id, key, { kind: project.input_type === 'SCRIPT' ? 'SCRIPT' : 'RESEARCH', executionTarget: 'CLOUD', payload: { projectRevision: input.expectedRevision } }, { startRevision: input.expectedRevision });
    const current = (await jobs.get(owner, job.id))!;
    if (['PENDING', 'READY'].includes(current.status)) { await jobs.tick(owner, id); await prepareJob(db, owner, job.id); }
    await new JobRunnerRepository(db).reconcileProject(owner, id);
    return c.json(startResponseSchema.parse({ projectId: id, job }), 202);
  }));
  for (const action of ['pause', 'resume'] as const) app.post(`/api/v1/projects/:id/${action}`, endpoint(async (c) => {
    const input = revisionInputSchema.parse(await body(c)); const runner = new JobRunnerRepository(authContext(c)!.db);
    const result = await runner[action](c.get('user')!.id, idParam(c), input.expectedRevision, operation(c));
    return c.json(projectControlSchema.parse({ projectId: result.id, status: result.status, revision: result.revision, pauseRequested: result.pause_requested === 1 }), 202);
  }));
  app.post('/api/v1/jobs/:id/retry', endpoint(async (c) => {
    const input = revisionInputSchema.parse(await body(c)); const db = authContext(c)!.db; const owner = c.get('user')!.id; const runner = new JobRunnerRepository(db);
    const result = await runner.retryFailed(owner, idParam(c), operation(c), input.expectedRevision);
    const current = (await runner.jobs.get(owner, result.id))!;
    if (['PENDING', 'READY'].includes(current.status)) { await runner.jobs.tick(owner, result.projectId); await prepareJob(db, owner, result.id); }
    await runner.reconcileProject(owner, result.projectId); return c.json(result, 202);
  }));
  app.post('/api/v1/checkpoints/:id/approve', endpoint(async (c) => c.json(checkpointDtoSchema.parse(await new ProductionRepository(authContext(c)!.db)
    .approve(c.get('user')!.id, idParam(c), operation(c), checkpointApproveSchema.parse(await body(c)))))));
  app.get('/api/v1/providers', endpoint(async (c) => c.json(providerListSchema.parse({ items: await new ProviderRepository(authContext(c)!.db).list(c.get('user')!.id) }))));
  app.post('/api/v1/providers', endpoint(async (c) => {
    const input = manualProviderCreateSchema.parse(await body(c));
    const capabilities = { TEXT: ['STRUCTURED_TEXT'], IMAGE: ['TEXT_IMAGE'], VIDEO: ['IMAGE_VIDEO', 'TEXT_VIDEO', 'FIRST_LAST_FRAME'], VOICE: ['VOICE'], STOCK: ['STOCK'], GRAPHICS: ['GRAPHICS'] };
    const provider = await new ProviderRepository(authContext(c)!.db).create(c.get('user')!.id, operation(c), {
      ...input, adapterKey: 'MANUAL_ASSIST', integrationMode: 'MANUAL', enabled: true, priority: 100,
      capabilities: { operations: capabilities[input.kind], aspectRatios: ['16:9'], languages: [], maxDurationMs: null, maxBytes: null, polling: false, cancellation: false, idempotency: false },
      limits: { concurrency: 1, quotaUnits: null, windowMs: 60000, maxCostPerJobMicros: null }, pricing: { currency: 'USD', costPerUnitMicros: null },
    }); return c.json(providerDtoSchema.parse(provider), 201);
  }));
  app.patch('/api/v1/providers/:id', endpoint(async (c) => c.json(providerDtoSchema.parse(await new ProviderRepository(authContext(c)!.db).patch(c.get('user')!.id, idParam(c), providerPatchSchema.parse(await body(c)))))));
}
