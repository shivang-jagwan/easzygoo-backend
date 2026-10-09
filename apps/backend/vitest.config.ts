import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Once per run: refuse unsafe DB targets, reset the test schema.
    globalSetup: ['test/global-setup.ts'],
    // Per test file, before it imports anything: point the app at the test DB.
    setupFiles: ['test/setup-env.ts'],
    // Every file shares one database and truncates it first, so files must not
    // overlap. Tests *within* a file still run concurrently where they ask to.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
