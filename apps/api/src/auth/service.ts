import { betterAuth } from './runtime.mjs';
import type { Database } from '../db/connection.js';

export type AuthConfig = { origin: string; secret: string };

// D1 real (batch/meta incluidos); el puerto de repositorios omite métodos que no usa.
// La compatibilidad se comprueba con introspección y pruebas workerd, no con mocks.
export function createAuth(db: Database, config: AuthConfig, bootstrapUserId?: string) {
  return betterAuth({
    appName: 'Video Studio',
    database: db,
    baseURL: config.origin,
    basePath: '/api/v1/auth',
    secret: config.secret,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: !bootstrapUserId, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
    advanced: {
      database: { generateId: bootstrapUserId ? ({ model }) => model === 'user' ? bootstrapUserId : crypto.randomUUID() : 'uuid' },
      useSecureCookies: new URL(config.origin).protocol === 'https:',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    session: { expiresIn: 604800, updateAge: 86400, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 10 },
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}
