/**
 * Basic-auth `@forge/api` replacement for the API E2E test (test:e2e).
 *
 * `src/backend/jira.ts` talks to Jira exclusively through
 * `api.asApp()/asUser().requestJira(route`…`, opts)`. Inside Forge those calls
 * carry the app/user identity; here we alias `@forge/api` to this module (see
 * vitest.e2e.config.ts) so the SAME production code instead hits the live REST
 * API with a personal API token over HTTP Basic auth. That means the E2E test
 * exercises the real `jira.ts` functions — any broken endpoint surfaces.
 *
 * Auth = `FORGE_EMAIL:FORGE_API_TOKEN` (the API token doubles as the Basic-auth
 * password). Target site = `JIRA_BASE_URL`. Both come from the repo-root `.env`
 * (loaded by vitest.e2e.config.ts).
 *
 * NOTE: `asApp()` and `asUser()` resolve to the SAME token-authenticated client
 * here — a PAT can only ever act as its user. App-identity-only capabilities
 * (e.g. writing the read-only `kpi-reading` field) therefore cannot be covered
 * by this shim; the test skips those with an explanation.
 */

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function baseUrl(): string {
  const raw = process.env.JIRA_BASE_URL || 'https://bitovi-training.atlassian.net';
  return raw.replace(/\/+$/, '');
}

function authHeader(): string {
  const email = process.env.FORGE_EMAIL ?? '';
  const token = process.env.FORGE_API_TOKEN ?? '';
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

/**
 * Perform a real Jira REST request. The returned native `Response` is shape-
 * compatible with what `jira.ts` expects from Forge (`ok`, `status`, `json()`,
 * `text()`), so no adapter wrapper is needed.
 */
async function requestJira(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  return fetch(`${baseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });
}

const client = { requestJira };

const api = {
  asApp: () => client,
  asUser: () => client,
};

export default api;

/**
 * Mirror Forge's `route` tag: build the request path, percent-encoding the
 * interpolated values (path segments / query-param values) while leaving the
 * literal template text (including `+` space encodings in JQL) untouched.
 */
export function route(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce(
    (acc, str, i) =>
      acc + str + (i < values.length ? encodeURIComponent(String(values[i])) : ''),
    '',
  );
}
