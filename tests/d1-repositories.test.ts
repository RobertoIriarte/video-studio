import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureId, FIXTURE_TIMESTAMP, projectInputFixture, projectSettingsFixture } from '@video-studio/testkit';
import { ProjectRepository, RepositoryDataError, SettingsRepository, UserRepository } from '../apps/api/src/db/repositories.js';
import { applyMigrations, d1Harness, migrations } from './support/d1.js';
import type { Database } from '../apps/api/src/db/connection.js';

let harness: Awaited<ReturnType<typeof d1Harness>> | undefined;
let db: Database;
const ownerA = fixtureId(1001);
const ownerB = fixtureId(1002);
const projectId = fixtureId(1);

beforeEach(async () => { harness = await d1Harness(); db = harness.db; }, 30_000);
afterEach(async () => { await harness?.dispose(); harness = undefined; });

async function seedOwners() {
  await db.batch([ownerA, ownerB].map((id, index) => db.prepare(
    'INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)',
  ).bind(id, `Propietario ${index}`, `owner-${index}@example.invalid`, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP)));
}

async function count(table: 'projects' | 'project_settings' | 'user') {
  const row = await db.prepare(`SELECT count(*) AS count FROM "${table}"`).first<{ count: number }>();
  return row?.count;
}

const context = (id = projectId) => ({ id, now: FIXTURE_TIMESTAMP });

describe('migraciones D1 reales, efímeras y locales', () => {
  it('crea desde vacío tablas, FK e índices previstos', async () => {
    await applyMigrations(db);
    const schema = await db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all<{ name: string; type: string }>();
    expect(schema.results).toEqual(expect.arrayContaining([
      { name: 'user', type: 'table' }, { name: 'projects', type: 'table' }, { name: 'project_settings', type: 'table' },
      { name: 'projects_owner_updated_id', type: 'index' }, { name: 'projects_owner_status_updated_id', type: 'index' },
    ]));
    expect((await db.prepare('PRAGMA foreign_key_list(projects)').all<{ table: string }>()).results)
      .toEqual(expect.arrayContaining([expect.objectContaining({ table: 'user' })]));
    expect((await db.prepare('PRAGMA foreign_key_list(project_settings)').all<{ table: string }>()).results)
      .toEqual(expect.arrayContaining([expect.objectContaining({ table: 'projects' })]));
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });

  it('upgrade 0003→0005 conserva identidad, proyecto y settings existentes', async () => {
    await applyMigrations(db, migrations.slice(0, 3));
    await seedOwners();
    const projects = new ProjectRepository(db);
    const before = await projects.create(ownerA, projectInputFixture(), context());
    await applyMigrations(db, migrations.slice(3));
    expect(await projects.get(ownerA, projectId)).toEqual(before);
    expect(await count('user')).toBe(2);
    expect(await count('projects')).toBe(1);
    expect(await count('project_settings')).toBe(1);
    const plan = await db.prepare('EXPLAIN QUERY PLAN SELECT id FROM projects WHERE owner_id = ? ORDER BY updated_at DESC,id DESC LIMIT 25')
      .bind(ownerA).all<{ detail: string }>();
    expect(plan.results.some((row) => row.detail.includes('projects_owner_updated_id'))).toBe(true);
  });
});

describe('repositorios D1 base', () => {
  beforeEach(async () => { await applyMigrations(db); await seedOwners(); });

  it('lee identidad sin inventar sesión ni exponer credenciales', async () => {
    const users = new UserRepository(db);
    expect(await users.getById(ownerA)).toEqual({
      id: ownerA, name: 'Propietario 0', email: 'owner-0@example.invalid', emailVerified: false, image: null,
    });
    expect(await users.getById(fixtureId(999))).toBeNull();
  });

  it.each(['TOPIC', 'SCRIPT', 'SOURCES'] as const)('persiste y valida proyecto/settings %s sin cambiar el DTO público', async (inputType) => {
    const projects = new ProjectRepository(db);
    const input = projectInputFixture({ inputType });
    const created = await projects.create(ownerA, input, context());
    expect(await projects.get(ownerA, projectId)).toEqual(created);
    expect(created.project).toMatchObject({ id: projectId, inputType, status: 'DRAFT', revision: 1, settings: input.settings });
    expect(created.inputText).toBe(input.inputText);
    expect(await new SettingsRepository(db).get(ownerA, projectId)).toEqual({ settings: input.settings, revision: 1 });
    expect(await count('projects')).toBe(1);
    expect(await count('project_settings')).toBe(1);
  });

  it('otro propietario no puede leer proyecto ni settings ni verlo en su lista', async () => {
    const projects = new ProjectRepository(db);
    await projects.create(ownerA, projectInputFixture(), context());
    expect(await projects.get(ownerB, projectId)).toBeNull();
    expect(await new SettingsRepository(db).get(ownerB, projectId)).toBeNull();
    expect(await projects.list(ownerB)).toEqual([]);
  });

  it('paginación estable por fecha/id sin duplicar ni cargar texto largo', async () => {
    const projects = new ProjectRepository(db);
    for (const index of [1, 2, 3, 4, 5]) await projects.create(index === 2 ? ownerB : ownerA,
      projectInputFixture(), context(fixtureId(index)));
    const first = await projects.list(ownerA, { limit: 2 });
    expect(first.map((item) => item.id)).toEqual([fixtureId(5), fixtureId(4)]);
    expect(first[0]).not.toHaveProperty('inputText');
    const last = first.at(-1);
    if (!last) throw new Error('Falta cursor de muestra.');
    const second = await projects.list(ownerA, { limit: 2, after: { id: last.id, updatedAt: last.updatedAt } });
    expect(second.map((item) => item.id)).toEqual([fixtureId(3), fixtureId(1)]);
    expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(4);
    await expect(projects.list(ownerA, { limit: 101 })).rejects.toThrow();
  });

  it('excluye archivados sin borrar filas ni recursos', async () => {
    const projects = new ProjectRepository(db);
    await projects.create(ownerA, projectInputFixture(), context());
    await db.prepare("UPDATE projects SET status = 'ARCHIVED', archived_at = ? WHERE id = ?")
      .bind(FIXTURE_TIMESTAMP, projectId).run();
    expect(await projects.get(ownerA, projectId)).toBeNull();
    expect(await new SettingsRepository(db).get(ownerA, projectId)).toBeNull();
    expect(await projects.list(ownerA)).toEqual([]);
    expect(await count('projects')).toBe(1);
    expect(await count('project_settings')).toBe(1);
  });

  it('rollback de la creación completa si falla la segunda sentencia', async () => {
    await db.prepare(`CREATE TRIGGER fixture_fail_settings BEFORE INSERT ON project_settings
      BEGIN SELECT RAISE(ABORT,'fixture_settings_failure'); END`).run();
    const projects = new ProjectRepository(db);
    await expect(projects.create(ownerA, projectInputFixture(), context())).rejects.toThrow();
    expect(await count('projects')).toBe(0);
    expect(await count('project_settings')).toBe(0);
    expect(await count('user')).toBe(2);
  });

  it('rechaza FK inexistente e identidad/proyecto duplicados sin escrituras parciales', async () => {
    const projects = new ProjectRepository(db);
    await expect(projects.create(fixtureId(999), projectInputFixture(), context())).rejects.toThrow();
    expect(await count('projects')).toBe(0);
    const initial = await projects.create(ownerA, projectInputFixture(), context());
    await expect(projects.create(ownerB, projectInputFixture({ title: 'No reemplazar' }), context())).rejects.toThrow();
    expect(await projects.get(ownerA, projectId)).toEqual(initial);
    await expect(db.prepare('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)')
      .bind(fixtureId(888), 'Otro', 'OWNER-0@EXAMPLE.INVALID', FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run()).rejects.toThrow();
  });

  it('enlaza valores SQL y valida antes de escribir', async () => {
    const projects = new ProjectRepository(db);
    const input = projectInputFixture({ title: "'); DROP TABLE projects; --", inputText: "SELECT * FROM user; '" });
    const created = await projects.create(ownerA, input, { id: projectId, now: '2026-11-17T00:00:00Z' });
    expect(created.project.createdAt).toBe(FIXTURE_TIMESTAMP);
    expect((await projects.get(ownerA, projectId))?.project.title).toBe(input.title);
    expect(await count('user')).toBe(2);
    await expect(projects.create(ownerA, projectInputFixture({ settings: projectSettingsFixture({ targetDurationMs: 0 }) }), context(fixtureId(2)))).rejects.toThrow();
    expect(await count('projects')).toBe(1);
  });

  it('JSON inválido semánticamente o settings ausentes fallan con error seguro al leer', async () => {
    const projects = new ProjectRepository(db);
    await projects.create(ownerA, projectInputFixture(), context());
    await db.prepare('UPDATE project_settings SET provider_policy_json = ? WHERE project_id = ?')
      .bind('{"allowPaidFallback":false,"preferredIds":[],"secret":"private-marker"}', projectId).run();
    await expect(projects.get(ownerA, projectId)).rejects.toThrow(new RepositoryDataError());
    await expect(new SettingsRepository(db).get(ownerA, projectId)).rejects.toThrow('REPOSITORY_DATA_INVALID');
    expect(await projects.get(ownerB, projectId)).toBeNull();
    await db.prepare('DELETE FROM project_settings WHERE project_id = ?').bind(projectId).run();
    await expect(projects.get(ownerA, projectId)).rejects.toThrow('REPOSITORY_DATA_INVALID');
  });

  it.each([
    ['projects', 'input_type', 'UNKNOWN'], ['projects', 'mode', 'MANUAL'], ['projects', 'status', 'UNKNOWN'],
    ['projects', 'revision', 0], ['projects', 'revision', 1.5], ['projects', 'title', ' '],
    ['project_settings', 'target_duration_ms', -1], ['project_settings', 'target_duration_ms', 0],
    ['project_settings', 'target_duration_ms', 1.5], ['project_settings', 'max_cost_micros', -1],
    ['project_settings', 'max_cost_micros', Number.MAX_SAFE_INTEGER + 1],
    ['project_settings', 'style', 'UNKNOWN'], ['project_settings', 'modality', 'UNKNOWN'],
    ['project_settings', 'objective', 'SHORT'], ['project_settings', 'style_version', 0],
    ['project_settings', 'checkpoint_policy_json', '{}'], ['project_settings', 'provider_policy_json', '{}'],
    ['project_settings', 'provider_policy_json', '{"allowPaidFallback":0,"preferredIds":[]}'],
    ['project_settings', 'storage_policy_json', '[]'],
  ] as const)('constraint SQL %s.%s rechaza %s', async (table, column, value) => {
    await new ProjectRepository(db).create(ownerA, projectInputFixture(), context());
    // Tabla/columna provienen exclusivamente de la matriz constante del test.
    const key = table === 'projects' ? 'id' : 'project_id';
    await expect(db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`).bind(value, projectId).run()).rejects.toThrow();
  });

  it('impide borrar usuario/proyecto con dependencias y booleanos de identidad inválidos', async () => {
    await new ProjectRepository(db).create(ownerA, projectInputFixture(), context());
    await expect(db.prepare('DELETE FROM "user" WHERE id = ?').bind(ownerA).run()).rejects.toThrow();
    await expect(db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run()).rejects.toThrow();
    await expect(db.prepare('UPDATE "user" SET emailVerified = 2 WHERE id = ?').bind(ownerA).run()).rejects.toThrow();
  });
});
