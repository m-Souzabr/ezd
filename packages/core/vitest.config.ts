import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Timed tests run on their own, without coverage: see vitest.perf.config.ts.
    exclude: [...configDefaults.exclude, 'src/**/*.perf.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
