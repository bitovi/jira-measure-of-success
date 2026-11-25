import { route } from '@forge/api';
import {
  isMarkedKpiMeta,
  KPI_META_PROPERTY_KEY,
  kpiMetaFieldIds,
  planKpiMetaToFields,
  type KpiFieldsConfig,
  type MigrationStatus,
} from '../../domain/index';
import { readKpiSiteConfig } from '../kpiConfig';
import { MIGRATION_BATCH_SIZE, migrateItems, type Migration, type MigrationContext } from './index';

/**
 * `kpi-meta-to-fields` (spec 11 · 05): copies each KPI's unit and direction
 * from its `kpi-meta` property into the KPI fields chosen in Settings, and
 * marks `kpi-meta` (`fields: true`). A field that already holds a different
 * value wins, and `kpi-meta` is rewritten to match (logged for review). Writes
 * as the admin (one History entry per KPI, naming them). Copy only: `kpi-meta`
 * stays, for the customer's report.
 */
export const KPI_META_TO_FIELDS = 'kpi-meta-to-fields';

const PROPERTY = KPI_META_PROPERTY_KEY;
/** Up to 100 pages of 100 KPIs when counting what's left. */
const COUNT_PAGE_SIZE = 100;
const MAX_COUNT_PAGES = 100;

type Jira = MigrationContext['writer'];

interface Setup {
  fields: KpiFieldsConfig;
  workTypeId: string;
}

/** The fields and KPI work type, or why the migration doesn't apply yet. */
async function setup(): Promise<Setup | { reason: string }> {
  const { fields, workType } = await readKpiSiteConfig();
  if (!fields) return { reason: 'Choose the KPI fields in Settings first (KPI building blocks).' };
  if (!workType) return { reason: 'Choose the KPI work type in Settings first (KPI building blocks).' };
  return { fields, workTypeId: workType.id };
}

/**
 * Every KPI on the site, in every space. Stable (it doesn't filter on what's
 * migrated), so `nextPageToken` paging can't skip KPIs as they're written; not
 * `id > n`, which only works within one project (01 E2).
 */
const kpisJql = (workTypeId: string) => `issuetype = ${workTypeId} ORDER BY id ASC`;

interface PageIssue {
  id: string;
  key: string;
  fields?: { project?: { key?: string }; [field: string]: unknown };
  properties?: Record<string, unknown>;
}

async function failure(res: { status: number; json(): Promise<unknown> }, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { errorMessages?: string[]; errors?: Record<string, string> };
  const messages = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})];
  return new Error(`Jira ${res.status} while trying to ${action}${messages.length ? `: ${messages.join('; ')}` : ''}`);
}

async function searchKpis(
  jira: Jira,
  workTypeId: string,
  fields: string,
  maxResults: number,
  cursor: string | null,
): Promise<{ issues: PageIssue[]; cursor: string | null }> {
  const jql = kpisJql(workTypeId);
  const res = await jira.requestJira(
    cursor
      ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&properties=${PROPERTY}&maxResults=${maxResults}&nextPageToken=${cursor}`
      : route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&properties=${PROPERTY}&maxResults=${maxResults}`,
  );
  if (!res.ok) throw await failure(res, 'list the KPIs');
  const data = (await res.json()) as { issues?: PageIssue[]; nextPageToken?: string; isLast?: boolean };
  return { issues: data.issues ?? [], cursor: data.isLast === false && data.nextPageToken ? data.nextPageToken : null };
}

/** A KPI still to migrate: it has a `kpi-meta` that isn't marked. */
const isPending = (legacy: unknown): boolean => legacy !== undefined && legacy !== null && !isMarkedKpiMeta(legacy);

export const kpiMetaToFields: Migration = {
  id: KPI_META_TO_FIELDS,
  title: 'Move unit and direction into fields',
  description: "Copies each KPI's unit and direction into the KPI fields chosen above.",
  writeAs: 'user',

  // `kpi-meta` isn't indexed, so pending KPIs are counted by paging every KPI, as the app.
  async status(ctx): Promise<MigrationStatus> {
    const s = await setup();
    if ('reason' in s) return { applicable: false, reason: s.reason, pending: null };
    let pending = 0;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_COUNT_PAGES; page += 1) {
      const result = await searchKpis(ctx.app, s.workTypeId, 'project', COUNT_PAGE_SIZE, cursor);
      pending += result.issues.filter((i) => isPending(i.properties?.[PROPERTY])).length;
      cursor = result.cursor;
      if (!cursor) return { applicable: true, pending };
    }
    return { applicable: true, pending: null };
  },

  async runBatch(ctx, cursor) {
    const s = await setup();
    if ('reason' in s) throw new Error(s.reason);
    // Listed as the app, so a KPI the admin can't see is a listed failure, not silently left out.
    const page = await searchKpis(ctx.app, s.workTypeId, 'project', MIGRATION_BATCH_SIZE, cursor);
    const items = page.issues.map((issue) => ({
      issueId: String(issue.id),
      issueKey: issue.key,
      space: issue.fields?.project?.key ?? issue.key.split('-')[0],
      legacy: issue.properties?.[PROPERTY],
    }));
    const fieldIds = kpiMetaFieldIds(s.fields).join(',');

    const result = await migrateItems(items, async (item) => {
      if (!isPending(item.legacy)) return 'alreadyDone';
      // Plan from a fresh read (fields + kpi-meta) right before writing, so an
      // edit made since the page was listed isn't overwritten.
      const res = await ctx.app.requestJira(route`/rest/api/3/issue/${item.issueId}?fields=${fieldIds}&properties=${PROPERTY}`);
      if (!res.ok) throw await failure(res, `read ${item.issueKey} in space ${item.space}`);
      const fresh = (await res.json()) as { fields?: Record<string, unknown>; properties?: Record<string, unknown> };
      const plan = planKpiMetaToFields(s.fields, { legacy: fresh.properties?.[PROPERTY], fields: fresh.fields });
      if (plan.action === 'none') return 'alreadyDone';
      if (plan.differences.length > 0) {
        const what = plan.differences.map((d) => `${d.part}: field "${d.field ?? ''}", kpi-meta "${d.legacy ?? ''}"`).join('; ');
        console.info(`[${KPI_META_TO_FIELDS}] ${item.issueKey}: the field already differed and was kept (${what})`);
      }
      // One edit: the copied fields and the marked kpi-meta (01 A6), as the admin.
      const put = await ctx.writer.requestJira(route`/rest/api/3/issue/${item.issueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: plan.fields, properties: [{ key: PROPERTY, value: plan.meta }] }),
      });
      if (put.status === 403 || put.status === 404) {
        throw await failure(put, `edit ${item.issueKey}: you need Edit Issues in space ${item.space}`);
      }
      if (!put.ok) throw await failure(put, `save ${item.issueKey} in space ${item.space}`);
      return 'migrated';
    });
    return { cursor: page.cursor, ...result };
  },
};
