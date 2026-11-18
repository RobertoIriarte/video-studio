export type ProviderContext = { ownerId: string; projectId: string; idempotencyKey: string; timeoutMs: number;
  signal: { readonly aborted: boolean; throwIfAborted(): void } };
// Los tipos concretos de request/result/capabilities se suministran desde contracts.
export interface ProviderAdapter<Request, Result, Estimate, Capabilities> {
  capabilities(): Capabilities;
  validate(request: Request): void;
  estimate(request: Request): Promise<Estimate>;
  start(request: Request, context: ProviderContext): Promise<Result>;
  poll?(operationId: string, context: ProviderContext): Promise<Result>;
  cancel?(operationId: string, context: ProviderContext): Promise<void>;
}
export type ProviderCandidate = { id: string; enabled: boolean; priority: number; integrationMode: string; status: string;
  capabilities: { operations: readonly string[]; aspectRatios: readonly string[]; languages: readonly string[]; maxDurationMs: number | null; maxBytes: number | null };
  pricing: { currency: string; costPerUnitMicros: number | null }; limits: { maxCostPerJobMicros: number | null } };
export function chooseProvider<T extends ProviderCandidate>(providers: readonly T[], request: { capability: string; aspectRatio?: string | undefined; language?: string | undefined; durationMs?: number | undefined; bytes?: number | undefined },
  policy: { preferredIds: readonly string[]; allowPaidFallback: boolean; spendingAuthorized: boolean; currency: string; availableMicros: number }) {
  const eligible = providers.filter((p) => p.enabled && ['AVAILABLE', 'MANUAL_ONLY'].includes(p.status) && p.capabilities.operations.includes(request.capability)
    && (!request.aspectRatio || p.capabilities.aspectRatios.includes(request.aspectRatio))
    && (!request.language || p.capabilities.languages.length === 0 || p.capabilities.languages.includes(request.language))
    && (!request.durationMs || p.capabilities.maxDurationMs === null || request.durationMs <= p.capabilities.maxDurationMs)
    && (!request.bytes || p.capabilities.maxBytes === null || request.bytes <= p.capabilities.maxBytes));
  const allowed = eligible.filter((p) => p.integrationMode !== 'PAID_API' || (policy.spendingAuthorized
    && (policy.preferredIds.includes(p.id) || policy.allowPaidFallback) && p.pricing.currency === policy.currency
    && (p.pricing.costPerUnitMicros ?? p.limits.maxCostPerJobMicros) !== null
    && (p.pricing.costPerUnitMicros ?? p.limits.maxCostPerJobMicros)! <= policy.availableMicros));
  const rank = (p: T) => policy.preferredIds.includes(p.id) ? policy.preferredIds.indexOf(p.id) : 1000 + (p.integrationMode === 'SUBSCRIPTION' ? 0 : p.integrationMode === 'PAID_API' ? 2000 : 1000);
  const provider = [...allowed].sort((a, b) => rank(a) - rank(b) || a.priority - b.priority || a.id.localeCompare(b.id))[0];
  return provider ? { provider, manual: provider.integrationMode === 'MANUAL' || provider.status === 'MANUAL_ONLY', reason: null }
    : { provider: null, manual: true, reason: eligible.length ? 'BUDGET_EXCEEDED' : 'UNSUPPORTED_CAPABILITY' };
}
export function normalizeProviderError(error: unknown) {
  const allowed = ['AUTH_REQUIRED', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'INVALID_INPUT', 'UNSUPPORTED_CAPABILITY', 'PROVIDER_UNAVAILABLE', 'CONTENT_BLOCKED', 'UNKNOWN_OUTCOME', 'LOCAL_UNAVAILABLE', 'BUDGET_EXCEEDED'];
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && allowed.includes(error.code) ? error.code : 'PROVIDER_UNAVAILABLE';
  return { code, retryable: ['RATE_LIMIT', 'PROVIDER_UNAVAILABLE'].includes(code) };
}
export * from './mock-text.js';
export * from './mock-voice.js';
export * from './integrations.js';
