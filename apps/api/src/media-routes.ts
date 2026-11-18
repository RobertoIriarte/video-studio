import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { assetAccessSchema, assetListSchema, assetQuerySchema, assetSchema, importDtoSchema, importListSchema, uuidSchema, WEB_IMPORT_MAX_BYTES } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { errorBody } from './app.js';
import { authContext } from './auth/routes.js';
import { requirePrivateAccess } from './private-access.js';
import { endpoint } from './orchestration.js';
import { MediaRepository } from './db/media.js';
import { JobConflict, JobNotFound } from './db/jobs.js';

const id = (c: Context<ApiEnv>) => uuidSchema.parse(c.req.param('id'));
const repo = (c: Context<ApiEnv>) => new MediaRepository(authContext(c)!.db, c.env.MEDIA!);
async function signingKey(secret: string) { return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
const signedValue = (owner: string, asset: string, expires: number) => new TextEncoder().encode(JSON.stringify({ owner, asset, expires }));
export async function assetTicket(secret: string, owner: string, asset: string, expires: number) {
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), signedValue(owner, asset, expires))), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyAssetTicket(secret: string, owner: string, asset: string, expires: number, ticket: string, now = Date.now()) {
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 300000 || !/^[a-f0-9]{64}$/.test(ticket)) return false;
  return crypto.subtle.verify('HMAC', await signingKey(secret), Uint8Array.from(ticket.match(/../g)!, (hex) => parseInt(hex, 16)), signedValue(owner, asset, expires));
}
async function readBody(c: Context<ApiEnv>) {
  const reader = c.req.raw.body?.getReader(); if (!reader) throw new JobConflict(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > WEB_IMPORT_MAX_BYTES) { await reader.cancel(); throw new z.ZodError([{ code: 'custom', path: ['file'], message: 'Too large' }]); } chunks.push(next.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export function registerMedia(app: Hono<ApiEnv>) {
  for (const prefix of ['assets', 'imports']) {
    app.use(`/api/v1/${prefix}`, requirePrivateAccess); app.use(`/api/v1/${prefix}/*`, requirePrivateAccess);
    for (const path of [`/api/v1/${prefix}`, `/api/v1/${prefix}/*`]) app.use(path, async (c, next) => { if (!c.env.MEDIA) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Almacenamiento privado sin configurar.', false), 503); await next(); });
  }
  app.post('/api/v1/assets/import', endpoint(async (c) => c.json(importDtoSchema.parse(await repo(c).intent(c.get('user')!.id, uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null))), 201)));
  app.put('/api/v1/imports/:id/content', endpoint(async (c) => { await repo(c).owned(c.get('user')!.id, id(c)); return c.json(importDtoSchema.parse(await repo(c).upload(c.get('user')!.id, id(c), await readBody(c)))); }));
  app.post('/api/v1/assets/:id/finalize', endpoint(async (c) => { z.strictObject({}).parse(await c.req.json<unknown>().catch(() => null)); return c.json(assetSchema.parse(await repo(c).finalize(c.get('user')!.id, id(c), uuidSchema.parse(c.req.header('idempotency-key'))))); }));
  app.get('/api/v1/imports', endpoint(async (c) => { const q = z.strictObject({ projectId: uuidSchema.optional(), cursor: uuidSchema.optional() }).parse(c.req.query()); return c.json(importListSchema.parse(await repo(c).listImports(c.get('user')!.id, q.projectId, q.cursor))); }));
  app.get('/api/v1/assets', endpoint(async (c) => c.json(assetListSchema.parse(await repo(c).listAssets(c.get('user')!.id, assetQuerySchema.parse(c.req.query()))))));
  app.get('/api/v1/assets/:id/access', endpoint(async (c) => {
    const owner = c.get('user')!.id; const asset = await repo(c).asset(owner, id(c)); const expires = Date.now() + 300000;
    const available = asset.key && ['REMOTE_AVAILABLE', 'BOTH'].includes(asset.dto.availability);
    return c.json(assetAccessSchema.parse({ assetId: asset.dto.id, availability: asset.dto.availability, expiresAt: available ? new Date(expires).toISOString() : null,
      url: available ? `/api/v1/assets/${asset.dto.id}/content?expires=${expires}&ticket=${await assetTicket(authContext(c)!.config.secret, owner, asset.dto.id, expires)}` : null }));
  }));
  app.get('/api/v1/assets/:id/content', endpoint(async (c) => {
    const owner = c.get('user')!.id; const asset = await repo(c).asset(owner, id(c));
    if (!asset.key || !['REMOTE_AVAILABLE', 'BOTH'].includes(asset.dto.availability) || !await verifyAssetTicket(authContext(c)!.config.secret, owner, asset.dto.id, Number(c.req.query('expires')), c.req.query('ticket') ?? '')) throw new JobNotFound();
    const object = await c.env.MEDIA!.get(asset.key); if (!object || object.size !== asset.dto.bytes) throw new JobNotFound(); c.set('binaryResponse', true);
    return new Response(object.body, { headers: { 'content-type': asset.dto.mime, 'content-length': String(object.size), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'content-disposition': 'inline' } });
  }));
}
