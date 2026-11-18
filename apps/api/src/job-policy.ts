import { z } from 'zod';
import { chooseProvider } from '@video-studio/providers';
import { providerRequestSchema } from '@video-studio/contracts';
import { JobNotFound, JobRepository, defaultJobRuntime } from './db/jobs.js';
import type { JobRuntime } from './db/jobs.js';
import type { Database } from './db/connection.js';
import { ProviderRepository } from './db/providers.js';
import { UsageRepository } from './db/usage.js';
import { safeJobError } from './db/job-runner.js';

export async function prepareJob(db: Database, owner: string, id: string, runtime: JobRuntime = defaultJobRuntime) {
  const jobs = new JobRepository(db, runtime); const job = await jobs.get(owner, id); if (!job) throw new JobNotFound();
  if (!['PENDING', 'READY', 'WAITING_MANUAL', 'WAITING_RESOURCE'].includes(job.status) || job.error?.code === 'UNKNOWN_OUTCOME' || job.kind === 'VALIDATE_INPUT') return job;
  const settings = await db.prepare('SELECT language,budget_currency,provider_policy_json FROM project_settings WHERE project_id=?').bind(job.projectId).first<{ language: string; budget_currency: string; provider_policy_json: string }>();
  const payload = await db.prepare('SELECT payload_json FROM jobs WHERE id=?').bind(id).first<{ payload_json: string }>();
  const requestedProvider = z.object({ providerId: z.string().nullable().optional() }).parse(JSON.parse(payload!.payload_json) as unknown).providerId;
  const policy = z.object({ preferredIds: z.array(z.string()), allowPaidFallback: z.boolean() }).parse(JSON.parse(settings!.provider_policy_json) as unknown);
  const capability = job.kind === 'VOICE' ? 'VOICE' : job.kind === 'ASSET' ? 'TEXT_IMAGE' : 'STRUCTURED_TEXT';
  const providers = await new ProviderRepository(db).list(owner);
  const provider = chooseProvider(requestedProvider ? providers.filter((p) => p.id === requestedProvider) : providers, providerRequestSchema.parse({ capability, language: settings!.language }),
    { ...policy, spendingAuthorized: false, currency: settings!.budget_currency, availableMicros: (await new UsageRepository(db, runtime).summary(owner, job.projectId)).remainingMicros });
  if (job.kind === 'RENDER' && job.executionTarget === 'LOCAL' && await db.prepare("SELECT id FROM local_agents WHERE owner_id=? AND revoked_at IS NULL AND last_seen_at>? AND json_extract(capabilities_json,'$.render')=1 LIMIT 1").bind(owner,new Date(runtime.now()-45000).toISOString()).first()) return job;
  const local = job.executionTarget === 'LOCAL'; const manual = !local && (job.executionTarget === 'MANUAL' || provider.manual);
  const code = local ? 'LOCAL_UNAVAILABLE' : manual ? 'UNSUPPORTED_CAPABILITY' : 'PROVIDER_UNAVAILABLE';
  const now = jobs.timestamp(); const token = runtime.uuid();
  if (!local && provider.provider?.adapterKey === 'MOCK_FIXTURE' && ['RESEARCH', 'SCRIPT', 'DIRECTION'].includes(job.kind)) {
    await db.prepare(`UPDATE jobs SET selected_provider_id=? WHERE id=? AND revision=? AND status='READY' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.pause_requested=0 AND p.archived_at IS NULL)`).bind(provider.provider.id, id, job.revision, owner).run();
    return (await jobs.get(owner, id))!;
  }
  await db.batch([
    db.prepare(`UPDATE jobs SET status=?,selected_provider_id=?,error_json=?,progress_json=?,revision=revision+1,updated_at=?,mutation_token=?
      WHERE id=? AND revision=? AND status IN('PENDING','READY','WAITING_MANUAL','WAITING_RESOURCE') AND (error_json IS NULL OR json_extract(error_json,'$.code')<>'UNKNOWN_OUTCOME')
      AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=0)
      AND NOT EXISTS(SELECT 1 FROM job_dependencies d JOIN jobs p ON p.id=d.depends_on_id WHERE d.job_id=jobs.id AND p.status<>'SUCCEEDED')
      AND NOT EXISTS(SELECT 1 FROM usage_records u WHERE u.job_id=jobs.id AND u.status='UNKNOWN')`)
      .bind(manual ? 'WAITING_MANUAL' : 'WAITING_RESOURCE', provider.provider?.id ?? null, JSON.stringify(safeJobError(code)),
        JSON.stringify({ message: local ? 'Esperando conexión del agente local.' : manual ? 'Esperando resultado manual. Abre el trabajo para copiar el prompt e importar la salida.' : 'Proveedor simulado configurado; ejecutor de contenido aún no disponible.' }), now, token, id, job.revision, owner),
    db.prepare("INSERT INTO activity_events SELECT ?,?,project_id,id,'SYSTEM',NULL,'JOB_RETRY','{}',? FROM jobs WHERE id=? AND mutation_token=?")
      .bind(runtime.uuid(), owner, now, id, token),
  ]);
  return (await jobs.get(owner, id))!;
}

export async function prepareNextJob(db: Database, owner: string, project: string, runtime: JobRuntime = defaultJobRuntime) {
  const row = await db.prepare("SELECT id FROM jobs WHERE project_id=? AND status='READY' AND kind<>'VALIDATE_INPUT' ORDER BY created_at,id LIMIT 1").bind(project).first<{ id: string }>();
  if (!row) return 0;
  const before = (await new JobRepository(db, runtime).get(owner, row.id))!; await prepareJob(db, owner, row.id, runtime);
  return before ? 1 : 0;
}
