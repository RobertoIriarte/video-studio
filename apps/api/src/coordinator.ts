import type { Database } from './db/connection.js';
import { JobRunnerRepository } from './db/job-runner.js';
import { currentInputsSql, defaultJobRuntime } from './db/jobs.js';
import type { JobRuntime } from './db/jobs.js';
import { prepareNextJob } from './job-policy.js';
import { executeMockContent, enqueueContentSuccessor, ensureScriptDirection } from './content-executor.js';
import { ensureSceneFollowups } from './scene-followups.js';

// Lote conservador de coordinación y contenido mock; sin ejecutores multimedia. Invocable sin navegador.
export async function advanceCoordinator(db: Database, runtime: JobRuntime = defaultJobRuntime, random: () => number = () => Math.random()) {
  const now = new Date(runtime.now()).toISOString();
  const rows = await db.prepare(`SELECT p.id,p.owner_id,p.active_script_version_id FROM projects p WHERE p.archived_at IS NULL AND (EXISTS(
    SELECT 1 FROM jobs j WHERE j.project_id=p.id AND ((j.status='RUNNING' AND j.lease_until<=?) OR
    (p.pause_requested=0 AND ((j.status IN('PENDING','RETRY_SCHEDULED') AND (j.next_run_at IS NULL OR j.next_run_at<=?)) OR (j.status='READY' AND j.kind<>'VALIDATE_INPUT') OR (j.status='SUCCEEDED' AND (j.kind='RESEARCH' OR (j.kind='SCRIPT' AND json_extract(j.output_ref,'$.id')=p.active_script_version_id AND EXISTS(SELECT 1 FROM script_versions v WHERE v.id=p.active_script_version_id AND json_extract(v.script_json,'$.metadata.schemaVersion')=1))) AND NOT EXISTS(SELECT 1 FROM content_expansions e WHERE e.job_id=j.id)))
      AND ${currentInputsSql('j')}
      AND NOT EXISTS(SELECT 1 FROM job_dependencies d JOIN jobs parent ON parent.id=d.depends_on_id WHERE d.job_id=j.id AND parent.status<>'SUCCEEDED'))))
    OR (p.pause_requested=0 AND EXISTS(SELECT 1 FROM script_versions v WHERE v.id=p.active_script_version_id AND json_extract(v.script_json,'$.metadata.schemaVersion')=1 AND NOT EXISTS(SELECT 1 FROM direction_expansions e WHERE e.script_version_id=v.id)))
    OR (p.pause_requested=0 AND EXISTS(SELECT 1 FROM scenes s JOIN scene_versions v ON v.id=s.active_version_id WHERE s.project_id=p.id AND v.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM scene_expansions e WHERE e.scene_version_id=v.id))))
    ORDER BY p.updated_at,p.id LIMIT 1`).bind(now, now).all<{ id: string; owner_id: string; active_script_version_id: string | null }>();
  for (const project of rows.results) {
    const runner = new JobRunnerRepository(db, runtime, random);
    if (project.active_script_version_id) await ensureScriptDirection(db, project.owner_id, project.id, project.active_script_version_id, runtime);
    await ensureSceneFollowups(db, project.owner_id, project.id, runtime);
    await runner.recoverExpired(project.owner_id, project.id, 1);
    await runner.jobs.tick(project.owner_id, project.id);
    await prepareNextJob(db, project.owner_id, project.id, runtime);
    const ready = await db.prepare("SELECT id FROM jobs WHERE project_id=? AND status='READY' AND selected_provider_id IS NOT NULL AND kind IN('RESEARCH','SCRIPT','DIRECTION') LIMIT 1").bind(project.id).first();
    if (ready) await executeMockContent(db, project.owner_id, project.id, runtime);
    const completed = await db.prepare("SELECT j.id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.project_id=? AND j.status='SUCCEEDED' AND (j.kind='RESEARCH' OR (j.kind='SCRIPT' AND json_extract(j.output_ref,'$.id')=p.active_script_version_id AND EXISTS(SELECT 1 FROM script_versions v WHERE v.id=p.active_script_version_id AND json_extract(v.script_json,'$.metadata.schemaVersion')=1))) AND NOT EXISTS(SELECT 1 FROM content_expansions e WHERE e.job_id=j.id) LIMIT 1").bind(project.id).first<{ id: string }>();
    if (completed) await enqueueContentSuccessor(db, project.owner_id, completed.id, runtime);
    await runner.reconcileProject(project.owner_id, project.id);
  }
  return rows.results.length;
}
