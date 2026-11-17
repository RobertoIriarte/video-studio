import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateEnvFile, workspaceRoot } from './private-env.mjs';

const file = privateEnvFile();
const args = [fileURLToPath(new URL('../../apps/api/node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'dev', '--local', '--config', fileURLToPath(new URL('../wrangler.local.json', import.meta.url)), '--log-level', 'warn'];
if (existsSync(file)) args.push('--env-file', file);
console.log('Iniciando API local en http://127.0.0.1:8787 (valores privados ocultos).');
const child = spawn(process.execPath, args, { cwd: workspaceRoot, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
