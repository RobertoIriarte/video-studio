import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/dist-demo/**', '**/coverage/**', '**/node_modules/**', '**/.wrangler/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['infra/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly' } },
  },
  {
    // Los tipos Node y sus módulos no deben filtrarse a los runtimes compartidos.
    files: [
      'apps/web/src/**/*.{ts,tsx}',
      'apps/api/src/**/*.ts',
      'packages/contracts/src/**/*.ts',
      'packages/domain/src/**/*.ts',
      'packages/providers/src/**/*.ts',
      'packages/render/src/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: builtinModules.filter((name) => !name.startsWith('node:')),
        patterns: ['node:*', '@video-studio/local-agent', '@video-studio/local-agent/*'],
      }],
    },
  },
);
