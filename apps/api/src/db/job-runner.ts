import { z } from 'zod';
import { executionTargetSchema, jobDtoSchema, jobKindSchema, jobErrorCodeSchema, jobInputRefSchema, jobProgressSchema, revisionSchema, uuidSchema } from '@video-studio/contracts';
import type { JobDto, JobErrorCode, JobInputRef } from '@video-studio/contracts';
import { checkpointRequired, failureDisposition, retryDelayMs } from '@video-studio/domain';
import type { Database, Statement } from './connection.js';
import { JobConflict, JobNotFound, JobRepository, batchChanges, currentInputsSql, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import { catalogHash } from './catalog.js';
import { usageTransitionStatement } from './usage.js';
import type { ActualUsage } from './usage.js';

export class LeaseLost extends JobConflict {}
const operationSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:-]+$/);
const projectStateSchema = z.object({ id: uuidSchema, status: z.string(), revision: revisionSchema, mode: z.string(), pause_requested: z.number(), active_script_version_id: uuidSchema.nullable() });
const messages: Record<JobErrorCode, string> = {
  DISK_FULL: 'Espacio insuficiente. Libera disco y solicita reintento.', LOCAL_FILE_MISSING: 'Falta un archivo local o su checksum no coincide. Restablece el recurso antes de reintentar.', RENDER_FAILED: 'Render local interrumpido o no valido; parcial conservado sin publicar.',
  AUTH_REQUIRED: 'Configura el acceso del proveedor.', RATE_LIMIT: 'Límite temporal; reintento programado.', QUOTA_EXHAUSTED: 'Cuota agotada; revisa disponibilidad.',
  INVALID_INPUT: 'Entrada no válida para este trabajo.', UNSUPPORTED_CAPABILITY: 'Capacidad no disponible. Usa la vía manual.', PROVIDER_UNAVAILABLE: 'Proveedor temporalmente no disponible.',
  CONTENT_BLOCKED: 'El proveedor no aceptó el contenido.', UNKNOWN_OUTCOME: 'Resultado externo incierto. Reconciliar antes de reintentar.', LOCAL_UNAVAILABLE: 'Esperando agente o recurso local.',
  BUDGET_EXCEEDED: 'Presupuesto insuficiente; no se autorizó gasto.', TRANSIENT: 'Fallo temporal; reintento programado.', ATTEMPTS_EXHAUSTED: 'Intentos agotados. Revisa el fallo antes de reintentar.',
};
export const safeJobError = (code: JobErrorCode, retryable = false) => ({ code, message: messages[code], retryable });
type Checkpoint = { id: string; stage: 'SCRIPT' | 'DIRECTION'; subject: string; blocking: boolean };
type Completion = { status: 'SUCCEEDED' | 'WAITING_APPROVAL'; checkpoint: Checkpoint | null };
type Transition = { status: string; attemptStatus: string; action: string; error: ReturnType<typeof safeJobError> | null; next: string | null; output: JobInputRef | null; checkpoint?: Checkpoint | null; expired?: boolean; externalMustBeAbsent?: boolean; usage?: ActualUsage | undefined };
export type PublicationGate = { sql: string; values: unknown[] };
export type ContentPublication = { before: (gate: PublicationGate) => Statement[]; after?: (gate: PublicationGate, automatic: boolean) => Statement[]; requireReview?: boolean };

export class JobRunnerRepository {
  readonly jobs: JobRepository;
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime, readonly random: () => number = () => Math.random()) { this.jobs = new JobRepository(db, runtime); }
  async claim(owner: string, project: string, workerId: string, target: 'CLOUD' | 'LOCAL' = 'CLOUD', leaseMs = 90000, contentOnly = false, agentCommand?: { operation: string; hash: string; kinds: string[] }) {
    uuidSchema.parse(workerId); executionTargetSchema.exclude(['MANUAL']).parse(target); z.int().min(1000).max(300000).parse(leaseMs);
    await this.jobs.project(owner, project); await this.jobs.tick(owner, project);
    const now = this.jobs.timestamp(); const until = new Date(this.runtime.now() + leaseMs).toISOString(); const token = this.runtime.uuid(); const attemptId = this.runtime.uuid();
    const kinds = agentCommand ? z.array(jobKindSchema).min(1).max(3).parse(agentCommand.kinds) : [];
    const statements = [
      this.db.prepare(`UPDATE jobs SET status='RUNNING',attempt_count=attempt_count+1,lease_token=?,lease_until=?,agent_id=?,updated_at=?,revision=revision+1,mutation_token=? WHERE id=(
        SELECT j.id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.project_id=? AND p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=0
        AND j.status='READY' AND j.execution_target=? AND j.attempt_count<j.max_attempts AND ${currentInputsSql('j')}
        ${contentOnly ? "AND j.kind IN('RESEARCH','SCRIPT','DIRECTION') AND EXISTS(SELECT 1 FROM provider_configs c WHERE c.id=j.selected_provider_id AND c.adapter_key='MOCK_FIXTURE' AND c.enabled=1 AND c.status='AVAILABLE')" : ''}
        ${agentCommand ? `AND j.kind IN(${kinds.map((k) => `'${k}'`).join(',')}) AND EXISTS(SELECT 1 FROM local_agents a JOIN agent_commands c ON c.agent_id=a.id WHERE a.id=? AND a.owner_id=p.owner_id AND a.revoked_at IS NULL AND c.operation_id=? AND c.request_hash=? AND c.response_json IS NULL) AND NOT EXISTS(SELECT 1 FROM jobs busy WHERE busy.agent_id=? AND busy.status='RUNNING' AND busy.lease_until>?)` : ''}
        AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.project_id=j.project_id AND active.status IN('RUNNING','FAILED'))
        AND NOT EXISTS(SELECT 1 FROM job_dependencies d JOIN jobs parent ON parent.id=d.depends_on_id WHERE d.job_id=j.id AND parent.status<>'SUCCEEDED') ORDER BY j.created_at,j.id LIMIT 1)`)
        .bind(token, until, workerId, now, token, project, owner, target, ...(agentCommand ? [workerId, agentCommand.operation, agentCommand.hash, workerId, now] : [])),
      this.db.prepare(`INSERT INTO job_attempts (id,job_id,attempt_no,request_id,lease_token,start_at,status,provider_id)
        SELECT ?,id,attempt_count,?,?,?,'RUNNING',selected_provider_id FROM jobs WHERE project_id=? AND lease_token=?`)
        .bind(attemptId, agentCommand?.operation ?? this.runtime.uuid(), token, now, project, token),
      this.db.prepare(`INSERT INTO activity_events SELECT ?,?,project_id,id,'SYSTEM',?,'JOB_CLAIMED','{}',? FROM jobs WHERE project_id=? AND lease_token=?`)
        .bind(this.runtime.uuid(), owner, workerId, now, project, token),
    ];
    if (agentCommand) statements.push(this.db.prepare(`UPDATE agent_commands SET response_json=(SELECT json_object('lease',json_object('job',json_object('id',j.id,'projectId',j.project_id,'sceneId',j.scene_id,'kind',j.kind,'status',j.status,'executionTarget',j.execution_target,'revision',j.revision,'attempt',j.attempt_count,'maxAttempts',j.max_attempts,'nextRunAt',j.next_run_at,'progress',json(j.progress_json),'error',json(j.error_json),'providerId',j.selected_provider_id,'outputRef',json(j.output_ref),'createdAt',j.created_at,'updatedAt',j.updated_at),'leaseToken',j.lease_token,'leaseUntil',j.lease_until,'attemptId',?,'payload',json(j.payload_json),'inputRefs',json(j.input_refs_json))) FROM jobs j WHERE j.lease_token=?) WHERE agent_id=? AND operation_id=? AND response_json IS NULL AND EXISTS(SELECT 1 FROM jobs WHERE lease_token=?)`).bind(attemptId, token, workerId, agentCommand.operation, token));
    const result = await this.db.batch(statements);
    if (batchChanges(result) === 0) return null;
    const row = await this.db.prepare('SELECT id,payload_json,input_refs_json FROM jobs WHERE project_id=? AND lease_token=?').bind(project, token).first<{ id: string; payload_json: string; input_refs_json: string }>();
    if (!row) throw new LeaseLost();
    return { job: (await this.jobs.get(owner, row.id))!, leaseToken: token, leaseUntil: until, attemptId,
      payload: JSON.parse(row.payload_json) as unknown, inputRefs: z.array(jobInputRefSchema).parse(JSON.parse(row.input_refs_json) as unknown) };
  }
  async heartbeat(owner: string, id: string, token: string, progress: unknown = { message: 'En ejecución.' }, leaseMs = 90000) {
    uuidSchema.parse(token); uuidSchema.parse(id); uuidSchema.parse(owner); z.int().min(1000).max(300000).parse(leaseMs);
    const now = this.jobs.timestamp();
    const changed = batchChanges(await this.db.batch([this.db.prepare(`UPDATE jobs SET lease_until=?,progress_json=?,updated_at=?,revision=revision+1
      WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>? AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.archived_at IS NULL)`)
      .bind(new Date(this.runtime.now() + leaseMs).toISOString(), JSON.stringify(jobProgressSchema.parse(progress)), now, id, token, now, owner)]));
    if (changed !== 1) throw new LeaseLost();
    const job = (await this.jobs.get(owner, id))!;
    return { pauseRequested: (await this.jobs.project(owner, job.projectId)).pause_requested === 1 };
  }
  async beginExternalEffect(owner: string, id: string, token: string) { await this.external(owner, id, token); }
  async recordExternalOperation(owner: string, id: string, token: string, operation: string) { await this.external(owner, id, token, operationSchema.parse(operation)); }
  private async external(owner: string, id: string, token: string, operation?: string) {
    const changed = batchChanges(await this.db.batch([this.db.prepare(`UPDATE job_attempts SET external_started=1${operation ? ',provider_operation_id=?' : ''}
      WHERE job_id=? AND lease_token=? AND status='RUNNING' AND EXISTS(SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND j.status='RUNNING' AND j.lease_token=? AND j.lease_until>? AND p.owner_id=? AND p.archived_at IS NULL)
      AND EXISTS(SELECT 1 FROM usage_records u JOIN provider_configs c ON c.id=u.provider_id WHERE u.job_id=job_attempts.job_id AND u.status='RESERVED' AND c.enabled=1 AND c.status='AVAILABLE')`)
      .bind(...(operation ? [operation] : []), uuidSchema.parse(id), uuidSchema.parse(token), id, token, this.jobs.timestamp(), uuidSchema.parse(owner))]));
    if (changed !== 1) throw new LeaseLost();
  }
  private async completion(owner: string, job: JobDto, raw: JobInputRef | null, blocking: boolean): Promise<Completion> {
    if (job.kind === 'VALIDATE_INPUT') { if (raw !== null) throw new JobConflict(); return { status: 'SUCCEEDED', checkpoint: null }; }
    if (!raw) throw new JobConflict(); const output = jobInputRefSchema.parse(raw);
    const expected: Record<string, string> = { RESEARCH: 'RESEARCH', SCRIPT: 'SCRIPT', DIRECTION: 'SCENE_VERSION', ASSET: 'ASSET', RENDER: 'ASSET' };
    if (expected[job.kind] !== output.kind) throw new JobConflict();
    const tables = { RESEARCH: ['research_versions', 'content_hash'], SCRIPT: ['script_versions', 'content_hash'], SCENE_VERSION: ['scene_versions', 'hash'], ASSET: ['assets', 'checksum'] } as const;
    const [table, hash] = tables[output.kind];
    const row = await this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=? AND ${hash}=?`).bind(output.id, job.projectId, output.hash).first<Record<string, unknown>>();
    if (!row || (output.kind !== 'ASSET' && !['CANDIDATE', 'APPROVED'].includes(String(row.status)))) throw new JobConflict();
    if (output.kind === 'ASSET' && row.availability === 'MISSING') throw new JobConflict();
    if (job.sceneId && output.kind === 'SCENE_VERSION' && row.scene_id !== job.sceneId) throw new JobConflict();
    const inputsRow = await this.db.prepare('SELECT input_refs_json FROM jobs WHERE id=?').bind(job.id).first<{ input_refs_json: string }>();
    const inputs = z.array(jobInputRefSchema).parse(JSON.parse(inputsRow!.input_refs_json) as unknown);
    const parent = output.kind === 'SCRIPT' ? inputs.find((r) => r.kind === 'RESEARCH') : output.kind === 'SCENE_VERSION' ? inputs.find((r) => r.kind === 'SCRIPT') : undefined;
    if (parent && row[output.kind === 'SCRIPT' ? 'research_version_id' : 'script_version_id'] !== parent.id) throw new JobConflict();
    const project = await this.jobs.project(owner, job.projectId);
    const settings = await this.db.prepare('SELECT checkpoint_policy_json FROM project_settings WHERE project_id=?').bind(job.projectId).first<{ checkpoint_policy_json: string }>();
    const stage = job.kind === 'SCRIPT' ? 'SCRIPT' : job.kind === 'DIRECTION' ? 'DIRECTION' : null;
    if (!stage || !checkpointRequired(project.mode, stage, z.array(z.string()).parse(JSON.parse(settings!.checkpoint_policy_json) as unknown), blocking)) return { status: 'SUCCEEDED', checkpoint: null };
    return { status: 'WAITING_APPROVAL', checkpoint: { id: this.runtime.uuid(), stage, subject: output.id, blocking } };
  }
  private outputGuard(output: JobInputRef | null): { sql: string; values: unknown[] } {
    if (!output) return { sql: '1=1', values: [] };
    const tables = { RESEARCH: ['research_versions', 'content_hash'], SCRIPT: ['script_versions', 'content_hash'], SCENE_VERSION: ['scene_versions', 'hash'], ASSET: ['assets', 'checksum'] } as const;
    const [table, hash] = tables[output.kind];
    return { sql: `EXISTS(SELECT 1 FROM ${table} v WHERE v.id=? AND v.project_id=jobs.project_id AND v.${hash}=? ${output.kind === 'ASSET' ? "AND v.availability<>'MISSING'" : "AND v.status IN('CANDIDATE','APPROVED')"})`, values: [output.id, output.hash] };
  }
  private checkpointStatement(checkpoint: Checkpoint, id: string, token: string): Statement {
    return this.db.prepare(`INSERT INTO checkpoints (id,project_id,job_id,stage,subject_version_id,script_version_id,scene_version_id,blocking,status,revision)
      SELECT ?,project_id,id,?,?,?,?,?,'PENDING',1 FROM jobs WHERE id=? AND mutation_token=? AND status='WAITING_APPROVAL'`)
      .bind(checkpoint.id, checkpoint.stage, checkpoint.subject, checkpoint.stage === 'SCRIPT' ? checkpoint.subject : null, checkpoint.stage === 'DIRECTION' ? checkpoint.subject : null, checkpoint.blocking ? 1 : 0, id, token);
  }
  private async transition(owner: string, id: string, lease: string, change: Transition, publication?: ContentPublication) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    const token = this.runtime.uuid(); const now = this.jobs.timestamp(); const guard = this.outputGuard(change.output);
    const gate = 'EXISTS(SELECT 1 FROM jobs WHERE id=? AND mutation_token=?)';
    const prefix = publication?.before({ sql: `EXISTS(SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND j.status='RUNNING' AND j.lease_token=? AND j.lease_until>? AND p.owner_id=? AND p.archived_at IS NULL AND ${currentInputsSql('j')})`, values: [id, lease, now, owner] }) ?? [];
    const statements = [this.db.prepare(`UPDATE jobs SET status=?,lease_until=NULL,lease_token=NULL,agent_id=NULL,revision=revision+1,updated_at=?,mutation_token=?,error_json=?,next_run_at=?,output_ref=?,progress_json=?
      WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until${change.expired ? '<=' : '>'}? AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.archived_at IS NULL)
      ${change.externalMustBeAbsent ? 'AND NOT EXISTS(SELECT 1 FROM job_attempts a WHERE a.job_id=jobs.id AND a.lease_token=jobs.lease_token AND a.external_started=1)' : ''}
      ${change.attemptStatus === 'SUCCEEDED' ? `AND ${currentInputsSql()} AND ${guard.sql}` : ''}`)
      .bind(change.status, now, token, change.error ? JSON.stringify(change.error) : null, change.next, change.output ? JSON.stringify(change.output) : null,
        JSON.stringify({ message: change.error?.message ?? (change.status === 'WAITING_APPROVAL' ? 'Esperando aprobación de versión.' : change.status === 'PAUSED' ? 'Pausado en punto seguro.' : 'Trabajo terminado.') }),
        id, uuidSchema.parse(lease), now, owner, ...(change.attemptStatus === 'SUCCEEDED' ? guard.values : [])),
      this.db.prepare(`UPDATE job_attempts SET status=?,end_at=?,error_code=?,result_json=? WHERE job_id=? AND lease_token=? AND status='RUNNING' AND ${gate}`)
        .bind(change.attemptStatus, now, change.error?.code ?? null, change.output ? JSON.stringify(change.output) : null, id, lease, id, token),
      this.db.prepare(`INSERT INTO activity_events SELECT ?,?,project_id,id,'SYSTEM',NULL,?,'{}',? FROM jobs WHERE id=? AND mutation_token=?`)
        .bind(this.runtime.uuid(), owner, change.action, now, id, token),
    ];
    statements.push(usageTransitionStatement(this.db, id, token, now, change.attemptStatus === 'SUCCEEDED' ? 'SUCCEEDED' : change.attemptStatus === 'UNKNOWN' ? 'UNKNOWN' : 'RELEASED', change.usage));
    if (change.checkpoint) statements.push(this.checkpointStatement(change.checkpoint, id, token));
    statements.push(...(publication?.after?.({ sql: gate, values: [id, token] }, change.status === 'SUCCEEDED') ?? []));
    if (batchChanges(await this.db.batch([...prefix, ...statements]), prefix.length) !== 1) throw new LeaseLost();
    await this.reconcileProject(owner, job.projectId); return (await this.jobs.get(owner, id))!;
  }
  // Output ya validado por el agente. Inserciones, fence, checkpoint y activación comparten transacción D1.
  async publishContent(owner: string, id: string, lease: string, output: JobInputRef, publication: ContentPublication) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    const expected = { RESEARCH: 'RESEARCH', SCRIPT: 'SCRIPT', DIRECTION: 'SCENE_VERSION', RENDER: 'ASSET' };
    if (!(job.kind in expected) || expected[job.kind as keyof typeof expected] !== output.kind) throw new JobConflict();
    const project = await this.jobs.project(owner, job.projectId);
    const settings = await this.db.prepare('SELECT checkpoint_policy_json FROM project_settings WHERE project_id=?').bind(job.projectId).first<{ checkpoint_policy_json: string }>();
    const stage = job.kind === 'SCRIPT' ? 'SCRIPT' : job.kind === 'DIRECTION' ? 'DIRECTION' : null;
    const checkpoint: Checkpoint | null = stage && (publication.requireReview || checkpointRequired(project.mode, stage, z.array(z.string()).parse(JSON.parse(settings!.checkpoint_policy_json) as unknown), false))
      ? { id: this.runtime.uuid(), stage, subject: output.id, blocking: false } : null;
    return this.transition(owner, id, lease, { status: checkpoint ? 'WAITING_APPROVAL' : 'SUCCEEDED', attemptStatus: 'SUCCEEDED', action: checkpoint ? 'CHECKPOINT_CREATED' : 'JOB_SUCCEEDED', error: null, next: null, output, checkpoint, usage: { amountMicros: 0, units: 1 } }, publication);
  }
  // Manual submission has no external side effect or intermediate RUNNING lease.
  async publishManual(owner: string, id: string, operation: string, hash: string, revision: number, output: JobInputRef, publication: ContentPublication) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    const previous = await this.jobs.receipt(owner, job.projectId, operation, hash); if (previous) return jobDtoSchema.parse(previous);
    const expected = { RESEARCH: 'RESEARCH', SCRIPT: 'SCRIPT', DIRECTION: 'SCENE_VERSION', ASSET: 'SCENE_VERSION', VOICE: 'SCENE_VERSION' };
    if (!(job.kind in expected) || expected[job.kind as keyof typeof expected] !== output.kind) throw new JobConflict();
    const now = this.jobs.timestamp(); const token = this.runtime.uuid(); const guard = this.outputGuard(output);
    const eligible: PublicationGate = { sql: `EXISTS(SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND j.revision=? AND j.status='WAITING_MANUAL' AND j.attempt_count<j.max_attempts AND p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=0 AND ${currentInputsSql('j')} AND NOT EXISTS(SELECT 1 FROM usage_records u WHERE u.job_id=j.id AND u.status IN('UNKNOWN','RESERVED')) AND NOT EXISTS(SELECT 1 FROM job_dependencies d JOIN jobs parent ON parent.id=d.depends_on_id WHERE d.job_id=j.id AND parent.status<>'SUCCEEDED'))`, values: [id, revision, owner] };
    const stage = output.kind === 'SCRIPT' ? 'SCRIPT' : output.kind === 'SCENE_VERSION' ? 'DIRECTION' : null;
    const checkpoint: Checkpoint | null = stage ? { id: this.runtime.uuid(), stage, subject: output.id, blocking: false } : null;
    const g: PublicationGate = { sql: 'EXISTS(SELECT 1 FROM jobs WHERE id=? AND mutation_token=?)', values: [id, token] };
    const before = publication.before(eligible);
    const statements = [...before,
      this.db.prepare(`UPDATE jobs SET status=?,attempt_count=attempt_count+1,revision=revision+1,updated_at=?,mutation_token=?,error_json=NULL,output_ref=?,progress_json='{"message":"Resultado manual validado."}' WHERE id=? AND ${eligible.sql} AND ${guard.sql}`).bind(checkpoint ? 'WAITING_APPROVAL' : 'SUCCEEDED', now, token, JSON.stringify(output), id, ...eligible.values, ...guard.values),
      this.db.prepare(`INSERT INTO job_attempts (id,job_id,attempt_no,request_id,lease_token,start_at,end_at,status,result_json) SELECT ?,id,attempt_count,?,?,?,?,'SUCCEEDED',? FROM jobs WHERE id=? AND mutation_token=?`).bind(this.runtime.uuid(), operation, token, now, now, JSON.stringify(output), id, token),
      this.db.prepare(`INSERT INTO activity_events SELECT ?,?,project_id,id,'USER',?,'JOB_SUCCEEDED','{}',? FROM jobs WHERE id=? AND mutation_token=?`).bind(this.runtime.uuid(), owner, owner, now, id, token),
      ...(checkpoint ? [this.checkpointStatement(checkpoint, id, token)] : []),
      ...(publication.after?.(g, !checkpoint) ?? []),
      this.db.prepare(`INSERT INTO job_commands SELECT project_id,?,?,json_object('id',id,'projectId',project_id,'sceneId',scene_id,'kind',kind,'status',status,'executionTarget',execution_target,'revision',revision,'attempt',attempt_count,'maxAttempts',max_attempts,'nextRunAt',next_run_at,'progress',json(progress_json),'error',json(error_json),'providerId',selected_provider_id,'outputRef',json(output_ref),'createdAt',created_at,'updatedAt',updated_at) FROM jobs WHERE id=? AND mutation_token=?`).bind(operation, hash, id, token),
    ];
    try { if (batchChanges(await this.db.batch(statements), before.length) !== 1) throw new JobConflict(); }
    catch (error) { const replay = await this.jobs.receipt(owner, job.projectId, operation, hash); if (replay) return jobDtoSchema.parse(replay); throw error; }
    await this.reconcileProject(owner, job.projectId); return jobDtoSchema.parse(await this.jobs.receipt(owner, job.projectId, operation, hash));
  }
  async complete(owner: string, id: string, lease: string, output: JobInputRef | null, blocking = false, usage?: ActualUsage) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    output = jobInputRefSchema.nullable().parse(output);
    const committed = await this.db.prepare("SELECT result_json FROM job_attempts WHERE job_id=? AND lease_token=? AND attempt_no=? AND status='SUCCEEDED'")
      .bind(id, uuidSchema.parse(lease), job.attempt).first<{ result_json: string | null }>();
    if (committed && ['SUCCEEDED', 'WAITING_APPROVAL'].includes(job.status)) {
      if (JSON.stringify(jobInputRefSchema.nullable().parse(committed.result_json === null ? null : JSON.parse(committed.result_json) as unknown)) !== JSON.stringify(output)) throw new JobConflict();
      return job;
    }
    const decision = await this.completion(owner, job, output, blocking);
    return this.transition(owner, id, lease, { ...decision, attemptStatus: 'SUCCEEDED', action: decision.checkpoint ? 'CHECKPOINT_CREATED' : 'JOB_SUCCEEDED', error: null, next: null, output, usage });
  }
  async fail(owner: string, id: string, lease: string, rawCode: JobErrorCode, retryAfterMs = 0, expired = false, publication?: ContentPublication) {
    const code = jobErrorCodeSchema.parse(rawCode); const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    const attempt = await this.db.prepare("SELECT external_started FROM job_attempts WHERE job_id=? AND lease_token=? AND status='RUNNING'").bind(id, uuidSchema.parse(lease)).first<{ external_started: number }>();
    const disposition = failureDisposition(code, attempt?.external_started === 1);
    const exhausted = disposition.retryable && job.attempt >= job.maxAttempts;
    const project = await this.jobs.project(owner, job.projectId);
    const status = exhausted ? 'FAILED' : disposition.retryable && project.pause_requested ? 'PAUSED' : disposition.status;
    const next = disposition.retryable && !exhausted ? new Date(this.runtime.now() + retryDelayMs(job.attempt, this.random(), retryAfterMs)).toISOString() : null;
    return this.transition(owner, id, lease, { status, attemptStatus: disposition.unknown ? 'UNKNOWN' : 'FAILED', action: disposition.unknown ? 'JOB_UNKNOWN' : exhausted || status === 'FAILED' ? 'JOB_FAILED' : 'JOB_RETRY',
      error: safeJobError(disposition.unknown ? 'UNKNOWN_OUTCOME' : exhausted ? 'ATTEMPTS_EXHAUSTED' : code, disposition.retryable && !exhausted), next, output: null, expired,
      externalMustBeAbsent: !disposition.unknown && !['AUTH_REQUIRED', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'INVALID_INPUT', 'UNSUPPORTED_CAPABILITY', 'CONTENT_BLOCKED', 'BUDGET_EXCEEDED'].includes(code) }, publication);
  }
  async recoverExpired(owner: string, project: string, limit = 3) {
    await this.jobs.project(owner, project); z.int().min(1).max(10).parse(limit);
    const rows = await this.db.prepare("SELECT id,lease_token FROM jobs WHERE project_id=? AND status='RUNNING' AND lease_until<=? ORDER BY lease_until,id LIMIT ?")
      .bind(project, this.jobs.timestamp(), limit).all<{ id: string; lease_token: string }>();
    let recovered = 0;
    for (const row of rows.results) {
      try { await this.fail(owner, row.id, row.lease_token, 'TRANSIENT', 0, true); recovered++; }
      catch (error) { if (!(error instanceof LeaseLost)) throw error; }
    }
    return recovered;
  }
  async pauseAtSafePoint(owner: string, id: string, lease: string) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    const project = await this.jobs.project(owner, job.projectId);
    const attempt = await this.db.prepare('SELECT external_started FROM job_attempts WHERE job_id=? AND lease_token=?').bind(id, lease).first<{ external_started: number }>();
    if (!project.pause_requested || attempt?.external_started !== 0) throw new JobConflict();
    return this.transition(owner, id, lease, { status: 'PAUSED', attemptStatus: 'CANCELLED', action: 'PROJECT_PAUSED', error: null, next: null, output: null, externalMustBeAbsent: true });
  }
  private projectReceiptStatement(project: string, token: string, operation: string, hash: string) {
    return this.db.prepare(`INSERT INTO job_commands SELECT id,?,?,json_object('id',id,'status',status,'revision',revision,'mode',mode,'pause_requested',pause_requested,'active_script_version_id',active_script_version_id)
      FROM projects WHERE id=? AND mutation_token=?`).bind(operation, hash, project, token);
  }
  async pause(owner: string, project: string, expectedRevision: number, operation?: string) {
    await this.jobs.project(owner, project); revisionSchema.parse(expectedRevision); const now = this.jobs.timestamp(); const token = this.runtime.uuid();
    const hash = await catalogHash({ action: 'PAUSE', project, expectedRevision });
    if (operation) { const previous = await this.jobs.receipt(owner, project, operation, hash); if (previous) return projectStateSchema.parse(previous); }
    const statements = [
      this.db.prepare(`UPDATE projects SET pause_requested=1,status=CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status='RUNNING') THEN 'PAUSING' ELSE 'PAUSED' END,
        revision=revision+1,updated_at=max(updated_at,?),mutation_token=? WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL AND pause_requested=0
        AND EXISTS(SELECT 1 FROM jobs WHERE project_id=?)`).bind(project, now, token, project, owner, expectedRevision, project),
      this.db.prepare(`UPDATE jobs SET status='PAUSED',revision=revision+1,updated_at=? WHERE project_id=? AND status IN('PENDING','READY','RETRY_SCHEDULED') AND EXISTS(SELECT 1 FROM projects WHERE id=? AND mutation_token=?)`).bind(now, project, project, token),
      this.db.prepare("INSERT INTO activity_events SELECT ?,owner_id,id,NULL,'USER',owner_id,'PROJECT_PAUSED','{}',? FROM projects WHERE id=? AND mutation_token=?").bind(this.runtime.uuid(), now, project, token),
    ];
    if (operation) statements.push(this.projectReceiptStatement(project, token, operation, hash));
    if (batchChanges(await this.db.batch(statements)) !== 1) {
      if (operation) { const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return projectStateSchema.parse(replay); }
      throw new JobConflict();
    }
    return operation ? projectStateSchema.parse(await this.jobs.receipt(owner, project, operation, hash)) : this.jobs.project(owner, project);
  }
  async resume(owner: string, project: string, expectedRevision: number, operation?: string) {
    await this.jobs.project(owner, project); revisionSchema.parse(expectedRevision); const now = this.jobs.timestamp(); const token = this.runtime.uuid();
    const hash = await catalogHash({ action: 'RESUME', project, expectedRevision });
    if (operation) { const previous = await this.jobs.receipt(owner, project, operation, hash); if (previous) return projectStateSchema.parse(previous); }
    const statements = [
      this.db.prepare("UPDATE projects SET pause_requested=0,status='RUNNING',revision=revision+1,updated_at=max(updated_at,?),mutation_token=? WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL AND pause_requested=1 AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status='RUNNING')")
        .bind(now, token, project, owner, expectedRevision, project),
      this.db.prepare(`UPDATE jobs SET status=CASE WHEN ${currentInputsSql()} THEN CASE WHEN attempt_count<max_attempts THEN 'PENDING' ELSE 'FAILED' END ELSE 'STALE' END,
        revision=revision+1,updated_at=? WHERE project_id=? AND status='PAUSED' AND EXISTS(SELECT 1 FROM projects WHERE id=? AND mutation_token=?)`).bind(now, project, project, token),
      this.db.prepare("INSERT INTO activity_events SELECT ?,owner_id,id,NULL,'USER',owner_id,'PROJECT_RESUMED','{}',? FROM projects WHERE id=? AND mutation_token=?").bind(this.runtime.uuid(), now, project, token),
    ];
    if (operation) statements.push(this.projectReceiptStatement(project, token, operation, hash));
    if (batchChanges(await this.db.batch(statements)) !== 1) {
      if (operation) { const replay = await this.jobs.receipt(owner, project, operation, hash); if (replay) return projectStateSchema.parse(replay); }
      throw new JobConflict();
    }
    await this.reconcileProject(owner, project);
    return operation ? projectStateSchema.parse(await this.jobs.receipt(owner, project, operation, hash)) : this.jobs.project(owner, project);
  }
  async reconcileProject(owner: string, project: string) {
    const p = await this.jobs.project(owner, project);
    const counts = (await this.db.prepare('SELECT status,count(*) AS count FROM jobs WHERE project_id=? GROUP BY status').bind(project).all<{ status: string; count: number }>()).results;
    const has = (...states: string[]) => counts.some((r) => states.includes(r.status) && r.count > 0);
    const unknown = await this.db.prepare("SELECT id FROM usage_records WHERE project_id=? AND status='UNKNOWN' LIMIT 1").bind(project).first();
    const ready=await this.db.prepare('SELECT id FROM render_ready_manifests WHERE project_id=? LIMIT 1').bind(project).first();
    const rendering=await this.db.prepare("SELECT id FROM jobs WHERE project_id=? AND kind='RENDER' AND status IN('PENDING','READY','RUNNING','RETRY_SCHEDULED') LIMIT 1").bind(project).first();
    const completed=await this.db.prepare("SELECT y.id FROM youtube_packages y JOIN renders r ON r.id=y.render_id JOIN projects cp ON cp.id=y.project_id WHERE y.project_id=? AND r.status='SUCCEEDED' AND cp.active_manifest_id=r.manifest_id AND r.manifest_id IN(SELECT id FROM current_render_manifests) LIMIT 1").bind(project).first();
    const status = p.pause_requested ? has('RUNNING') ? 'PAUSING' : 'PAUSED' : has('FAILED') ? 'FAILED' : unknown ? 'WAITING_RESOURCE' : has('WAITING_APPROVAL') ? 'WAITING_APPROVAL'
      : rendering ? 'RENDERING' : completed && ready ? 'COMPLETED' : ready ? 'READY_RENDER' : has('RUNNING', 'READY', 'PENDING', 'RETRY_SCHEDULED') ? 'RUNNING' : counts.length ? 'WAITING_RESOURCE' : 'DRAFT';
    await this.db.prepare('UPDATE projects SET status=?,revision=revision+1,updated_at=max(updated_at,?) WHERE id=? AND owner_id=? AND archived_at IS NULL AND status<>? AND revision=? AND pause_requested=?')
      .bind(status, this.jobs.timestamp(), project, owner, status, p.revision, p.pause_requested).run();
    return this.jobs.project(owner, project);
  }
  async reconcileOutcome(owner: string, id: string, expectedRevision: number, outcome: { kind: 'NOT_ACCEPTED' } | { kind: 'VERIFIED_RESULT'; output: JobInputRef | null; usage?: ActualUsage }) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    if (job.revision !== revisionSchema.parse(expectedRevision) || job.status !== 'WAITING_RESOURCE' || job.error?.code !== 'UNKNOWN_OUTCOME') throw new JobConflict();
    const project = await this.jobs.project(owner, job.projectId);
    const current = await this.db.prepare(`SELECT ${currentInputsSql('j')} AS valid FROM jobs j WHERE j.id=?`).bind(id).first<{ valid: number }>();
    if (outcome.kind === 'VERIFIED_RESULT' && current?.valid !== 1) throw new JobConflict();
    const decision = outcome.kind === 'VERIFIED_RESULT' ? await this.completion(owner, job, outcome.output, false) : null;
    const status = current?.valid !== 1 ? 'STALE' : decision?.status ?? (job.attempt >= job.maxAttempts ? 'FAILED' : project.pause_requested ? 'PAUSED' : 'RETRY_SCHEDULED');
    const now = this.jobs.timestamp(); const token = this.runtime.uuid(); const output = outcome.kind === 'VERIFIED_RESULT' ? outcome.output : null; const guard = this.outputGuard(output);
    const statements = [this.db.prepare(`UPDATE jobs SET status=?,output_ref=?,error_json=?,next_run_at=?,revision=revision+1,updated_at=?,mutation_token=?,progress_json=? WHERE id=? AND revision=? AND status='WAITING_RESOURCE' AND json_extract(error_json,'$.code')='UNKNOWN_OUTCOME'
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.archived_at IS NULL) ${decision ? `AND ${guard.sql} AND ${currentInputsSql()}` : ''}`)
      .bind(status, output ? JSON.stringify(output) : null, status === 'FAILED' ? JSON.stringify(safeJobError('ATTEMPTS_EXHAUSTED')) : null,
        status === 'RETRY_SCHEDULED' ? new Date(this.runtime.now() + retryDelayMs(job.attempt, this.random())).toISOString() : null, now, token,
        JSON.stringify({ message: decision ? 'Resultado reconciliado.' : 'Rechazo externo confirmado.' }), id, expectedRevision, owner, ...(decision ? guard.values : [])),
      this.db.prepare(`UPDATE job_attempts SET status=?,error_code=?,result_json=? WHERE job_id=? AND attempt_no=? AND status='UNKNOWN' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND mutation_token=?)`)
        .bind(decision ? 'SUCCEEDED' : 'FAILED', decision ? null : 'TRANSIENT', output ? JSON.stringify(output) : null, id, job.attempt, id, token),
      this.db.prepare("INSERT INTO activity_events SELECT ?,?,project_id,id,'SYSTEM',NULL,?,'{}',? FROM jobs WHERE id=? AND mutation_token=?")
        .bind(this.runtime.uuid(), owner, decision ? 'JOB_SUCCEEDED' : 'JOB_RETRY', now, id, token),
    ];
    statements.push(usageTransitionStatement(this.db, id, token, now, decision ? 'SUCCEEDED' : 'RELEASED', outcome.kind === 'VERIFIED_RESULT' ? outcome.usage : undefined, true));
    if (decision?.checkpoint) statements.push(this.checkpointStatement(decision.checkpoint, id, token));
    if (batchChanges(await this.db.batch(statements)) !== 1) throw new JobConflict();
    await this.reconcileProject(owner, job.projectId); return (await this.jobs.get(owner, id))!;
  }
  async retryFailed(owner: string, id: string, operation: string, expectedRevision: number) {
    const job = await this.jobs.get(owner, id); if (!job) throw new JobNotFound();
    const hash = await catalogHash({ action: 'RETRY_JOB', id, expectedRevision: revisionSchema.parse(expectedRevision) });
    const previous = await this.jobs.receipt(owner, job.projectId, operation, hash); if (previous) return jobDtoSchema.parse(previous);
    const p = await this.jobs.project(owner, job.projectId);
    if (job.status !== 'FAILED' || job.revision !== expectedRevision || job.attempt >= 10 || job.error?.code === 'UNKNOWN_OUTCOME') throw new JobConflict();
    const now = this.jobs.timestamp(); const token = this.runtime.uuid();
    const body = jobDtoSchema.parse({ ...job, status: p.pause_requested ? 'PAUSED' : 'PENDING', revision: job.revision + 1,
      maxAttempts: Math.max(job.maxAttempts, job.attempt + 1), error: null, nextRunAt: null, progress: { message: 'Reintento solicitado.' }, updatedAt: now });
    const results = await this.db.batch([
      this.db.prepare(`UPDATE jobs SET status=?,max_attempts=?,error_json=NULL,next_run_at=NULL,progress_json=?,revision=revision+1,updated_at=?,mutation_token=?
        WHERE id=? AND revision=? AND status='FAILED' AND ${currentInputsSql()} AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=?)`)
        .bind(body.status, body.maxAttempts, JSON.stringify(body.progress), now, token, id, expectedRevision, owner, p.pause_requested),
      this.db.prepare('INSERT INTO job_commands SELECT project_id,?,?,? FROM jobs WHERE id=? AND mutation_token=?').bind(operation, hash, JSON.stringify(body), id, token),
      this.db.prepare("INSERT INTO activity_events SELECT ?,?,project_id,id,'USER',?,'JOB_RETRY','{}',? FROM jobs WHERE id=? AND mutation_token=?")
        .bind(this.runtime.uuid(), owner, owner, now, id, token),
    ]);
    if (batchChanges(results) !== 1) { const replay = await this.jobs.receipt(owner, job.projectId, operation, hash); if (replay) return jobDtoSchema.parse(replay); throw new JobConflict(); }
    await this.reconcileProject(owner, job.projectId); return body;
  }
}
