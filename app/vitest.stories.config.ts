import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Story tests — runs each surface's Storybook stories as assertions (via
 * portable stories / `composeStories`) in jsdom. Segmented from the fast domain
 * suite (`vitest.config.ts`); invoked with `npm run test:stories`. Aliases match
 * the app + harness, incl. the `@forge/bridge` mock.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': resolve('./src/domain'),
      '@backend': resolve('./src/backend'),
      '@ui': resolve('./src/ui'),
      '@harness': resolve('./test-harness'),
      '@forge/bridge': resolve('./test-harness/mock-bridge.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/ui/**/*.test.tsx'],
    setupFiles: ['./vitest.stories.setup.ts'],
    css: false,
  },
});
