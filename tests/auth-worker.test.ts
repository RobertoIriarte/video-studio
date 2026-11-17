import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authHarness } from './support/d1.js';
import { createAuth } from '../apps/api/src/auth/service.js';
import { payloadHash } from '../apps/api/src/auth/routes.js';
import { ProjectRepository } from '../apps/api/src/db/repositories.js';
import { fixtureId, FIXTURE_TIMESTAMP, projectInputFixture } from '@video-studio/testkit';

let h: Awaited<ReturnType<typeof authHarness>>;
let password: string;
const operation = fixtureId(400);
const email = 'owner@example.invalid';
beforeEach(async () => { h = await authHarness(); password = `A-${crypto.randomUUID()}`; }, 30000);
afterEach(async () => { await h?.dispose(); });

function post(path: string, body: unknown, extra: Record<string, string> = {}) {
  return h.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', origin: h.origin, ...extra }, body: JSON.stringify(body) });
}
const bootBody = () => ({ name: 'Propietario de prueba', email, password });
const bootstrap = (key = operation, body = bootBody()) => post('/api/v1/bootstrap', body, { authorization: `Bearer ${h.bootstrapToken}`, 'idempotency-key': key });
async function login(address = email, secret = password) {
  const response = await post('/api/v1/auth/sign-in/email', { email: address, password: secret });
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  return { response, cookie };
}

describe('F2-02 · Better Auth/D1 real en workerd', () => {
  it('bootstrap explícito, cookie HttpOnly y sesión sin exponer token; logout revoca', async () => {
    expect((await h.fetch('/api/v1/me')).status).toBe(401);
    expect((await bootstrap()).status).toBe(200);
    const signed = await login();
    expect(signed.response.status).toBe(200);
    expect(await signed.response.json()).toEqual({ ok: true });
    expect(signed.response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(signed.response.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    const me = await h.fetch('/api/v1/me', { headers: { cookie: signed.cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: { id: operation, name: 'Propietario de prueba', email } });
    expect((await post('/api/v1/auth/sign-out', {}, { cookie: signed.cookie })).status).toBe(200);
    expect((await h.fetch('/api/v1/me', { headers: { cookie: signed.cookie } })).status).toBe(401);
  }, 30000);

  it('registro público cerrado, bootstrap único e idempotencia sin guardar password cruda', async () => {
    expect((await post('/api/v1/auth/sign-up/email', bootBody())).status).toBe(404);
    expect((await bootstrap()).status).toBe(200);
    expect((await bootstrap()).status).toBe(200);
    expect((await bootstrap(fixtureId(401))).status).toBe(409);
    expect((await bootstrap(operation, { ...bootBody(), name: 'Otro' })).status).toBe(409);
    const stored = await h.db.prepare('SELECT password FROM account').first<{ password: string }>();
    expect(stored?.password).not.toBe(password);
    expect(stored?.password).toBeTruthy();
    expect((await h.db.prepare('SELECT count(*) AS count FROM "user"').first<{ count: number }>())?.count).toBe(1);
  });

  it('rechaza origen ajeno, token incorrecto y respuestas de login que enumeren usuarios', async () => {
    expect((await post('/api/v1/bootstrap', bootBody(), { origin: 'https://other.invalid' })).status).toBe(403);
    expect((await post('/api/v1/bootstrap', bootBody(), { authorization: 'Bearer invalid' })).status).toBe(403);
    expect((await bootstrap()).status).toBe(200);
    const wrong = await login(email, `Wrong-${crypto.randomUUID()}`);
    const absent = await login('absent@example.invalid', password);
    expect(wrong.response.status).toBe(401);
    expect(absent.response.status).toBe(401);
    const a = await wrong.response.json() as { error: { message: string; code: string } };
    const b = await absent.response.json() as { error: { message: string; code: string } };
    expect(a.error.message).toBe(b.error.message);
    expect(a.error.code).toBe(b.error.code);
    expect((await post('/api/v1/auth/sign-in/email', { email, password }, { origin: 'https://other.invalid' })).status).toBe(403);
  });

  it('dos sesiones no acceden al proyecto del otro usuario (T02)', async () => {
    expect((await bootstrap()).status).toBe(200);
    const otherId = fixtureId(402);
    const otherEmail = 'second@example.invalid';
    // Identidad adicional exclusiva del fixture, mediante SDK servidor real.
    await createAuth(h.db, { origin: h.origin, secret: h.secret }, otherId).api.signUpEmail({ body: { name: 'Segundo', email: otherEmail, password } });
    await new ProjectRepository(h.db).create(operation, projectInputFixture(), { id: fixtureId(403), now: FIXTURE_TIMESTAMP });
    const own = await login();
    const other = await login(otherEmail);
    expect((await h.fetch(`/api/v1/projects/${fixtureId(403)}`, { headers: { cookie: own.cookie } })).status).toBe(200);
    expect((await h.fetch(`/api/v1/projects/${fixtureId(403)}`, { headers: { cookie: other.cookie } })).status).toBe(404);
    expect((await h.fetch(`/api/v1/projects/${fixtureId(403)}`)).status).toBe(401);
  });

  it('sesión expirada y cookie manipulada no autentican', async () => {
    await bootstrap();
    const signed = await login();
    await h.db.prepare('UPDATE session SET expiresAt = ?').bind('2000-01-01T00:00:00.000Z').run();
    expect((await h.fetch('/api/v1/me', { headers: { cookie: signed.cookie } })).status).toBe(401);
    expect((await h.fetch('/api/v1/me', { headers: { cookie: `${signed.cookie}x` } })).status).toBe(401);
  });

  it('recupera bootstrap parcial con la misma clave y credenciales sin borrar identidad', async () => {
    await h.db.prepare('INSERT INTO "user" (id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
      .bind(operation, bootBody().name, email, FIXTURE_TIMESTAMP, FIXTURE_TIMESTAMP).run();
    await h.db.prepare("INSERT INTO owner_bootstrap (singleton,operation_id,payload_hash,state,created_at) VALUES (1,?,?,'CLAIMED',?)")
      .bind(operation, await payloadHash(h.secret, bootBody()), FIXTURE_TIMESTAMP).run();
    expect((await bootstrap()).status).toBe(200);
    expect((await login()).response.status).toBe(200);
  });

  it('rate limit de login persistente ignora cabeceras IP elegidas por cliente', async () => {
    await bootstrap();
    const statuses: number[] = [];
    for (let index = 0; index < 12; index++) statuses.push((await post('/api/v1/auth/sign-in/email', { email, password: 'invalid-password' }, { 'x-forwarded-for': `10.0.0.${index}` })).status);
    expect(statuses).toContain(429);
  }, 30000);
});
