import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Minimal `.env` loader — the API E2E test reads live-site credentials from the
 * repo-root `.env` (gitignored). We avoid a dotenv dependency: parse simple
 * `KEY=VALUE` lines and only set vars that aren't already in the environment
 * (so `set -a && source .env` / CI env still win).
 */
function loadEnv(url: string): void {
  const file = fileURLToPath(new URL(url, import.meta.url));
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv('../.env'); // repo root (where Forge creds live)
loadEnv('./.env'); // app-local override, if any

/**
 * API E2E config — opt-in via `npm run test:e2e`. Aliases `@forge/api` to a
 * Basic-auth REST shim so `src/backend/jira.ts` runs against a live Jira site
 * with a personal API token. Kept entirely separate from the default vitest
 * config so it never runs in the normal `npm test` suite. The suite itself
 * skips when credentials are absent (see test-e2e/jira-api.e2e.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@forge/api': resolve('./test-e2e/forge-api-shim.ts'),
      '@domain': resolve('./src/domain'),
      '@backend': resolve('./src/backend'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test-e2e/**/*.e2e.ts'],
    // Live-network + project provisioning + async project deletion polling.
    testTimeout: 90_000,
    hookTimeout: 180_000,
    // These tests mutate a shared site; never run files in parallel.
    fileParallelism: false,
  },
});
