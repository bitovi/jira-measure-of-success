import { route } from '@forge/api';
import { KPI_META_PROPERTY_KEY, kpiMetaFromChangelog, type IssueChangelogItem } from '../domain/index';
import { readKpiFieldsConfig } from './kpiConfig';
import { asApp, type RequestJira } from './requestLog';

/**
 * Sync trigger (spec 11 · 05, `kpi-meta-sync` in the manifest): when someone
 * edits a KPI's unit or direction field in Jira's own UI, rewrite its
 * `kpi-meta` property (AS THE APP) so the customer's report, which still reads
 * `kpi-meta`, follows. Removed in the cleanup release.
 *
 * The manifest filter only passes KPIs whose `kpi-meta` is marked
 * `fields: true`, and `ignoreSelf` drops the app's own writes (its KPI edits,
 * which already write `kpi-meta`, and the migration). Property writes never
 * fire the event, so this can't loop (01 A9). The handler still checks
 * everything itself, in case an event gets through.
 */

/** The parts of an `avi:jira:updated:issue` event this handler reads. */
export interface IssueUpdatedEvent {
  issue?: { id?: string | number; key?: string };
  changelog?: { items?: IssueChangelogItem[] | null } | null;
}

export async function syncKpiMetaFromFields(
  event: IssueUpdatedEvent,
  jira: { requestJira: RequestJira } = asApp(),
): Promise<'written' | 'unchanged'> {
  const issueId = event.issue?.id === undefined ? null : String(event.issue.id);
  if (!issueId) return 'unchanged';
  const cfg = await readKpiFieldsConfig();
  if (!cfg) return 'unchanged';
  const ours = new Set([cfg.unit.fieldId, cfg.direction.fieldId]);
  // Decided from the event alone first: an edit to other fields costs no request.
  if (!(event.changelog?.items ?? []).some((i) => i.fieldId !== undefined && ours.has(i.fieldId))) return 'unchanged';

  const res = await jira.requestJira(route`/rest/api/3/issue/${issueId}/properties/${KPI_META_PROPERTY_KEY}`);
  if (res.status === 404) return 'unchanged';
  if (!res.ok) throw new Error(`Jira ${res.status} while reading kpi-meta on ${event.issue?.key ?? issueId}`);
  const stored = ((await res.json()) as { value?: unknown }).value;
  const next = kpiMetaFromChangelog(event.changelog, cfg, stored);
  if (!next) return 'unchanged';

  const put = await jira.requestJira(route`/rest/api/3/issue/${issueId}/properties/${KPI_META_PROPERTY_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!put.ok) throw new Error(`Jira ${put.status} while saving kpi-meta on ${event.issue?.key ?? issueId}`);
  return 'written';
}

/** Forge trigger function (`index.kpiMetaSync`). */
export async function kpiMetaSync(event: IssueUpdatedEvent): Promise<void> {
  try {
    const outcome = await syncKpiMetaFromFields(event);
    if (outcome === 'written') console.info(`[kpi-meta-sync] ${event.issue?.key ?? event.issue?.id}: kpi-meta follows the fields`);
  } catch (error) {
    console.error(`[kpi-meta-sync] ${event.issue?.key ?? event.issue?.id}:`, error instanceof Error ? error.message : error);
  }
}
