import { defineConfig } from 'vitest/config';

// Database-tests kører mod en rigtig Postgres (DATABASE_URL). Se tests/db/README.md.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
