import { executeRender } from './render-job.js';
import { renderReady } from './render.js';
import { z } from 'zod';
import { agentClaimResponseSchema, agentDtoSchema, agentTokenSchema, assetSchema, jobDtoSchema, pendingInspectionsSchema } from '@video-studio/contracts';
import type { AgentCapabilities } from '@video-studio/contracts';
import { diskFree, saveDownloaded } from './cache.js';
import { probeFile, probeVersion } from './probe.js';

export class AgentApiError extends Error { constructor(readonly status: number) { super(`AGENT_API_${status}`); } }
export class AgentClient {
  readonly origin: string;
  constructor(origin: string, readonly token: string, readonly transport: typeof fetch = fetch) {
    const url = new URL(origin); if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('INVALID_AGENT_ORIGIN'); this.origin = url.origin;
  }
  async call<T>(path: string, schema: z.ZodType<T>, input?: unknown, key: string = crypto.randomUUID()) {
    if (!/^\/agents(?:\/|$)/.test(path) || path.includes('..')) throw new Error('INVALID_AGENT_ROUTE');
    const response = await this.transport(`${this.origin}/api/v1${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), 'idempotency-key': key }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new AgentApiError(response.status); return schema.parse(await response.json());
  }
  pair(code: string, name: string, capabilities: AgentCapabilities, operation: string) { return this.call('/agents/pair', agentTokenSchema, { code, name, capabilities }, operation); }
  async heartbeat(root: string, binary: string | undefined, activeJobIds: string[] = []) { const version = await probeVersion(binary); return this.call('/agents/heartbeat', agentDtoSchema, { capabilities: { ffprobe: !!version, localImport: true, alignment: false, render: !!version && await renderReady(binary) }, diskFreeBytes: await diskFree(root), activeJobIds, probeVersion: version }); }
  async tick(root: string, claimOperation: string, binary?: string, signal?: AbortSignal) {
    const status = await this.heartbeat(root, binary);
    if (status.capabilities.ffprobe) {
      const pending = await this.call('/agents/imports', pendingInspectionsSchema); const item = pending.items[0];
      if (item) {
        const response = await this.transport(`${this.origin}/api/v1/agents/imports/${item.id}/content`, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok || !response.body) throw new AgentApiError(response.status); const path = await saveDownloaded(root, item.projectId, item.id, response.body, item.bytes, item.checksum);
        try { const metadata = await probeFile(path, item.mime, binary); if (metadata.checksum !== item.checksum || metadata.bytes !== item.bytes) throw new Error('INVALID_MEDIA'); await this.call(`/agents/imports/${item.id}/inspect`, assetSchema, { metadata, probeVersion: status.probeVersion }, item.id); }
        catch (error) { if (error instanceof AgentApiError) throw error; await this.call(`/agents/imports/${item.id}/fail`, z.object({ ok: z.literal(true) }), { code: 'INVALID_MEDIA' }, item.id); }
      }
    }
    const result = await this.call('/agents/jobs/claim', agentClaimResponseSchema, { availableSlots: 1 }, claimOperation); const lease = result.lease; if (!lease) return false;
    try { if (lease.job.kind === 'RENDER') { await executeRender(this,root,lease,binary,signal); return true; } await this.call(`/agents/jobs/${lease.job.id}/heartbeat`, z.object({ pauseRequested: z.boolean() }), { leaseToken: lease.leaseToken, progress: { message: 'Agente local conectado.' } }); await this.call(`/agents/jobs/${lease.job.id}/complete`, jobDtoSchema, { leaseToken: lease.leaseToken, output: null }, lease.attemptId); }
    catch (error) { if (error instanceof AgentApiError && [401, 404, 409].includes(error.status)) return false; throw error; }
    return true;
  }
}
