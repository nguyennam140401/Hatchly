import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'boundaries/fixtures/**'],
    testTimeout: 60_000,
  },
});
