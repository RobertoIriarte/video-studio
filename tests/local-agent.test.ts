import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { agentTokenSchema, bytesHash, importDtoSchema, pairingDtoSchema, projectDetailSchema } from '@video-studio/contracts';
import { projectInputFixture } from '@video-studio/testkit';
import { pngFixture, wavFixture } from './support/media.js';
import { authHarness } from './support/d1.js';
import { AgentClient } from '../apps/local-agent/src/client.js';
import { copyIntoCache, contained, fileHash } from '../apps/local-agent/src/cache.js';
import { defaultProbePath, probeFile, probeVersion } from '../apps/local-agent/src/probe.js';
import { readConfig, writeConfig } from '../apps/local-agent/src/config.js';
import { importLocalFile } from '../apps/local-agent/src/import.js';

const execute = promisify(execFile); const native = existsSync(defaultProbePath()); const encoder = join(dirname(defaultProbePath()), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'); let root: string | undefined;
afterEach(async () => { if (root) { const target = resolve(root); if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith('video-studio-agent-test-')) throw new Error('UNSAFE_TEST_CLEANUP'); await rm(target, { recursive: true, force: true }); root = undefined; } });
describe('F5-02 agente Node y archivos', { timeout: 30000 }, () => {
  it('protege paths/credenciales y conserva cache inmutable', async () => {
    root = await mkdtemp(join(tmpdir(), 'video-studio-agent-test-')); const input = join(root, 'source.wav'); await writeFile(input, wavFixture()); const project = crypto.randomUUID(); const id = crypto.randomUUID();
    const copied = await copyIntoCache(join(root, 'cache'), project, id, input, 'wav'); expect(copied.checksum).toBe(await bytesHash(wavFixture())); await expect(copyIntoCache(join(root, 'cache'), project, id, input, 'wav')).rejects.toThrow('ASSET_EXISTS');
    expect(() => contained(root!, join(root!, '..', 'foreign'))).toThrow('UNSAFE_PATH'); await expect(copyIntoCache(join(root, 'cache'), '../foreign', id, input, 'wav')).rejects.toThrow();
    const config = { origin: 'http://127.0.0.1:8787', mediaRoot: join(root, 'cache'), token: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'), agentId: crypto.randomUUID() }; const path = join(root, 'credentials', 'agent.json'); await writeConfig(config, path); expect(await readConfig(path)).toEqual(config);
    await expect(writeConfig(config, resolve('agent-secret.json'))).rejects.toThrow('SECRET_CONFIG_MUST_BE_OUTSIDE_REPOSITORY'); await expect(writeConfig(config, resolve('..hidden', 'agent.json'))).rejects.toThrow('SECRET_CONFIG_MUST_BE_OUTSIDE_REPOSITORY'); expect(() => new AgentClient('http://foreign.invalid', config.token)).toThrow('INVALID_AGENT_ORIGIN'); expect(() => new AgentClient('https://user:secret@example.invalid', config.token)).toThrow();
  });
  it.skipIf(!native)('FFprobe real inspecciona PNG/WAV, rechaza red y mantiene duraciones/checksums', async () => {
    root = await mkdtemp(join(tmpdir(), 'video-studio-agent-test-')); const folder = join(root, 'carpeta con espacios'); await mkdir(folder); const image = join(folder, 'image.png'); const audio = join(folder, 'voice.wav'); await writeFile(image, pngFixture()); await writeFile(audio, wavFixture(1250));
    expect(await probeVersion()).toContain('ffprobe version'); expect(await probeFile(image, 'image/png')).toMatchObject({ width: 2, height: 2, checksum: await bytesHash(pngFixture()) }); expect(await probeFile(audio, 'audio/wav')).toMatchObject({ durationMs: 1250 }); await expect(probeFile('https://example.invalid/file', 'video/mp4')).rejects.toThrow('ABSOLUTE_PATH_REQUIRED'); await expect(probeFile(image, 'audio/mpeg')).rejects.toThrow('INVALID_MEDIA');
  });
  it.skipIf(!native || !existsSync(encoder))('agente real verifica MP3 pendiente de R2 y reanuda sin navegador', async () => {
    root = await mkdtemp(join(tmpdir(), 'video-studio-agent-test-')); const mp3 = join(root, 'generated.mp3'); const ffmpeg = join(dirname(defaultProbePath()), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.5', '-c:a', 'libmp3lame', mp3], { windowsHide: true, shell: false, timeout: 15000 }); const { readFile } = await import('node:fs/promises'); const bytes = await readFile(mp3); const h = await authHarness();
    try {
      const password = `Fixture-${crypto.randomUUID()}`; const origin = h.origin;
      const req = (path: string, input: unknown, cookie = '', extra: Record<string, string> = {}) => h.fetch(`/api/v1${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...extra }, body: JSON.stringify(input) });
      expect((await req('/bootstrap', { name: 'Local', email: 'node@example.invalid', password }, '', { authorization: `Bearer ${h.bootstrapToken}` })).status).toBe(200); const login = await req('/auth/sign-in/email', { email: 'node@example.invalid', password }); const cookie = login.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
      const project = projectDetailSchema.parse(await (await req('/projects', projectInputFixture(), cookie)).json()); const pairing = pairingDtoSchema.parse(await (await req('/agents/pairing', { label: 'Node de prueba' }, cookie)).json());
      const transport: typeof fetch = (url, init) => { if (typeof url !== 'string') throw new Error('TEST_URL_REQUIRED'); const parsed = new URL(url); if (parsed.origin !== origin) throw new Error('UNEXPECTED_NETWORK'); return h.fetch(parsed.pathname + parsed.search, init); };
      const token = agentTokenSchema.parse(await new AgentClient(origin, '', transport).pair(pairing.code, 'Node de prueba', { ffprobe: true, localImport: true, alignment: false }, crypto.randomUUID()));
      const input = { projectId: project.id, mime: 'audio/mpeg', bytes: bytes.length, checksum: await bytesHash(bytes), license: { source: 'Fixture nativo', note: '', rightsAcknowledged: true }, prompt: null };
      const intent = importDtoSchema.parse(await (await req('/assets/import', input, cookie)).json()); const upload = await h.fetch(`/api/v1/imports/${intent.id}/content`, { method: 'PUT', headers: { origin, cookie, 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) }); expect(upload.status).toBe(200);
      const client = new AgentClient(origin, token.token, transport); await client.tick(join(root, 'cache'), crypto.randomUUID());
      expect((await h.db.prepare('SELECT availability,duration_ms FROM assets WHERE id=?').bind(intent.id).first<{ availability: string; duration_ms: number }>())?.availability).toBe('REMOTE_AVAILABLE'); const cached = join(root, 'cache', 'projects', project.id, 'assets', intent.id, 'inspection.bin'); expect((await fileHash(cached)).checksum).toBe(input.checksum);
      await client.tick(join(root, 'cache'), crypto.randomUUID()); expect((await h.db.prepare('SELECT count(*) AS n FROM assets WHERE id=?').bind(intent.id).first<{ n: number }>())?.n).toBe(1);
      const previousConfig = process.env.VIDEO_STUDIO_AGENT_CONFIG; process.env.VIDEO_STUDIO_AGENT_CONFIG = join(root, 'private', 'agent.json');
      try {
        const config = { origin, token: token.token, agentId: token.agentId, mediaRoot: join(root, 'local-cache') };
        const dropping: typeof fetch = async (url, init) => { const response = await transport(url, init); if (typeof url === 'string' && url.endsWith('/agents/assets/register')) throw new TypeError('Fixture de respuesta perdida después del commit'); return response; };
        await expect(importLocalFile(new AgentClient(origin, token.token, dropping), config, { file: mp3, projectId: project.id, mime: 'audio/mpeg', source: 'Fixture propio', rights: true })).rejects.toThrow('Fixture de respuesta perdida');
        const persisted = await readConfig(); expect(persisted.pendingAsset).toBeDefined();
        const imported = await importLocalFile(client, persisted);
        expect(imported.availability).toBe('LOCAL_ONLY'); expect(imported.checksum).toBe(input.checksum); expect(imported.durationMs).toBeGreaterThan(0); expect((await readConfig()).pendingAsset).toBeUndefined();
        expect((await h.db.prepare('SELECT count(*) AS n FROM asset_locations WHERE asset_id=? AND agent_id=?').bind(imported.id, token.agentId).first<{ n: number }>())!.n).toBe(1);
      } finally { if (previousConfig === undefined) delete process.env.VIDEO_STUDIO_AGENT_CONFIG; else process.env.VIDEO_STUDIO_AGENT_CONFIG = previousConfig; }
    } finally { await h.dispose(); }
  });
});
