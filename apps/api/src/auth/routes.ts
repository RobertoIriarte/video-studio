import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { authUserSchema, bootstrapInputSchema, loginInputSchema, meResponseSchema, uuidSchema } from '@video-studio/contracts';
import { createAuth } from './service.js';
import type { ApiEnv } from '../app.js';
import { errorBody } from '../app.js';

const authConfigSchema = z.object({
  APP_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
  }),
  AUTH_SECRET: z.string().min(32).max(256).refine((value) => value.trim() === value),
});

export function authContext(c: Context<ApiEnv>) {
  const config = authConfigSchema.safeParse(c.env);
  if (!config.success || !c.env.DB || typeof c.env.DB.prepare !== 'function' || typeof c.env.DB.exec !== 'function') return null;
  return { db: c.env.DB, config: { origin: config.data.APP_ORIGIN, secret: config.data.AUTH_SECRET } };
}

export async function identity(c: Context<ApiEnv>) {
  const context = authContext(c);
  if (!context) return null;
  const session = await createAuth(context.db, context.config).api.getSession({ headers: c.req.raw.headers });
  return session ? authUserSchema.strip().parse(session.user) : null;
}

export function sameOrigin(c: Context<ApiEnv>, origin: string) {
  return c.req.header('origin') === origin;
}

export async function requestAllowed(db: NonNullable<ApiEnv['Bindings']['DB']>, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const result = await db.prepare(`INSERT INTO request_limits (key,count,window_start) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
    window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END RETURNING count`)
    .bind(key, now, cutoff, cutoff, now).first<{ count: number }>();
  return result !== null && result.count <= max;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function tokenMatches(provided: string, expected: string) {
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
export async function payloadHash(secret: string, value: unknown) {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
    return input;
  };
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(canonical(value)))));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function registerAuth(app: Hono<ApiEnv>) {
  app.post('/api/v1/bootstrap', async (c) => {
    const context = authContext(c);
    const expected = c.env.AUTH_BOOTSTRAP_TOKEN;
    if (!context) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Configura el acceso local antes de continuar.', false), 503);
    if (!expected || expected.length < 32) return c.json(errorBody(c.get('requestId'), 'NOT_FOUND', 'Recurso no encontrado.', false), 404);
    if (!sameOrigin(c, context.config.origin)) return c.json(errorBody(c.get('requestId'), 'FORBIDDEN', 'Origen no permitido.', false), 403);
    if (!await requestAllowed(context.db, 'bootstrap', 5, 300000)) return c.json(errorBody(c.get('requestId'), 'RATE_LIMITED', 'Espera antes de volver a intentarlo.', true), 429);
    const token = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    if (token.length > 256 || !await tokenMatches(token, expected)) return c.json(errorBody(c.get('requestId'), 'FORBIDDEN', 'Acceso no permitido.', false), 403);
    const operation = uuidSchema.safeParse(c.req.header('idempotency-key'));
    const input = bootstrapInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!operation.success || !input.success) return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Datos de entrada no válidos.', false), 400);
    const hash = await payloadHash(context.config.secret, input.data);
    await context.db.prepare(`INSERT INTO owner_bootstrap (singleton,operation_id,payload_hash,state,created_at)
      SELECT 1,?,?,'CLAIMED',? WHERE NOT EXISTS (SELECT 1 FROM "user") ON CONFLICT(singleton) DO NOTHING`)
      .bind(operation.data, hash, new Date().toISOString()).run();
    const claim = await context.db.prepare('SELECT operation_id,payload_hash,state FROM owner_bootstrap WHERE singleton = 1')
      .first<{ operation_id: string; payload_hash: string; state: string }>();
    if (!claim || claim.operation_id !== operation.data || claim.payload_hash !== hash) return c.json(errorBody(c.get('requestId'), 'CONFLICT', 'El bootstrap ya está reservado o completado.', false), 409);
    if (claim.state === 'READY') return c.json({ ok: true });
    const auth = createAuth(context.db, context.config, operation.data);
    try {
      const user = await context.db.prepare('SELECT id FROM "user" WHERE id = ?').bind(operation.data).first();
      if (!user) {
        await auth.api.signUpEmail({ body: input.data, headers: new Headers({ origin: context.config.origin }) });
      } else {
        const account = await context.db.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL")
          .bind(operation.data).first();
        if (!account) {
          const internal = await auth.$context;
          await internal.internalAdapter.createAccount({ userId: operation.data, providerId: 'credential', accountId: operation.data, password: await internal.password.hash(input.data.password) });
        }
      }
    } catch {
      // Permitir recuperación de la misma operación tras una carrera o fallo parcial.
    }
    const complete = await context.db.prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL")
      .bind(operation.data).first();
    if (!complete) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Bootstrap incompleto. Reintenta la misma operación.', true), 503);
    await context.db.prepare("UPDATE owner_bootstrap SET state = 'READY',user_id = ? WHERE singleton = 1 AND operation_id = ? AND payload_hash = ?")
      .bind(operation.data, operation.data, hash).run();
    return c.json({ ok: true });
  });

  for (const endpoint of ['sign-in/email', 'sign-out']) app.post(`/api/v1/auth/${endpoint}`, async (c) => {
    const context = authContext(c);
    if (!context) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Configura el acceso local antes de continuar.', false), 503);
    if (!sameOrigin(c, context.config.origin)) return c.json(errorBody(c.get('requestId'), 'FORBIDDEN', 'Origen no permitido.', false), 403);
    const body = endpoint === 'sign-in/email' ? loginInputSchema.safeParse(await c.req.json().catch(() => null)) : { success: true as const, data: {} };
    if (!body.success) return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Datos de entrada no válidos.', false), 400);
    const headers = new Headers({ 'content-type': 'application/json', origin: context.config.origin, 'cf-connecting-ip': '127.0.0.1' });
    const cookie = c.req.header('cookie');
    if (cookie) headers.set('cookie', cookie);
    const response = await createAuth(context.db, context.config).handler(new Request(`${context.config.origin}/api/v1/auth/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body.data) }));
    if (!response.ok) {
      if (response.status === 429) return c.json(errorBody(c.get('requestId'), 'RATE_LIMITED', 'Espera antes de volver a intentarlo.', true), 429);
      return c.json(errorBody(c.get('requestId'), 'UNAUTHENTICATED', 'Correo o contraseña incorrectos.', false), 401);
    }
    const result = c.json({ ok: true });
    for (const cookieValue of response.headers.getSetCookie()) result.headers.append('set-cookie', cookieValue);
    return result;
  });

  app.get('/api/v1/me', async (c) => {
    if (!authContext(c)) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Configura el acceso local antes de continuar.', false), 503);
    const user = await identity(c);
    return user ? c.json(meResponseSchema.parse({ user })) : c.json(errorBody(c.get('requestId'), 'UNAUTHENTICATED', 'Inicia sesión para continuar.', false), 401);
  });

}
