import { z } from 'zod';
import { agentCapabilitiesSchema, agentDtoSchema, agentPairSchema, agentTokenSchema, pairingCreateSchema, pairingDtoSchema, agentHeartbeatSchema, bytesHash, uuidSchema } from '@video-studio/contracts';
import type { AgentIdentity } from '@video-studio/contracts';
import type { Database } from './connection.js';
import { catalogHash } from './catalog.js';
import { batchChanges, JobConflict, JobNotFound, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (p) => parseInt(p, 16));
const secretCode = () => hex(crypto.getRandomValues(new Uint8Array(32)));
async function key(secret: string) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(`agent-pair-receipt-v1:${secret}`)), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(secret: string, value: unknown, aad: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, await key(secret), encoder.encode(JSON.stringify(value))); return `${hex(iv)}.${hex(new Uint8Array(data))}`; }
async function open(secret: string, value: string, aad: string): Promise<unknown> { const [iv, data] = value.split('.'); if (!iv || !data) throw new JobConflict(); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: encoder.encode(aad) }, await key(secret), unhex(data)))) as unknown; }
type AgentRow = { id: string; owner_id: string; name: string; capabilities_json: string; disk_free_bytes: number; last_seen_at: string | null; revoked_at: string | null; revision: number; probe_version: string | null };
type PairRow = { id: string; owner_id: string; request_hash: string; code_enc: string; expires_at: string; used_by: string | null; pair_operation_id: string | null; pair_hash: string | null; result_enc: string | null };
export class AgentRepository {
  constructor(readonly db: Database, readonly secret: string, readonly runtime: JobRuntime = defaultJobRuntime) {}
  now() { return new Date(this.runtime.now()).toISOString(); }
  async expireReceipts(owner: string) { await this.db.prepare("UPDATE agent_pairings SET code_enc='',result_enc=NULL WHERE owner_id=? AND expires_at<=? AND code_enc<>''").bind(owner, this.now()).run(); }
  dto(row: AgentRow) { return agentDtoSchema.parse({ id: row.id, name: row.name, capabilities: agentCapabilitiesSchema.parse(JSON.parse(row.capabilities_json) as unknown), diskFreeBytes: row.disk_free_bytes, lastSeenAt: row.last_seen_at, status: row.revoked_at ? 'REVOKED' : row.last_seen_at && this.runtime.now() - Date.parse(row.last_seen_at) < 45000 ? 'ONLINE' : 'OFFLINE', revision: row.revision, probeVersion: row.probe_version }); }
  async get(owner: string, id: string) { const row = await this.db.prepare('SELECT * FROM local_agents WHERE id=? AND owner_id=?').bind(uuidSchema.parse(id), uuidSchema.parse(owner)).first<AgentRow>(); if (!row) throw new JobNotFound(); return row; }
  async list(owner: string) { uuidSchema.parse(owner); await this.expireReceipts(owner); const rows = await this.db.prepare('SELECT * FROM local_agents WHERE owner_id=? ORDER BY created_at,id LIMIT 25').bind(owner).all<AgentRow>(); return rows.results.map((r) => this.dto(r)); }
  async pairing(owner: string, operation: string, raw: unknown) {
    const input = pairingCreateSchema.parse(raw); const hash = await catalogHash(input); const existing = await this.db.prepare('SELECT * FROM agent_pairings WHERE owner_id=? AND operation_id=?').bind(uuidSchema.parse(owner), uuidSchema.parse(operation)).first<PairRow>();
    if (existing) { if (existing.request_hash !== hash || existing.expires_at <= this.now()) throw new JobConflict(); return pairingDtoSchema.parse(await open(this.secret, existing.code_enc, existing.id)); }
    const id = this.runtime.uuid(); const code = secretCode(); const expiresAt = new Date(this.runtime.now() + 300000).toISOString(); const result = { id, code, expiresAt };
    const encrypted = await seal(this.secret, result, id);
    try { await this.db.prepare('INSERT INTO agent_pairings (id,owner_id,operation_id,request_hash,code_hash,code_enc,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, owner, operation, hash, await bytesHash(encoder.encode(code)), encrypted, expiresAt, this.now()).run(); }
    catch (error) { const replay = await this.db.prepare('SELECT * FROM agent_pairings WHERE owner_id=? AND operation_id=?').bind(owner, operation).first<PairRow>(); if (!replay) throw error; if (replay.request_hash !== hash) throw new JobConflict(); return pairingDtoSchema.parse(await open(this.secret, replay.code_enc, replay.id)); }
    return result;
  }
  async pair(operation: string, raw: unknown) {
    uuidSchema.parse(operation); const input = agentPairSchema.parse(raw); const hash = await catalogHash(input);
    const row = await this.db.prepare('SELECT * FROM agent_pairings WHERE code_hash=?').bind(await bytesHash(encoder.encode(input.code))).first<PairRow>();
    if (!row || row.expires_at <= this.now()) throw new JobNotFound();
    if (row.used_by) { if (row.pair_operation_id !== operation || row.pair_hash !== hash || !row.result_enc) throw new JobConflict(); const agent = await this.get(row.owner_id, row.used_by); if (agent.revoked_at) throw new JobConflict(); return agentTokenSchema.parse(await open(this.secret, row.result_enc, row.id)); }
    const id = this.runtime.uuid(); const token = secretCode(); const response = { agentId: id, token }; const encrypted = await seal(this.secret, response, row.id);
    try {
      const result = await this.db.batch([
        this.db.prepare(`INSERT INTO local_agents (id,owner_id,name,token_hash,capabilities_json,created_at) SELECT ?,owner_id,?,?,?,? FROM agent_pairings WHERE id=? AND used_by IS NULL AND expires_at>?`).bind(id, input.name, await bytesHash(encoder.encode(token)), JSON.stringify(input.capabilities), this.now(), row.id, this.now()),
        this.db.prepare('UPDATE agent_pairings SET used_by=?,pair_operation_id=?,pair_hash=?,result_enc=? WHERE id=? AND used_by IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM local_agents WHERE id=?)').bind(id, operation, hash, encrypted, row.id, this.now(), id),
      ]); if (batchChanges(result) !== 1) throw new JobConflict();
    } catch (error) { const replay = await this.db.prepare('SELECT * FROM agent_pairings WHERE id=?').bind(row.id).first<PairRow>(); if (replay?.pair_operation_id === operation && replay.pair_hash === hash && replay.result_enc) return agentTokenSchema.parse(await open(this.secret, replay.result_enc, row.id)); throw error; }
    return response;
  }
  async authenticate(token: string): Promise<AgentIdentity | null> {
    if (!/^[a-f0-9]{64}$/.test(token)) return null; const row = await this.db.prepare('SELECT id,owner_id FROM local_agents WHERE token_hash=? AND revoked_at IS NULL').bind(await bytesHash(encoder.encode(token))).first<{ id: string; owner_id: string }>(); return row ? { id: row.id, ownerId: row.owner_id } : null;
  }
  async command(agent: string, operation: string, action: string, input: unknown) {
    const hash = await catalogHash({ action, input }); uuidSchema.parse(operation);
    await this.db.prepare('INSERT OR IGNORE INTO agent_commands VALUES (?,?,?,NULL)').bind(agent, operation, hash).run();
    const row = await this.db.prepare('SELECT request_hash,response_json FROM agent_commands WHERE agent_id=? AND operation_id=?').bind(agent, operation).first<{ request_hash: string; response_json: string | null }>();
    if (row?.request_hash !== hash) throw new JobConflict(); return { hash, response: row.response_json === null ? null : JSON.parse(row.response_json) as unknown };
  }
  async heartbeat(agent: AgentIdentity, operation: string, raw: unknown) {
    await this.expireReceipts(agent.ownerId);
    const input = agentHeartbeatSchema.parse(raw); const previous = await this.command(agent.id, operation, 'HEARTBEAT', input); if (previous.response) return agentDtoSchema.parse(previous.response);
    const row = await this.get(agent.ownerId, agent.id); if (row.revoked_at) throw new JobConflict();
    for (const id of input.activeJobIds) if (!await this.db.prepare("SELECT id FROM jobs WHERE id=? AND agent_id=? AND status='RUNNING'").bind(id, agent.id).first()) throw new JobConflict();
    const now = this.now(); const token = this.runtime.uuid(); const response = agentDtoSchema.parse({ id: row.id, name: row.name, capabilities: input.capabilities, diskFreeBytes: input.diskFreeBytes, lastSeenAt: now, status: 'ONLINE', revision: row.revision + 1, probeVersion: input.probeVersion });
    const result = await this.db.batch([
      this.db.prepare('UPDATE local_agents SET capabilities_json=?,disk_free_bytes=?,last_seen_at=?,probe_version=?,revision=revision+1,mutation_token=? WHERE id=? AND revoked_at IS NULL AND revision=?').bind(JSON.stringify(input.capabilities), input.diskFreeBytes, now, input.probeVersion, token, agent.id, row.revision),
      this.db.prepare('UPDATE agent_commands SET response_json=? WHERE agent_id=? AND operation_id=? AND response_json IS NULL AND EXISTS(SELECT 1 FROM local_agents WHERE id=? AND mutation_token=?)').bind(JSON.stringify(response), agent.id, operation, agent.id, token),
    ]); if (batchChanges(result) !== 1) { const replay = await this.command(agent.id, operation, 'HEARTBEAT', input); if (replay.response) return agentDtoSchema.parse(replay.response); throw new JobConflict(); } return response;
  }
  async revoke(owner: string, id: string, operation: string, expectedRevision: number) {
    const row = await this.get(owner, id); const previous = await this.command(id, operation, 'REVOKE', { expectedRevision }); if (previous.response) return agentDtoSchema.parse(previous.response);
    z.int().positive().parse(expectedRevision); const now = this.now(); const token = this.runtime.uuid(); const response = this.dto({ ...row, revoked_at: now, revision: expectedRevision + 1 });
    const result = await this.db.batch([
      this.db.prepare('UPDATE local_agents SET revoked_at=?,revision=revision+1,mutation_token=? WHERE id=? AND owner_id=? AND revision=? AND revoked_at IS NULL').bind(now, token, id, owner, expectedRevision),
      this.db.prepare("UPDATE jobs SET lease_until=? WHERE agent_id=? AND status='RUNNING' AND EXISTS(SELECT 1 FROM local_agents WHERE id=? AND mutation_token=?)").bind(now, id, id, token),
      this.db.prepare('UPDATE agent_commands SET response_json=? WHERE agent_id=? AND operation_id=? AND response_json IS NULL AND EXISTS(SELECT 1 FROM local_agents WHERE id=? AND mutation_token=?)').bind(JSON.stringify(response), id, operation, id, token),
    ]); if (batchChanges(result) !== 1) { const replay = await this.command(id, operation, 'REVOKE', { expectedRevision }); if (replay.response) return agentDtoSchema.parse(replay.response); throw new JobConflict(); } return response;
  }
}
