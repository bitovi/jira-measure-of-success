import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
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

/**
 * Atlaskit's `setGlobalTheme` lazy-loads theme CSS via dynamic imports (~20
 * chunks, incl. unused contrast/finesse/custom-brand themes). We bundle the
 * themes we need statically (src/ui/theme.ts), so stub those dynamic imports
 * to keep the deploy output lean and free of unused chunks.
 */
const stubUnusedAtlaskitThemeChunks = (): Plugin => ({
  name: 'stub-unused-atlaskit-theme-chunks',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0].replace(/\\/g, '/');
    if (file.endsWith('/@atlaskit/tokens/dist/esm/artifacts/theme-import-map.js')) {
      return 'export const themeImportMap = {}; export default themeImportMap;';
    }
    if (file.endsWith('/@atlaskit/tokens/dist/esm/custom-theme.js')) {
      return 'export function loadAndAppendCustomThemeCss() {}';
    }
    return null;
  },
});

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
  plugins: [react(), stubUnusedAtlaskitThemeChunks()],
  resolve: {
    alias: {
      '@domain': resolve('./src/domain'),
      '@backend': resolve('./src/backend'),
      '@ui': resolve('./src/ui'),
      '@atlaskit/feature-gate-js-client/feature-gates': resolve('./src/ui/stubs/featureGates.ts'),
    },
  },
  build: {
    outDir: resolve(`./${SURFACES[surface]}`),
    emptyOutDir: true,
  },
});
