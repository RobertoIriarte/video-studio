import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { preview } from 'vite';
import { seedOrchestration } from './e2e-orchestration-fixture.mjs';
import { seedYoutube } from './e2e-youtube-fixture.mjs';
import { seedRender } from './e2e-render-fixture.mjs';
import { seedVoice } from './e2e-voice-fixture.mjs';
import { seedMediaSession } from './e2e-media-session.mjs';

const root = new URL('../../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('infra/wrangler.local.json', root), 'utf8'));
const origin = 'http://127.0.0.1:4174'; const token = randomUUID() + randomUUID();
const secret = randomUUID() + randomUUID();
if (!process.env.VIDEO_STUDIO_E2E_PASSWORD) throw new Error('Usa pnpm test:e2e para generar credenciales efímeras.');
const runtime = new Miniflare({
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('apps/api/dist/index.js', root)) }],
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  host: '127.0.0.1', port: 8788, d1Databases: ['DB'], d1Persist: false, r2Buckets: ['MEDIA'], r2Persist: false,
  bindings: { ...config.vars, APP_ORIGIN: origin, AUTH_SECRET: secret, AUTH_BOOTSTRAP_TOKEN: token },
});
try {
  const db = await runtime.getD1Database('DB');
  const directory = new URL('infra/migrations/', root);
  for (const name of readdirSync(directory).filter((n) => n.endsWith('.sql')).sort()) await db.batch([db.prepare(readFileSync(new URL(name, directory), 'utf8'))]);
  const boot = await runtime.dispatchFetch(`${origin}/api/v1/bootstrap`, { method: 'POST', headers: { origin, 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, body: JSON.stringify({ name: 'E2E sintético', email: 'e2e@example.invalid', password: process.env.VIDEO_STUDIO_E2E_PASSWORD }) });
  if (!boot.ok) throw new Error(`Bootstrap efímero falló: ${boot.status}`);
  await seedOrchestration(db, origin, secret, process.env.VIDEO_STUDIO_E2E_PASSWORD);
  await seedContent(db, origin, secret, process.env.VIDEO_STUDIO_E2E_PASSWORD);
  await seedMediaSession(db, origin, secret, process.env.VIDEO_STUDIO_E2E_PASSWORD, process.env.VIDEO_STUDIO_E2E_MEDIA_STATE);
  await seedVoice(db);
  await seedRender(db, await runtime.getR2Bucket('MEDIA'));
  await seedRender(db, await runtime.getR2Bucket('MEDIA'), '00000000-0000-4000-8000-00000000a530');
  await seedRender(db, await runtime.getR2Bucket('MEDIA'), '00000000-0000-4000-8000-00000000a540');
  await seedYoutube(db, await runtime.getR2Bucket('MEDIA'));
  const server = await preview({ root: fileURLToPath(new URL('apps/web/', root)), configFile: fileURLToPath(new URL('apps/web/vite.config.ts', root)), preview: { host: '127.0.0.1', port: 4174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8788' } } });
  const close = async () => { await new Promise((resolve) => server.httpServer.close(resolve)); await runtime.dispose(); process.exitCode = 0; };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch (error) { await runtime.dispose(); throw error; }
import { seedContent } from './e2e-content-fixture.mjs';
