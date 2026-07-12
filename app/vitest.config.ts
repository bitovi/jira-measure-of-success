import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Domain tests are pure TS (no browser). UI component tests can opt into
// jsdom per-file via `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve('./src/domain'),
      '@backend': resolve('./src/backend'),
      '@ui': resolve('./src/ui'),
      '@harness': resolve('./test-harness'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test-harness/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
