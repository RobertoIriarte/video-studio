import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Credenciales sintéticas por ejecución, solo en memoria y procesos de prueba.
const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url)), 'test', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, VIDEO_STUDIO_E2E_PASSWORD: `Fixture-${randomUUID()}`, WRANGLER_SEND_METRICS: 'false' },
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
