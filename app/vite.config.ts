import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The harness build aliases `@forge/bridge` to the mock so Custom UI surfaces
// render identically in a plain browser (local dev + computer-vision checks)
// and, unchanged, inside Jira's iframe under `forge tunnel`.
const useMockBridge = process.env.FORGE_BRIDGE !== 'real';

export default defineConfig({
  root: 'test-harness',
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': resolve('./src/domain'),
      '@backend': resolve('./src/backend'),
      '@ui': resolve('./src/ui'),
      '@harness': resolve('./test-harness'),
      ...(useMockBridge
        ? { '@forge/bridge': resolve('./test-harness/mock-bridge.ts') }
        : {}),
    },
  },
  server: { port: 5180 },
});
