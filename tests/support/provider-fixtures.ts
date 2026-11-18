import type { ProviderInput } from '@video-studio/contracts';
import { ProviderRepository } from '../../apps/api/src/db/providers.js';
import { UsageRepository } from '../../apps/api/src/db/usage.js';
import type { orchestrationHarness } from './orchestration.js';

export const providerFixture = (): ProviderInput => ({ name: 'Proveedor sintético · sin conexión', kind: 'TEXT', adapterKey: 'MOCK_FIXTURE', integrationMode: 'MOCK', enabled: true, priority: 10,
  capabilities: { operations: ['STRUCTURED_TEXT'], aspectRatios: ['16:9'], languages: ['es'], maxDurationMs: null, maxBytes: null, polling: true, cancellation: false, idempotency: true },
  limits: { concurrency: 8, quotaUnits: 100, windowMs: 60000, maxCostPerJobMicros: 10000 }, pricing: { currency: 'USD', costPerUnitMicros: 0 } });
export async function reserveExternalFixture(h: Awaited<ReturnType<typeof orchestrationHarness>>, jobId: string) {
  const provider = await new ProviderRepository(h.db, true).create(h.owner, crypto.randomUUID(), providerFixture());
  return new UsageRepository(h.db, h.runtime).reserve(h.owner, h.project, { jobId, providerId: provider.id, eventKey: crypto.randomUUID(), amountMicros: 0, units: 1, currency: 'USD' });
}
