import { z } from 'zod';
import { activityDtoSchema, attemptDtoSchema, checkpointDtoSchema, jobDtoSchema, jobInputSchema, paginationQuerySchema, uuidSchema } from '@video-studio/contracts';
import type { JobDto } from '@video-studio/contracts';
import { assertDag } from '@video-studio/domain';
import type { Database } from './connection.js';
import { catalogHash } from './catalog.js';
import { RepositoryDataError } from './repositories.js';

export class JobNotFound extends Error { constructor() { super('JOB_NOT_FOUND'); } }
export class JobConflict extends Error { constructor() { super('JOB_CONFLICT'); } }
export type JobRuntime = { now: () => number; uuid: () => string };
export const defaultJobRuntime: JobRuntime = { now: () => Date.now(), uuid: () => crypto.randomUUID() };
export const jobColumns = `j.id,j.project_id,j.scene_id,j.kind,j.execution_target,j.status,j.revision,j.attempt_count,j.max_attempts,
  j.next_run_at,j.progress_json,j.error_json,j.output_ref,j.created_at,j.updated_at,j.selected_provider_id`;
export function jobJsonSql(a='j') { return `json_object('id',${a}.id,'projectId',${a}.project_id,'sceneId',${a}.scene_id,'kind',${a}.kind,'status',${a}.status,'executionTarget',${a}.execution_target,'revision',${a}.revision,'attempt',${a}.attempt_count,'maxAttempts',${a}.max_attempts,'nextRunAt',${a}.next_run_at,'progress',json(${a}.progress_json),'error',json(${a}.error_json),'providerId',${a}.selected_provider_id,'outputRef',json(${a}.output_ref),'createdAt',${a}.created_at,'updatedAt',${a}.updated_at)`; }
export function decodeJob(row: Record<string, unknown>): JobDto {
  try {
    return jobDtoSchema.parse({ id: row.id, projectId: row.project_id, sceneId: row.scene_id, kind: row.kind, executionTarget: row.execution_target,
      status: row.status, revision: row.revision, attempt: row.attempt_count, maxAttempts: row.max_attempts, nextRunAt: row.next_run_at, providerId: row.selected_provider_id,
      progress: JSON.parse(z.string().parse(row.progress_json)) as unknown, error: row.error_json === null ? null : JSON.parse(z.string().parse(row.error_json)) as unknown,
      outputRef: row.output_ref === null ? null : JSON.parse(z.string().parse(row.output_ref)) as unknown, createdAt: row.created_at, updatedAt: row.updated_at });
  } catch { throw new RepositoryDataError(); }
}
export function batchChanges(result: unknown, index = 0): number {
  return z.array(z.object({ meta: z.object({ changes: z.number() }) })).parse(result)[index]?.meta.changes ?? 0;
}
// Alias de SQL fijado por código servidor; todas las referencias exigen mismo proyecto/hash.
export function currentInputsSql(alias = 'jobs'): string {
  const definitions = [
    ['RESEARCH', 'research_versions', 'content_hash'], ['SCRIPT', 'script_versions', 'content_hash'],
    ['SCENE_VERSION', 'scene_versions', 'hash'], ['ASSET', 'assets', 'checksum'],
  ] as const;
  const branches = definitions.map(([kind, table, hash]) => `WHEN '${kind}' THEN NOT EXISTS(SELECT 1 FROM ${table} v ${kind === 'SCENE_VERSION' ? `LEFT JOIN job_version_compatibility c ON c.version_id=v.id AND c.job_id=${alias}.id LEFT JOIN scenes s ON s.id=c.scene_id` : ''} WHERE v.id=json_extract(ref.value,'$.id') AND v.project_id=${alias}.project_id AND v.${hash}=json_extract(ref.value,'$.hash') ${kind === 'ASSET' ? '' : kind === 'SCENE_VERSION' ? "AND (v.status IN('CANDIDATE','APPROVED') OR (v.status='SUPERSEDED' AND c.compatible_with_id=s.active_version_id))" : "AND v.status IN('CANDIDATE','APPROVED')"})`).join(' ');
  return `NOT EXISTS(SELECT 1 FROM json_each(${alias}.input_refs_json) ref WHERE CASE json_extract(ref.value,'$.kind') ${branches} ELSE 1 END) AND (json_extract(${alias}.payload_json,'$.manifestId') IS NULL OR EXISTS(SELECT 1 FROM current_render_manifests ready JOIN projects mp ON mp.id=ready.project_id WHERE ready.id=json_extract(${alias}.payload_json,'$.manifestId') AND ready.project_id=${alias}.project_id AND ready.content_hash=json_extract(${alias}.payload_json,'$.manifestHash') AND mp.active_manifest_id=ready.id AND ready.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM render_manifests snapshot,json_each(snapshot.manifest_json,'$.assets') a LEFT JOIN assets actual ON actual.id=json_extract(a.value,'$.id') AND actual.project_id=snapshot.project_id WHERE snapshot.id=ready.id AND (actual.id IS NULL OR actual.availability='MISSING')) AND (${alias}.kind<>'RENDER' OR EXISTS(SELECT 1 FROM qa_reports rq WHERE rq.manifest_id=ready.id AND rq.kind='PRE_RENDER' AND rq.status='APPROVED' AND rq.version_no=(SELECT max(latest.version_no) FROM qa_reports latest WHERE latest.manifest_id=ready.id AND latest.kind='PRE_RENDER')))))`;
}
export class JobRepository {
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime) {}
  timestamp() { return new Date(this.runtime.now()).toISOString(); }
  async project(owner: string, project: string) {
    const row = await this.db.prepare('SELECT id,status,revision,mode,pause_requested,active_script_version_id FROM projects WHERE id=? AND owner_id=? AND archived_at IS NULL')
      .bind(uuidSchema.parse(project), uuidSchema.parse(owner)).first<{ id: string; status: string; revision: number; mode: string; pause_requested: number; active_script_version_id: string | null }>();
    if (!row) throw new JobNotFound(); return row;
  }
  async get(owner: string, id: string): Promise<JobDto | null> {
    const row = await this.db.prepare(`SELECT ${jobColumns} FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND p.owner_id=? AND p.archived_at IS NULL`)
      .bind(uuidSchema.parse(id), uuidSchema.parse(owner)).first<Record<string, unknown>>();
    return row ? decodeJob(row) : null;
  }
  async receipt(owner: string, project: string, operation: string, hash: string): Promise<unknown | null> {
    await this.project(owner, project);
    const row = await this.db.prepare('SELECT payload_hash,response_json FROM job_commands WHERE project_id=? AND operation_id=?')
      .bind(project, uuidSchema.parse(operation)).first<{ payload_hash: string; response_json: string }>();
    if (!row) return null;
    if (row.payload_hash !== hash) throw new JobConflict();
    return JSON.parse(row.response_json) as unknown;
  }
  async create(owner: string, project: string, operation: string, raw: unknown, context: { startRevision?: number; regeneration?: { expectedRevision: number; baseVersionId: string }; activeSceneVersionId?: string; guard?: {sql:string;values:unknown[]} } = {}): Promise<JobDto> {
    await this.project(owner, project); const input = jobInputSchema.parse(raw); const hash = await catalogHash({ action: 'CREATE_JOB', input, startRevision: context.startRevision, regeneration: context.regeneration, activeSceneVersionId: context.activeSceneVersionId });
    const existing = await this.receipt(owner, project, operation, hash); if (existing) return jobDtoSchema.parse(existing);
    const id = uuidSchema.parse(this.runtime.uuid()); const now = this.timestamp();
    assertDag([{ id, dependencies: input.dependencies }], input.dependencies);
    if (input.sceneId && !await this.db.prepare('SELECT id FROM scenes WHERE id=? AND project_id=? AND archived_at IS NULL').bind(input.sceneId, project).first()) throw new JobNotFound();
    if (input.dependencies.length) {
      const rows = await this.db.prepare(`SELECT id FROM jobs WHERE project_id=? AND id IN(${input.dependencies.map(() => '?').join(',')})`).bind(project, ...input.dependencies).all();
      if (rows.results.length !== input.dependencies.length) throw new JobNotFound();
    }
    for (const ref of input.inputRefs) {
      const tables = { RESEARCH: ['research_versions', 'content_hash'], SCRIPT: ['script_versions', 'content_hash'], SCENE_VERSION: ['scene_versions', 'hash'], ASSET: ['assets', 'checksum'] } as const;
      const [table, column] = tables[ref.kind];
      if (!await this.db.prepare(`SELECT id FROM ${table} WHERE id=? AND project_id=? AND ${column}=?`).bind(ref.id, project, ref.hash).first()) throw new JobNotFound();
    }
    const body = jobDtoSchema.parse({ id, projectId: project, sceneId: input.sceneId, kind: input.kind, executionTarget: input.executionTarget, status: 'PENDING',
      revision: 1, attempt: 0, maxAttempts: input.maxAttempts, nextRunAt: null, progress: { message: 'Pendiente.' }, error: null, outputRef: null, createdAt: now, updatedAt: now });
    const statements = [];
    const guarded = context.startRevision !== undefined || context.regeneration !== undefined;
    if (context.startRevision !== undefined) statements.push(this.db.prepare(`UPDATE projects SET status='RUNNING',revision=revision+1,updated_at=max(updated_at,?),mutation_token=?
      WHERE id=? AND owner_id=? AND revision=? AND status='DRAFT' AND wizard_step=5 AND archived_at IS NULL AND pause_requested=0
      AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=?)`).bind(now, id, project, owner, context.startRevision, project));
    if (context.regeneration) statements.push(this.db.prepare(`UPDATE projects SET revision=revision+1,status='RUNNING',updated_at=max(updated_at,?),mutation_token=? WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL AND pause_requested=0
      AND EXISTS(SELECT 1 FROM scenes s JOIN scene_versions v ON v.id=s.active_version_id WHERE s.id=? AND s.project_id=projects.id AND s.active_version_id=? AND v.status='APPROVED' AND v.script_version_id=projects.active_script_version_id) ${context.guard ? `AND ${context.guard.sql}` : ''}`).bind(now, id, project, owner, context.regeneration.expectedRevision, input.sceneId, context.regeneration.baseVersionId,...(context.guard?.values ?? [])));
    statements.push(this.db.prepare(`INSERT INTO jobs (id,project_id,scene_id,kind,execution_target,status,payload_json,input_refs_json,idempotency_key,input_hash,
      attempt_count,max_attempts,progress_json,revision,created_at,updated_at) SELECT ?,?,?,?,?,'PENDING',?,?,?, ?,0,?,?,1,?,?
      ${guarded ? 'WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND mutation_token=?)' : context.activeSceneVersionId ? "WHERE EXISTS(SELECT 1 FROM scenes s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND s.project_id=? AND s.active_version_id=? AND p.owner_id=? AND p.archived_at IS NULL)" : ''}`)
      .bind(id, project, input.sceneId, input.kind, input.executionTarget, JSON.stringify(input.payload), JSON.stringify(input.inputRefs), operation, hash, input.maxAttempts, JSON.stringify(body.progress), now, now,
        ...(guarded ? [project, owner, id] : context.activeSceneVersionId ? [input.sceneId, project, context.activeSceneVersionId, owner] : [])));
    for (const parent of input.dependencies) statements.push(this.db.prepare('INSERT INTO job_dependencies SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)').bind(project, id, parent, id));
    statements.push(this.db.prepare('INSERT INTO job_commands SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)').bind(project, operation, hash, JSON.stringify(body), id));
    statements.push(this.db.prepare("INSERT INTO activity_events SELECT ?,?,?,?,'SYSTEM',NULL,'JOB_CREATED','{}',? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(this.runtime.uuid(), owner, project, id, now, id));
    try { if (batchChanges(await this.db.batch(statements), guarded ? 1 : 0) !== 1) throw new JobConflict(); }
    catch (error) { const replay = await this.receipt(owner, project, operation, hash); if (replay) return jobDtoSchema.parse(replay); throw error; }
    return body;
  }
  async tick(owner: string, project: string, limit = 10): Promise<number> {
    await this.project(owner, project); z.int().min(1).max(20).parse(limit);
    const token = this.runtime.uuid(); const now = this.timestamp();
    return batchChanges(await this.db.batch([
      this.db.prepare(`UPDATE jobs SET status='READY',revision=revision+1,updated_at=?,mutation_token=? WHERE id IN(
        SELECT j.id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.project_id=? AND p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=0
        AND j.status IN('PENDING','RETRY_SCHEDULED') AND (j.next_run_at IS NULL OR j.next_run_at<=?) AND ${currentInputsSql('j')}
        AND NOT EXISTS(SELECT 1 FROM job_dependencies d JOIN jobs parent ON parent.id=d.depends_on_id WHERE d.job_id=j.id AND parent.status<>'SUCCEEDED')
        AND NOT EXISTS(SELECT 1 FROM checkpoints c WHERE c.job_id=j.id AND c.status='PENDING') ORDER BY j.created_at,j.id LIMIT ?)`)
        .bind(now, token, project, owner, now, limit),
      this.db.prepare(`INSERT INTO activity_events SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))), ?,project_id,id,'SYSTEM',NULL,'JOB_READY','{}',? FROM jobs WHERE project_id=? AND mutation_token=?`)
        .bind(owner, now, project, token),
    ]));
  }
  async list(owner: string, options: { projectId?: string | undefined; status?: string | undefined; limit?: number | undefined; before?: { createdAt: string; id: string } | undefined } = {}) {
    uuidSchema.parse(owner); const { limit } = paginationQuerySchema.parse({ limit: options.limit });
    if (options.projectId) await this.project(owner, options.projectId);
    const clauses = ["p.owner_id=? AND p.archived_at IS NULL"]; const values: unknown[] = [owner];
    if (options.projectId) { clauses.push('j.project_id=?'); values.push(options.projectId); }
    if (options.status) { clauses.push('j.status=?'); values.push(options.status); }
    if (options.before) { clauses.push('(j.created_at<? OR (j.created_at=? AND j.id<?))'); values.push(options.before.createdAt, options.before.createdAt, uuidSchema.parse(options.before.id)); }
    const rows = await this.db.prepare(`SELECT ${jobColumns} FROM jobs j JOIN projects p ON p.id=j.project_id WHERE ${clauses.join(' AND ')} ORDER BY j.created_at DESC,j.id DESC LIMIT ?`)
      .bind(...values, limit + 1).all<Record<string, unknown>>();
    const items = rows.results.slice(0, limit).map(decodeJob); const last = items.at(-1);
    return { items, before: rows.results.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
  }
  async attempts(owner: string, id: string) {
    if (!await this.get(owner, id)) throw new JobNotFound();
    const rows = await this.db.prepare('SELECT id,job_id,attempt_no,request_id,status,start_at,end_at,error_code,provider_operation_id,provider_id FROM job_attempts WHERE job_id=? ORDER BY attempt_no LIMIT 100').bind(id).all<Record<string, unknown>>();
    return rows.results.map((r) => attemptDtoSchema.parse({ id: r.id, jobId: r.job_id, attemptNo: r.attempt_no, requestId: r.request_id, status: r.status, startedAt: r.start_at, endedAt: r.end_at, errorCode: r.error_code, providerOperationId: r.provider_operation_id, providerId: r.provider_id }));
  }
  async checkpoints(owner: string, project: string) {
    await this.project(owner, project);
    const rows = await this.db.prepare('SELECT * FROM checkpoints WHERE project_id=? ORDER BY id LIMIT 100').bind(project).all<Record<string, unknown>>();
    return rows.results.map((r) => checkpointDtoSchema.parse({ id: r.id, projectId: r.project_id, jobId: r.job_id, stage: r.stage, subjectVersionId: r.subject_version_id, status: r.status, blocking: r.blocking === 1, revision: r.revision, reviewedAt: r.reviewed_at }));
  }
  async activity(owner: string, project: string) {
    await this.project(owner, project);
    const rows = await this.db.prepare(`SELECT id,project_id,job_id,action,created_at FROM (
      SELECT id,project_id,job_id,action,created_at FROM activity_events WHERE owner_id=? AND project_id=? UNION ALL
      SELECT id,project_id,NULL AS job_id,action,created_at FROM content_changes WHERE owner_id=? AND project_id=?) ORDER BY created_at DESC,id DESC LIMIT 25`).bind(owner, project, owner, project).all<Record<string, unknown>>();
    return rows.results.map((r) => activityDtoSchema.parse({ id: r.id, projectId: r.project_id, jobId: r.job_id, action: r.action, createdAt: r.created_at }));
  }
}
