import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bytesHash, importDtoSchema, inspectMedia, assetSchema, assetAccessSchema, projectDetailSchema } from '@video-studio/contracts';
import { pngFixture, wavFixture } from './support/media.js';
import { authHarness } from './support/d1.js';
import { projectInputFixture, fixtureId } from '@video-studio/testkit';
import { assetTicket, verifyAssetTicket } from '../apps/api/src/media-routes.js';
import { createAuth } from '../apps/api/src/auth/service.js';

let h: Awaited<ReturnType<typeof authHarness>>; let cookie: string; let project: string;
function request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) { return h.fetch(`/api/v1${path}`, { method, headers: { cookie, origin: h.origin, 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
beforeEach(async () => {
  h = await authHarness(); const password = `Fixture-${crypto.randomUUID()}`;
  const boot = await request('POST', '/bootstrap', { name: 'Media', email: 'media@example.invalid', password }, { authorization: `Bearer ${h.bootstrapToken}`, 'idempotency-key': crypto.randomUUID() }); expect(boot.status).toBe(200);
  const login = await request('POST', '/auth/sign-in/email', { email: 'media@example.invalid', password }); cookie = login.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
  const created = await request('POST', '/projects', projectInputFixture(), { 'idempotency-key': crypto.randomUUID() }); project = projectDetailSchema.parse(await created.json()).id;
}, 30000);
afterEach(async () => { await h?.dispose(); cookie = ''; });
async function intent(bytes: Uint8Array, mime = 'image/png', key = crypto.randomUUID(), extra: Record<string, unknown> = {}) {
  const body = { projectId: project, mime, bytes: bytes.length, checksum: await bytesHash(bytes), license: { source: 'Fixture propio', note: 'Sin derechos externos.', rightsAcknowledged: true }, prompt: null, ...extra };
  return { response: await request('POST', '/assets/import', body, { 'idempotency-key': key }), body, key };
}
function upload(id: string, bytes: Uint8Array, headers: Record<string, string> = {}) { return h.fetch(`/api/v1/imports/${id}/content`, { method: 'PUT', headers: { cookie, origin: h.origin, 'content-type': 'application/octet-stream', ...headers }, body: new Uint8Array(bytes) }); }
describe('F5-01 archivos privados D1/R2 nativo', { timeout: 30000 }, () => {
  it('verifica PNG CRC/dimensiones y WAV duración real; no finge inspección de comprimidos', () => {
    expect(inspectMedia(pngFixture(), 'image/png')).toMatchObject({ width: 2, height: 2 }); expect(inspectMedia(wavFixture(1000), 'audio/wav')).toMatchObject({ durationMs: 1000 });
    const broken = pngFixture(); broken[45] = 127; expect(() => inspectMedia(broken, 'image/png')).toThrow(); expect(() => inspectMedia(wavFixture(), 'image/png')).toThrow();
    const ogg = new Uint8Array(16); ogg.set([79, 103, 103, 83]); expect(inspectMedia(ogg, 'audio/ogg')).toBeNull();
  });
  it('subida/finalize recuperables, binario privado y links que caducan sin revelar claves R2', async () => {
    const bytes = pngFixture(); const first = await intent(bytes); expect(first.response.status).toBe(201); const input = importDtoSchema.parse(await first.response.json());
    expect((await upload(input.id, bytes)).status).toBe(200); const operation = crypto.randomUUID(); const finish = () => request('POST', `/assets/${input.id}/finalize`, {}, { 'idempotency-key': operation });
    const responses = await Promise.all([finish(), finish()]); const a = assetSchema.parse(await responses[0]!.json()); expect(assetSchema.parse(await responses[1]!.json())).toEqual(a); expect(a).toMatchObject({ width: 2, height: 2, availability: 'REMOTE_AVAILABLE' });
    expect(importDtoSchema.parse(await (await request('POST', '/assets/import', first.body, { 'idempotency-key': first.key })).json())).toEqual(input);
    const access = assetAccessSchema.parse(await (await request('GET', `/assets/${a.id}/access`)).json()); expect(access.url).not.toContain('users/');
    const content = await h.fetch(access.url!, { headers: { cookie } }); expect(content.headers.get('content-type')).toBe('image/png'); expect(new Uint8Array(await content.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect((await h.fetch(access.url!)).status).toBe(401); expect((await h.fetch(access.url!.replace('ticket=', 'ticket=bad'), { headers: { cookie } })).status).toBe(404);
    const owner = crypto.randomUUID(); const expired = await assetTicket(h.secret, owner, a.id, 1000); expect(await verifyAssetTicket(h.secret, owner, a.id, 1000, expired, 999)).toBe(true); expect(await verifyAssetTicket(h.secret, owner, a.id, 1000, expired, 1001)).toBe(false);
    const listed = await (await request('GET', `/assets?projectId=${project}&type=IMAGE`)).json(); expect(JSON.stringify(listed)).not.toContain('r2_key');
    const password = `Fixture-${crypto.randomUUID()}`; await createAuth(h.db, { origin: h.origin, secret: h.secret }, fixtureId(8100)).api.signUpEmail({ body: { name: 'Otro', email: 'other-media@example.invalid', password } });
    const login = await request('POST', '/auth/sign-in/email', { email: 'other-media@example.invalid', password }); const other = login.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
    expect((await upload(input.id, bytes, { cookie: other })).status).toBe(404); expect((await request('GET', `/assets/${a.id}/access`, undefined, { cookie: other })).status).toBe(404); expect((await h.fetch(access.url!, { headers: { cookie: other } })).status).toBe(404);
  });
  it('rechaza checksum/tipo/path/owner/origen y mantiene comprimidos pendientes', async () => {
    const bytes = wavFixture(); const first = await intent(bytes, 'audio/wav'); const input = importDtoSchema.parse(await first.response.json());
    const broken = new Uint8Array(bytes); broken[60] = 99; expect((await upload(input.id, broken)).status).toBe(409);
    expect((await upload(input.id, bytes, { origin: 'https://foreign.invalid' })).status).toBe(403);
    expect((await intent(bytes, 'audio/wav', crypto.randomUUID(), { path: '../../private', url: 'http://127.0.0.1/' })).response.status).toBe(400);
    const fake = await intent(bytes, 'image/png'); const fakeId = importDtoSchema.parse(await fake.response.json()).id; expect((await upload(fakeId, bytes)).status).toBe(400);
    expect((await request('POST', `/assets/${input.id}/finalize`, {}, { 'idempotency-key': crypto.randomUUID() })).status).toBe(409);
    const ogg = new Uint8Array(16); ogg.set([79, 103, 103, 83]); const pending = importDtoSchema.parse(await (await intent(ogg, 'audio/ogg')).response.json()); expect(importDtoSchema.parse(await (await upload(pending.id, ogg)).json()).requiresInspection).toBe(true);
    expect((await request('POST', `/assets/${pending.id}/finalize`, {}, { 'idempotency-key': crypto.randomUUID() })).status).toBe(409);
    const foreign = await request('GET', `/assets?projectId=${crypto.randomUUID()}`); expect(foreign.status).toBe(404);
    expect((await request('POST', '/assets/import', first.body, { 'idempotency-key': first.key, cookie: '' })).status).toBe(401);
  });
});
