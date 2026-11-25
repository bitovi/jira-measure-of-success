import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRefEdgeCases,
  buildScaleFixture,
  createMockJira,
  DELETED_KPI_KEY,
  type MockJira,
  type RefEdgeCases,
} from '../testing/scaleFixture';
import type { MigrationRecord, MigrationsData, StoredAssignments } from '../../domain/index';
import type { MigrationContext } from './index';

/**
 * `kpi-target-refs-to-ids` (spec 11 · 03) through the REAL resolver and the
 * real registry, against the in-memory Jira on pre-migration (keys only) data.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null, requests: [] as Array<{ route: string; as: string }> }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('../testing/scaleFixture');
  const api = mockForgeApi(
    () => h.jira!,
    (route, as) => h.requests.push({ route: decodeURIComponent(String((route as { value: string }).value)), as }),
  );
  return { default: api, ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.jira!.fixture.kvs.get(key),
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, structuredClone(value));
    },
  },
}));

const ID = 'kpi-target-refs-to-ids';
const SETTINGS = { moduleKey: 'kpi-settings-page' };
// 60 target-carrying epics (three batches: 25, 25, 10), keys only, plus the edge cases.
const FIXTURE = { kpis: 10, initiatives: 3, epicsPerInitiative: 20, storiesPerEpic: 0, subtasksPerStory: 0, refs: 'keys' as const };
/** Epics already migrated before this run (e.g. saved by this version). */
const ALREADY_MIGRATED = ['200050', '200051'];

type Handler = (req: unknown, runtime: unknown) => Promise<unknown>;
let handler: Handler;
let jira: MockJira;
let edge: RefEdgeCases;

async function load() {
  vi.resetModules();
  jira = createMockJira(buildScaleFixture(FIXTURE));
  edge = addRefEdgeCases(jira.fixture);
  for (const id of ALREADY_MIGRATED) {
    const issue = jira.fixture.issues.get(id)!;
    const prop = issue.properties['kpi-assignments'] as StoredAssignments;
    const kpiId = prop.assignments[0].kpiId;
    const kpiIssueId = [...jira.fixture.issues.values()].find((i) => i.key === kpiId)!.id;
    issue.properties['kpi-assignments'] = {
      ...prop,
      assignments: [{ ...prop.assignments[0], kpiIssueId }],
      kpiIssueIds: [kpiIssueId],
      refsVersion: 2,
    };
  }
  h.jira = jira;
  (await import('./index')).setMigrationRegistryForTests(null);
  handler = (await import('../resolver')).handler as Handler;
}

async function call<T>(key: string, payload: unknown = {}) {
  return (await handler({ call: { functionKey: key, payload }, context: SETTINGS }, { principal: { accountId: 'acc-1' } })) as T;
}
const runBatch = () => call<MigrationRecord>('runMigrationBatch', { id: ID });
async function runToEnd(): Promise<MigrationRecord> {
  for (let i = 0; i < 20; i += 1) {
    const record = await runBatch();
    if (record.cursor === null) return record;
  }
  throw new Error('migration never finished');
}
/** `status().pending`, as the app (getMigrations doesn't count a `done` migration). */
const pending = async () => {
  const { kpiTargetRefsToIds } = await import('./kpiTargetRefsToIds');
  const app = jira as unknown as MigrationContext['app'];
  return (await kpiTargetRefsToIds.status({ accountId: null, writer: app, app })).pending;
};
const stored = (issueId: string) => jira.fixture.issues.get(issueId)!.properties['kpi-assignments'] as StoredAssignments;
const contributors = () => jira.fixture.contributorIds;
const propertyWrites = () => jira.writes.filter((w) => w.endsWith('/properties/kpi-assignments'));

beforeEach(async () => {
  await load();
});

describe('kpi-target-refs-to-ids', () => {
  it('is registered, writes as the app, and counts what is left with one approximate-count as the app', async () => {
    h.requests = [];
    const countJql: string[] = [];
    jira.intercept = (method, path, body) => {
      if (method === 'POST' && path === '/rest/api/3/search/approximate-count') countJql.push((JSON.parse(String(body)) as { jql: string }).jql);
      return undefined;
    };
    const status = (await call<MigrationsData>('getMigrations')).migrations.find((m) => m.id === ID)!.status;
    expect(countJql).toEqual([
      'issue.property[kpi-assignments].kpiIds IS NOT EMPTY AND issue.property[kpi-assignments].refsVersion IS EMPTY',
    ]);
    expect(status).toEqual({ applicable: true, pending: contributors().length - ALREADY_MIGRATED.length });
    const counts = h.requests.filter((r) => r.route.endsWith('/search/approximate-count'));
    expect(counts.map((r) => r.as)).toEqual(['app']);
    expect(counts[0].route).toBe('/rest/api/3/search/approximate-count');
    const { migrations } = await call<MigrationsData>('getMigrations');
    expect(migrations[0]).toMatchObject({ id: ID, writeAs: 'app', dependsOn: [] });
  });

  it('migrates mixed data: ids next to the current keys, deleted KPIs left as keys, every item stamped, nothing deleted', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const before = structuredClone(stored(edge.mixedIssueId));
    const last = await runToEnd();
    expect(last).toMatchObject({
      state: 'done',
      cursor: null,
      counts: {
        migrated: contributors().length - ALREADY_MIGRATED.length - 1,
        alreadyDone: ALREADY_MIGRATED.length,
        skipped: 1, // the work item whose only target is on a deleted KPI
        failed: 0,
      },
      failures: [],
    });
    expect(await pending()).toBe(0);

    // A target on the moved KPI gets its id and its current key.
    expect(stored('200002')).toEqual(
      expect.objectContaining({ kpiIssueIds: [edge.moved.id], kpiIds: [edge.moved.newKey], refsVersion: 2 }),
    );
    expect(stored('200002').assignments[0]).toMatchObject({ kpiIssueId: edge.moved.id, kpiId: edge.moved.newKey });
    // The deleted KPI stays a key next to the live target; authorship unchanged.
    expect(stored(edge.mixedIssueId)).toEqual({
      assignments: [
        { ...before.assignments[0], kpiIssueId: '1000', kpiId: 'KPI-1' },
        before.assignments[1],
      ],
      kpiIssueIds: ['1000'],
      kpiIds: ['KPI-1', DELETED_KPI_KEY],
      refsVersion: 2,
    });
    // Only deleted KPIs: stamped (so not pending), still key-only.
    expect(stored(edge.deletedOnlyIssueId)).toMatchObject({ kpiIssueIds: [], kpiIds: [DELETED_KPI_KEY], refsVersion: 2 });
    // The unresolved key is reported.
    expect(info.mock.calls.flat().join('\n')).toContain(DELETED_KPI_KEY);
    // Already-migrated items aren't rewritten.
    for (const id of ALREADY_MIGRATED) expect(propertyWrites()).not.toContain(`PUT /rest/api/3/issue/${id}/properties/kpi-assignments`);
    expect(propertyWrites()).toHaveLength(contributors().length - ALREADY_MIGRATED.length);
    expect(jira.unhandled).toEqual([]);
    info.mockRestore();
  });

  it('resolves each key once per batch, as the app; a second run (another install) is all already done, with no writes', async () => {
    h.requests = [];
    await runToEnd();
    const keyGets = h.requests.filter((r) => /\/issue\/KPI-\d+\?fields=issuetype/.test(r.route));
    expect(new Set(keyGets.map((r) => r.as))).toEqual(new Set(['app']));
    // 10 KPIs + the deleted key, looked up in each of the 3 batches at most
    expect(keyGets.length).toBeLessThanOrEqual(11 * 3);

    jira.fixture.kvs.delete(`kpi:migration:${ID}`);
    const writes = propertyWrites().length;
    const again = await runToEnd();
    expect(again).toMatchObject({ state: 'done', counts: { migrated: 0, alreadyDone: contributors().length, skipped: 0, failed: 0 } });
    expect(propertyWrites().length).toBe(writes);
  });

  it('migrates work items the admin cannot see (written as the app)', async () => {
    const hidden = contributors().slice(5, 8);
    for (const id of hidden) jira.fixture.userView.hidden.add(id);
    jira.fixture.userView.access.APP = { browse: false, create: false, edit: false, link: false };
    expect((await runToEnd()).state).toBe('done');
    for (const id of hidden) expect(stored(id).refsVersion).toBe(2);
    expect(stored('200000').refsVersion).toBe(2); // an APP work item
  });

  it('a work item saved between the batch read and the write is left pending: the run ends failed, a retry ends done', async () => {
    const victim = '200010';
    let saved = false;
    jira.intercept = (method, path, _body, _raw, as) => {
      // The migration's re-read: someone saves a target first (an app save keeps key-only refs and doesn't stamp).
      if (!saved && method === 'GET' && as === 'app' && path === `/rest/api/3/issue/${victim}/properties/kpi-assignments`) {
        saved = true;
        const prop = stored(victim);
        jira.fixture.issues.get(victim)!.properties['kpi-assignments'] = {
          ...prop,
          assignments: [{ ...prop.assignments[0], target: 12345 }],
        };
      }
      return undefined;
    };
    const last = await runToEnd();
    expect(last.state).toBe('failed');
    expect(last.counts.failed).toBe(1);
    expect(last.failures).toEqual([
      { issueId: victim, issueKey: jira.fixture.issues.get(victim)!.key, message: 'Its targets changed during the run. Retry to migrate it.' },
    ]);
    // The save wasn't overwritten, and the item is still pending.
    expect(stored(victim).assignments[0].target).toBe(12345);
    expect(stored(victim).refsVersion).toBeUndefined();
    expect(await pending()).toBe(1);

    await call('retryMigration', { id: ID });
    const retried = await runToEnd();
    expect(retried).toMatchObject({ state: 'done', counts: { migrated: 1, failed: 0 } });
    expect(stored(victim)).toMatchObject({ refsVersion: 2, assignments: [{ target: 12345, kpiIssueId: expect.any(String) }] });
  });

  it('resumes from the saved cursor after a failed batch', async () => {
    const first = await runBatch();
    expect(first.cursor).not.toBeNull();
    let fail = true;
    jira.intercept = (method, path, _body, raw) => {
      if (fail && method === 'GET' && path === '/rest/api/3/search/jql' && raw.includes('nextPageToken')) {
        fail = false;
        return { status: 503, body: { errorMessages: ['Service unavailable'] } };
      }
      return undefined;
    };
    await expect(runBatch()).rejects.toThrow(/Jira 503 while trying to list the work items with KPI targets/);
    const stored = jira.fixture.kvs.get(`kpi:migration:${ID}`) as MigrationRecord;
    expect(stored.cursor).toBe(first.cursor);
    const last = await runToEnd();
    expect(last).toMatchObject({ state: 'done', counts: { failed: 0 } });
    expect(last.counts.migrated + last.counts.alreadyDone + last.counts.skipped).toBe(contributors().length);
    expect(propertyWrites()).toHaveLength(contributors().length - ALREADY_MIGRATED.length);
  });

  it('a key lookup that fails (not a 404) fails those items instead of treating the KPI as deleted', async () => {
    let fail = true;
    jira.intercept = (method, path) => {
      if (fail && method === 'GET' && path === '/rest/api/3/issue/KPI-2') {
        fail = false;
        return { status: 500 };
      }
      return undefined;
    };
    const last = await runToEnd();
    expect(last.state).toBe('failed');
    expect(last.failures.length).toBeGreaterThan(0);
    expect(last.failures.every((f) => f.message.startsWith("Couldn't look up KPI-2"))).toBe(true);
    for (const f of last.failures) expect(stored(f.issueId).refsVersion).toBeUndefined();
    await call('retryMigration', { id: ID });
    expect((await runToEnd()).state).toBe('done');
  });
});
