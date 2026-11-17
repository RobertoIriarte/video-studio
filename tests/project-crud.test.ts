import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHarness } from './support/d1.js';
import { createAuth } from '../apps/api/src/auth/service.js';
import { fixtureId, projectInputFixture } from '@video-studio/testkit';
import { projectDetailSchema, projectListSchema } from '@video-studio/contracts';

let h: Awaited<ReturnType<typeof authHarness>>; let cookie: string;
const owner = fixtureId(800); const email = 'projects@example.invalid';
beforeEach(async () => {
  h = await authHarness(); const password = `Test-${crypto.randomUUID()}`;
  await request('POST', '/bootstrap', { name: 'Fixture', email, password }, '', { authorization: `Bearer ${h.bootstrapToken}`, 'idempotency-key': owner });
  const response = await request('POST', '/auth/sign-in/email', { email, password }, '');
  cookie = response.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
}, 30000);
afterEach(async () => { await h?.dispose(); });
function request(method: string, path: string, body?: unknown, session = cookie, extra: Record<string, string> = {}) {
  return h.fetch(`/api/v1${path}`, { method, headers: { origin: h.origin, 'content-type': 'application/json', cookie: session, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function create(input = projectInputFixture(), key = crypto.randomUUID()) {
  const response = await request('POST', '/projects', input, cookie, { 'idempotency-key': key });
  expect(response.status).toBe(201);
  return projectDetailSchema.parse(await response.json());
}

describe('F2-03 · CRUD y borrador persistido', () => {
  it.each(['TOPIC', 'SCRIPT', 'SOURCES'] as const)('T03 crea, reabre, edita y archiva %s conservando datos', async (inputType) => {
    const input = { ...projectInputFixture(), inputType };
    const p = await create(input);
    expect(projectDetailSchema.parse(await (await request('GET', `/projects/${p.id}`)).json())).toEqual(p);
    const edit = await request('PATCH', `/projects/${p.id}`, { expectedRevision: 1, title: 'Nuevo título', wizardStep: 4, settings: { ...input.settings, mode: 'AUTO' } });
    expect(edit.status).toBe(200); const saved = projectDetailSchema.parse(await edit.json());
    expect(saved).toMatchObject({ title: 'Nuevo título', revision: 2, wizardStep: 4, inputText: input.inputText, settings: { mode: 'AUTO' } });
    expect(projectDetailSchema.parse(await (await request('GET', `/projects/${p.id}`)).json())).toEqual(saved);
    const archiveKey = crypto.randomUUID();
    const archive = () => request('POST', `/projects/${p.id}/archive`, { expectedRevision: 2 }, cookie, { 'idempotency-key': archiveKey });
    const archived = await archive(); expect(archived.status).toBe(200);
    expect(await (await archive()).json()).toEqual(await archived.json());
    expect((await request('GET', `/projects/${p.id}`)).status).toBe(404);
    expect(projectListSchema.parse(await (await request('GET', '/projects')).json()).items).toEqual([]);
    expect(await h.db.prepare('SELECT input_text,status FROM projects WHERE id=?').bind(p.id).first()).toMatchObject({ input_text: input.inputText, status: 'ARCHIVED' });
    expect(await h.db.prepare('SELECT project_id FROM project_settings WHERE project_id=?').bind(p.id).first()).not.toBeNull();
  });

  it('POST repetido/concurrente devuelve mismo snapshot; payload distinto da 409', async () => {
    const key = crypto.randomUUID(); const input = projectInputFixture();
    const responses = await Promise.all([1, 2].map(() => request('POST', '/projects', input, cookie, { 'idempotency-key': key })));
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const [a, b] = await Promise.all(responses.map((r) => r.json())); expect(a).toEqual(b);
    expect((await request('POST', '/projects', { ...input, title: 'Otro' }, cookie, { 'idempotency-key': key })).status).toBe(409);
    expect(await h.db.prepare('SELECT count(*) AS count FROM projects').first()).toEqual({ count: 1 });
  });

  it('CAS concurrente conserva settings coherentes y revisión perdedora no sobrescribe', async () => {
    const p = await create(); const a = { ...p.settings, audience: 'Audiencia A' }; const b = { ...p.settings, audience: 'Audiencia B' };
    const responses = await Promise.all([['A', a], ['B', b]].map(([title, settings]) => request('PATCH', `/projects/${p.id}`, { expectedRevision: 1, title, settings, wizardStep: 3 })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = projectDetailSchema.parse(await (await request('GET', `/projects/${p.id}`)).json());
    expect(current.revision).toBe(2); expect(current.settings.audience).toBe(`Audiencia ${current.title}`);
    const stale = await request('PATCH', `/projects/${p.id}`, { expectedRevision: 1, title: 'Perdedor' });
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: { details: { currentRevision: 2 } } });
  });

  it('valida inputs, Origin, sesión y estado sin aceptar owner ni proveedores ajenos', async () => {
    expect((await request('POST', '/projects', projectInputFixture(), '')).status).toBe(401);
    expect((await request('POST', '/projects', projectInputFixture(), cookie, { origin: 'https://foreign.invalid' })).status).toBe(403);
    for (const input of [{ ...projectInputFixture(), ownerId: owner }, { ...projectInputFixture(), inputText: ' ' }, { ...projectInputFixture(), wizardStep: 6 }, { ...projectInputFixture(), settings: { ...projectInputFixture().settings, providerPolicy: { allowPaidFallback: false, preferredIds: [fixtureId(999)] } } }]) {
      expect((await request('POST', '/projects', input, cookie, { 'idempotency-key': crypto.randomUUID() })).status).toBe(400);
    }
    const p = await create();
    await h.db.prepare("UPDATE projects SET status='RUNNING' WHERE id=?").bind(p.id).run();
    expect((await request('PATCH', `/projects/${p.id}`, { expectedRevision: 1, title: 'No' })).status).toBe(409);
    expect((await request('GET', '/projects?cursor=invalid')).status).toBe(400);
  });

  it('propietario B no lista, edita ni archiva datos de A', async () => {
    const p = await create(); const password = `Test-${crypto.randomUUID()}`;
    await createAuth(h.db, { origin: h.origin, secret: h.secret }, fixtureId(801)).api.signUpEmail({ body: { name: 'B', email: 'b@example.invalid', password } });
    const signed = await request('POST', '/auth/sign-in/email', { email: 'b@example.invalid', password });
    const other = signed.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
    expect(projectListSchema.parse(await (await request('GET', '/projects', undefined, other)).json()).items).toEqual([]);
    expect((await request('PATCH', `/projects/${p.id}`, { expectedRevision: 1, title: 'No' }, other)).status).toBe(404);
    expect((await request('POST', `/projects/${p.id}/archive`, { expectedRevision: 1 }, other, { 'idempotency-key': crypto.randomUUID() })).status).toBe(404);
  });

  it('lista paginada filtra antes de paginar y no expone input largo', async () => {
    for (const title of ['Buscar uno', 'Buscar dos', 'Otro']) await create({ ...projectInputFixture(), title });
    const page = projectListSchema.parse(await (await request('GET', '/projects?q=Buscar&limit=1&status=DRAFT')).json());
    expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeTruthy(); expect(page.items[0]).not.toHaveProperty('inputText');
    const next = projectListSchema.parse(await (await request('GET', `/projects?q=Buscar&limit=1&status=DRAFT&cursor=${encodeURIComponent(page.nextCursor!)}`)).json());
    expect(next.items).toHaveLength(1); expect(next.items[0]?.id).not.toBe(page.items[0]?.id); expect(next.nextCursor).toBeNull();
  });
});
