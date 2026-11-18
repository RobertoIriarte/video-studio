import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../../apps/api/src/db/connection.js';
import localConfig from '../../infra/wrangler.local.json' with { type: 'json' };

// Mismo límite tipado del SDK real que en F1-02: sus .d.ts siguen incompletos.
type D1Runtime = {
  getD1Database(name: string): Promise<Database>;
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
};
const { Miniflare } = createRequire(import.meta.url)('miniflare') as {
  Miniflare: new (options: {
    modules: boolean | { type: 'ESModule'; path: string }[]; script?: string; scriptPath?: string; compatibilityDate: string;
    compatibilityFlags?: string[]; bindings?: Record<string, string>;
    host: string; port: number; d1Databases: string[]; d1Persist: false|string; r2Buckets?: string[]; r2Persist?: false|string;
  }) => D1Runtime;
};

export async function authHarness(options:{persistRoot?:string;existing?:boolean}={}) {
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const bootstrapToken = crypto.randomUUID() + crypto.randomUUID();
  const origin = localConfig.vars.APP_ORIGIN;
  const runtime = new Miniflare({
    modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../../apps/api/dist/index.js', import.meta.url)) }],
    compatibilityDate: localConfig.compatibility_date, compatibilityFlags: localConfig.compatibility_flags,
    host: '127.0.0.1', port: 0, d1Databases: ['DB'], d1Persist: options.persistRoot?join(options.persistRoot,'d1'):false, r2Buckets: ['MEDIA'], r2Persist: options.persistRoot?join(options.persistRoot,'r2'):false,
    bindings: { ...localConfig.vars, AUTH_SECRET: secret, AUTH_BOOTSTRAP_TOKEN: bootstrapToken },
  });
  try {
    const db = await runtime.getD1Database('DB');
    if(!options.existing)await applyMigrations(db);
    return { db, secret, bootstrapToken, origin, fetch: (path: string, init?: RequestInit) => runtime.dispatchFetch(`${origin}${path}`, init), dispose: () => runtime.dispose() };
  } catch (error) { await runtime.dispose(); throw error; }
}

export async function d1Harness() {
  const runtime = new Miniflare({
    modules: true, script: 'export default { fetch() { return new Response("D1 test harness"); } };',
    compatibilityDate: localConfig.compatibility_date, host: '127.0.0.1', port: 0,
    d1Databases: ['DB'], d1Persist: false,
  });
  try {
    return { db: await runtime.getD1Database('DB'), dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

const directory = new URL('../../infra/migrations/', import.meta.url);
export const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }));

// Cada archivo del baseline contiene una sentencia DDL completa. No es un
// migrador de producción: ese ledger y sus transacciones los gestiona Wrangler.
export async function applyMigrations(db: Database, selected = migrations) {
  // Lotes pequeños de las mismas sentencias: menos viajes IPC al crecer el esquema.
  for (let offset = 0; offset < selected.length; offset += 16) await db.batch(selected.slice(offset, offset + 16).map((migration) => db.prepare(migration.sql)));
}
