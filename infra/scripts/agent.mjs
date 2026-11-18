import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAgent } from './build-agent.mjs';
await buildAgent();
const child = spawn(process.execPath, [fileURLToPath(new URL('../../apps/local-agent/dist/agent.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
