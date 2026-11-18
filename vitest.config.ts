import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    // D1/workerd and native FHD rendering share memory and CPU on the local host.
    maxWorkers: 2,
  },
});
