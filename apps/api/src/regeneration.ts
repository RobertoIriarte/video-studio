import { jobDtoSchema, regenerateSchema, regenerationImpactSchema, regenerationScopeSchema } from '@video-studio/contracts';
import { affectedJobKinds, scopeComponents, sceneComponents } from '@video-studio/domain';
import type { Database } from './db/connection.js';
import { ContentRepository } from './db/content.js';
import { JobConflict, JobNotFound, defaultJobRuntime } from './db/jobs.js';
import type { JobRuntime } from './db/jobs.js';
import { ProviderRepository } from './db/providers.js';
import { catalogHash } from './db/catalog.js';

export function regenerationImpact(scopeInput: unknown) {
  const scope = regenerationScopeSchema.parse(scopeInput); const components = scopeComponents(scope);
  return regenerationImpactSchema.parse({ scope, components, jobKinds: affectedJobKinds(components), preserves: sceneComponents.filter((c) => !components.includes(c)), requiresResource: ['VOICE', 'MUSIC', 'AMBIENCE', 'EDIT'].includes(scope),
    message: ['VOICE', 'MUSIC', 'AMBIENCE', 'EDIT'].includes(scope) ? 'Requiere importación, proveedor compatible o agente. No se producirá multimedia simulada como si fuera real.' : 'Se creará una candidata. La versión activa y sus recursos se conservan hasta aprobar la nueva versión. Los mocks se identifican como simulación.' });
}
export async function regenerateScene(db: Database, owner: string, sceneId: string, operation: string, raw: unknown, runtime: JobRuntime = defaultJobRuntime, qa?: {reportId:string;findingId:string;project:string;round:number}) {
  const input = regenerateSchema.parse(raw); const repo = new ContentRepository(db, runtime); const project = await repo.sceneScope(owner, sceneId); const requestHash = await catalogHash({ sceneId, input, ...(qa ? {qaReportId:qa.reportId,qaFindingId:qa.findingId} : {}) });
  const previous = await db.prepare('SELECT response_json FROM job_commands WHERE project_id=? AND operation_id=?').bind(project, operation).first<{ response_json: string }>();
  if (previous) {
    const response = jobDtoSchema.safeParse(JSON.parse(previous.response_json) as unknown); if (!response.success) throw new JobConflict();
    const stored = await db.prepare("SELECT json_extract(payload_json,'$.regenerationRequestHash') AS hash FROM jobs WHERE id=? AND project_id=?").bind(response.data.id, project).first<{ hash: string | null }>();
    if (stored?.hash !== requestHash) throw new JobConflict(); return response.data;
  }
  const scene = (await repo.catalog.getScene(owner, project, sceneId))!;
  const base = await repo.catalog.getSceneVersion(owner, project, input.baseVersionId); if (!base || base.sceneId !== sceneId) throw new JobNotFound();
  // La revisión/parent se vuelve a comprobar en el mismo batch que el job y su recibo.
  if (input.providerId) {
    const provider = await new ProviderRepository(db).get(owner, input.providerId);
    if (!provider) throw new JobNotFound();
    if (!provider.enabled || !['MOCK', 'MANUAL'].includes(provider.integrationMode) || !provider.capabilities.operations.includes(input.scope === 'VOICE' ? 'VOICE' : 'STRUCTURED_TEXT')) throw new JobConflict();
  }
  const script = await repo.catalog.getScript(owner, project, base.scriptVersionId); if (!script) throw new JobNotFound();
  const kind = ['ALL', 'VISUAL', 'NARRATION'].includes(input.scope) ? 'DIRECTION' : input.scope === 'VOICE' ? 'VOICE' : input.scope === 'EDIT' ? 'EDIT' : 'ASSET';
  return repo.jobs.create(owner, project, operation, { kind, sceneId, executionTarget: input.scope === 'EDIT' ? 'LOCAL' : ['MUSIC', 'AMBIENCE'].includes(input.scope) ? 'MANUAL' : 'CLOUD', inputRefs: [{ kind: 'SCRIPT', id: script.id, hash: script.contentHash }, { kind: 'SCENE_VERSION', id: base.id, hash: base.contentHash }],
    payload: { ...(qa ? {qaReportId:qa.reportId,qaFindingId:qa.findingId,qaRepairRound:qa.round} : {}), sectionKey: scene.stableKey, scope: input.scope, instruction: input.instruction, providerId: input.providerId, regeneration: true, regenerationRequestHash: requestHash } }, { regeneration: { expectedRevision: input.expectedRevision, baseVersionId: input.baseVersionId }, ...(qa ? { guard: { sql: "EXISTS(SELECT 1 FROM qa_reports q JOIN projects qp ON qp.id=q.project_id WHERE q.id=? AND q.project_id=? AND q.kind IN('PRE_RENDER','FINAL') AND q.status IN('BLOCKED','PENDING') AND qp.active_manifest_id=q.manifest_id AND q.manifest_id IN(SELECT id FROM current_render_manifests) AND q.version_no=(SELECT max(latest.version_no) FROM qa_reports latest WHERE latest.manifest_id=q.manifest_id AND latest.kind=q.kind) AND EXISTS(SELECT 1 FROM json_each(q.findings_json) f WHERE json_extract(f.value,'$.id')=?) AND (SELECT count(*) FROM jobs repair JOIN qa_reports origin ON origin.id=json_extract(repair.payload_json,'$.qaReportId') WHERE repair.project_id=q.project_id AND origin.manifest_id=q.manifest_id)<2)", values:[qa.reportId,qa.project,qa.findingId] } } : {}) });
}
