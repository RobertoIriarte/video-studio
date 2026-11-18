import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { betterAuth } from '../../apps/api/src/auth/runtime.mjs';

// Sesión sintética real, aislada del rate-limit de los tests que sí prueban login UI.
// El archivo temporal está fuera del repo y el runner lo elimina al cerrar.
export async function seedMediaSession(db, origin, secret, password, output) {
  if (!output) throw new Error('Usa el runner E2E para la sesión efímera.');
  const owner = '00000000-0000-4000-8000-00000000a500';
  const auth = betterAuth({ database: db, baseURL: origin, basePath: '/api/v1/auth', secret, emailAndPassword: { enabled: true, minPasswordLength: 12 }, advanced: { database: { generateId: ({ model }) => model === 'user' ? owner : randomUUID() } }, telemetry: { enabled: false }, logger: { disabled: true } });
  await auth.api.signUpEmail({ body: { name: 'Biblioteca sintética', email: 'media-e2e@example.invalid', password } });
  const response = await auth.api.signInEmail({ body: { email: 'media-e2e@example.invalid', password }, asResponse: true });
  const cookies = response.headers.getSetCookie().map((raw) => { const pair = raw.split(';')[0]; const index = pair.indexOf('='); return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }; });
  await writeFile(output, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
}
