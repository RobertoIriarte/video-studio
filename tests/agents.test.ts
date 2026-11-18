import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentClaimResponseSchema, agentDtoSchema, agentTokenSchema, pairingDtoSchema, bytesHash, projectDetailSchema, meResponseSchema } from '@video-studio/contracts';
import { projectInputFixture } from '@video-studio/testkit';
import { authHarness } from './support/d1.js';
import { AgentRepository } from '../apps/api/src/db/agents.js';
import { JobRepository } from '../apps/api/src/db/jobs.js';

let h: Awaited<ReturnType<typeof authHarness>>; let cookie: string; let owner: string; let project: string;
const caps = { ffprobe: true, localImport: true, alignment: false };
function request(method: string, path: string, input?: unknown, headers: Record<string, string> = {}) { return h.fetch(`/api/v1${path}`, { method, headers: { cookie: cookie ?? '', origin: h.origin, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); }
beforeEach(async () => {
  h = await authHarness(); const password = `Fixture-${crypto.randomUUID()}`; expect((await request('POST', '/bootstrap', { name: 'Agente', email: 'agent@example.invalid', password }, { authorization: `Bearer ${h.bootstrapToken}` })).status).toBe(200);
  const login = await request('POST', '/auth/sign-in/email', { email: 'agent@example.invalid', password }); cookie = login.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
  owner = meResponseSchema.parse(await (await request('GET', '/me')).json()).user.id; project = projectDetailSchema.parse(await (await request('POST', '/projects', projectInputFixture())).json()).id;
}, 30000);
afterEach(async () => { await h.dispose(); cookie = ''; });
async function pair(name = 'Equipo de prueba') { const code = pairingDtoSchema.parse(await (await request('POST', '/agents/pairing', { label: name })).json()); const key = crypto.randomUUID(); const input = { code: code.code, name, capabilities: caps }; const response = await request('POST', '/agents/pair', input, { cookie: '', 'idempotency-key': key }); return { code, key, input, ...agentTokenSchema.parse(await response.json()) }; }
const bearer = (token: string) => ({ cookie: '', authorization: `Bearer ${token}` });
describe('F5-02 identidad y leases de agente nativos', { timeout: 30000 }, () => {
  it('vinculación de un uso, replay cifrado/TTL, token hash y DTO sin credenciales', async () => {
    const agent = await pair(); const replay = await request('POST', '/agents/pair', agent.input, { ...bearer(''), 'idempotency-key': agent.key }); expect(agentTokenSchema.parse(await replay.json()).token).toBe(agent.token);
    expect((await request('POST', '/agents/pair', agent.input, bearer(''))).status).toBe(409);
    const row = await h.db.prepare('SELECT token_hash FROM local_agents WHERE id=?').bind(agent.agentId).first<{ token_hash: string }>(); expect(row?.token_hash).toBe(await bytesHash(new TextEncoder().encode(agent.token)));
    expect(JSON.stringify(await (await request('GET', '/agents')).json())).not.toContain(agent.token);
    let now = Date.now(); const repo = new AgentRepository(h.db, h.secret, { now: () => now, uuid: () => crypto.randomUUID() }); now += 300001; await repo.list(owner); expect((await h.db.prepare('SELECT result_enc FROM agent_pairings WHERE id=?').bind(agent.code.id).first<{ result_enc: string | null }>())?.result_enc).toBeNull(); await expect(repo.pair(agent.key, agent.input)).rejects.toThrow('JOB_NOT_FOUND');
  });
  it('dos agentes, claim idempotente atómico, tokens viejos y revocación', async () => {
    const a = await pair('A'); const b = await pair('B'); const jobs = new JobRepository(h.db); const job = await jobs.create(owner, project, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'LOCAL' });
    const firstKey = crypto.randomUUID(); const claim = (token: string, key: string) => request('POST', '/agents/jobs/claim', { availableSlots: 1 }, { ...bearer(token), 'idempotency-key': key });
    const responses = await Promise.all([claim(a.token, firstKey), claim(b.token, crypto.randomUUID())]); const leases = await Promise.all(responses.map(async (r) => { expect(r.status).toBe(200); return agentClaimResponseSchema.parse(await r.json()); })); expect(leases.filter((r) => r.lease)).toHaveLength(1);
    const winner = leases[0]!.lease ? a : b; const lease = (leases.find((r) => r.lease)!).lease!; expect(lease.job.id).toBe(job.id); if (winner === a) expect(agentClaimResponseSchema.parse(await (await claim(a.token, firstKey)).json())).toEqual(leases[0]);
    const heartbeat = await request('POST', `/agents/jobs/${job.id}/heartbeat`, { leaseToken: lease.leaseToken, progress: { message: 'Validando.' } }, bearer(winner.token)); expect(heartbeat.status).toBe(200);
    const status = agentDtoSchema.parse(await (await request('POST', '/agents/heartbeat', { capabilities: caps, diskFreeBytes: 1000000000, activeJobIds: [job.id], probeVersion: 'Fixture' }, bearer(winner.token))).json());
    expect((await request('POST', `/agents/${winner.agentId}/revoke`, { expectedRevision: status.revision })).status).toBe(200);
    expect((await request('POST', `/agents/jobs/${job.id}/complete`, { leaseToken: lease.leaseToken, output: null }, bearer(winner.token))).status).toBe(401);
    expect((await h.db.prepare('SELECT lease_until FROM jobs WHERE id=?').bind(job.id).first<{ lease_until: string }>())!.lease_until <= new Date().toISOString()).toBe(true);
    expect((await request('GET', '/projects', undefined, bearer(b.token))).status).toBe(401);
  });
  it('complete se recupera sin duplicar, agente ajeno no usa lease de otro', async () => {
    const a = await pair('A'); const b = await pair('B'); const jobs = new JobRepository(h.db); const job = await jobs.create(owner, project, crypto.randomUUID(), { kind: 'VALIDATE_INPUT', executionTarget: 'LOCAL' });
    const lease = agentClaimResponseSchema.parse(await (await request('POST', '/agents/jobs/claim', { availableSlots: 1 }, bearer(a.token))).json()).lease!;
    expect((await request('POST', `/agents/jobs/${job.id}/heartbeat`, { leaseToken: lease.leaseToken, progress: { message: 'Ajeno.' } }, bearer(b.token))).status).toBe(404);
    const key = crypto.randomUUID(); const complete = () => request('POST', `/agents/jobs/${job.id}/complete`, { leaseToken: lease.leaseToken, output: null }, { ...bearer(a.token), 'idempotency-key': key }); const first = await complete(); expect(first.status).toBe(200); expect(await (await complete()).json()).toEqual(await first.json()); expect(await jobs.attempts(owner, job.id)).toHaveLength(1);
    expect((await request('POST', '/agents/assets/register', { projectId: crypto.randomUUID(), assetId: crypto.randomUUID(), asset: { type: 'IMAGE', mime: 'image/png', bytes: 16, checksum: 'a'.repeat(64), durationMs: null, width: 2, height: 2, origin: 'MANUAL', license: { source: 'Fixture', rightsAcknowledged: true }, prompt: null } }, bearer(a.token))).status).toBe(404);
    expect((await request('GET', '/providers/integrations', undefined, bearer(a.token))).status).toBe(401);
    const reviews = await request('GET', '/providers/integrations'); expect(reviews.status).toBe(200); expect(JSON.stringify(await reviews.json())).toContain('MANUAL_ONLY');
  });
});
