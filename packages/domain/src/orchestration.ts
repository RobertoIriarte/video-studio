const transitions: Readonly<Record<string, readonly string[]>> = {
  PENDING: ['READY', 'WAITING_RESOURCE', 'WAITING_MANUAL', 'PAUSED', 'CANCELLED', 'STALE'],
  READY: ['RUNNING', 'WAITING_RESOURCE', 'WAITING_MANUAL', 'PAUSED', 'CANCELLED', 'STALE'],
  RUNNING: ['SUCCEEDED', 'WAITING_APPROVAL', 'WAITING_MANUAL', 'WAITING_RESOURCE', 'RETRY_SCHEDULED', 'FAILED', 'PAUSED', 'CANCELLED', 'STALE'],
  WAITING_APPROVAL: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'STALE'],
  WAITING_MANUAL: ['PENDING', 'SUCCEEDED', 'CANCELLED', 'STALE'],
  WAITING_RESOURCE: ['PENDING', 'CANCELLED', 'STALE'],
  RETRY_SCHEDULED: ['READY', 'PAUSED', 'FAILED', 'CANCELLED', 'STALE'],
  PAUSED: ['PENDING', 'CANCELLED', 'STALE'], FAILED: ['PENDING', 'CANCELLED', 'STALE'],
  SUCCEEDED: ['STALE'], CANCELLED: [], STALE: [],
};
export function assertJobTransition(from: string, to: string): void {
  if (!transitions[from]?.includes(to)) throw new Error('JOB_TRANSITION_INVALID');
}
export function assertDag(nodes: readonly { id: string; dependencies: readonly string[] }[], externalIds: readonly string[] = []): void {
  const graph = new Map(nodes.map((n) => [n.id, n.dependencies]));
  if (graph.size !== nodes.length) throw new Error('DAG_DUPLICATE');
  const external = new Set(externalIds); const visited = new Set<string>(); const active = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new Error('DAG_CYCLE');
    if (visited.has(id)) return;
    const deps = graph.get(id);
    if (!deps) { if (external.has(id)) return; throw new Error('DAG_MISSING_DEPENDENCY'); }
    if (new Set(deps).size !== deps.length) throw new Error('DAG_DUPLICATE_DEPENDENCY');
    active.add(id); for (const dependency of deps) visit(dependency); active.delete(id); visited.add(id);
  }
  for (const id of graph.keys()) visit(id);
}
export type SchedulerNode = { id: string; status: string; dependencies: readonly string[]; nextRunAtMs: number | null; inputsCurrent: boolean; checkpointPending: boolean };
export function planReadyJobs(nodes: readonly SchedulerNode[], nowMs: number, paused: boolean): string[] {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('CLOCK_INVALID');
  assertDag(nodes);
  if (paused) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.filter((n) => ['PENDING', 'RETRY_SCHEDULED'].includes(n.status) && n.inputsCurrent && !n.checkpointPending
    && (n.nextRunAtMs === null || n.nextRunAtMs <= nowMs)
    && n.dependencies.every((id) => byId.get(id)?.status === 'SUCCEEDED')).map((n) => n.id);
}
export function checkpointRequired(mode: string, stage: string, checkpoints: readonly string[], blocking: boolean): boolean {
  if (!['AUTO', 'SUPERVISED'].includes(mode)) throw new Error('MODE_INVALID');
  return blocking || (mode === 'SUPERVISED' && checkpoints.includes(stage));
}

export function retryDelayMs(attempt: number, random: number, retryAfterMs = 0): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || !Number.isFinite(random) || random < 0 || random > 1
    || !Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 86400000) throw new RangeError('BACKOFF_INVALID');
  const base = Math.min(600000, 15000 * 4 ** Math.min(attempt - 1, 10));
  return Math.max(retryAfterMs, Math.min(600000, base + Math.floor(base * random * .25)));
}
export function failureDisposition(code: string, externalEffectPossible: boolean): { status: string; retryable: boolean; unknown: boolean } {
  const definiteRejections = ['AUTH_REQUIRED', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'INVALID_INPUT', 'UNSUPPORTED_CAPABILITY', 'CONTENT_BLOCKED', 'BUDGET_EXCEEDED'];
  if (code === 'UNKNOWN_OUTCOME' || (externalEffectPossible && !definiteRejections.includes(code))) return { status: 'WAITING_RESOURCE', retryable: false, unknown: true };
  if (['TRANSIENT', 'RATE_LIMIT', 'PROVIDER_UNAVAILABLE'].includes(code)) return { status: 'RETRY_SCHEDULED', retryable: true, unknown: false };
  if (code === 'UNSUPPORTED_CAPABILITY') return { status: 'WAITING_MANUAL', retryable: false, unknown: false };
  if (['LOCAL_UNAVAILABLE', 'QUOTA_EXHAUSTED', 'BUDGET_EXCEEDED'].includes(code)) return { status: 'WAITING_RESOURCE', retryable: false, unknown: false };
  return { status: 'FAILED', retryable: false, unknown: false };
}
