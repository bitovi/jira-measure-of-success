/**
 * Legacy reader report (spec 11 · 09 Step 1). Reads the site the way the
 * customer's reporting app does — the PRE-spec-11 formats only — and prints a
 * stable, sorted report, so runs before and after each migration can be diffed.
 *
 *   node --experimental-strip-types scripts/legacy-report.ts [CENTRAL_SPACE_KEY]
 *
 * Needs JIRA_SITE (default bitovi-training.atlassian.net), JIRA_EMAIL and
 * JIRA_API_TOKEN, falling back to the repo-root `.env`'s FORGE_EMAIL /
 * FORGE_API_TOKEN. Never run in CI. Removed by the cleanup release.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadDotEnv(): Record<string, string> {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1], m[2]]),
    );
  } catch {
    return {};
  }
}

const env = { ...loadDotEnv(), ...process.env } as Record<string, string | undefined>;
const site = env.JIRA_SITE ?? 'bitovi-training.atlassian.net';
const email = env.JIRA_EMAIL ?? env.FORGE_EMAIL;
const token = env.JIRA_API_TOKEN ?? env.FORGE_API_TOKEN;
const spaceKey = process.argv[2] ?? 'KPI';
if (!email || !token) throw new Error('Set JIRA_EMAIL and JIRA_API_TOKEN (or FORGE_* in .env).');
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

async function jira<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://${site}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface SearchPage {
  issues: Array<{ id: string; key: string; fields: Record<string, unknown>; properties?: Record<string, unknown> }>;
  nextPageToken?: string;
}

async function searchAll(jql: string, properties: string[]): Promise<SearchPage['issues']> {
  const all: SearchPage['issues'] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jira<SearchPage>('/rest/api/3/search/jql', {
      jql,
      fields: ['summary'],
      properties,
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    all.push(...page.issues);
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return all;
}

interface LegacyAssignment {
  kpiId?: string;
  target?: number | null;
  targetType?: string;
  inheritFromParent?: boolean;
  timing?: { start?: string | null; due?: { mode?: string; absolute?: string | null; anchor?: string; offsetMonths?: number } };
}

const byKey = (a: { key: string }, b: { key: string }) => {
  const [pa, na] = a.key.split('-');
  const [pb, nb] = b.key.split('-');
  return pa === pb ? Number(na) - Number(nb) : pa.localeCompare(pb);
};

const kpis = (await searchAll(`project = "${spaceKey}"`, ['kpi-meta'])).sort(byKey);
const lines: string[] = [`# Legacy reader report — ${site}, central space ${spaceKey}`, '', `## KPIs (${kpis.length})`];
for (const k of kpis) {
  const meta = (k.properties?.['kpi-meta'] ?? {}) as { unit?: string; direction?: string | null };
  lines.push(`${k.key}\t${String(k.fields.summary)}\tunit=${meta.unit ?? '∅'}\tdirection=${meta.direction ?? '∅'}`);
}

const items = (
  await searchAll('issue.property[kpi-assignments].kpiIds IS NOT EMPTY', ['kpi-assignments'])
).sort(byKey);
lines.push('', `## Work items with targets (${items.length})`);
for (const it of items) {
  const prop = (it.properties?.['kpi-assignments'] ?? {}) as { assignments?: LegacyAssignment[]; kpiIds?: string[] };
  const assignments = [...(prop.assignments ?? [])].sort((a, b) => String(a.kpiId).localeCompare(String(b.kpiId)));
  lines.push(`${it.key}\tkpiIds=${[...(prop.kpiIds ?? [])].sort().join(',')}`);
  for (const a of assignments) {
    const due = a.timing?.due;
    const dueText = due?.mode === 'absolute' ? `due=${due.absolute}` : `due=${due?.anchor}+${due?.offsetMonths}m`;
    lines.push(
      `  ${a.kpiId}\t${a.inheritFromParent ? 'inherit' : `${a.targetType}:${a.target}`}\tstart=${a.timing?.start ?? '∅'}\t${dueText}`,
    );
  }
}
console.log(lines.join('\n'));
