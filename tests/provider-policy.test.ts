import { describe, expect, it } from 'vitest';
import { chooseProvider, normalizeProviderError } from '../packages/providers/src/index.js';
import { providerFixture } from './support/provider-fixtures.js';

const candidate = (id: string, integrationMode = 'MOCK') => ({ ...providerFixture(), id, integrationMode, status: 'AVAILABLE' });
const policy = { preferredIds: [] as string[], allowPaidFallback: false, spendingAuthorized: false, currency: 'USD', availableMicros: 1000 };
describe('F3-03 · política y errores de proveedores', () => {
  it('prioriza suscripción compatible; no fallback pago silencioso', () => {
    const subscription = candidate('subscription', 'SUBSCRIPTION'); const paid = { ...candidate('paid', 'PAID_API'), priority: 0 };
    expect(chooseProvider([paid, subscription], { capability: 'STRUCTURED_TEXT' }, policy).provider?.id).toBe('subscription');
    expect(chooseProvider([paid], { capability: 'STRUCTURED_TEXT' }, policy)).toMatchObject({ provider: null, manual: true });
    expect(chooseProvider([paid], { capability: 'STRUCTURED_TEXT' }, { ...policy, allowPaidFallback: true })).toMatchObject({ provider: null, manual: true });
    expect(chooseProvider([paid], { capability: 'STRUCTURED_TEXT' }, { ...policy, allowPaidFallback: true, spendingAuthorized: true }).provider?.id).toBe('paid');
  });
  it('capacidad/idioma/duración/aspect ratio incompatibles llevan a manual', () => {
    const p = { ...candidate('limited'), capabilities: { ...providerFixture().capabilities, maxDurationMs: 5000 } };
    for (const request of [{ capability: 'TEXT_VIDEO' }, { capability: 'STRUCTURED_TEXT', language: 'fr' }, { capability: 'STRUCTURED_TEXT', durationMs: 6000 }, { capability: 'STRUCTURED_TEXT', aspectRatio: '9:16' }]) expect(chooseProvider([p], request, policy).manual).toBe(true);
    const manual = { ...candidate('manual', 'MANUAL'), status: 'MANUAL_ONLY' }; expect(chooseProvider([manual], { capability: 'STRUCTURED_TEXT' }, policy).manual).toBe(true);
  });
  it('precio desconocido sin tope, moneda distinta o presupuesto insuficiente bloquean pago', () => {
    const paid = { ...candidate('paid', 'PAID_API'), pricing: { currency: 'USD', costPerUnitMicros: 2000 } };
    const allowed = { ...policy, allowPaidFallback: true, spendingAuthorized: true };
    expect(chooseProvider([paid], { capability: 'STRUCTURED_TEXT' }, allowed).provider).toBeNull();
    expect(chooseProvider([{ ...paid, pricing: { currency: 'EUR', costPerUnitMicros: 1 } }], { capability: 'STRUCTURED_TEXT' }, allowed).provider).toBeNull();
    expect(chooseProvider([{ ...paid, pricing: { currency: 'USD', costPerUnitMicros: null }, limits: { maxCostPerJobMicros: null } }], { capability: 'STRUCTURED_TEXT' }, allowed).provider).toBeNull();
  });
  it('T13 normaliza sin filtrar mensaje, URL ni credenciales', () => {
    expect(normalizeProviderError({ code: 'RATE_LIMIT', message: 'private-token-value' })).toEqual({ code: 'RATE_LIMIT', retryable: true });
    expect(JSON.stringify(normalizeProviderError(new Error('private-token-value')))).not.toContain('private-token-value');
    expect(normalizeProviderError({ code: 'UNKNOWN_OUTCOME' }).retryable).toBe(false);
  });
});
