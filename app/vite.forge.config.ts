import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Forge Custom UI build. Produces one static bundle per surface into the
 * `static/<key>/build` directories referenced by manifest.yml. Unlike the local
 * harness (vite.config.ts), this does NOT alias `@forge/bridge` — the real
 * bridge is bundled so the surfaces talk to the deployed Forge resolver.
 *
 * Pick a surface with the SURFACE env var; `npm run build:forge` builds all three.
 */
const SURFACES = {
  'issue-panel': 'static/issue-panel/build',
  timeline: 'static/timeline/build',
  settings: 'static/settings/build',
} as const;

const surface = process.env.SURFACE as keyof typeof SURFACES | undefined;
if (!surface || !(surface in SURFACES)) {
  throw new Error(
    `Set SURFACE to one of: ${Object.keys(SURFACES).join(', ')} (got: ${surface ?? 'unset'})`,
  );
}

export default defineConfig({
  root: `forge-ui/${surface}`,
  // Relative asset URLs so bundles load correctly inside the Forge CDN iframe.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': resolve('./src/domain'),
      '@backend': resolve('./src/backend'),
      '@ui': resolve('./src/ui'),
    },
  },
  build: {
    outDir: resolve(`./${SURFACES[surface]}`),
    emptyOutDir: true,
  },
});
