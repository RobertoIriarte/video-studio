import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema, versionResponseSchema } from '@video-studio/contracts';
import localConfig from '../infra/wrangler.local.json' with { type: 'json' };

// Los .d.ts publicados de Miniflare referencian archivos internos ausentes.
// Limitar este SDK de pruebas a la superficie usada, sin modificar node_modules
// ni desactivar skipLibCheck. La implementación cargada es el Miniflare real.
type LocalRuntime = {
  ready: Promise<URL>;
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  getWorker(name: string): Promise<{ fetch(url: string): Promise<Response> }>;
  dispose(): Promise<void>;
};
type LocalRuntimeOptions = {
  host: string;
  port: number;
  workers: {
    modules: { type: 'ESModule'; path: string }[];
    compatibilityDate: string;
    compatibilityFlags: string[];
    name: string;
    bindings: Record<string, string>;
  }[];
};
const { Miniflare } = createRequire(import.meta.url)('miniflare') as {
  Miniflare: new (options: LocalRuntimeOptions) => LocalRuntime;
};

// Ejecutar el bundle real en workerd, sin cuenta Cloudflare ni bindings remotos.
const workerOptions = {
  modules: [{ type: 'ESModule' as const, path: fileURLToPath(new URL('../apps/api/dist/index.js', import.meta.url)) }],
  compatibilityDate: localConfig.compatibility_date,
  compatibilityFlags: localConfig.compatibility_flags,
};
const server = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
  { ...workerOptions, name: localConfig.name, bindings: localConfig.vars },
  { ...workerOptions, name: 'invalid-config', bindings: { APP_ENV: 'production', APP_VERSION: '' } },
] });

beforeAll(async () => { await server.ready; }, 30_000);
afterAll(async () => { await server.dispose(); });

describe('API en Worker local (workerd)', () => {
  it('health comprueba liveness y devuelve JSON sin caché ni cookies', async () => {
    const response = await server.dispatchFetch('http://localhost/api/v1/health');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
    expect(response.headers.get('content-type')).toMatch(/application\/json; charset=UTF-8/i);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('version devuelve únicamente versiones públicas', async () => {
    const response = await server.dispatchFetch('http://localhost/api/v1/version');
    expect(response.status).toBe(200);
    expect(versionResponseSchema.parse(await response.json())).toEqual({
      apiVersion: 'v1', version: localConfig.vars.APP_VERSION,
    });
  });

  it('ruta desconocida usa el sobre de error compartido y no refleja inputs', async () => {
    const response = await server.dispatchFetch('http://localhost/api/v1/unknown?token=private-marker');
    expect(response.status).toBe(404);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error).toEqual({
      code: 'NOT_FOUND', message: 'Recurso no encontrado.',
      requestId: response.headers.get('x-request-id'), retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain('private-marker');
  });

  it.each(['POST', 'PUT', 'DELETE'])('no habilita %s sobre health', async (method) => {
    const response = await server.dispatchFetch('http://localhost/api/v1/health', { method });
    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('genera IDs distintos e ignora el requestId suministrado por cliente', async () => {
    const clientId = '00000000-0000-4000-8000-000000000000';
    const first = await server.dispatchFetch('http://localhost/api/v1/health', { headers: { 'X-Request-Id': clientId } });
    const second = await server.dispatchFetch('http://localhost/api/v1/health');
    expect(first.headers.get('x-request-id')).not.toBe(clientId);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
  });

  it('configuración inválida cierra acceso con 503, sin fallback a producción', async () => {
    const worker = await server.getWorker('invalid-config');
    const response = await worker.fetch('http://localhost/api/v1/health');
    expect(response.status).toBe(503);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE', message: 'Configuración del servicio no válida.',
      requestId: response.headers.get('x-request-id'), retryable: false,
    });
  });
});
