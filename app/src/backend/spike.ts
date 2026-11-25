/**
 * TEMPORARY — spec 11 · 01 (Jira spikes). Deployed to the dev environment only
 * and deleted in 01 Step 5. Not product code: no tests, no UI.
 */
import type Resolver from '@forge/resolver';
import { asApp, asUser, assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';

const SETTINGS_MODULE_KEY = 'kpi-settings-page';
const LOG_KEY = 'spike:trigger-log';

interface SpikeRequest {
  as: 'user' | 'app';
  method?: string;
  path: string;
  body?: unknown;
}

function requireSettings(context: unknown): void {
  if ((context as { moduleKey?: string } | undefined)?.moduleKey !== SETTINGS_MODULE_KEY) {
    throw new Error('spike resolvers run from the Settings page only');
  }
}

async function call({ as, method = 'GET', path, body }: SpikeRequest) {
  const api = as === 'app' ? asApp() : asUser();
  const started = Date.now();
  const res = await api.requestJira(assumeTrustedRoute(path), {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, ms: Date.now() - started, data };
}

export function registerSpikeResolvers(resolver: Resolver): void {
  resolver.define('spikeRequest', async ({ payload, context }) => {
    requireSettings(context);
    return call(payload as unknown as SpikeRequest);
  });

  resolver.define('spikeBatch', async ({ payload, context }) => {
    requireSettings(context);
    const { ids, as, fieldId, parallel } = payload as unknown as {
      ids: string[];
      as: 'user' | 'app';
      fieldId: string;
      parallel?: number;
    };
    const started = Date.now();
    const results: Array<{ id: string; status: number; ms: number }> = [];
    const width = Math.max(1, parallel ?? 1);
    for (let i = 0; i < ids.length; i += width) {
      const chunk = ids.slice(i, i + width);
      const done = await Promise.all(
        chunk.map(async (id) => {
          const r = await call({
            as,
            method: 'PUT',
            path: `/rest/api/3/issue/${id}`,
            body: { fields: { [fieldId]: `batch ${started} ${id}` } },
          });
          return { id, status: r.status, ms: r.ms };
        }),
      );
      results.push(...done);
    }
    return { totalMs: Date.now() - started, results };
  });

  resolver.define('spikeLog', async ({ payload, context }) => {
    requireSettings(context);
    if ((payload as { clear?: boolean } | undefined)?.clear) await kvs.delete(LOG_KEY);
    return (await kvs.get(LOG_KEY)) ?? [];
  });
}

interface IssueEvent {
  eventType?: string;
  atlassianId?: string;
  issue?: { id?: string; key?: string; fields?: { project?: { key?: string } } };
  changelog?: { items?: Array<{ field?: string; fieldId?: string; fromString?: string | null; toString?: string | null }> };
}

async function logEvent(trigger: string, event: IssueEvent): Promise<void> {
  const projectKey = event.issue?.fields?.project?.key ?? event.issue?.key?.split('-')[0];
  if (!projectKey?.startsWith('SPIKE')) return;
  const entry = {
    trigger,
    at: new Date().toISOString(),
    key: event.issue?.key,
    atlassianId: event.atlassianId,
    items: (event.changelog?.items ?? []).map((i) => ({
      field: i.field,
      fieldId: i.fieldId,
      from: i.fromString,
      to: i.toString,
    })),
  };
  console.log('spike trigger', JSON.stringify(entry));
  const log = ((await kvs.get(LOG_KEY)) as unknown[] | undefined) ?? [];
  await kvs.set(LOG_KEY, [...log, entry].slice(-100));
}

export async function spikeTriggerAll(event: IssueEvent): Promise<void> {
  await logEvent('all', event);
}

export async function spikeTriggerFiltered(event: IssueEvent): Promise<void> {
  await logEvent('filtered', event);
}
