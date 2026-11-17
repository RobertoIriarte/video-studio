import { z } from 'zod';
import { assetInputSchema, assetSchema, researchInputSchema, researchVersionSchema, scriptInputSchema, scriptVersionSchema, sceneInputSchema, sceneSchema, sceneVersionInputSchema, sceneVersionSchema, uuidSchema, revisionSchema, paginationQuerySchema } from '@video-studio/contracts';
import type { Database, Statement } from './connection.js';
import { RepositoryDataError } from './repositories.js';

export class CatalogNotFound extends Error { constructor() { super('CATALOG_NOT_FOUND'); } }
export class CatalogConflict extends Error { constructor() { super('CATALOG_CONFLICT'); } }
const json = (raw: unknown) => JSON.parse(z.string().parse(raw)) as unknown;
function decode<T>(read: () => T): T { try { return read(); } catch { throw new RepositoryDataError(); } }
export async function catalogHash(value: unknown): Promise<string> {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, child]) => [k, stable(child)])) : v;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(value))))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
type Row = Record<string, unknown>;
const version = (row: Row) => ({ id: row.id, projectId: row.project_id, versionNo: row.version_no, status: row.status, contentHash: row.content_hash ?? row.hash, createdAt: row.created_at });
type Scope = { id: string; revision: number; active_script_version_id: string | null };

export class CatalogRepository {
  constructor(private readonly db: Database) {}
  private async scope(owner: string, project: string): Promise<Scope> {
    const row = await this.db.prepare('SELECT id,revision,active_script_version_id FROM projects WHERE id=? AND owner_id=? AND archived_at IS NULL')
      .bind(uuidSchema.parse(project), uuidSchema.parse(owner)).first<Scope>();
    if (!row) throw new CatalogNotFound();
    return row;
  }
  private async ownedRow(table: 'research_versions' | 'script_versions' | 'scenes' | 'scene_versions' | 'assets', owner: string, project: string, id: string) {
    return this.db.prepare(`SELECT c.* FROM ${table} c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.project_id=? AND p.owner_id=? AND p.archived_at IS NULL`)
      .bind(uuidSchema.parse(id), uuidSchema.parse(project), uuidSchema.parse(owner)).first<Row>();
  }
  async getResearch(owner: string, project: string, id: string) {
    const row = await this.ownedRow('research_versions', owner, project, id); if (!row) return null;
    const sources = await this.db.prepare('SELECT * FROM sources WHERE research_version_id=? ORDER BY id').bind(id).all<Row>();
    return decode(() => researchVersionSchema.parse({ ...version(row), data: json(row.data_json), sources: sources.results.map((s) => ({ id: s.id, url: s.url, title: s.title, acquiredAt: s.acquired_at, notes: s.notes, provenance: s.provenance, accessStatus: s.access_status })) }));
  }
  async getScript(owner: string, project: string, id: string) {
    const row = await this.ownedRow('script_versions', owner, project, id); if (!row) return null;
    return decode(() => scriptVersionSchema.parse({ ...version(row), researchVersionId: row.research_version_id, data: json(row.script_json), targetDurationMs: row.target_duration_ms }));
  }
  async getScene(owner: string, project: string, id: string) {
    const row = await this.ownedRow('scenes', owner, project, id); if (!row || row.archived_at !== null) return null;
    return decode(() => sceneSchema.parse({ id: row.id, projectId: row.project_id, stableKey: row.stable_key, orderIndex: row.order_index, activeVersionId: row.active_version_id, revision: row.revision }));
  }
  async getAsset(owner: string, project: string, id: string) {
    const row = await this.ownedRow('assets', owner, project, id); if (!row) return null;
    return decode(() => assetSchema.parse({ id: row.id, projectId: row.project_id, type: row.type, mime: row.mime, bytes: row.bytes, checksum: row.checksum, durationMs: row.duration_ms, width: row.width, height: row.height, origin: row.origin, license: json(row.license_json), prompt: row.prompt, availability: row.availability, createdAt: row.created_at }));
  }
  async getSceneVersion(owner: string, project: string, id: string) {
    const row = await this.ownedRow('scene_versions', owner, project, id); if (!row) return null;
    const [shots, links] = await Promise.all([
      this.db.prepare('SELECT * FROM shots WHERE scene_version_id=? ORDER BY order_index,id').bind(id).all<Row>(),
      this.db.prepare('SELECT * FROM asset_links WHERE scene_version_id=? ORDER BY id').bind(id).all<Row>(),
    ]);
    return decode(() => sceneVersionSchema.parse({ ...version(row), sceneId: row.scene_id, scriptVersionId: row.script_version_id, parentVersionId: row.parent_version_id,
      narration: row.narration, direction: json(row.direction_json), durationMs: row.duration_ms, generationScope: row.generation_scope,
      shots: shots.results.map((s) => ({ id: s.id, orderIndex: s.order_index, durationMs: s.duration_ms, type: s.type, prompt: s.prompt, camera: json(s.camera_json), transition: json(s.transition_json), assetId: s.asset_id })),
      assetLinks: links.results.map((l) => ({ id: l.id, assetId: l.asset_id, role: l.role, offsetMs: l.offset_ms, trimStartMs: l.trim_start_ms, trimEndMs: l.trim_end_ms })),
    }));
  }
  // Páginas de IDs por padre, sin cargar JSON grande. El llamador puede resolver detalles necesarios.
  async list(owner: string, project: string, kind: 'research' | 'script' | 'scene' | 'asset', options: { limit?: number; afterId?: string } = {}) {
    await this.scope(owner, project);
    const { limit } = paginationQuerySchema.parse({ limit: options.limit });
    const after = options.afterId ? uuidSchema.parse(options.afterId) : '';
    const tables = { research: 'research_versions', script: 'script_versions', scene: 'scenes', asset: 'assets' } as const;
    const rows = await this.db.prepare(`SELECT id FROM ${tables[kind]} WHERE project_id=? AND id>? ${kind === 'scene' ? 'AND archived_at IS NULL' : ''} ORDER BY id LIMIT ?`).bind(project, after, limit + 1).all<{ id: string }>();
    const items = rows.results.slice(0, limit).map((r) => uuidSchema.parse(r.id));
    return { items, nextId: rows.results.length > limit ? items.at(-1)! : null };
  }
  async createResearch(owner: string, project: string, raw: unknown) {
    await this.scope(owner, project); const input = researchInputSchema.parse(raw); const id = crypto.randomUUID(); const now = new Date().toISOString();
    input.sources = input.sources.map((source) => ({ ...source, acquiredAt: new Date(source.acquiredAt).toISOString() }));
    const statements = [this.db.prepare(`INSERT INTO research_versions (id,project_id,version_no,data_json,content_hash,status,created_at)
      SELECT ?,?,COALESCE(MAX(version_no),0)+1,?,?,'DRAFT',? FROM research_versions WHERE project_id=?`)
      .bind(id, project, JSON.stringify(input.data), await catalogHash(input), now, project)];
    for (const source of input.sources) statements.push(this.db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), id, source.url, source.title, source.acquiredAt, source.notes, source.provenance, source.accessStatus));
    statements.push(this.db.prepare("UPDATE research_versions SET status='CANDIDATE' WHERE id=?").bind(id));
    await this.db.batch(statements); return (await this.getResearch(owner, project, id))!;
  }
  async createScript(owner: string, project: string, raw: unknown) {
    await this.scope(owner, project); const input = scriptInputSchema.parse(raw);
    if (input.researchVersionId) { const research = await this.getResearch(owner, project, input.researchVersionId); if (!research) throw new CatalogNotFound(); if (['INVALIDATED', 'SUPERSEDED'].includes(research.status)) throw new CatalogConflict(); }
    const id = crypto.randomUUID();
    await this.db.prepare(`INSERT INTO script_versions (id,project_id,research_version_id,version_no,script_json,content_hash,target_duration_ms,status,created_at)
      SELECT ?,?,?,COALESCE(MAX(version_no),0)+1,?,?,?,'CANDIDATE',? FROM script_versions WHERE project_id=?`)
      .bind(id, project, input.researchVersionId, JSON.stringify(input.data), await catalogHash(input), input.targetDurationMs, new Date().toISOString(), project).run();
    return (await this.getScript(owner, project, id))!;
  }
  async createScene(owner: string, project: string, raw: unknown) {
    await this.scope(owner, project); const input = sceneInputSchema.parse(raw); const id = crypto.randomUUID();
    await this.db.prepare('INSERT INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,?,?,1)').bind(id, project, input.stableKey, input.orderIndex).run();
    return (await this.getScene(owner, project, id))!;
  }
  async createAsset(owner: string, project: string, raw: unknown) {
    await this.scope(owner, project); const input = assetInputSchema.parse(raw); const id = crypto.randomUUID();
    await this.db.prepare(`INSERT INTO assets (id,project_id,owner_id,type,mime,bytes,checksum,duration_ms,width,height,origin,license_json,prompt,availability,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'MISSING',?)`).bind(id, project, owner, input.type, input.mime, input.bytes, input.checksum, input.durationMs, input.width, input.height, input.origin, JSON.stringify(input.license), input.prompt, new Date().toISOString()).run();
    return (await this.getAsset(owner, project, id))!;
  }
  async createSceneVersion(owner: string, project: string, scene: string, raw: unknown) {
    await this.scope(owner, project); if (!await this.getScene(owner, project, scene)) throw new CatalogNotFound();
    const input = sceneVersionInputSchema.parse(raw); const script = await this.getScript(owner, project, input.scriptVersionId);
    if (!script) throw new CatalogNotFound(); if (['INVALIDATED', 'SUPERSEDED'].includes(script.status)) throw new CatalogConflict();
    if (input.parentVersionId) { const parent = await this.getSceneVersion(owner, project, input.parentVersionId); if (!parent || parent.sceneId !== scene) throw new CatalogNotFound(); }
    const ids = [...new Set([...input.shots.flatMap((s) => s.assetId ? [s.assetId] : []), ...input.assetLinks.map((l) => l.assetId)])];
    const assets = ids.length ? (await this.db.prepare(`SELECT id,type,duration_ms FROM assets WHERE project_id=? AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(project, ...ids).all<{ id: string; type: string; duration_ms: number | null }>()).results : [];
    if (assets.length !== ids.length) throw new CatalogNotFound();
    for (const shot of input.shots) {
      const asset = assets.find((a) => a.id === shot.assetId);
      if (asset && asset.type !== (shot.type === 'VIDEO' ? 'VIDEO' : 'IMAGE')) throw new CatalogConflict();
    }
    for (const link of input.assetLinks) {
      const asset = assets.find((a) => a.id === link.assetId)!;
      if ((link.role === 'VISUAL' ? asset.type === 'AUDIO' : asset.type !== 'AUDIO') || link.offsetMs >= input.durationMs || (asset.duration_ms !== null && (link.trimStartMs >= asset.duration_ms || (link.trimEndMs !== null && link.trimEndMs > asset.duration_ms)))) throw new CatalogConflict();
    }
    const id = crypto.randomUUID();
    const statements = [this.db.prepare(`INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,parent_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at)
      SELECT ?,?,?,?,?,COALESCE(MAX(version_no),0)+1,?,?,?,?,'DRAFT',?,? FROM scene_versions WHERE scene_id=?`)
      .bind(id, project, scene, input.scriptVersionId, input.parentVersionId, input.narration, JSON.stringify(input.direction), input.durationMs, input.generationScope, await catalogHash(input), new Date().toISOString(), scene)];
    for (const shot of input.shots) statements.push(this.db.prepare('INSERT INTO shots VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), project, id, shot.orderIndex, shot.durationMs, shot.type, shot.prompt, JSON.stringify(shot.camera), JSON.stringify(shot.transition), shot.assetId));
    for (const link of input.assetLinks) statements.push(this.db.prepare('INSERT INTO asset_links VALUES (?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), project, id, link.assetId, link.role, link.offsetMs, link.trimStartMs, link.trimEndMs));
    statements.push(this.db.prepare("UPDATE scene_versions SET status='CANDIDATE' WHERE id=?").bind(id));
    await this.db.batch(statements); return (await this.getSceneVersion(owner, project, id))!;
  }
  private async changed(statements: Statement[]) {
    const results = z.array(z.object({ meta: z.object({ changes: z.number() }) })).parse(await this.db.batch(statements));
    if (results[0]?.meta.changes !== 1) throw new CatalogConflict();
  }
  async approveResearch(owner: string, project: string, id: string) {
    await this.scope(owner, project); if (!await this.getResearch(owner, project, id)) throw new CatalogNotFound();
    await this.changed([this.db.prepare("UPDATE research_versions SET status='APPROVED' WHERE id=? AND project_id=? AND status='CANDIDATE' AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND archived_at IS NULL)").bind(id, project, project, owner)]);
    return (await this.getResearch(owner, project, id))!;
  }
  async activateScript(owner: string, project: string, id: string, expectedRevision: number) {
    const scope = await this.scope(owner, project); revisionSchema.parse(expectedRevision);
    const candidate = await this.getScript(owner, project, id); if (!candidate) throw new CatalogNotFound();
    if (scope.revision !== expectedRevision || candidate.status !== 'CANDIDATE') throw new CatalogConflict();
    // F4 implementará invalidación de derivados. Antes de eso no cambiar un guion con escenas activas.
    const token = crypto.randomUUID();
    const statements = [this.db.prepare(`UPDATE projects SET revision=revision+1,mutation_token=? WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM scenes WHERE project_id=? AND active_version_id IS NOT NULL)
      AND EXISTS(SELECT 1 FROM script_versions v WHERE id=? AND project_id=? AND status='CANDIDATE'
        AND (research_version_id IS NULL OR EXISTS(SELECT 1 FROM research_versions r WHERE r.id=v.research_version_id AND r.project_id=v.project_id AND r.status IN ('CANDIDATE','APPROVED'))))`).bind(token, project, owner, expectedRevision, project, id, project)];
    const gate = 'EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND mutation_token=? AND revision=?)';
    statements.push(this.db.prepare(`UPDATE script_versions SET status='APPROVED' WHERE id=? AND project_id=? AND ${gate}`).bind(id, project, project, owner, token, expectedRevision + 1));
    statements.push(this.db.prepare(`UPDATE script_versions SET status='SUPERSEDED' WHERE id=(SELECT active_script_version_id FROM projects WHERE id=?) AND project_id=? AND status='APPROVED' AND ${gate}`).bind(project, project, project, owner, token, expectedRevision + 1));
    statements.push(this.db.prepare(`UPDATE projects SET active_script_version_id=?,updated_at=max(updated_at,?) WHERE id=? AND owner_id=? AND mutation_token=? AND revision=?`).bind(id, new Date().toISOString(), project, owner, token, expectedRevision + 1));
    await this.changed(statements); return { version: (await this.getScript(owner, project, id))!, revision: expectedRevision + 1 };
  }
  async activateSceneVersion(owner: string, project: string, scene: string, id: string, expectedRevision: number) {
    await this.scope(owner, project); revisionSchema.parse(expectedRevision);
    const current = await this.getScene(owner, project, scene); const candidate = await this.getSceneVersion(owner, project, id);
    if (!current || !candidate || candidate.sceneId !== scene) throw new CatalogNotFound();
    if (current.revision !== expectedRevision || candidate.status !== 'CANDIDATE' || candidate.parentVersionId !== current.activeVersionId) throw new CatalogConflict();
    // Candidata ligada al parent activo exacto y al guion activo actual.
    const token = crypto.randomUUID();
    const gate = 'EXISTS(SELECT 1 FROM scenes s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.id=? AND p.owner_id=? AND p.archived_at IS NULL AND s.revision=? AND s.mutation_token=?)';
    const statements = [this.db.prepare(`UPDATE scenes SET revision=revision+1,mutation_token=? WHERE id=? AND project_id=? AND revision=? AND archived_at IS NULL AND active_version_id IS ?
      AND EXISTS(SELECT 1 FROM projects p JOIN script_versions v ON v.id=p.active_script_version_id WHERE p.id=? AND p.owner_id=? AND p.archived_at IS NULL AND p.active_script_version_id=? AND v.status='APPROVED')
      AND EXISTS(SELECT 1 FROM scene_versions WHERE id=? AND scene_id=? AND status='CANDIDATE')`)
      .bind(token, scene, project, expectedRevision, candidate.parentVersionId, project, owner, candidate.scriptVersionId, id, scene)];
    statements.push(this.db.prepare(`UPDATE scene_versions SET status='APPROVED' WHERE id=? AND ${gate}`).bind(id, scene, project, owner, expectedRevision + 1, token));
    statements.push(this.db.prepare(`UPDATE scene_versions SET status='SUPERSEDED' WHERE id=? AND status='APPROVED' AND ${gate}`).bind(current.activeVersionId, scene, project, owner, expectedRevision + 1, token));
    statements.push(this.db.prepare(`UPDATE scenes SET active_version_id=? WHERE id=? AND ${gate}`).bind(id, scene, scene, project, owner, expectedRevision + 1, token));
    await this.changed(statements); return (await this.getScene(owner, project, scene))!;
  }
}
