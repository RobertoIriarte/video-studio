import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
export function privateEnvFile() {
  const key = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12);
  const file = resolve(process.env.VIDEO_STUDIO_ENV_FILE ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'VideoStudio', key, 'worker.env'));
  let ancestor = file;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const resolvedTarget = resolve(realpathSync(ancestor), relative(ancestor, file));
  for (const target of [file, resolvedTarget]) {
    const pathFromWorkspace = relative(workspaceRoot, target);
    if (pathFromWorkspace !== '..' && !pathFromWorkspace.startsWith(`..${sep}`) && !isAbsolute(pathFromWorkspace)) throw new Error('El archivo privado debe estar fuera del repositorio.');
  }
  return file;
}
export function loadPrivateEnv() {
  const file = privateEnvFile();
  if (existsSync(file)) process.loadEnvFile(file);
  return file;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = privateEnvFile();
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `AUTH_SECRET=${randomBytes(32).toString('hex')}\nAUTH_BOOTSTRAP_TOKEN=${randomBytes(32).toString('hex')}\nBOOTSTRAP_IDEMPOTENCY_KEY=${randomUUID()}\nAPP_ORIGIN=http://127.0.0.1:5173\n`, { flag: 'wx', mode: 0o600 });
  }
  console.log(`Configuración privada conservada fuera del repo: ${file}`);
  console.log('No se ha creado ninguna cuenta. Inicia pnpm dev y ejecuta pnpm owner:bootstrap.');
}
