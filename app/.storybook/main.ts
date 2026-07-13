import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Storybook (React + Vite). Reuses the app's aliases and points `@forge/bridge`
 * at the harness mock, so surfaces load even when a story relies on the default
 * loader hook (most stories inject a stub hook and never hit the bridge).
 */
const config: StorybookConfig = {
  stories: ['../src/ui/**/*.stories.tsx'],
  addons: ['@storybook/addon-essentials'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (cfg) => {
    cfg.resolve ??= {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias as Record<string, string>),
      '@domain': resolve('../src/domain'),
      '@backend': resolve('../src/backend'),
      '@ui': resolve('../src/ui'),
      '@harness': resolve('../test-harness'),
      '@forge/bridge': resolve('../test-harness/mock-bridge.ts'),
    };
    return cfg;
  },
};

export default config;
