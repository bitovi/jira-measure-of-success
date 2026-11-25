import { route } from '@forge/api';
import type { MigrationStatus } from '../../domain/index';
import { MIGRATION_BATCH_SIZE, migrateItems, type Migration, type MigrationContext } from '../migrations/index';

/**
 * A test-only migration over the scale fixture's target-carrying issues: it
 * copies each issue's `kpi-assignments` kpiIds into a `test-copy` property.
 * Pages a stable query (writes don't change what it matches) by
 * nextPageToken. The switches fail an item, throw part-way through a batch, or
 * skip items on purpose; hide items from the user with `fixture.userView.hidden`.
 */
export const TEST_COPY_PROPERTY = 'test-copy';
const JQL = 'issue.property[kpi-assignments].kpiIds IS NOT EMPTY';

export interface TestMigrationSwitches {
  /** issue ids whose write fails */
  failIds: Set<string>;
  /** issue ids the planner skips (e.g. a reference to a deleted KPI) */
  skipIds: Set<string>;
  /** throw after the next batch's first 5 items are written (once) */
  throwMidBatch: boolean;
  applicable: boolean;
  statusCalls: number;
  batchCalls: number;
}

interface SearchIssue {
  id: string;
  key: string;
  properties?: Record<string, unknown>;
}

type Outcome = 'migrate' | 'alreadyDone' | 'skipped';

function plan(issue: SearchIssue, switches: TestMigrationSwitches): Outcome {
  if (switches.skipIds.has(issue.id)) return 'skipped';
  const want = (issue.properties?.['kpi-assignments'] as { kpiIds?: string[] } | undefined)?.kpiIds ?? [];
  const have = (issue.properties?.[TEST_COPY_PROPERTY] as { kpiIds?: string[] } | undefined)?.kpiIds;
  return JSON.stringify(have) === JSON.stringify(want) ? 'alreadyDone' : 'migrate';
}

async function searchPage(
  jira: MigrationContext['writer'],
  cursor: string | null,
  maxResults: number,
): Promise<{ issues: SearchIssue[]; cursor: string | null }> {
  const props = `kpi-assignments,${TEST_COPY_PROPERTY}`;
  const res = await jira.requestJira(
    cursor
      ? route`/rest/api/3/search/jql?jql=${JQL}&properties=${props}&maxResults=${maxResults}&nextPageToken=${cursor}`
      : route`/rest/api/3/search/jql?jql=${JQL}&properties=${props}&maxResults=${maxResults}`,
  );
  if (!res.ok) throw new Error(`Jira ${res.status} while searching`);
  const data = (await res.json()) as { issues?: SearchIssue[]; nextPageToken?: string; isLast?: boolean };
  return { issues: data.issues ?? [], cursor: data.isLast === false && data.nextPageToken ? data.nextPageToken : null };
}

export function createTestMigration(
  over: Partial<Pick<Migration, 'id' | 'title' | 'dependsOn' | 'writeAs'>> = {},
): { migration: Migration; switches: TestMigrationSwitches } {
  const switches: TestMigrationSwitches = {
    failIds: new Set(),
    skipIds: new Set(),
    throwMidBatch: false,
    applicable: true,
    statusCalls: 0,
    batchCalls: 0,
  };
  const migration: Migration = {
    id: 'test-copy',
    title: 'Test copy',
    description: 'Copies target KPI ids into a test property.',
    writeAs: 'user',
    ...over,
    async status(ctx): Promise<MigrationStatus> {
      switches.statusCalls += 1;
      if (!switches.applicable) return { applicable: false, reason: 'Nothing to copy on this site.', pending: null };
      let pending = 0;
      let cursor: string | null = null;
      do {
        const page = await searchPage(ctx.app, cursor, 100);
        pending += page.issues.filter((i) => plan(i, switches) === 'migrate').length;
        cursor = page.cursor;
      } while (cursor);
      return { applicable: true, pending };
    },
    async runBatch(ctx, cursor) {
      switches.batchCalls += 1;
      const page = await searchPage(ctx.writer, cursor, MIGRATION_BATCH_SIZE);
      const throwAfter = switches.throwMidBatch ? 5 : Infinity;
      const items = page.issues.map((issue) => ({ issueId: issue.id, issueKey: issue.key, issue }));
      const result = await migrateItems(items.slice(0, throwAfter), async ({ issue }) => {
        const outcome = plan(issue, switches);
        if (outcome !== 'migrate') return outcome;
        if (switches.failIds.has(issue.id)) throw new Error(`Jira 403: You do not have permission to edit ${issue.key}.`);
        const kpiIds = (issue.properties?.['kpi-assignments'] as { kpiIds: string[] }).kpiIds;
        const res = await ctx.writer.requestJira(route`/rest/api/3/issue/${issue.id}/properties/${TEST_COPY_PROPERTY}`, {
          method: 'PUT',
          body: JSON.stringify({ kpiIds }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { errorMessages?: string[] };
          throw new Error(`Jira ${res.status}: ${body.errorMessages?.join('; ') ?? 'save failed'}`);
        }
        return 'migrated';
      });
      if (items.length > throwAfter) {
        switches.throwMidBatch = false;
        throw new Error('Simulated batch failure');
      }
      return { cursor: page.cursor, ...result };
    },
  };
  return { migration, switches };
}
