import { requirePrivateAccess } from './private-access.js';
import { z } from 'zod';
import type { Hono } from 'hono';
import { projectArchiveSchema, projectCreateSchema, projectCursorSchema, projectListQuerySchema, projectListSchema, projectPatchSchema, safeValidationIssues, uuidSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { errorBody } from './app.js';
import { authContext, payloadHash } from './auth/routes.js';
import { ProjectCrudRepository, ProjectConflict } from './db/project-crud.js';
import { ProjectRepository } from './db/repositories.js';
import { ProviderRepository } from './db/providers.js';
import { JobNotFound } from './db/jobs.js';

export function registerProjects(app: Hono<ApiEnv>) {
  app.use('/api/v1/projects', requirePrivateAccess);
  app.use('/api/v1/projects/*', requirePrivateAccess);
  app.get('/api/v1/projects', async (c) => {
    const query = projectListQuerySchema.safeParse(c.req.query());
    let after;
    try { after = query.success && query.data.cursor ? projectCursorSchema.parse(JSON.parse(atob(query.data.cursor)) as unknown) : undefined; }
    catch { return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Cursor no válido.', false), 400); }
    if (!query.success) return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Filtros no válidos.', false), 400);
    const owner = c.get('user')!;
    // Una consulta para toda la página, sin cargar input_text ni N+1 lecturas D1.
    const page = await new ProjectRepository(authContext(c)!.db).page(owner.id, { ...query.data, after });
    return c.json(projectListSchema.parse({ items: page.items, nextCursor: page.after ? btoa(JSON.stringify(page.after)) : null }));
  });
  app.get('/api/v1/projects/:id', async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'));
    const record = id.success ? await new ProjectCrudRepository(authContext(c)!.db).get(c.get('user')!.id, id.data) : null;
    return record ? c.json(record) : c.json(errorBody(c.get('requestId'), 'NOT_FOUND', 'Recurso no encontrado.', false), 404);
  });
  for (const kind of ['create', 'patch', 'archive'] as const) {
    const handler = async (c: import('hono').Context<ApiEnv>) => {
      const schema = kind === 'create' ? projectCreateSchema : kind === 'patch' ? projectPatchSchema : projectArchiveSchema;
      const input = schema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) return c.json({ error: { ...errorBody(c.get('requestId'), 'INVALID_INPUT', 'Revisa los campos indicados.', false).error, details: { issues: safeValidationIssues(input.error) } } }, 400);
      if ('settings' in input.data && input.data.settings?.providerPolicy.preferredIds.length) {
        try { await new ProviderRepository(authContext(c)!.db).validatePreferred(c.get('user')!.id, input.data.settings.providerPolicy.preferredIds); }
        catch (error) { if (!(error instanceof JobNotFound)) throw error; return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Proveedor preferido no disponible.', false), 400); }
      }
      const id = kind === 'create' ? null : uuidSchema.safeParse(c.req.param('id'));
      if (id && !id.success) return c.json(errorBody(c.get('requestId'), 'NOT_FOUND', 'Recurso no encontrado.', false), 404);
      const op = uuidSchema.safeParse(c.req.header('idempotency-key'));
      if (kind !== 'patch' && !op.success) return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Falta Idempotency-Key válida.', false), 400);
      const context = authContext(c)!; const owner = c.get('user')!.id;
      const repo = new ProjectCrudRepository(context.db);
      const hash = await payloadHash(context.config.secret, { kind, id: id?.data ?? null, input: input.data });
      try {
        if (kind === 'create' && op.success) { const result = await repo.create(owner, input.data, op.data, hash); return c.json(result.body, result.status); }
        if (kind === 'archive' && op.success) { const previous = await repo.receipt(owner, op.data, hash); if (previous) return c.json(previous.body, previous.status); }
        const record = await repo.update(owner, id!.data!, input.data as z.infer<typeof projectPatchSchema>, kind === 'archive' && op.success ? { operation: op.data, hash } : undefined);
        return record ? c.json(record) : c.json(errorBody(c.get('requestId'), 'NOT_FOUND', 'Recurso no encontrado.', false), 404);
      } catch (error) {
        if (!(error instanceof ProjectConflict)) throw error;
        const current = id?.success ? await repo.get(owner, id.data) : null;
        return c.json({ error: { ...errorBody(c.get('requestId'), 'CONFLICT', 'El proyecto cambió o la operación ya existe. Actualiza antes de guardar.', false).error, details: { currentRevision: current?.revision ?? null } } }, 409);
      }
    };
    if (kind === 'patch') app.patch('/api/v1/projects/:id', handler);
    else app.post(kind === 'create' ? '/api/v1/projects' : '/api/v1/projects/:id/archive', handler);
  }
}
