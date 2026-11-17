import { describe, expect, it, vi } from 'vitest';
import { apiErrorSchema } from '@video-studio/contracts';
import { createApp } from '../apps/api/src/app.js';

describe('errores de aplicación', () => {
  it('500 oculta excepción/stack y registra solo código, evento e identificador', async () => {
    const app = createApp();
    // Ruta exclusiva del test: jamás se añade al Worker de producción.
    app.get('/failure', () => { throw new Error('secret-marker'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await app.request('/failure', {}, { APP_ENV: 'local', APP_VERSION: '0.0.0' });
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toBe('application/json; charset=UTF-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = apiErrorSchema.parse(await response.json());
      expect(body.error).toEqual({
        code: 'INTERNAL_ERROR', message: 'Error interno del servidor.',
        requestId: response.headers.get('x-request-id'), retryable: false,
      });
      expect(JSON.stringify(body)).not.toContain('secret-marker');
      expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
        event: 'request_failed', code: 'INTERNAL_ERROR', requestId: body.error.requestId,
      }));
      // El manejador no deja el proceso inutilizable tras una excepción.
      expect((await app.request('/api/v1/health', {}, { APP_ENV: 'local', APP_VERSION: '0.0.0' })).status).toBe(200);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    { APP_ENV: 'production', APP_VERSION: '0.0.0' },
    { APP_ENV: 'local', APP_VERSION: '' },
    { APP_ENV: 'local', APP_VERSION: 'private-marker' },
  ])('rechaza configuración inválida sin reflejar sus valores: %j', async (env) => {
    const response = await createApp().request('/api/v1/version', {}, env);
    expect(response.status).toBe(503);
    const body = apiErrorSchema.parse(await response.json());
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('private-marker');
  });

  it('el contrato rechaza requestId inválido y campos de excepción', () => {
    const error = {
      code: 'INTERNAL_ERROR', message: 'Error interno del servidor.',
      requestId: '00000000-0000-4000-8000-000000000000', retryable: false,
    };
    expect(apiErrorSchema.safeParse({ error }).success).toBe(true);
    expect(apiErrorSchema.safeParse({ error: { ...error, requestId: 'invalid' } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ error: { ...error, stack: 'secret-marker' } }).success).toBe(false);
  });
});
