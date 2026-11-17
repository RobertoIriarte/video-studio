import type { Database } from '../db/connection.js';

// Superficie utilizada del SDK 1.7.25, contrastada por getMigrations y workerd.
// No implementa auth ni simula métodos. Los payloads de sesión se validan aparte.
export interface AuthOptions {
  appName: string; database: Database; baseURL: string; basePath: string;
  secret: string; trustedOrigins: string[];
  emailAndPassword: { enabled: true; disableSignUp: boolean; autoSignIn: false; minPasswordLength: number; maxPasswordLength: number };
  advanced: { database: { generateId: 'uuid' | ((options: { model: string }) => string) }; useSecureCookies: boolean; ipAddress: { ipAddressHeaders: string[] } };
  session: { expiresIn: number; updateAge: number; cookieCache: { enabled: false } };
  rateLimit: { enabled: true; storage: 'database'; window: number; max: number };
  telemetry: { enabled: false }; logger: { disabled: true };
}
export interface Auth {
  options: AuthOptions;
  handler(request: Request): Promise<Response>;
  api: {
    signUpEmail(options: { body: { name: string; email: string; password: string }; headers?: Headers }): Promise<unknown>;
    getSession(options: { headers: Headers }): Promise<{ user: unknown; session: unknown } | null>;
  };
  $context: Promise<{
    password: { hash(password: string): Promise<string> };
    internalAdapter: { createAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown> };
  }>;
}
export function betterAuth(options: AuthOptions): Auth;
