import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, d1Harness, migrations } from './support/d1.js';
import { CatalogConflict, CatalogNotFound, CatalogRepository, catalogHash } from '../apps/api/src/db/catalog.js';
import { ProjectRepository, RepositoryDataError } from '../apps/api/src/db/repositories.js';
import { ProjectCrudRepository, ProjectConflict } from '../apps/api/src/db/project-crud.js';
import { assetFixture, fixtureId, FIXTURE_TIMESTAMP, projectInputFixture, researchFixture, sceneVersionFixture, scriptFixture } from '@video-studio/testkit';
import { assetInputSchema, sceneVersionInputSchema } from '@video-studio/contracts';

let h: Awaited<ReturnType<typeof d1Harness>>; let repo: CatalogRepository;
const owner = fixtureId(1001); const other = fixtureId(1002); const project = fixtureId(2001); const second = fixtureId(2002); const foreign = fixtureId(2003);
async function seed() {
  for (const [i, id] of [owner, other].entries()) await h.db.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)').bind(id, 'Fixture', `catalog-${i}@example.invalid`, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
  const projects = new ProjectRepository(h.db);
  for (const [id, user] of [[project, owner], [second, owner], [foreign, other]]) await projects.create(user!, projectInputFixture(), { id: id!, now: FIXTURE_TIMESTAMP });
}
beforeEach(async () => { h = await d1Harness(); await applyMigrations(h.db); await seed(); repo = new CatalogRepository(h.db); }, 30000);
afterEach(async () => { await h?.dispose(); });
async function graph() {
  const researchInput = researchFixture();
  researchInput.sources[0]!.acquiredAt = '2026-11-17T00:00:00Z';
  const research = await repo.createResearch(owner, project, researchInput);
  const script = await repo.createScript(owner, project, scriptFixture(research.id));
  const asset = await repo.createAsset(owner, project, assetFixture());
  const scene = await repo.createScene(owner, project, { stableKey: 'opening', orderIndex: 0 });
  const input = sceneVersionFixture(script.id); input.shots[0]!.assetId = asset.id;
  input.assetLinks.push({ assetId: asset.id, role: 'VISUAL', offsetMs: 0, trimStartMs: 0, trimEndMs: null });
  const version = await repo.createSceneVersion(owner, project, scene.id, input);
  return { research, script, asset, scene, version };
}

describe('F2-04 · catálogo D1 real', { timeout: 30000 }, () => {
  it('graph completo, candidatas, hashes estables, metadatos MISSING y FK válidas', async () => {
    const g = await graph();
    expect(g.research.status).toBe('CANDIDATE'); expect(g.script.versionNo).toBe(1); expect(g.version.status).toBe('CANDIDATE');
    expect(g.research.sources[0]?.acquiredAt).toBe(FIXTURE_TIMESTAMP);
    expect(g.version.shots).toHaveLength(1); expect(g.version.assetLinks[0]?.assetId).toBe(g.asset.id);
    expect(g.asset.availability).toBe('MISSING'); expect(g.asset).not.toHaveProperty('r2Key');
    expect(await repo.getResearch(owner, project, g.research.id)).toEqual(g.research);
    expect(await repo.getSceneVersion(owner, project, g.version.id)).toEqual(g.version);
    expect((await repo.getScene(owner, project, g.scene.id))?.activeVersionId).toBeNull();
    expect(await catalogHash({ b: 2, a: 1 })).toBe(await catalogHash({ a: 1, b: 2 }));
    expect((await h.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });

  it('activación explícita CAS conserva versiones, fuentes, shots y links anteriores', async () => {
    const g = await graph(); await repo.approveResearch(owner, project, g.research.id);
    await repo.activateScript(owner, project, g.script.id, 1);
    const first = await repo.activateSceneVersion(owner, project, g.scene.id, g.version.id, 1);
    expect(first.activeVersionId).toBe(g.version.id); expect(first.revision).toBe(2);
    const input = { ...sceneVersionFixture(g.script.id), parentVersionId: g.version.id, narration: 'Nueva narración.' };
    const candidate = await repo.createSceneVersion(owner, project, g.scene.id, input);
    expect(candidate.versionNo).toBe(2); expect((await repo.getScene(owner, project, g.scene.id))?.activeVersionId).toBe(g.version.id);
    await expect(repo.activateSceneVersion(owner, project, g.scene.id, candidate.id, 1)).rejects.toBeInstanceOf(CatalogConflict);
    await repo.activateSceneVersion(owner, project, g.scene.id, candidate.id, 2);
    const old = await repo.getSceneVersion(owner, project, g.version.id);
    expect(old).toEqual({ ...g.version, status: 'SUPERSEDED' });
    expect((await repo.getSceneVersion(owner, project, candidate.id))?.status).toBe('APPROVED');
  });

  it('SQL impide mutar/borrar contenido publicado y reabrir una versión', async () => {
    const g = await graph(); await repo.activateScript(owner, project, g.script.id, 1); await repo.activateSceneVersion(owner, project, g.scene.id, g.version.id, 1);
    for (const [sql, id] of [
      ["UPDATE research_versions SET data_json='{}' WHERE id=?", g.research.id],
      ["UPDATE script_versions SET script_json='{}' WHERE id=?", g.script.id],
      ["UPDATE scene_versions SET narration='mutado' WHERE id=?", g.version.id],
      ["UPDATE sources SET notes='mutado' WHERE research_version_id=?", g.research.id],
      ["UPDATE shots SET prompt='mutado' WHERE scene_version_id=?", g.version.id],
      ["DELETE FROM asset_links WHERE scene_version_id=?", g.version.id],
      ["DELETE FROM scene_versions WHERE id=?", g.version.id],
      ["UPDATE scene_versions SET status='DRAFT' WHERE id=?", g.version.id],
      ["UPDATE assets SET checksum='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE id=?", g.asset.id],
    ]) await expect(h.db.prepare(sql!).bind(id).run()).rejects.toThrow();
    await expect(h.db.prepare('INSERT INTO shots VALUES (?,?,?,?,?,?,?,?,?,?)').bind(fixtureId(3000), project, g.version.id, 1, 1, 'IMAGE', '', '{}', '{}', null).run()).rejects.toThrow();
    expect((await repo.getSceneVersion(owner, project, g.version.id))?.narration).toBe(g.version.narration);
  });

  it('owner y relaciones del mismo propietario también deben ser del mismo proyecto', async () => {
    const g = await graph();
    expect(await repo.getScript(other, project, g.script.id)).toBeNull(); expect(await repo.getAsset(owner, second, g.asset.id)).toBeNull();
    await expect(repo.createResearch(other, project, researchFixture())).rejects.toBeInstanceOf(CatalogNotFound);
    await expect(repo.createScript(owner, second, scriptFixture(g.research.id))).rejects.toBeInstanceOf(CatalogNotFound);
    const script = await repo.createScript(owner, second, scriptFixture()); const scene = await repo.createScene(owner, second, { stableKey: 'other', orderIndex: 0 });
    const input = sceneVersionFixture(script.id); input.shots[0]!.assetId = g.asset.id;
    await expect(repo.createSceneVersion(owner, second, scene.id, input)).rejects.toBeInstanceOf(CatalogNotFound);
    await expect(h.db.prepare('INSERT INTO assets SELECT ?,project_id,?,type,mime,bytes,checksum,duration_ms,width,height,origin,provider_id,generation_id,license_json,prompt,r2_key,availability,created_at FROM assets WHERE id=?').bind(fixtureId(3001), other, g.asset.id).run()).rejects.toThrow();
    await repo.activateScript(owner, project, g.script.id, 1);
    await expect(h.db.prepare("UPDATE projects SET active_script_version_id=? WHERE id=?").bind(g.script.id, second).run()).rejects.toThrow();
    await expect(h.db.prepare('UPDATE projects SET owner_id=? WHERE id=?').bind(other, project).run()).rejects.toThrow();
  });

  it('FKs SQL bloquean research/script/parent/asset de otro proyecto aun fuera del repositorio', async () => {
    const g = await graph(); const script = await repo.createScript(owner, second, scriptFixture()); const scene = await repo.createScene(owner, second, { stableKey: 'other', orderIndex: 0 });
    await expect(h.db.prepare(`INSERT INTO script_versions (id,project_id,research_version_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) VALUES (?,?,?,2,'{}',?,1,'CANDIDATE',?)`).bind(fixtureId(3100), second, g.research.id, 'a'.repeat(64), FIXTURE_TIMESTAMP).run()).rejects.toThrow();
    const insert = (scriptId: string, parentId: string | null) => h.db.prepare(`INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,parent_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at) VALUES (?,?,?,?,?,1,'','{}',1,'ALL','DRAFT',?,?)`).bind(fixtureId(3101), second, scene.id, scriptId, parentId, 'a'.repeat(64), FIXTURE_TIMESTAMP).run();
    await expect(insert(g.script.id, null)).rejects.toThrow(); await expect(insert(script.id, g.version.id)).rejects.toThrow();
    await insert(script.id, null); // DRAFT: el guard de publicación todavía permite hijos.
    await expect(h.db.prepare('INSERT INTO asset_links VALUES (?,?,?,?,?,?,?,?)').bind(fixtureId(3102), second, fixtureId(3101), g.asset.id, 'VISUAL', 0, 0, null).run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(h.db.prepare('INSERT INTO shots VALUES (?,?,?,?,?,?,?,?,?,?)').bind(fixtureId(3103), second, fixtureId(3101), 0, 1, 'IMAGE', '', '{}', '{}', g.asset.id).run()).rejects.toThrow(/FOREIGN KEY/);
    expect((await h.db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });

  it('version_no concurrente único y activar guion con CAS no pisa otra aprobación', async () => {
    const versions = await Promise.all([1, 2, 3].map(() => repo.createScript(owner, project, scriptFixture())));
    expect(versions.map((v) => v.versionNo).sort()).toEqual([1, 2, 3]);
    const results = await Promise.allSettled(versions.slice(0, 2).map((v) => repo.activateScript(owner, project, v.id, 1)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const approved = await h.db.prepare("SELECT count(*) AS n FROM script_versions WHERE project_id=? AND status='APPROVED'").bind(project).first(); expect(approved).toEqual({ n: 1 });
    const next = versions[2]!; await repo.activateScript(owner, project, next.id, 2);
    expect((await repo.getScript(owner, project, next.id))?.status).toBe('APPROVED');
  });

  it('parent obsoleto o guion diferente al activo bloquean activación; no hay invalidación prematura', async () => {
    const g = await graph(); await repo.activateScript(owner, project, g.script.id, 1); await repo.activateSceneVersion(owner, project, g.scene.id, g.version.id, 1);
    const stale = await repo.createSceneVersion(owner, project, g.scene.id, sceneVersionFixture(g.script.id));
    await expect(repo.activateSceneVersion(owner, project, g.scene.id, stale.id, 2)).rejects.toBeInstanceOf(CatalogConflict);
    const nextScript = await repo.createScript(owner, project, scriptFixture());
    await expect(repo.activateScript(owner, project, nextScript.id, 2)).rejects.toBeInstanceOf(CatalogConflict);
    const otherScene = await repo.createScene(owner, project, { stableKey: 'next', orderIndex: 1 });
    const candidate = await repo.createSceneVersion(owner, project, otherScene.id, sceneVersionFixture(nextScript.id));
    await expect(repo.activateSceneVersion(owner, project, otherScene.id, candidate.id, 1)).rejects.toBeInstanceOf(CatalogConflict);
    expect((await repo.getSceneVersion(owner, project, candidate.id))?.status).toBe('CANDIDATE');
    await expect(new ProjectCrudRepository(h.db).update(owner, project, { expectedRevision: 2, title: 'Cambio con guion activo' })).rejects.toBeInstanceOf(ProjectConflict);
    const research = await repo.createResearch(owner, second, researchFixture());
    const invalidatedScript = await repo.createScript(owner, second, scriptFixture(research.id));
    await h.db.prepare("UPDATE research_versions SET status='INVALIDATED' WHERE id=?").bind(research.id).run();
    await expect(repo.activateScript(owner, second, invalidatedScript.id, 1)).rejects.toBeInstanceOf(CatalogConflict);
  });

  it('upgrade F2-03 conserva proyecto/recibos y agrega FK nullable sin reescritura', async () => {
    const isolated = await d1Harness();
    try {
      await applyMigrations(isolated.db, migrations.slice(0, 18));
      await isolated.db.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)').bind(owner, 'Fixture', 'upgrade@example.invalid', FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
      const projects = new ProjectRepository(isolated.db); const before = await projects.create(owner, projectInputFixture(), { id: project, now: FIXTURE_TIMESTAMP });
      await isolated.db.prepare('INSERT INTO project_operations VALUES (?,?,?,?,201)').bind(owner, fixtureId(4000), 'fixture', '{}').run();
      await applyMigrations(isolated.db, migrations.slice(18));
      expect(await projects.get(owner, project)).toEqual(before);
      expect(await isolated.db.prepare('SELECT active_script_version_id FROM projects WHERE id=?').bind(project).first()).toEqual({ active_script_version_id: null });
      expect(await isolated.db.prepare('SELECT count(*) AS n FROM project_operations').first()).toEqual({ n: 1 });
    } finally { await isolated.dispose(); }
  });

  it('validación semántica, JSON seguro y páginas de catálogo aisladas', async () => {
    const g = await graph();
    expect(sceneVersionInputSchema.safeParse({ ...sceneVersionFixture(g.script.id), durationMs: 1 }).success).toBe(false);
    expect(assetInputSchema.safeParse({ ...assetFixture(), type: 'AUDIO' }).success).toBe(false);
    const otherAsset = await repo.createAsset(owner, project, assetFixture()); const first = await repo.list(owner, project, 'asset', { limit: 1 });
    const next = await repo.list(owner, project, 'asset', { limit: 1, afterId: first.nextId! });
    expect(new Set([...first.items, ...next.items])).toEqual(new Set([g.asset.id, otherAsset.id])); expect(next.nextId).toBeNull();
    await expect(repo.list(other, project, 'asset')).rejects.toBeInstanceOf(CatalogNotFound);
    // availability puede cambiar, payload binario/identidad no. Corrupción fuera del contrato se rechaza al leer.
    await h.db.prepare("UPDATE assets SET availability='LOCAL_ONLY' WHERE id=?").bind(g.asset.id).run();
    expect((await repo.getAsset(owner, project, g.asset.id))?.availability).toBe('LOCAL_ONLY');
    await expect(h.db.prepare('INSERT INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,?,?,1)').bind('invalid', project, 'invalid', 0).run()).rejects.toThrow();
    const corruptId = fixtureId(5000);
    // trim de SQLite elimina espacios; el contrato también rechaza tabs vacíos.
    await h.db.prepare('INSERT INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,?,?,1)').bind(corruptId, project, '\t', 0).run();
    await expect(repo.getScene(owner, project, corruptId)).rejects.toBeInstanceOf(RepositoryDataError);
  });
});
