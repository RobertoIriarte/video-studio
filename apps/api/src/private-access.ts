import type { Context } from 'hono';
import type { ApiEnv } from './app.js';
import { errorBody } from './app.js';
import { authContext, identity, sameOrigin, requestAllowed } from './auth/routes.js';

export function requirePrivateAccess(c: Context<ApiEnv>, next: () => Promise<void>) {
    return (async () => {
      if (c.get('user')) { await next(); return; }
      const context = authContext(c);
      if (!context) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Acceso sin configurar.', false), 503);
      const user = await identity(c);
      if (!user) return c.json(errorBody(c.get('requestId'), 'UNAUTHENTICATED', 'Inicia sesión para continuar.', false), 401);
      if (!['GET', 'HEAD'].includes(c.req.method) && !sameOrigin(c, context.config.origin)) return c.json(errorBody(c.get('requestId'), 'FORBIDDEN', 'Origen no permitido.', false), 403);
      if (!['GET', 'HEAD'].includes(c.req.method)) {
        const binaryUpload = c.req.method === 'PUT' && /^\/api\/v1\/imports\/[a-f0-9-]{36}\/content$/.test(c.req.path) && c.req.header('content-type') === 'application/octet-stream';
        if (!binaryUpload && c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Se requiere JSON.', false), 400);
        if (!await requestAllowed(context.db, `project-mutations:${user.id}`, 120, 60000)) {
          c.header('Retry-After', '60');
          return c.json(errorBody(c.get('requestId'), 'RATE_LIMITED', 'Espera antes de volver a intentarlo.', true), 429);
        }
      }
      c.set('user', user);
      await next();
    })();
  }
