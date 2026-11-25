import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addKpiSpaces,
  buildScaleFixture,
  chooseKpiFields,
  createMockJira,
  GROWTH_PROJECT,
  KPI_DIRECTION_FIELD_ID,
  KPI_PROJECT,
  KPI_UNIT_FIELD_ID,
  PORTFOLIO_PROJECT,
  TEAM_MANAGED_PROJECT,
  type KpiFieldsShape,
  type KpiSpaces,
  type MockJira,
} from './testing/scaleFixture';
import {
  applyTargetContributions,
  type CreatedKpi,
  type MigrationRecord,
  type PanelData,
  type PanelListData,
  type PanelValuesData,
  type TimelineData,
  type TimelineNodeDto,
  type TimelineTargetsData,
} from '../domain/index';
import type { Trace } from './requestLog';

/**
 * Spec 11 · 06 — KPIs by work type, in many spaces. Runs the REAL resolver
 * against the in-memory Jira with the multi-space fixture (`addKpiSpaces`):
 * the central KPI space, Portfolio and Growth (company-managed, with KPIs
 * nested across spaces), a team-managed space with its own "KPI" type, and a
 * Story in the central space.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('./testing/scaleFixture');
  return { default: mockForgeApi(() => h.jira!), ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.jira!.fixture.kvs.get(key),
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, structuredClone(value));
    },
  },
}));

const SMALL = { kpis: 10, initiatives: 2, epicsPerInitiative: 3, storiesPerEpic: 1, subtasksPerStory: 0 };
const SETTINGS = { moduleKey: 'kpi-settings-page' };
const NO_ACCESS = { browse: false, create: false, edit: false, link: false };
const READ_ONLY = { browse: true, create: false, edit: false, link: false };
const KPI_1 = '1000';

let jira: MockJira;
let spaces: KpiSpaces;

/** A fresh multi-space site; `fields` chooses the KPI fields (after the spaces, so their KPIs take the shape). */
function load(fields: KpiFieldsShape | null = null, setup?: (j: MockJira) => void) {
  vi.resetModules();
  const fixture = buildScaleFixture(SMALL);
  spaces = addKpiSpaces(fixture);
  if (fields) chooseKpiFields(fixture, fields);
  jira = createMockJira(fixture);
  h.jira = jira;
  setup?.(jira);
}

async function call<T>(key: string, payload: unknown = {}, context: Record<string, unknown> = {}) {
  const { handler } = await import('./resolver');
  const { setTraceSink } = await import('./requestLog');
  let trace: Trace | undefined;
  setTraceSink((t) => {
    trace = t;
  });
  const writesBefore = jira.writes.length;
  let data: T | undefined;
  let error: Error | undefined;
  try {
    data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
      { call: { functionKey: key, payload }, context: { accountId: 'acc-1', ...context } },
      { principal: { accountId: 'acc-1' } },
    )) as T;
  } catch (e) {
    error = e as Error;
  }
  expect(jira.unhandled).toEqual([]);
  const requests = trace?.requests ?? [];
  return {
    data,
    error,
    writes: jira.writes.slice(writesBefore),
    count: (endpoint: string) => requests.filter((r) => r.endpoint === endpoint).length,
    endpoints: requests.map((r) => r.endpoint),
  };
}

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const byKey = (roots: TimelineNodeDto[], key: string) => flatten(roots).find((n) => n.issueKey === key);
const childKeys = (roots: TimelineNodeDto[], key: string) => byKey(roots, key)?.children.map((c) => c.issueKey) ?? [];
const rootKeys = (roots: TimelineNodeDto[]) => roots.map((r) => r.issueKey);

/** Record the issue ids of every changelog bulkfetch. */
function captureBulkfetch(j: MockJira): string[][] {
  const bodies: string[][] = [];
  j.intercept = (method, path, body) => {
    if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
      bodies.push((JSON.parse(String(body)) as { issueIdsOrKeys: string[] }).issueIdsOrKeys);
    }
    return undefined;
  };
  return bodies;
}

describe('Step 2: "is a KPI" by work type', () => {
  beforeEach(() => load());

  it('finds KPIs in every company-managed space, not the team-managed "KPI" nor a Story in the central space', async () => {
    const { data } = await call<TimelineData>('getTimelineData');
    const keys = flatten(data!.roots).map((n) => n.issueKey);
    expect(keys).toEqual(expect.arrayContaining(['KPI-1', 'PORT-1', 'PORT-2', 'GROW-1', 'GROW-2', 'GROW-3']));
    expect(keys).not.toContain('TMP-1');
    expect(keys).not.toContain('KPI-500');
    expect(keys).toHaveLength(SMALL.kpis + 5);
    expect(byKey(data!.roots, 'PORT-2')!.space).toEqual(PORTFOLIO_PROJECT);
    expect(byKey(data!.roots, 'GROW-1')!.space).toEqual(GROWTH_PROJECT);
    expect(byKey(data!.roots, 'KPI-1')!.space).toEqual(KPI_PROJECT);
  });

  it('derives the work type by name on an install with nothing saved, skipping a team-managed type listed first', async () => {
    const { data } = await call<TimelineData>('getTimelineSkeleton');
    expect(flatten(data!.roots).map((n) => n.issueKey)).not.toContain('TMP-1');
    expect(flatten(data!.roots)).toHaveLength(SMALL.kpis + 5);
  });

  it('a Story in the central space and the team-managed "KPI" are not KPIs: no KPI writes on them', async () => {
    const story = await call('recordValue', { kpiId: spaces.centralStoryId, date: '2026-06-01', value: 1 });
    expect(story.error?.message).toBe("KPI-500 isn't a KPI, so values can't be recorded on it.");
    const tmp = await call('recordValue', { kpiId: spaces.teamManagedKpiId, date: '2026-06-01', value: 1 });
    expect(tmp.error?.message).toBe("TMP-1 isn't a KPI, so values can't be recorded on it.");
    expect([...story.writes, ...tmp.writes]).toEqual([]);
  });

  it('the panel on a team-managed "KPI" or a central-space Story is a work item panel, not the KPI view', async () => {
    for (const id of [spaces.teamManagedKpiId, spaces.centralStoryId]) {
      const { data } = await call<PanelListData>('getPanelList', { issueId: id });
      expect(data!.basis).toBeDefined();
      expect(data!.panel).toBeUndefined();
    }
  });

  it('with no KPI work type at all: an empty Timeline that says so, and nothing searched', async () => {
    load(null, (j) => {
      j.fixture.issueTypes = j.fixture.issueTypes.filter((t) => t.name !== 'KPI');
    });
    const { data, endpoints } = await call<TimelineData>('getTimelineSkeleton');
    expect(data).toMatchObject({ roots: [], noWorkType: true });
    expect(endpoints.some((e) => e.includes('search/jql'))).toBe(false);
  });
});

describe('Step 3: access per space, looked up only when an action needs it', () => {
  it('loading the Timeline or the panel makes no permission lookup', async () => {
    load();
    for (const [key, payload] of [
      ['getTimelineSkeleton', {}],
      ['getTimelineTargets', {}],
      ['getPanelList', { issueId: spaces.crossSpaceTargetIssueId }],
      ['getPanelValues', { issueId: spaces.crossSpaceTargetIssueId }],
    ] as const) {
      const { count } = await call(key, payload);
      expect(count('GET /rest/api/3/mypermissions'), key).toBe(0);
    }
  });

  it('getKpiAccess answers for one space: Edit in the central space says nothing about Portfolio', async () => {
    load(null, (j) => {
      j.fixture.userView.access[PORTFOLIO_PROJECT.key] = READ_ONLY;
    });
    expect((await call('getKpiAccess', { projectKey: 'KPI' })).data).toEqual({
      projectKey: 'KPI',
      access: { browse: true, create: true, edit: true, link: true },
    });
    const port = await call('getKpiAccess', { projectKey: 'PORT' });
    expect(port.data).toEqual({ projectKey: 'PORT', access: READ_ONLY });
    expect(port.count('GET /rest/api/3/mypermissions')).toBe(1);
  });

  it('Edit Issues in one space doesn’t allow recording on a KPI in another, and the message names its space', async () => {
    load(null, (j) => {
      j.fixture.userView.access[PORTFOLIO_PROJECT.key] = READ_ONLY;
    });
    const central = await call('recordValue', { kpiId: KPI_1, date: '2026-06-01', value: 1 });
    expect(central.error).toBeUndefined();
    const port = await call('recordValue', { kpiId: spaces.portChildId, date: '2026-06-01', value: 1 });
    expect(port.error?.message).toBe(
      'Recording a value on PORT-2 needs Edit Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    expect(port.writes).toEqual(['PUT /rest/api/3/issue/5001']);
    expect(jira.fixture.readingChanges.get(spaces.portChildId)).toHaveLength(2);
  });

  it('a user without Browse on a space never sees its KPIs, on the Timeline or in the panel', async () => {
    load(null, (j) => {
      j.fixture.userView.access[GROWTH_PROJECT.key] = NO_ACCESS;
    });
    const { data: timeline } = await call<TimelineData>('getTimelineData');
    expect(flatten(timeline!.roots).some((n) => n.space?.key === 'GROW')).toBe(false);
    const { data: list } = await call<PanelListData>('getPanelList', { issueId: spaces.crossSpaceTargetIssueId });
    expect(list!.basis!.kpis.some((c) => c.space?.key === 'GROW')).toBe(false);
    const picker = list!.basis!.picker!;
    const listed = [
      ...picker.inThisSpace,
      ...picker.trackedByParents.flatMap((b) => b.targets.flatMap((t) => [t.option, ...t.subKpis])),
    ];
    expect(listed.some((o) => o.space.key === 'GROW')).toBe(false);
    // Its target on GROW-1 stays, flagged no-permission.
    expect(list!.basis!.noAccessKpiIds).toEqual([spaces.growUnderCentralId]);
    const { data: values } = await call<PanelValuesData>('getPanelValues', { issueId: spaces.crossSpaceTargetIssueId });
    expect(Object.keys(values!.readings)).not.toContain(spaces.growUnderCentralId);
  });
});

describe('Step 4: Timeline, panel and create across spaces', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('one tree across spaces; a KPI with two parent links shows once, under its lowest-id parent', async () => {
    load();
    const { data } = await call<TimelineData>('getTimelineData');
    const roots = data!.roots;
    // Siblings by rank (the fixture ranks KPI-5…KPI-2 first, then the other spaces' KPIs).
    expect(childKeys(roots, 'KPI-1')).toEqual(['KPI-5', 'KPI-4', 'KPI-3', 'KPI-2', 'GROW-1', 'GROW-2']);
    expect(childKeys(roots, 'PORT-1')).toEqual(['PORT-2']);
    expect(childKeys(roots, 'PORT-2')).toEqual(['GROW-3']);
    expect(rootKeys(roots)).toContain('PORT-1');
    expect(flatten(roots).filter((n) => n.issueKey === 'GROW-2')).toHaveLength(1);
    expect(byKey(roots, 'GROW-3')!.depth).toBe(2);
  });

  it('targets and readings on KPIs in other spaces', async () => {
    load();
    const { data } = await call<TimelineData>('getTimelineData');
    const source = jira.fixture.issues.get(spaces.crossSpaceTargetIssueId)!.key;
    for (const key of ['GROW-1', 'PORT-2']) {
      const node = byKey(data!.roots, key)!;
      expect([...node.targets, ...node.undated].map((t) => t.source.issue)).toEqual([source]);
      expect(node.readings).toHaveLength(2);
    }
  });

  it('a KPI whose parent KPI is in a space the user can’t browse is top-level', async () => {
    load(null, (j) => {
      j.fixture.userView.access[PORTFOLIO_PROJECT.key] = NO_ACCESS;
    });
    const { data } = await call<TimelineData>('getTimelineData');
    expect(rootKeys(data!.roots)).toContain('GROW-3');
    expect(byKey(data!.roots, 'GROW-3')!.depth).toBe(0);
    expect(childKeys(data!.roots, 'KPI-1')).toContain('GROW-2');
    expect(flatten(data!.roots).some((n) => n.space?.key === 'PORT')).toBe(false);
  });

  it('the panel reads its targeted KPIs from every space, by work type, with their space', async () => {
    load();
    const { data } = await call<PanelListData>('getPanelList', { issueId: spaces.crossSpaceTargetIssueId });
    const kpis = data!.basis!.kpis;
    expect(kpis.map((c) => c.key)).toEqual(expect.arrayContaining(['GROW-1', 'PORT-2']));
    expect(kpis.find((c) => c.key === 'GROW-1')!.space).toEqual(GROWTH_PROJECT);
    expect(kpis.find((c) => c.key === 'PORT-2')!.space).toEqual(PORTFOLIO_PROJECT);
  });

  it('nests across spaces, checking Link Issues on the child’s space only', async () => {
    load(null, (j) => {
      j.fixture.userView.access[KPI_PROJECT.key] = { browse: true, create: true, edit: true, link: false };
    });
    const moved = await call('updateKpi', { kpiId: spaces.growUnderPortChildId, parentKpiId: '1001' });
    expect(moved.error).toBeUndefined();
    expect(jira.fixture.issues.get(spaces.growUnderPortChildId)!.kpiParentId).toBe('1001');

    load(null, (j) => {
      j.fixture.userView.access[GROWTH_PROJECT.key] = { browse: true, create: true, edit: true, link: false };
    });
    const refused = await call('updateKpi', { kpiId: spaces.growUnderPortChildId, parentKpiId: '1001' });
    expect(refused.error?.message).toBe(
      'Nesting a KPI under another needs Link Issues permission on the Growth space. Ask a Jira admin.',
    );
    expect(refused.writes).toEqual([]);
  });

  it('nesting replaces every parent link, so a KPI with two parents ends with one', async () => {
    load();
    const { error } = await call('updateKpi', { kpiId: spaces.growTwoParentsId, parentKpiId: spaces.portChildId });
    expect(error).toBeUndefined();
    const issue = jira.fixture.issues.get(spaces.growTwoParentsId)!;
    expect([issue.kpiParentId, ...(issue.extraKpiParentIds ?? [])].filter(Boolean)).toEqual([spaces.portChildId]);
  });

  it('createKpi without a space fails with the message, creating nothing', async () => {
    load();
    const { error, writes } = await call('createKpi', { name: 'Churn', unit: '%', direction: null });
    expect(error?.message).toBe('Choose a space for the new KPI.');
    expect(writes).toEqual([]);
  });

  it('createKpi in a second space: its fields and a marked kpi-meta (05), and its space returned', async () => {
    load('migrated');
    const { data, error } = await call<CreatedKpi>('createKpi', {
      projectId: GROWTH_PROJECT.id,
      name: 'Activation',
      unit: '%',
      direction: 'increase',
      parentKpiId: spaces.portRootId,
    });
    expect(error).toBeUndefined();
    expect(data).toMatchObject({ issueKey: 'GROW-4', parentKpiId: spaces.portRootId, space: GROWTH_PROJECT });
    const issue = jira.fixture.issues.get(data!.id)!;
    expect(issue.fieldValues).toEqual({
      [KPI_UNIT_FIELD_ID]: '%',
      [KPI_DIRECTION_FIELD_ID]: expect.objectContaining({ value: 'Increase' }),
    });
    expect(issue.properties['kpi-meta']).toEqual({ unit: '%', direction: 'increase', fields: true });
    expect(issue.kpiParentId).toBe(spaces.portRootId);
  });

  it('createKpi refuses a space without the KPI work type, and names the space a permission is missing in', async () => {
    load(null, (j) => {
      j.fixture.userView.access[PORTFOLIO_PROJECT.key] = READ_ONLY;
    });
    const tmp = await call('createKpi', { projectId: TEAM_MANAGED_PROJECT.id, name: 'X', unit: '', direction: null });
    expect(tmp.error?.message).toMatch(/^KPIs can't be created in Team-managed space: its work types don't include KPI\./);
    const port = await call('createKpi', { projectId: PORTFOLIO_PROJECT.id, name: 'X', unit: '', direction: null });
    expect(port.error?.message).toBe('Adding a KPI needs Create Issues permission on the Portfolio space. Ask a Jira admin.');
    expect([...tmp.writes, ...port.writes]).toEqual([]);
  });

  it("createKpi in a space the user can't browse says nothing about it (not its name or work types)", async () => {
    load(null, (j) => {
      j.fixture.userView.access[TEAM_MANAGED_PROJECT.key] = { browse: false, create: false, edit: false, link: false };
    });
    const hidden = await call('createKpi', { projectId: TEAM_MANAGED_PROJECT.id, name: 'X', unit: '', direction: null });
    expect(hidden.error?.message).toBe(`There's no space with id "${TEAM_MANAGED_PROJECT.id}" that you can see.`);
    expect(hidden.writes).toEqual([]);
  });

  it('createKpi refuses a parent that isn’t a KPI', async () => {
    load();
    const { error, writes } = await call('createKpi', {
      projectId: KPI_PROJECT.id,
      name: 'X',
      unit: '',
      direction: null,
      parentKpiId: spaces.centralStoryId,
    });
    expect(error?.message).toBe("KPI-500 isn't a KPI: KPIs can only be nested under KPIs.");
    expect(writes).toEqual([]);
  });

  it('05’s kpi-meta-to-fields migration migrates KPIs in two (here three) spaces, and nothing else', async () => {
    load('pre-migration');
    let record: MigrationRecord | undefined;
    for (let i = 0; i < 10 && record?.cursor !== null; i += 1) {
      record = (await call<MigrationRecord>('runMigrationBatch', { id: 'kpi-meta-to-fields' }, SETTINGS)).data;
    }
    expect(record).toMatchObject({ state: 'done', counts: { migrated: SMALL.kpis + 5, failed: 0 } });
    for (const key of ['KPI-1', 'PORT-2', 'GROW-1']) {
      const issue = [...jira.fixture.issues.values()].find((i) => i.key === key)!;
      expect(issue.fieldValues?.[KPI_UNIT_FIELD_ID], key).toBeTruthy();
      expect(issue.properties['kpi-meta'], key).toMatchObject({ fields: true });
    }
    expect(jira.fixture.issues.get(spaces.teamManagedKpiId)!.properties['kpi-meta']).not.toHaveProperty('fields');
  });
});

describe('Step 5: a KPI’s own panel loads only that KPI', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  /** The node the whole-Timeline build makes, as a KPI's own panel shows it (no children, depth 0). */
  async function timelineNode(key: string): Promise<TimelineNodeDto> {
    const { data } = await call<TimelineData>('getTimelineData');
    return { ...byKey(data!.roots, key)!, depth: 0, children: [] };
  }

  it.each([
    ['KPI-1', KPI_1],
    ['PORT-2', '5001'],
    ['GROW-1', '5100'],
    ['GROW-2', '5101'],
  ])('%s: the same node the whole-Timeline build produces', async (key, id) => {
    load('migrated');
    const expected = await timelineNode(key);
    const { data } = await call<PanelListData>('getPanelList', { issueId: id });
    const view = data!.panel!.kpiView!;
    expect(view.node).toEqual(expected);
    // And the client's rebuild from the raw targets agrees (recording a value relies on it).
    const rebuilt = applyTargetContributions({ today: view.today, roots: [{ ...view.node, targets: [], undated: [] }] }, {
      [id]: view.contributions ?? [],
    });
    expect(rebuilt.roots[0]).toEqual(view.node);
  });

  it('loads one KPI: no search over all KPIs, readings for it alone, targets by kpiIssueIds = id, its space’s access', async () => {
    load('migrated', (j) => {
      j.fixture.userView.access[GROWTH_PROJECT.key] = READ_ONLY;
    });
    const bodies = captureBulkfetch(jira);
    const { data, count, endpoints } = await call<PanelListData>('getPanelList', { issueId: spaces.growUnderCentralId });
    expect(count('GET /rest/api/3/search/jql [issuetype]')).toBe(0);
    expect(count('GET /rest/api/3/search/jql [kpi-assignments index]')).toBe(0);
    expect(count('GET /rest/api/3/search/jql [kpi-assignments id]')).toBe(1);
    expect(count('GET /rest/api/3/mypermissions')).toBe(1);
    expect(bodies).toEqual([[spaces.growUnderCentralId]]);
    expect(endpoints).not.toContain('GET /rest/api/3/issue/{id}/properties/kpi-assignments');
    const panel = data!.panel!;
    expect(panel.kpis).toEqual([]);
    expect(panel.picker).toBeUndefined();
    expect(panel.access).toEqual(READ_ONLY);
    expect(panel.kpiView!.node.targets.length + panel.kpiView!.node.undated.length).toBe(1);
  });

  it('Phase 2 for a KPI makes no KPI search and fetches no readings', async () => {
    load();
    const bodies = captureBulkfetch(jira);
    const { data, count } = await call<PanelValuesData>('getPanelValues', { issueId: spaces.portChildId });
    expect(data!.readings).toEqual({});
    expect(count('GET /rest/api/3/search/jql [issuetype]')).toBe(0);
    expect(bodies).toEqual([]);
  });

  it('with the panel’s context naming the issue’s work type and space, a work item’s This space search starts without waiting for the issue', async () => {
    load();
    const jql: string[] = [];
    jira.intercept = (_method, path, _body, raw) => {
      if (path === '/rest/api/3/search/jql') jql.push(new URLSearchParams(raw.split('?')[1]).get('jql') ?? '');
      return undefined;
    };
    const context = {
      extension: { issue: { id: spaces.crossSpaceTargetIssueId, typeId: '10302' }, project: { key: 'OPS' } },
    };
    const { data } = await call<PanelListData>('getPanelList', { issueId: spaces.crossSpaceTargetIssueId }, context);
    expect(data!.basis!.kpis.length).toBeGreaterThan(0);
    expect(data!.basis!.picker!.thisSpace.key).toBe('OPS');
    expect(jql[0]).toMatch(/project in \("OPS"\)/);
  });

  it('flags a KPI linked under two parent KPIs, naming the one the Timeline shows it under', async () => {
    load();
    const { data } = await call<PanelData>('getPanelData', { issueId: spaces.growTwoParentsId });
    expect(data!.kpiView!.parentLinks).toEqual({ count: 2, shownKey: 'KPI-1' });
    const single = await call<PanelData>('getPanelData', { issueId: spaces.growUnderCentralId });
    expect(single.data!.kpiView).not.toHaveProperty('parentLinks');
  });

  it('a KPI’s own panel when Jira can’t answer the access lookup: the chart, access unknown', async () => {
    load(null, (j) => {
      j.intercept = (_method, path) => (path === '/rest/api/3/mypermissions' ? { status: 503 } : undefined);
    });
    const { data, error } = await call<PanelData>('getPanelData', { issueId: KPI_1 });
    expect(error).toBeUndefined();
    expect(data!.kpiView).toBeDefined();
    expect(data).not.toHaveProperty('access');
  });

  it('getTimelineTargets is unchanged by a KPI-only targets lookup (contributions by KPI id)', async () => {
    load();
    const { data } = await call<TimelineTargetsData>('getTimelineTargets');
    expect(data!.contributions[spaces.growUnderCentralId]).toHaveLength(1);
    expect(data!.contributions[spaces.portChildId]).toHaveLength(1);
  });
});
