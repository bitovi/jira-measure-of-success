import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  addRefEdgeCases,
  buildScaleFixture,
  createMockJira,
  DELETED_KPI_KEY,
  fixtureTarget,
  storedTargets,
  type MockJira,
  type MockPrincipal,
  type RefEdgeCases,
  type ScaleOptions,
} from './testing/scaleFixture';
import {
  assemblePanel,
  type Assignment,
  type MigrationsData,
  type PanelData,
  type PanelListData,
  type StoredAssignments,
  type TimelineData,
  type TimelineNodeDto,
  type TimelineTargetsData,
} from '../domain/index';

/**
 * Spec 11 · 03: inside the app a KPI is its issue id. Runs the REAL resolver
 * against the in-memory Jira, on the migrated fixture (ids + keys) and the
 * pre-migration one (keys only), with a moved KPI, a deleted KPI's key-only
 * reference and a KPI hidden from the user (`addRefEdgeCases`).
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null, requests: [] as Array<{ route: string; as: string }> }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('./testing/scaleFixture');
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
      h.jira!.fixture.kvs.set(key, value);
    },
  },
}));

// 6 epics (200000…200005); epic N targets KPI-(N+1), issue 10NN. With the edge cases:
// 200000 also targets the deleted KPI-404, 200001 targets only KPI-404, 200002
// targets the moved KPI (1002, KPI-3 → KPI-910), 200003 targets the hidden KPI (1003).
const SMALL = { kpis: 10, initiatives: 2, epicsPerInitiative: 3, storiesPerEpic: 1, subtasksPerStory: 0 };
const STORY = '300000';

let jira: MockJira;
let edge: RefEdgeCases;

function load(refs: ScaleOptions['refs'] = 'migrated', setup?: (jira: MockJira) => void) {
  vi.resetModules();
  jira = createMockJira(buildScaleFixture({ ...SMALL, refs }));
  edge = addRefEdgeCases(jira.fixture);
  setup?.(jira);
  h.jira = jira;
}

async function call<T>(key: string, payload: unknown = {}, context: Record<string, unknown> = {}): Promise<T> {
  h.requests = [];
  const { handler } = await import('./resolver');
  const data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
    { call: { functionKey: key, payload }, context },
    { principal: { accountId: 'acc-1' } },
  )) as T;
  expect(jira.unhandled).toEqual([]);
  return data;
}

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const stored = (issueId: string) => jira.fixture.issues.get(issueId)!.properties['kpi-assignments'] as StoredAssignments;
/** Requests that look a KPI up by key (`/issue/KPI-5`), or search for keys. */
const keyLookups = () => h.requests.filter((r) => /\/issue\/[A-Za-z][A-Za-z0-9_]*-\d+/.test(r.route) || /jql=.*\bkey\s*(=|in)/i.test(r.route));
const requestsAs = (as: MockPrincipal, re: RegExp) => h.requests.filter((r) => r.as === as && re.test(r.route));

const newTarget = (kpiId: string): Assignment => ({
  kpiId,
  inheritFromParent: false,
  target: 7,
  targetType: 'absolute',
  timing: { start: null, due: { mode: 'absolute', absolute: '2026-11-30', anchor: 'issueDueDate', offsetMonths: 0 } },
  updatedBy: 'acc-1',
  updatedAt: 1_800_000_000_000,
});

describe('reads use KPI ids (migrated data)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    load();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the catalog, the timeline and the readings are keyed by issue id, with the key alongside', async () => {
    const list = await call<PanelListData>('getPanelList', { issueId: '200004' });
    expect(list.basis!.catalog.find((c) => c.id === '1000')).toMatchObject({ key: 'KPI-1' });
    const values = await call<{ readings: Record<string, unknown[]> }>('getPanelValues', { issueId: '200004' });
    expect(Object.keys(values.readings)).toContain('1000');
    const timeline = await call<TimelineData>('getTimelineSkeleton');
    expect(flatten(timeline.roots).find((n) => n.kpiId === '1000')).toMatchObject({ id: '1000', issueKey: 'KPI-1' });
  });

  it('a target on a moved KPI shows under it, in the panel and the timeline, labelled with its new key', async () => {
    const list = await call<PanelListData>('getPanelList', { issueId: '200002' });
    const basis = list.basis!;
    expect(basis.own.map((a) => a.kpiId)).toEqual([edge.moved.id]);
    expect(basis.deletedKpiIds).toBeUndefined();
    const row = assemblePanel(basis, null).rows[0];
    expect(row).toMatchObject({ kpiId: edge.moved.id, kpiKey: edge.moved.newKey, name: 'KPI 3' });
    expect(row.kpiMissing).toBeUndefined();

    const timeline = await call<TimelineData>('getTimelineData');
    const node = flatten(timeline.roots).find((n) => n.kpiId === edge.moved.id)!;
    expect(node.issueKey).toBe(edge.moved.newKey);
    expect([...node.targets, ...node.undated].map((t) => t.source.issue)).toContain(jira.fixture.issues.get('200002')!.key);
  });

  it("a deleted KPI's key-only reference is reported deleted without asking Jira", async () => {
    const mixed = await call<PanelListData>('getPanelList', { issueId: edge.mixedIssueId });
    expect(mixed.basis!.own.map((a) => a.kpiId)).toEqual(['1000', DELETED_KPI_KEY]);
    expect(mixed.basis!.deletedKpiIds).toEqual([DELETED_KPI_KEY]);
    expect(h.requests.filter((r) => r.route.includes(DELETED_KPI_KEY))).toEqual([]);

    const alone = await call<PanelData>('getPanelData', { issueId: edge.deletedOnlyIssueId });
    expect(alone.rows).toEqual([expect.objectContaining({ kpiId: DELETED_KPI_KEY, kpiKey: DELETED_KPI_KEY, kpiMissing: true })]);
  });

  it("a target on a KPI the user can't see shows as no access, labelled with its key", async () => {
    const list = await call<PanelListData>('getPanelList', { issueId: '200003' });
    expect(list.basis!.noAccessKpiIds).toEqual([edge.hiddenKpiId]);
    expect(list.basis!.deletedKpiIds).toBeUndefined();
    expect(list.basis!.kpiKeys).toEqual({ [edge.hiddenKpiId]: 'KPI-4' });
    expect(assemblePanel(list.basis!, null).rows[0]).toMatchObject({ kpiKey: 'KPI-4', kpiNoAccess: true });
  });

  it('the timeline discovers targets by kpiIssueIds and leaves out what has no KPI to show under', async () => {
    const targets = await call<TimelineTargetsData>('getTimelineTargets');
    expect(requestsAs('user', /kpiIssueIds IS NOT EMPTY/)).toHaveLength(1);
    expect(h.requests.some((r) => /kpiIds IS NOT EMPTY/.test(r.route))).toBe(false);
    const sources = Object.values(targets.contributions).flat().map((c) => c.source.key);
    // the deleted-only work item has no kpiIssueIds, so it isn't discovered
    expect(sources).not.toContain(jira.fixture.issues.get(edge.deletedOnlyIssueId)!.key);
    expect(Object.keys(targets.contributions).every((id) => /^\d+$/.test(id))).toBe(true);
    expect(Object.keys(targets.contributions)).toEqual(expect.arrayContaining(['1000', edge.moved.id, edge.hiddenKpiId]));
  });

  it('reads make no key-resolution requests', async () => {
    for (const issueId of ['200000', '200001', '200002', '200003', STORY]) {
      await call('getPanelData', { issueId });
      expect(keyLookups()).toEqual([]);
    }
    await call('getTimelineData');
    expect(keyLookups()).toEqual([]);
  });
});

describe('same output as the key-based code', () => {
  it('the panel shows the same rows on migrated data as the key-based code did on the matching pre-migration data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    // Work items with own, parent's and relative targets, and a story. (A KPI issue's own
    // panel loads only that KPI since spec 11 · 06; kpisByWorkType.test checks its node.)
    const scale = { kpis: 10, initiatives: 3, epicsPerInitiative: 4, storiesPerEpic: 2, subtasksPerStory: 1 };
    const issues = ['200000', '200001', '200002', '200003', '200005', '200007', '200010', '300000', '300003'];
    const panels: PanelData[] = [];
    for (const issueId of issues) {
      vi.resetModules();
      jira = createMockJira(buildScaleFixture(scale));
      h.jira = jira;
      panels.push(await call<PanelData>('getPanelData', { issueId }));
    }
    vi.useRealTimers();
    expect(panels.flatMap((p) => p.rows).every((r) => /^\d+$/.test(r.kpiId) && r.kpiKey.startsWith('KPI-'))).toBe(true);

    // Map ids back to keys (and drop the new key fields) to compare with the
    // digest of `getPanelData` on the same issues taken before this change.
    const node = (n: TimelineNodeDto): TimelineNodeDto => ({ ...n, kpiId: n.issueKey, children: n.children.map(node) });
    // Spec 11 · 06: the panel no longer carries `access` (looked up per space when an
    // action needs it) and catalog entries gained their `space`; put back / left out.
    const FULL = { browse: true, create: true, edit: true, link: true };
    const asBefore = panels.map((p) => ({
      ...p,
      rows: p.rows.map(({ kpiKey, ...r }) => ({ ...r, kpiId: kpiKey })),
      catalog: p.catalog.map(({ key, space, ...c }) => {
        void space;
        return { ...c, id: key };
      }),
      access: FULL,
      ...(p.kpiView
        ? {
            kpiView: {
              ...p.kpiView,
              node: node(p.kpiView.node),
              contributions: p.kpiView.contributions?.map((c) => ({
                ...c,
                assignment: { ...c.assignment, kpiId: p.kpiView!.node.issueKey },
              })),
            },
          }
        : {}),
    }));
    const digest = createHash('sha256').update(JSON.stringify(asBefore)).digest('hex');
    // The digest of the code before spec 11 · 06 on these nine issues.
    expect(digest).toBe('7f8f8d18b338d3f6d5e18c2edf9a12b3b506cc98cabfca6b048b098a206baf07');
  });
});

describe('reads before the migration (keys only): the documented degraded state', () => {
  beforeEach(() => load('keys'));

  it('every target reads as a deleted KPI, without asking Jira', async () => {
    const list = await call<PanelListData>('getPanelList', { issueId: '200002' });
    expect(list.basis!.own.map((a) => a.kpiId)).toEqual([edge.moved.oldKey]);
    expect(list.basis!.deletedKpiIds).toEqual([edge.moved.oldKey]);
    expect(keyLookups()).toEqual([]);
  });

  it('the timeline discovers nothing', async () => {
    expect((await call<TimelineTargetsData>('getTimelineTargets')).contributions).toEqual({});
    const timeline = await call<TimelineData>('getTimelineData');
    expect(flatten(timeline.roots).flatMap((n) => [...n.targets, ...n.undated])).toEqual([]);
  });
});

describe('writes store ids and keys', () => {
  it('saving a target on a migrated work item writes id + current key for every id reference, both indexes, and keeps the stamp', async () => {
    load('migrated', (j) => {
      // 200003 targets the hidden KPI (1003), which has since moved too.
      j.fixture.issues.get(edge.hiddenKpiId)!.key = 'KPI-44';
    });
    const before = stored('200003').assignments[0];
    await call('saveAssignment', { issueId: '200003', assignment: newTarget(edge.moved.id) });
    const after = stored('200003');
    expect(after).toEqual({
      assignments: [
        { ...before, kpiIssueId: edge.hiddenKpiId, kpiId: 'KPI-44' },
        { ...newTarget(edge.moved.id), kpiIssueId: edge.moved.id, kpiId: edge.moved.newKey },
      ],
      kpiIssueIds: [edge.hiddenKpiId, edge.moved.id],
      kpiIds: ['KPI-44', edge.moved.newKey],
      refsVersion: 2,
    });
    // The other target keeps its authorship: rewriting a reference isn't an edit.
    expect(after.assignments[0]).toMatchObject({ updatedBy: 'fixture', updatedAt: before.updatedAt });
  });

  it('looks up the keys it does not already have in one id search as the app', async () => {
    load('migrated', (j) => j.fixture.userView.hidden.add('1004'));
    jira.fixture.issues.get('200004')!.properties['kpi-assignments'] = storedTargets(
      [fixtureTarget('KPI-5', { kpiIssueId: '1004' }), fixtureTarget('KPI-1', { kpiIssueId: '1000' })],
      true,
    );
    await call('saveAssignment', { issueId: '200004', assignment: newTarget('1001') });
    // Only the KPI just checked (1001) was already loaded; the others come from one app search.
    const idSearches = h.requests.filter((r) => /jql=id in \(1004,1000\)/.test(r.route));
    expect(idSearches.map((r) => r.as)).toEqual(['app']);
    expect(stored('200004').kpiIds).toEqual(['KPI-5', 'KPI-1', 'KPI-2']);
  });

  it('an id reference whose KPI was deleted keeps the key stored with it', async () => {
    load('migrated', (j) => {
      j.fixture.issues.delete('1005');
      j.fixture.kpiIds = j.fixture.kpiIds.filter((id) => id !== '1005');
    });
    await call('saveAssignment', { issueId: '200005', assignment: newTarget('1000') });
    expect(stored('200005').assignments.map((a) => [a.kpiIssueId, a.kpiId])).toEqual([
      ['1005', 'KPI-6'],
      ['1000', 'KPI-1'],
    ]);
  });

  it('falls back to one GET per id when Jira refuses the id search', async () => {
    load('migrated', (j) => {
      j.fixture.issues.get(edge.hiddenKpiId)!.key = 'KPI-44';
      j.intercept = (method, _path, _body, raw) =>
        method === 'GET' && decodeURIComponent(raw).includes('jql=id in') ? { status: 400 } : undefined;
    });
    await call('saveAssignment', { issueId: '200003', assignment: newTarget('1000') });
    expect(stored('200003').kpiIds).toEqual(['KPI-44', 'KPI-1']);
    expect(requestsAs('app', new RegExp(`/issue/${edge.hiddenKpiId}\\?fields=issuetype`))).toHaveLength(1);
  });

  it('on an unmigrated work item, key-only references are kept as they are and it stays unstamped', async () => {
    load('keys');
    await call('saveAssignment', { issueId: '200002', assignment: newTarget('1000') });
    const after = stored('200002');
    expect(after.assignments.map((a) => [a.kpiIssueId, a.kpiId])).toEqual([
      [undefined, edge.moved.oldKey],
      ['1000', 'KPI-1'],
    ]);
    expect(after.kpiIssueIds).toEqual(['1000']);
    expect(after.kpiIds).toEqual([edge.moved.oldKey, 'KPI-1']);
    expect(after).not.toHaveProperty('refsVersion');
  });

  it('a work item with no targets yet, or only id references, is stamped by its first write and is not pending', async () => {
    load('keys', (j) => {
      // 200005 holds only id references but was never stamped.
      j.fixture.issues.get('200005')!.properties['kpi-assignments'] = storedTargets(
        [fixtureTarget('KPI-6', { kpiIssueId: '1005' })],
        false,
      );
    });
    const pendingBefore = (await call<MigrationsData>('getMigrations', {}, { moduleKey: 'kpi-settings-page' })).migrations[0].status!
      .pending!;
    await call('saveAssignment', { issueId: STORY, assignment: newTarget('1000') });
    await call('saveAssignment', { issueId: '200005', assignment: newTarget('1001') });
    expect(stored(STORY).refsVersion).toBe(2);
    expect(stored('200005').refsVersion).toBe(2);
    const pendingAfter = (await call<MigrationsData>('getMigrations', {}, { moduleKey: 'kpi-settings-page' })).migrations[0].status!
      .pending;
    expect(pendingAfter).toBe(pendingBefore - 1);
  });

  it('removing a deleted KPI\'s key-only target works by its key', async () => {
    load();
    await call('removeAssignment', { issueId: edge.mixedIssueId, kpiId: DELETED_KPI_KEY });
    expect(stored(edge.mixedIssueId)).toMatchObject({ kpiIssueIds: ['1000'], kpiIds: ['KPI-1'], refsVersion: 2 });
  });

  it('addTarget stores the id even when given a key, and writes the current key', async () => {
    load();
    const added = await call<{ assignment: Assignment }>('addTarget', {
      kpiId: edge.moved.oldKey,
      issueId: '200004',
      issueKey: jira.fixture.issues.get('200004')!.key,
      issueType: 'Epic',
      issueTypeIconUrl: null,
      issueSummary: 'Epic 5',
      date: '2026-12-31',
      value: 5,
    });
    expect(added.assignment.kpiId).toBe(edge.moved.id);
    expect(stored('200004').assignments.at(-1)).toMatchObject({ kpiIssueId: edge.moved.id, kpiId: edge.moved.newKey });
  });
});
