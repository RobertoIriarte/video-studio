import { changedComponents, sceneComponents } from '@video-studio/domain';
import type { JobInput } from '@video-studio/contracts';
import type { Database } from './db/connection.js';
import { CatalogRepository, catalogHash } from './db/catalog.js';
import { JobConflict, JobRepository, defaultJobRuntime } from './db/jobs.js';
import type { JobRuntime } from './db/jobs.js';
import { sceneHashes } from './db/invalidation.js';

// Un solo plan de escena por tick. Los servicios F5/F6 aún ausentes quedan esperando recurso/manual.
export async function ensureSceneFollowups(db: Database, owner: string, project: string, runtime: JobRuntime = defaultJobRuntime) {
  const jobs = new JobRepository(db, runtime); await jobs.project(owner, project);
  const row = await db.prepare("SELECT s.active_version_id FROM scenes s JOIN scene_versions v ON v.id=s.active_version_id WHERE s.project_id=? AND v.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM scene_expansions e WHERE e.scene_version_id=v.id) ORDER BY s.order_index,s.id LIMIT 1").bind(project).first<{ active_version_id: string }>();
  if (!row) return;
  const catalog = new CatalogRepository(db); const version = (await catalog.getSceneVersion(owner, project, row.active_version_id))!;
  const parent = version.parentVersionId ? await catalog.getSceneVersion(owner, project, version.parentVersionId) : null;
  const changed = parent ? changedComponents(await sceneHashes(parent), await sceneHashes(version)) : [...sceneComponents];
  const scene = (await catalog.getScene(owner, project, version.sceneId))!; const plan: { kind: JobInput['kind']; target: JobInput['executionTarget']; scope: string }[] = [];
  if (version.direction.narrationReviewRequired === true) plan.push({ kind: 'DIRECTION', target: 'CLOUD', scope: 'VISUAL' });
  if ((!parent || changed.includes('NARRATION')) && !version.assetLinks.some((l) => l.role === 'VOICE')) plan.push({ kind: 'VOICE', target: 'CLOUD', scope: 'VOICE' });
  const invalidVisual = version.shots.some((s) => !s.assetId) || !!await db.prepare("SELECT t.id FROM shots t JOIN assets a ON a.id=t.asset_id AND a.project_id=t.project_id WHERE t.scene_version_id=? AND (a.availability='MISSING' OR (t.type='VIDEO' AND (a.duration_ms IS NULL OR a.duration_ms<t.duration_ms))) LIMIT 1").bind(version.id).first();
  if ((!parent || changed.some((c) => ['NARRATION', 'VISUAL', 'TIMING'].includes(c))) && invalidVisual) plan.push({ kind: 'ASSET', target: 'CLOUD', scope: 'VISUAL' });
  if (parent && changed.includes('VOICE') && !changed.includes('NARRATION') && !version.voiceSegments.length) plan.push({ kind: 'ALIGNMENT', target: 'LOCAL', scope: 'VOICE' });
  if (parent && changed.some((c) => ['MUSIC', 'AMBIENCE', 'EDIT'].includes(c))) plan.push({ kind: 'EDIT', target: 'LOCAL', scope: 'EDIT' });
  let direction: string | undefined;
  for (const item of plan) {
    const hash = await catalogHash({ versionId: version.id, kind: item.kind, scope: item.scope });
    const operation = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const refs: JobInput['inputRefs'] = [{ kind: 'SCENE_VERSION', id: version.id, hash: version.contentHash }];
    if (item.kind === 'DIRECTION') { const script = (await catalog.getScript(owner, project, version.scriptVersionId))!; refs.unshift({ kind: 'SCRIPT', id: script.id, hash: script.contentHash }); }
    try {
      const job = await jobs.create(owner, project, operation, { kind: item.kind, executionTarget: item.target, sceneId: scene.id, inputRefs: refs, dependencies: direction && item.kind !== 'DIRECTION' ? [direction] : [], payload: { sectionKey: scene.stableKey, scope: item.scope, regeneration: item.kind === 'DIRECTION', followupVersionId: version.id } }, { activeSceneVersionId: version.id });
      if (item.kind === 'DIRECTION') direction = job.id;
    } catch (error) { if (error instanceof JobConflict) return; throw error; }
  }
  await db.prepare('INSERT OR IGNORE INTO scene_expansions VALUES (?,?)').bind(version.id, jobs.timestamp()).run();
}
