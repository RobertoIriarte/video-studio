import { fileURLToPath } from 'node:url';
import { buildComposition } from './build-composition.mjs';
import { build } from 'vite';
export async function buildAgent() {
  await build({ configFile: false, publicDir: false, logLevel: 'warn', ssr: { noExternal: [/^@video-studio\//, 'zod'] }, build: { target: 'node24', ssr: fileURLToPath(new URL('../../apps/local-agent/src/cli.ts', import.meta.url)), outDir: fileURLToPath(new URL('../../apps/local-agent/dist', import.meta.url)), emptyOutDir: true, rolldownOptions: { output: { entryFileNames: 'agent.mjs' } } } });
  await buildComposition();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildAgent();
