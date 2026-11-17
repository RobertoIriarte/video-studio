import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { d1Harness, applyMigrations } from './support/d1.js';
import { createAuth } from '../apps/api/src/auth/service.js';

it('V01: contrasta esquema Better Auth sin modificar datos existentes', async () => {
  const harness = await d1Harness();
  try {
    await applyMigrations(harness.db);
    const config = { origin: 'http://127.0.0.1:5173', secret: crypto.randomUUID() + crypto.randomUUID() };
    const auth = createAuth(harness.db, config);
    const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
    const { getMigrations } = await import(requireApi.resolve('better-auth/db/migration')) as {
      getMigrations(options: typeof auth.options): Promise<{
        schemaProblems: string[]; unsafeChanges: string[]; toBeCreated: unknown[]; toBeAdded: unknown[]; toBeAddedIndexes: unknown[];
      }>;
    };
    const plan = await getMigrations(auth.options);
    expect(plan.schemaProblems).toEqual([]);
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.toBeAddedIndexes).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
  } finally { await harness.dispose(); }
}, 30000);
