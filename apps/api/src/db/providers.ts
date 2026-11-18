import { z } from 'zod';
import { providerDtoSchema, providerInputSchema, providerPatchSchema, uuidSchema } from '@video-studio/contracts';
import type { ProviderDto } from '@video-studio/contracts';
import type { Database } from './connection.js';
import { JobConflict, JobNotFound, batchChanges } from './jobs.js';
import { catalogHash } from './catalog.js';
import { RepositoryDataError } from './repositories.js';

export function decodeProvider(row: Record<string, unknown>): ProviderDto {
  try {
    return providerDtoSchema.parse({ id: row.id, name: row.name, kind: row.kind, adapterKey: row.adapter_key, integrationMode: row.integration_mode,
      enabled: row.enabled === 1, priority: row.priority, capabilities: JSON.parse(z.string().parse(row.caps_json)) as unknown,
      limits: JSON.parse(z.string().parse(row.limits_json)) as unknown, pricing: JSON.parse(z.string().parse(row.pricing_json)) as unknown,
      status: row.status, revision: row.revision, updatedAt: row.updated_at });
  } catch { throw new RepositoryDataError(); }
}
export class ProviderRepository {
  constructor(readonly db: Database, readonly allowMocks = false) {}
  async get(owner: string, id: string) {
    const row = await this.db.prepare('SELECT * FROM provider_configs WHERE id=? AND owner_id=?').bind(uuidSchema.parse(id), uuidSchema.parse(owner)).first<Record<string, unknown>>();
    return row ? decodeProvider(row) : null;
  }
  async list(owner: string) {
    const rows = await this.db.prepare('SELECT * FROM provider_configs WHERE owner_id=? ORDER BY priority,id LIMIT 100').bind(uuidSchema.parse(owner)).all<Record<string, unknown>>();
    return rows.results.map(decodeProvider);
  }
  async create(owner: string, operation: string, raw: unknown) {
    uuidSchema.parse(owner); uuidSchema.parse(operation); const input = providerInputSchema.parse(raw);
    if (input.adapterKey === 'MOCK_FIXTURE' && !this.allowMocks) throw new JobConflict();
    const hash = await catalogHash(input);
    const previous = await this.db.prepare('SELECT payload_hash,response_json FROM provider_commands WHERE owner_id=? AND operation_id=?').bind(owner, operation).first<{ payload_hash: string; response_json: string }>();
    if (previous) { if (previous.payload_hash !== hash) throw new JobConflict(); return providerDtoSchema.parse(JSON.parse(previous.response_json) as unknown); }
    const body = providerDtoSchema.parse({ ...input, id: crypto.randomUUID(), status: input.adapterKey === 'MOCK_FIXTURE' ? 'AVAILABLE' : 'MANUAL_ONLY', revision: 1, updatedAt: new Date().toISOString() });
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO provider_configs (id,owner_id,name,kind,adapter_key,integration_mode,enabled,priority,caps_json,limits_json,pricing_json,status,revision,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).bind(body.id, owner, body.name, body.kind, body.adapterKey, body.integrationMode, body.enabled ? 1 : 0, body.priority,
          JSON.stringify(body.capabilities), JSON.stringify(body.limits), JSON.stringify(body.pricing), body.status, body.updatedAt),
        this.db.prepare('INSERT INTO provider_commands VALUES (?,?,?,?)').bind(owner, operation, hash, JSON.stringify(body)),
      ]);
    } catch (error) {
      const replay = await this.db.prepare('SELECT payload_hash,response_json FROM provider_commands WHERE owner_id=? AND operation_id=?').bind(owner, operation).first<{ payload_hash: string; response_json: string }>();
      if (replay) { if (replay.payload_hash !== hash) throw new JobConflict(); return providerDtoSchema.parse(JSON.parse(replay.response_json) as unknown); }
      throw error;
    }
    return body;
  }
  async patch(owner: string, id: string, raw: unknown) {
    const current = await this.get(owner, id); if (!current) throw new JobNotFound(); const input = providerPatchSchema.parse(raw);
    const { expectedRevision, ...changes } = input;
    const body = providerDtoSchema.parse({ ...current, ...changes, revision: current.revision + 1, updatedAt: new Date().toISOString() });
    // expectedRevision es control de escritura, no parte del DTO.
    const result = await this.db.batch([this.db.prepare('UPDATE provider_configs SET enabled=?,priority=?,limits_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?')
      .bind(body.enabled ? 1 : 0, body.priority, JSON.stringify(body.limits), body.updatedAt, id, owner, expectedRevision)]);
    if (batchChanges(result) !== 1) throw new JobConflict(); return body;
  }
  async validatePreferred(owner: string, ids: readonly string[]) {
    uuidSchema.parse(owner); if (!ids.length) return;
    ids.forEach((id) => uuidSchema.parse(id));
    const rows = await this.db.prepare(`SELECT id FROM provider_configs WHERE owner_id=? AND enabled=1 AND id IN(${ids.map(() => '?').join(',')})`).bind(owner, ...ids).all();
    if (rows.results.length !== ids.length) throw new JobNotFound();
  }
}
