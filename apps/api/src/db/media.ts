import { z } from 'zod';
import { assetSchema, importDtoSchema, importInputSchema, mediaMetadataSchema, inspectMedia, bytesHash, uuidSchema } from '@video-studio/contracts';
import type { MediaMetadata } from '@video-studio/contracts';
import type { Database } from './connection.js';
import type { MediaBucket } from '../media-storage.js';
import { catalogHash, CatalogRepository } from './catalog.js';
import { JobRepository, JobConflict, JobNotFound, batchChanges, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';

type ImportRow = { id: string; project_id: string; request_json: string; request_hash: string; state: string; inspection_json: string | null; object_key: string; created_at: string; inspection_error: string | null };
const decode = (r: ImportRow) => importDtoSchema.parse({ ...importInputSchema.parse(JSON.parse(r.request_json) as unknown), id: r.id, state: r.state, requiresInspection: r.state !== 'PENDING' && r.inspection_json === null && !r.inspection_error, createdAt: r.created_at, error: r.inspection_error });
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
export class MediaRepository {
  readonly jobs: JobRepository;
  constructor(readonly db: Database, readonly bucket: MediaBucket, readonly runtime: JobRuntime = defaultJobRuntime) { this.jobs = new JobRepository(db, runtime); }
  async intent(owner: string, operation: string, raw: unknown) {
    const input = importInputSchema.parse(raw); await this.jobs.project(owner, input.projectId); uuidSchema.parse(operation);
    const hash = await catalogHash(input); const previous = await this.db.prepare('SELECT * FROM asset_imports WHERE owner_id=? AND operation_id=?').bind(owner, operation).first<ImportRow>();
    if (previous) { if (previous.request_hash !== hash) throw new JobConflict(); return decode({ ...previous, state: 'PENDING', inspection_json: null, inspection_error: null }); }
    const id = this.runtime.uuid(); const now = this.jobs.timestamp(); const key = `users/${owner}/projects/${input.projectId}/assets/${id}/${input.checksum}.${extensions[input.mime]}`;
    try { await this.db.prepare("INSERT INTO asset_imports (id,project_id,owner_id,operation_id,request_hash,request_json,state,object_key,created_at) VALUES (?,?,?,?,?,?,'PENDING',?,?)").bind(id, input.projectId, owner, operation, hash, JSON.stringify(input), key, now).run(); }
    catch (error) { const replay = await this.db.prepare('SELECT * FROM asset_imports WHERE owner_id=? AND operation_id=?').bind(owner, operation).first<ImportRow>(); if (!replay) throw error; if (replay.request_hash !== hash) throw new JobConflict(); return decode({ ...replay, state: 'PENDING', inspection_json: null, inspection_error: null }); }
    return decode((await this.owned(owner, id))!);
  }
  async owned(owner: string, id: string) {
    const row = await this.db.prepare('SELECT i.* FROM asset_imports i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND i.owner_id=? AND p.archived_at IS NULL').bind(uuidSchema.parse(id), uuidSchema.parse(owner)).first<ImportRow>();
    if (!row) throw new JobNotFound(); return row;
  }
  async upload(owner: string, id: string, bytes: Uint8Array) {
    const row = await this.owned(owner, id); const input = importInputSchema.parse(JSON.parse(row.request_json) as unknown);
    if (bytes.length !== input.bytes || await bytesHash(bytes) !== input.checksum) throw new JobConflict();
    let inspected; try { inspected = inspectMedia(bytes, input.mime); } catch { throw new z.ZodError([{ code: 'custom', path: ['file'], message: 'Invalid media' }]); }
    if (row.state === 'VERIFIED') return decode(row);
    await this.bucket.put(row.object_key, bytes, { httpMetadata: { contentType: input.mime } });
    await this.db.prepare("UPDATE asset_imports SET state='UPLOADED',inspection_json=? WHERE id=? AND owner_id=? AND state<>'VERIFIED'").bind(inspected ? JSON.stringify({ ...inspected, checksum: input.checksum }) : null, id, owner).run();
    return decode(await this.owned(owner, id));
  }
  async finalize(owner: string, id: string, operation: string) {
    uuidSchema.parse(operation); const row = await this.owned(owner, id); const input = importInputSchema.parse(JSON.parse(row.request_json) as unknown); const hash = await catalogHash({ action: 'FINALIZE_ASSET', id });
    const previous = await this.jobs.receipt(owner, row.project_id, operation, hash); if (previous) return assetSchema.parse(previous);
    const receipt = this.db.prepare(`INSERT OR IGNORE INTO job_commands SELECT project_id,?,?,json_object('id',id,'projectId',project_id,'type',type,'mime',mime,'bytes',bytes,'checksum',checksum,'durationMs',duration_ms,'width',width,'height',height,'origin',origin,'license',json(license_json),'prompt',prompt,'availability',availability,'createdAt',created_at) FROM assets WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM projects p WHERE p.id=assets.project_id AND p.owner_id=? AND p.archived_at IS NULL)`).bind(operation, hash, id, owner, owner);
    if (row.state === 'VERIFIED') { await receipt.run(); return assetSchema.parse(await this.jobs.receipt(owner, row.project_id, operation, hash)); }
    if (row.state !== 'UPLOADED' || !row.inspection_json) throw new JobConflict();
    const object = await this.bucket.get(row.object_key); if (!object || object.size !== input.bytes || await bytesHash(new Uint8Array(await object.arrayBuffer())) !== input.checksum) throw new JobConflict();
    const info = mediaMetadataSchema.parse(JSON.parse(row.inspection_json) as unknown); const now = this.jobs.timestamp();
    assetSchema.parse({ ...info, id, projectId: row.project_id, origin: 'MANUAL', license: input.license, prompt: input.prompt, availability: 'REMOTE_AVAILABLE', createdAt: now });
    const gate = "EXISTS(SELECT 1 FROM asset_imports i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND i.owner_id=? AND i.state='VERIFIED' AND p.archived_at IS NULL)";
    try { const result = await this.db.batch([
      this.db.prepare("UPDATE asset_imports SET state='VERIFIED' WHERE id=? AND owner_id=? AND state='UPLOADED' AND inspection_json IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=asset_imports.project_id AND p.owner_id=asset_imports.owner_id AND p.archived_at IS NULL)").bind(id, owner),
      this.db.prepare(`INSERT INTO assets (id,project_id,owner_id,type,mime,bytes,checksum,duration_ms,width,height,origin,license_json,prompt,r2_key,availability,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,'MANUAL',?,?,?,'REMOTE_AVAILABLE',? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM assets WHERE id=?)`).bind(id, row.project_id, owner, info.type, info.mime, info.bytes, info.checksum, info.durationMs, info.width, info.height, JSON.stringify(input.license), input.prompt, row.object_key, now, id, owner, id),
      receipt,
    ]); if (batchChanges(result) !== 1) { const replay = await this.jobs.receipt(owner, row.project_id, operation, hash); if (replay) return assetSchema.parse(replay); throw new JobConflict(); } }
    catch (error) { const replay = await this.jobs.receipt(owner, row.project_id, operation, hash); if (replay) return assetSchema.parse(replay); throw error; }
    return assetSchema.parse(await this.jobs.receipt(owner, row.project_id, operation, hash));
  }
  async listImports(owner: string, project?: string, cursor?: string) {
    if (project) await this.jobs.project(owner, project);
    const rows = await this.db.prepare(`SELECT i.* FROM asset_imports i JOIN projects p ON p.id=i.project_id WHERE i.owner_id=? AND p.archived_at IS NULL ${project ? 'AND i.project_id=?' : ''} AND i.id>? ORDER BY i.id LIMIT 26`).bind(owner, ...(project ? [project] : []), cursor ? uuidSchema.parse(cursor) : '').all<ImportRow>();
    return { items: rows.results.slice(0, 25).map(decode), nextCursor: rows.results.length > 25 ? rows.results[24]!.id : null };
  }
  async asset(owner: string, id: string) {
    const row = await this.db.prepare('SELECT a.project_id,a.r2_key FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.owner_id=? AND p.archived_at IS NULL').bind(uuidSchema.parse(id), owner).first<{ project_id: string; r2_key: string | null }>();
    if (!row) throw new JobNotFound(); return { dto: (await new CatalogRepository(this.db).getAsset(owner, row.project_id, id))!, key: row.r2_key };
  }
  async listAssets(owner: string, options: { projectId?: string | undefined; type?: string | undefined; q?: string | undefined; cursor?: string | undefined; limit: number }) {
    if (options.projectId) await this.jobs.project(owner, options.projectId);
    const rows = await this.db.prepare(`SELECT a.id,a.project_id FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.owner_id=? AND p.archived_at IS NULL AND a.id>? ${options.projectId ? 'AND a.project_id=?' : ''} ${options.type ? 'AND a.type=?' : ''} ${options.q ? "AND (instr(lower(a.prompt),lower(?))>0 OR instr(lower(a.license_json),lower(?))>0)" : ''} ORDER BY a.id LIMIT ?`).bind(owner, options.cursor ? uuidSchema.parse(options.cursor) : '', ...(options.projectId ? [options.projectId] : []), ...(options.type ? [options.type] : []), ...(options.q ? [options.q, options.q] : []), options.limit + 1).all<{ id: string; project_id: string }>();
    const catalog = new CatalogRepository(this.db); return { items: await Promise.all(rows.results.slice(0, options.limit).map((r) => catalog.getAsset(owner, r.project_id, r.id))), nextCursor: rows.results.length > options.limit ? rows.results[options.limit - 1]!.id : null };
  }
}
export type { MediaMetadata };
