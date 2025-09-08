import { defineConfig } from 'vitest/config';

// conventions.md §1: packages/engine targets ~100% branch coverage; this enforces a hard
// floor of 95% so a coverage regression fails CI rather than merely being visible in a report.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/test-support.ts'],
      thresholds: {
        branches: 95,
      },
    },
  },
});
