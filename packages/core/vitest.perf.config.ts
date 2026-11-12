import { defineConfig } from 'vitest/config';

// The performance tests. They run without coverage, which slows the code several times
// over, and one file at a time, so they do not compete for the processor.
export default defineConfig({
  test: {
    include: ['src/**/*.perf.test.ts'],
    fileParallelism: false,
  },
});
