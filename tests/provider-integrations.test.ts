import { describe, expect, it } from 'vitest';
import { integrationReviewsSchema, providerListSchema, providerInputSchema, manualResultSchema } from '@video-studio/contracts';
import { integrationReviews } from '../packages/providers/src/index.js';
import { researchData, scriptData } from './support/content.js';
describe('F5-05 contratos de disponibilidad e importación', () => {
  it('las vías revisadas no pueden declarar API activa, costo conocido ni credenciales en DTO', () => {
    const response = integrationReviewsSchema.parse({ items: integrationReviews }); expect(new Set(response.items.map((i) => i.kind))).toEqual(new Set(['TEXT', 'IMAGE', 'VIDEO', 'VOICE', 'STOCK']));
    const first = response.items[0]!;
    for (const mutation of [{ automatic: true }, { status: 'AVAILABLE' }, { costKnown: true }, { token: 'must-not-appear' }, { toolUrl: 'http://insecure.invalid' }]) expect(integrationReviewsSchema.safeParse({ items: [{ ...first, ...mutation }] }).success).toBe(false);
    // Additive endpoint: the established /providers response remains valid and unchanged.
    expect(providerListSchema.parse({ items: [] })).toEqual({ items: [] });
  });
  it('la vía manual no se convierte en PAID_API o suscripción mediante configuración', () => {
    const manual = { name: 'Manual autorizado', kind: 'TEXT', adapterKey: 'MANUAL_ASSIST', integrationMode: 'MANUAL', enabled: true, priority: 0, capabilities: { operations: ['STRUCTURED_TEXT'], aspectRatios: [], languages: [], maxDurationMs: null, maxBytes: null, polling: false, cancellation: false, idempotency: true }, limits: { concurrency: 1, quotaUnits: null, windowMs: 60000, maxCostPerJobMicros: null }, pricing: { currency: 'USD', costPerUnitMicros: null } };
    expect(providerInputSchema.safeParse(manual).success).toBe(true); for (const integrationMode of ['PAID_API', 'SUBSCRIPTION']) expect(providerInputSchema.safeParse({ ...manual, integrationMode }).success).toBe(false);
    expect(manualResultSchema.parse({ kind: 'RESEARCH', data: researchData() }).kind).toBe('RESEARCH'); expect(manualResultSchema.parse({ kind: 'SCRIPT', data: scriptData() }).kind).toBe('SCRIPT');
    expect(manualResultSchema.safeParse({ kind: 'ASSET', assets: [{ shotOrder: 0, assetId: 'https://external.invalid/file' }] }).success).toBe(false);
  });
});
