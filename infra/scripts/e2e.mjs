import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Credenciales sintéticas por ejecución, solo en memoria y procesos de prueba.
const directory = await mkdtemp(join(tmpdir(), 'video-studio-e2e-')); const sessionFile = join(directory, 'media-session.json');
const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url)), 'test', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, VIDEO_STUDIO_E2E_PASSWORD: `Fixture-${randomUUID()}`, VIDEO_STUDIO_E2E_MEDIA_STATE: sessionFile, WRANGLER_SEND_METRICS: 'false' },
});
child.on('exit', async (code) => { await rm(sessionFile, { force: true }); await rmdir(directory); process.exitCode = code ?? 1; });
