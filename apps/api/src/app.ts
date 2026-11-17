import { Hono } from 'hono';
import {
  apiErrorSchema,
  healthResponseSchema,
  versionResponseSchema,
} from '@video-studio/contracts';
import type { ApiError, AuthUser } from '@video-studio/contracts';
import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import { registerAuth } from './auth/routes.js';
import { registerProjects } from './projects.js';
import type { Database } from './db/connection.js';

// Esta entrega solo configura ejecución local; no hay fallback a producción.
const configSchema = z.object({
  APP_ENV: z.literal('local'),
  APP_VERSION: versionResponseSchema.shape.version,
});

export type ApiBindings = { APP_ENV: string; APP_VERSION: string; DB?: Database; APP_ORIGIN?: string; AUTH_SECRET?: string; AUTH_BOOTSTRAP_TOKEN?: string };

export type ApiEnv = {
  Bindings: ApiBindings;
  Variables: { requestId: string; config: z.infer<typeof configSchema>; user?: AuthUser };
};

const jsonHeaders = { 'Content-Type': 'application/json; charset=UTF-8' };

export function errorBody(
  requestId: string,
  code: ApiError['error']['code'],
  message: string,
  retryable: boolean,
): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId, retryable } });
}

export function createApp() {
  const app = new Hono<ApiEnv>();

  app.use('*', async (c, next) => {
    // Se genera en servidor: no confiar en identificadores suministrados por cliente.
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');

    const config = configSchema.safeParse(c.env);
    if (!config.success) {
      return c.json(errorBody(requestId, 'SERVICE_UNAVAILABLE', 'Configuración del servicio no válida.', false), 503, jsonHeaders);
    }
    c.set('config', config.data);
    await next();
    c.header('Content-Type', 'application/json; charset=UTF-8');
  });

  app.get('/api/v1/health', (c) => c.json(healthResponseSchema.parse({ status: 'ok' }), 200, jsonHeaders));
  app.get('/api/v1/version', (c) => c.json(versionResponseSchema.parse({
    apiVersion: 'v1',
    version: c.get('config').APP_VERSION,
  }), 200, jsonHeaders));

  app.use('/api/v1/*', bodyLimit({ maxSize: 6 * 1024 * 1024 + 16384,
    onError: (c) => c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Solicitud demasiado grande.', false), 413),
  }));
  registerAuth(app);
  registerProjects(app);

  app.notFound((c) => c.json(errorBody(c.get('requestId'), 'NOT_FOUND', 'Recurso no encontrado.', false), 404, jsonHeaders));
  app.onError((_error, c) => {
    // No registrar excepción, URL, headers ni configuración: pueden incluir secretos.
    console.error(JSON.stringify({ event: 'request_failed', code: 'INTERNAL_ERROR', requestId: c.get('requestId') }));
    return c.json(errorBody(c.get('requestId'), 'INTERNAL_ERROR', 'Error interno del servidor.', false), 500, jsonHeaders);
  });

  return app;
}
