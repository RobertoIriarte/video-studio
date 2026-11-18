import { AgentRepository } from './agents.js';
import { z } from 'zod';
import { checkpointApproveSchema, checkpointDtoSchema, checkpointViewSchema, productionSchema, uuidSchema } from '@video-studio/contracts';
import type { Database } from './connection.js';
import { JobConflict, JobNotFound, JobRepository, batchChanges, currentInputsSql, defaultJobRuntime } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import { ProjectRepository } from './repositories.js';
import { UsageRepository } from './usage.js';
import { CatalogRepository, catalogHash } from './catalog.js';
import { JobRunnerRepository } from './job-runner.js';
import { sceneInvalidation, scriptInvalidation } from './invalidation.js';

export class ProductionRepository {
  readonly jobs: JobRepository;
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime) { this.jobs = new JobRepository(db, runtime); }
  async checkpointViews(owner: string, project: string, id?: string) {
    await this.jobs.project(owner, project);
    const rows = await this.db.prepare(`SELECT c.*,COALESCE(s.version_no,v.version_no) AS version_no,
      CASE WHEN c.stage='SCRIPT' THEN s.script_json ELSE json_object('narration',v.narration,'direction',json(v.direction_json)) END AS preview_json,
      CASE WHEN c.stage='SCRIPT' THEN s.version_no=(SELECT max(version_no) FROM script_versions WHERE project_id=c.project_id)
      ELSE v.version_no=(SELECT max(version_no) FROM scene_versions WHERE scene_id=v.scene_id) END AS is_current
      FROM checkpoints c LEFT JOIN script_versions s ON s.id=c.script_version_id LEFT JOIN scene_versions v ON v.id=c.scene_version_id
      WHERE c.project_id=? ${id ? 'AND c.id=?' : "AND c.status='PENDING'"} ORDER BY c.id LIMIT 25`)
      .bind(project, ...(id ? [uuidSchema.parse(id)] : [])).all<Record<string, unknown>>();
    return rows.results.map((r) => checkpointViewSchema.parse({ id: r.id, projectId: r.project_id, jobId: r.job_id, stage: r.stage, subjectVersionId: r.subject_version_id,
      status: r.status, blocking: r.blocking === 1, revision: r.revision, reviewedAt: r.reviewed_at, versionNo: r.version_no, current: r.is_current === 1,
      preview: JSON.parse(z.string().parse(r.preview_json)) as unknown }));
  }
  async overview(owner: string, project: string) {
    const state = await this.jobs.project(owner, project); const record = await new ProjectRepository(this.db).summary(owner, project); if (!record) throw new JobNotFound();
    const [counts, stages, listed, checkpoints, activity, usage, wizard] = await Promise.all([
      this.db.prepare('SELECT status,count(*) AS count FROM jobs WHERE project_id=? GROUP BY status').bind(project).all<{ status: string; count: number }>(),
      this.db.prepare("SELECT kind,count(*) AS count,sum(CASE WHEN status='SUCCEEDED' THEN 1 ELSE 0 END) AS completed FROM jobs WHERE project_id=? GROUP BY kind").bind(project).all(),
      this.jobs.list(owner, { projectId: project, limit: 25 }), this.checkpointViews(owner, project), this.jobs.activity(owner, project),
      new UsageRepository(this.db, this.runtime).summary(owner, project), this.db.prepare('SELECT wizard_step FROM projects WHERE id=?').bind(project).first<{ wizard_step: number }>(),
    ]);
    const agents = await new AgentRepository(this.db, '', this.runtime).list(owner);
    const agent = agents.some((a) => a.status === 'ONLINE') ? 'ONLINE' : agents.some((a) => a.status !== 'REVOKED') ? 'OFFLINE' : 'NOT_CONFIGURED';
    const total = counts.results.reduce((sum, row) => sum + row.count, 0);
    return productionSchema.parse({ project: record, pauseRequested: state.pause_requested === 1, canStart: state.status === 'DRAFT' && total === 0 && wizard?.wizard_step === 5,
      counts: counts.results, stages: stages.results, jobs: listed.items, checkpoints, activity, usage,
      progress: { completedJobs: counts.results.find((r) => r.status === 'SUCCEEDED')?.count ?? 0, registeredJobs: total, plannedTotal: null }, agent,
      availabilityMessage: !total ? wizard?.wizard_step === 5 ? 'Puedes registrar la producción. La vía de trabajo depende del proveedor configurado.' : 'Completa y confirma los cinco pasos del borrador.'
        : counts.results.some((r) => r.status === 'WAITING_MANUAL') ? 'Esperando resultado manual. Abre el trabajo para copiar el prompt e importar la salida.'
          : counts.results.some((r) => r.status === 'WAITING_APPROVAL') ? 'Revisa el contenido de la versión exacta antes de aprobar.' : 'Consulta los trabajos para conocer el próximo paso. Los mocks generan solo contenido simulado; la multimedia requiere importación o agente.',
      updatedAt: this.jobs.timestamp() });
  }
  async approve(owner: string, id: string, operation: string, raw: unknown) {
    uuidSchema.parse(id); uuidSchema.parse(operation); const input = checkpointApproveSchema.parse(raw);
    const row = await this.db.prepare('SELECT c.project_id,c.job_id FROM checkpoints c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.owner_id=? AND p.archived_at IS NULL')
      .bind(id, uuidSchema.parse(owner)).first<{ project_id: string; job_id: string }>();
    if (!row) throw new JobNotFound();
    const hash = await catalogHash({ action: 'APPROVE_CHECKPOINT', id, input });
    const replay = await this.jobs.receipt(owner, row.project_id, operation, hash); if (replay) return checkpointDtoSchema.parse(replay);
    const view = (await this.checkpointViews(owner, row.project_id, id))[0]!;
    const project = await this.jobs.project(owner, row.project_id);
    if (view.status !== 'PENDING' || view.revision !== input.expectedRevision || view.subjectVersionId !== input.subjectVersionId || !view.current) throw new JobConflict();
    const script = view.stage === 'SCRIPT'; const table = script ? 'script_versions' : 'scene_versions';
    const now = this.jobs.timestamp(); const token = this.runtime.uuid();
    const body = checkpointDtoSchema.parse({ id: view.id, projectId: view.projectId, jobId: view.jobId, stage: view.stage,
      subjectVersionId: view.subjectVersionId, blocking: view.blocking, status: 'APPROVED', revision: view.revision + 1, reviewedAt: now });
    const gate = 'EXISTS(SELECT 1 FROM checkpoints WHERE id=? AND mutation_token=?)';
    const sceneVersion = !script ? await new CatalogRepository(this.db).getSceneVersion(owner, row.project_id, view.subjectVersionId) : null;
    const sceneState = sceneVersion ? await this.db.prepare('SELECT active_version_id FROM scenes WHERE id=?').bind(sceneVersion.sceneId).first<{ active_version_id: string | null }>() : null;
    const invalidate = script ? scriptInvalidation(this.db, row.project_id, project.active_script_version_id, view.subjectVersionId) : await sceneInvalidation(this.db, owner, row.project_id, sceneState?.active_version_id ?? null, view.subjectVersionId);
    const statements = [this.db.prepare(`UPDATE checkpoints SET status='APPROVED',reviewed_by=?,reviewed_at=?,revision=revision+1,mutation_token=?
      WHERE id=? AND revision=? AND status='PENDING' AND subject_version_id=?
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=checkpoints.project_id AND p.owner_id=? AND p.archived_at IS NULL AND p.revision=?)
      AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=checkpoints.job_id AND j.status='WAITING_APPROVAL' AND json_extract(j.output_ref,'$.id')=checkpoints.subject_version_id AND ${currentInputsSql('j')})
      AND EXISTS(SELECT 1 FROM ${table} v WHERE v.id=checkpoints.subject_version_id AND v.project_id=checkpoints.project_id AND v.status IN('CANDIDATE','APPROVED')
        AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=checkpoints.job_id AND json_extract(j.output_ref,'$.hash')=v.${script ? 'content_hash' : 'hash'} AND json_extract(j.output_ref,'$.kind')='${script ? 'SCRIPT' : 'SCENE_VERSION'}')
        AND v.version_no=(SELECT max(version_no) FROM ${table} latest WHERE ${script ? 'latest.project_id=v.project_id' : 'latest.scene_id=v.scene_id'})
        ${script ? ""
          : "AND EXISTS(SELECT 1 FROM scenes s JOIN projects p ON p.id=s.project_id WHERE s.id=v.scene_id AND s.archived_at IS NULL AND s.active_version_id IS v.parent_version_id AND p.active_script_version_id=v.script_version_id)"})`)
      .bind(owner, now, token, id, input.expectedRevision, input.subjectVersionId, owner, project.revision),
      this.db.prepare(`UPDATE ${table} SET status='APPROVED' WHERE id=? AND ${gate}`).bind(view.subjectVersionId, id, token),
    ];
    if (script) {
      statements.push(this.db.prepare(`UPDATE script_versions SET status='SUPERSEDED' WHERE id=(SELECT active_script_version_id FROM projects WHERE id=?) AND id<>? AND status='APPROVED' AND ${gate}`)
        .bind(row.project_id, view.subjectVersionId, id, token));
      statements.push(this.db.prepare(`UPDATE projects SET active_script_version_id=?,revision=revision+1,updated_at=max(updated_at,?) WHERE id=? AND owner_id=? AND ${gate}`)
        .bind(view.subjectVersionId, now, row.project_id, owner, id, token));
    } else {
      statements.push(this.db.prepare(`UPDATE scene_versions SET status='SUPERSEDED' WHERE id=(SELECT s.active_version_id FROM scenes s JOIN scene_versions v ON v.scene_id=s.id WHERE v.id=?) AND id<>? AND status='APPROVED' AND ${gate}`)
        .bind(view.subjectVersionId, view.subjectVersionId, id, token));
      statements.push(this.db.prepare(`UPDATE scenes SET active_version_id=?,revision=revision+1 WHERE id=(SELECT scene_id FROM scene_versions WHERE id=?) AND ${gate}`)
        .bind(view.subjectVersionId, view.subjectVersionId, id, token));
      statements.push(this.db.prepare(`UPDATE projects SET revision=revision+1,updated_at=max(updated_at,?) WHERE id=? AND owner_id=? AND ${gate}`).bind(now, row.project_id, owner, id, token));
    }
    statements.push(...invalidate({ sql: gate, values: [id, token] }));
    statements.push(this.db.prepare(`UPDATE jobs SET status='SUCCEEDED',revision=revision+1,updated_at=?,progress_json=? WHERE id=? AND status='WAITING_APPROVAL' AND ${gate}`)
      .bind(now, JSON.stringify({ message: 'Versión aprobada.' }), row.job_id, id, token));
    statements.push(this.db.prepare(`INSERT INTO activity_events SELECT ?,?,project_id,job_id,'USER',?,'CHECKPOINT_APPROVED','{}',? FROM checkpoints WHERE id=? AND mutation_token=?`)
      .bind(this.runtime.uuid(), owner, owner, now, id, token));
    statements.push(this.db.prepare(`INSERT INTO job_commands SELECT project_id,?,?,? FROM checkpoints WHERE id=? AND mutation_token=?`).bind(operation, hash, JSON.stringify(body), id, token));
    try { if (batchChanges(await this.db.batch(statements)) !== 1) throw new JobConflict(); }
    catch (error) { const previous = await this.jobs.receipt(owner, row.project_id, operation, hash); if (previous) return checkpointDtoSchema.parse(previous); throw error; }
    await new JobRunnerRepository(this.db, this.runtime).reconcileProject(owner, row.project_id); return body;
  }
}
