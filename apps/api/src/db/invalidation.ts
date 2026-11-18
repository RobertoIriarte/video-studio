import { sceneComponents, affectedJobKinds, changedComponents } from '@video-studio/domain';
import type { SceneComponent } from '@video-studio/domain';
import type { z } from 'zod';
import type { sceneVersionSchema } from '@video-studio/contracts';
import type { Database, Statement } from './connection.js';
import { CatalogRepository, catalogHash } from './catalog.js';
import type { PublicationGate } from './job-runner.js';
type Version = z.infer<typeof sceneVersionSchema>;

export async function sceneHashes(v: Version): Promise<Record<SceneComponent, string>> {
  const links = (role: string) => v.assetLinks.filter((l) => l.role === role).map(({ assetId, role, offsetMs, trimStartMs, trimEndMs }) => ({ assetId, role, offsetMs, trimStartMs, trimEndMs })).sort((a, b) => a.assetId.localeCompare(b.assetId) || a.offsetMs - b.offsetMs || a.trimStartMs - b.trimStartMs || (a.trimEndMs ?? 0) - (b.trimEndMs ?? 0));
  const values = { NARRATION: v.narration, VISUAL: { direction: Object.fromEntries(Object.entries(v.direction).filter(([k]) => !['musicMood', 'sfx', 'ambience', 'edit', 'metadata', 'scenes', 'warnings', 'voiceTimingMethod', 'alignmentPending', 'visualTimingReviewRequired', 'voiceTimingReviewRequired'].includes(k))), shots: v.shots.map(({ orderIndex, type, prompt, camera, assetId }) => ({ orderIndex, type, prompt, camera, assetId })), assets: links('VISUAL') },
    VOICE: links('VOICE'), TIMING: { segments: v.voiceSegments, durationMs: v.durationMs, shots: v.shots.map((s) => s.durationMs), voice: links('VOICE') }, MUSIC: { mood: v.direction.musicMood ?? null, links: links('MUSIC') }, AMBIENCE: { ambience: v.direction.ambience ?? null, sfx: v.direction.sfx ?? null, links: [...links('AMBIENCE'), ...links('SFX')] }, EDIT: { edit: v.direction.edit ?? null, transitions: v.shots.map((s) => s.transition) } };
  return Object.fromEntries(await Promise.all(sceneComponents.map(async (c) => [c, await catalogHash(values[c])]))) as Record<SceneComponent, string>;
}
// Scope real de los inputs de ASSET: música/ambiente no dependen de un cambio visual.
function dependencyPredicate(changed: readonly SceneComponent[], alias: string) {
  const kinds = affectedJobKinds(changed).filter((k) => !['ASSET', 'DIRECTION'].includes(k));
  const assetScopes = new Set<string>();
  if (changed.some((c) => ['NARRATION', 'VISUAL', 'TIMING'].includes(c))) for (const s of ['ALL', 'VISUAL', 'IMAGE', 'VIDEO']) assetScopes.add(s);
  for (const c of changed) if (c === 'MUSIC' || c === 'AMBIENCE') assetScopes.add(c);
  return `(${kinds.length ? `${alias}.kind IN(${kinds.map((k) => `'${k}'`).join(',')})` : '0'} OR (${changed.some((c) => ['NARRATION', 'VISUAL', 'TIMING'].includes(c)) ? '1' : '0'} AND ${alias}.kind='DIRECTION' AND ${alias}.status<>'SUCCEEDED') OR (${alias}.kind='ASSET' AND COALESCE(json_extract(${alias}.payload_json,'$.scope'),'VISUAL') IN(${[...assetScopes].map((s) => `'${s}'`).join(',') || "''"})))`;
}
function invalidationStatements(db: Database, project: string, roots: string, rootValues: unknown[], gate: PublicationGate, now: string, mutation: string): Statement[] {
  const g = gate; const affected = `WITH RECURSIVE affected(id) AS (SELECT j.id FROM jobs j WHERE j.project_id=? AND (${roots}) UNION SELECT d.job_id FROM job_dependencies d JOIN affected a ON d.depends_on_id=a.id WHERE d.project_id=?) SELECT id FROM affected`;
  return [
    db.prepare(`UPDATE jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM job_attempts a WHERE a.job_id=jobs.id AND a.attempt_no=jobs.attempt_count AND a.external_started=1 AND a.status IN('RUNNING','UNKNOWN')) THEN 'WAITING_RESOURCE' ELSE 'STALE' END,
      error_json=CASE WHEN EXISTS(SELECT 1 FROM job_attempts a WHERE a.job_id=jobs.id AND a.attempt_no=jobs.attempt_count AND a.external_started=1 AND a.status IN('RUNNING','UNKNOWN')) THEN '{"code":"UNKNOWN_OUTCOME","message":"Entrada reemplazada; reconciliar resultado externo sin reintentar.","retryable":false}' ELSE NULL END,
      lease_token=NULL,lease_until=NULL,agent_id=NULL,next_run_at=NULL,revision=revision+1,updated_at=?,mutation_token=?,progress_json='{"message":"Entrada reemplazada; historial conservado."}'
      WHERE id IN(${affected}) AND status NOT IN('CANCELLED','STALE') AND ${g.sql}`).bind(now, mutation, project, ...rootValues, project, ...g.values),
    db.prepare(`UPDATE job_attempts SET status=CASE WHEN external_started=1 THEN 'UNKNOWN' ELSE 'CANCELLED' END,end_at=? WHERE status='RUNNING' AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=job_attempts.job_id AND j.mutation_token=?) AND ${g.sql}`).bind(now, mutation, ...g.values),
    db.prepare(`UPDATE usage_records SET status=CASE WHEN status='UNKNOWN' OR EXISTS(SELECT 1 FROM job_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.id=usage_records.job_id AND a.attempt_no=j.attempt_count AND a.external_started=1) THEN 'UNKNOWN' ELSE 'RELEASED' END,updated_at=? WHERE status IN('RESERVED','UNKNOWN') AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=usage_records.job_id AND j.mutation_token=?) AND ${g.sql}`).bind(now, mutation, ...g.values),
    db.prepare(`UPDATE checkpoints SET status='SUPERSEDED',revision=revision+1 WHERE status='PENDING' AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=checkpoints.job_id AND j.mutation_token=?) AND ${g.sql}`).bind(mutation, ...g.values),
  ];
}
export async function sceneInvalidation(db: Database, owner: string, project: string, oldId: string | null, newId: string) {
  if (!oldId || oldId === newId) return () => [] as Statement[];
  const catalog = new CatalogRepository(db); const before = (await catalog.getSceneVersion(owner, project, oldId))!; const after = (await catalog.getSceneVersion(owner, project, newId))!;
  const changed = changedComponents(await sceneHashes(before), await sceneHashes(after));
  return (g: PublicationGate) => {
    const depends = dependencyPredicate(changed, 'j'); const now = new Date().toISOString(); const mutation = crypto.randomUUID();
    const compatible = [db.prepare(`UPDATE job_version_compatibility SET compatible_with_id=? WHERE scene_id=? AND compatible_with_id=? AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=job_version_compatibility.job_id AND NOT ${depends}) AND ${g.sql}`).bind(newId, before.sceneId, oldId, ...g.values),
      db.prepare(`INSERT OR IGNORE INTO job_version_compatibility SELECT j.id,j.project_id,?,?,? FROM jobs j WHERE j.project_id=? AND NOT ${depends} AND EXISTS(SELECT 1 FROM json_each(j.input_refs_json) r WHERE json_extract(r.value,'$.kind')='SCENE_VERSION' AND json_extract(r.value,'$.id')=?) AND ${g.sql}`).bind(before.sceneId, oldId, newId, project, oldId, ...g.values)];
    if (!changed.length) return compatible;
    return [...compatible, ...invalidationStatements(db, project, `(${depends}) AND (j.scene_id=? OR (j.scene_id IS NULL AND j.kind IN('EDIT','QA','RENDER','SEO')) OR EXISTS(SELECT 1 FROM json_each(j.input_refs_json) r WHERE json_extract(r.value,'$.id')=?) OR EXISTS(SELECT 1 FROM job_version_compatibility c WHERE c.job_id=j.id AND c.compatible_with_id=?)) AND COALESCE(json_extract(j.output_ref,'$.id'),'')<>?`, [before.sceneId, oldId, oldId, newId], g, now, mutation)];
  };
}
export function scriptInvalidation(db: Database, project: string, oldId: string | null, newId: string) {
  return (g: PublicationGate) => !oldId || oldId === newId ? [] : [
    ...invalidationStatements(db, project, `(j.kind NOT IN('RESEARCH','SCRIPT','VALIDATE_INPUT') OR (j.kind='SCRIPT' AND j.status='WAITING_APPROVAL')) AND COALESCE(json_extract(j.output_ref,'$.id'),'')<>?`, [newId], g, new Date().toISOString(), crypto.randomUUID()),
    db.prepare(`UPDATE scene_versions SET status='INVALIDATED' WHERE project_id=? AND status IN('CANDIDATE','APPROVED') AND script_version_id<>? AND ${g.sql}`).bind(project, newId, ...g.values),
    db.prepare(`UPDATE scenes SET active_version_id=NULL,revision=revision+1 WHERE project_id=? AND active_version_id IN(SELECT id FROM scene_versions WHERE project_id=? AND script_version_id<>?) AND ${g.sql}`).bind(project, project, newId, ...g.values),
  ];
}
