import { route } from '@forge/api';
import {
  isKpiIssueId,
  migrateStoredAssignments,
  parseKpiRef,
  REFS_VERSION,
  StoredAssignments,
  type MigrationStatus,
} from '../../domain/index';
import { resolveKpiKeys } from '../jira';
import { MIGRATION_BATCH_SIZE, migrateItems, type Migration, type MigrationContext } from './index';

/**
 * `kpi-target-refs-to-ids` (spec 11 · 03): stores the KPI's issue id next to its
 * key on every target (`kpi-assignments`), so targets survive a KPI moving
 * space. Writes as the app: targets live on work items in every project, and an
 * admin may not be able to edit them all (entity properties aren't in History).
 * Copy only: `kpiId` keeps a key (now the KPI's current one), `kpiIds` stays.
 */
export const KPI_TARGET_REFS_TO_IDS = 'kpi-target-refs-to-ids';

const PROPERTY = 'kpi-assignments';
/**
 * Every work item with targets. Stable (it doesn't filter on `refsVersion`), so
 * `nextPageToken` paging can't skip items as they're migrated (01 E2).
 */
const TARGETS_JQL = `issue.property[${PROPERTY}].kpiIds IS NOT EMPTY`;
const PAGE_JQL = `${TARGETS_JQL} ORDER BY id ASC`;
/** What's left: work items not yet stamped `refsVersion` (01 D5). */
const PENDING_JQL = `${TARGETS_JQL} AND issue.property[${PROPERTY}].refsVersion IS EMPTY`;

type Jira = MigrationContext['writer'];

interface PageIssue {
  id: string;
  key: string;
  properties?: Record<string, unknown>;
}

async function failure(res: { status: number; json(): Promise<unknown> }, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { errorMessages?: string[] };
  return new Error(`Jira ${res.status} while trying to ${action}${body.errorMessages?.length ? `: ${body.errorMessages.join('; ')}` : ''}`);
}

async function searchPage(jira: Jira, cursor: string | null): Promise<{ issues: PageIssue[]; cursor: string | null }> {
  const res = await jira.requestJira(
    cursor
      ? route`/rest/api/3/search/jql?jql=${PAGE_JQL}&fields=summary&properties=${PROPERTY}&maxResults=${MIGRATION_BATCH_SIZE}&nextPageToken=${cursor}`
      : route`/rest/api/3/search/jql?jql=${PAGE_JQL}&fields=summary&properties=${PROPERTY}&maxResults=${MIGRATION_BATCH_SIZE}`,
  );
  if (!res.ok) throw await failure(res, 'list the work items with KPI targets');
  const data = (await res.json()) as { issues?: PageIssue[]; nextPageToken?: string; isLast?: boolean };
  return { issues: data.issues ?? [], cursor: data.isLast === false && data.nextPageToken ? data.nextPageToken : null };
}

async function readProperty(jira: Jira, issueId: string): Promise<unknown> {
  const res = await jira.requestJira(route`/rest/api/3/issue/${issueId}/properties/${PROPERTY}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw await failure(res, `read the targets on ${issueId}`);
  return ((await res.json()) as { value?: unknown }).value;
}

/** JSON equality that ignores key order (Jira may not return keys as they were written). */
function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canonical(x)]))
        : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** The keys an unmigrated property still references by key alone. */
function keyOnlyRefs(stored: StoredAssignments): string[] {
  return stored.assignments.flatMap((a) => {
    if (a.kpiIssueId !== undefined && isKpiIssueId(a.kpiIssueId)) return [];
    const ref = parseKpiRef(a.kpiId);
    return ref.kind === 'key' ? [ref.key] : [];
  });
}

export const kpiTargetRefsToIds: Migration = {
  id: KPI_TARGET_REFS_TO_IDS,
  title: 'Point targets at KPI ids',
  description:
    "Saves each KPI's issue id next to its key on every target, so targets keep working when a KPI moves to another space.",
  writeAs: 'app',

  async status(ctx): Promise<MigrationStatus> {
    const res = await ctx.app.requestJira(route`/rest/api/3/search/approximate-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: PENDING_JQL }),
    });
    if (!res.ok) throw await failure(res, 'count the work items left to migrate');
    const { count } = (await res.json()) as { count?: number };
    return { applicable: true, pending: typeof count === 'number' ? count : null };
  },

  async runBatch(ctx, cursor) {
    const page = await searchPage(ctx.writer, cursor);
    const items = page.issues.map((issue) => {
      const raw = issue.properties?.[PROPERTY];
      const parsed = StoredAssignments.safeParse(raw);
      return { issueId: String(issue.id), issueKey: issue.key, raw, stored: parsed.success ? parsed.data : null };
    });

    // One lookup per distinct key in the batch, as the app.
    const keys = items.flatMap((i) => (i.stored && i.stored.refsVersion !== REFS_VERSION ? keyOnlyRefs(i.stored) : []));
    const resolved = await resolveKpiKeys(keys, ctx.app);
    const idOfKey = new Map([...resolved.found].map(([key, kpi]) => [key, kpi.id]));
    const keyOfId = new Map([...resolved.found.values()].map((kpi) => [kpi.id, kpi.key]));

    const result = await migrateItems(items, async (item) => {
      if (!item.stored) throw new Error("Its kpi-assignments property isn't in a format this app reads.");
      if (item.stored.refsVersion === REFS_VERSION) return 'alreadyDone';
      const unresolved = keyOnlyRefs(item.stored).find((key) => resolved.errors.has(key));
      if (unresolved) throw new Error(`Couldn't look up ${unresolved}: ${resolved.errors.get(unresolved)}`);

      const plan = migrateStoredAssignments(item.stored, idOfKey, keyOfId);
      if (plan.deletedKeys.length > 0) {
        console.info(`[${KPI_TARGET_REFS_TO_IDS}] ${item.issueKey}: left deleted KPI references as they are: ${plan.deletedKeys.join(', ')}`);
      }
      // The PUT replaces the whole property: re-read it right before writing and
      // leave the item for a retry if a target was saved since the batch read.
      const current = await readProperty(ctx.writer, item.issueId);
      if (!sameJson(current, item.raw)) {
        throw new Error('Its targets changed during the run. Retry to migrate it.');
      }
      const res = await ctx.writer.requestJira(route`/rest/api/3/issue/${item.issueId}/properties/${PROPERTY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.stored),
      });
      if (!res.ok) throw await failure(res, `save the targets on ${item.issueKey}`);
      return plan.outcome;
    });
    return { cursor: page.cursor, ...result };
  },
};
