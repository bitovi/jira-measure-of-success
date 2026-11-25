import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addKpiSpaces,
  buildScaleFixture,
  createMockJira,
  GROWTH_PROJECT,
  KPI_PROJECT,
  PORTFOLIO_PROJECT,
  type KpiSpaces,
  type MockJira,
  type ScaleOptions,
} from './testing/scaleFixture';
import type { KpiCreateSpaces, TimelineData, TimelineNodeDto, TimelineReadingsData } from '../domain/index';
import type { Trace } from './requestLog';

/**
 * Spec 11 · 08 Step 3 — the Timeline across spaces, through the REAL resolver
 * on the multi-space fixture (`addKpiSpaces`: the central KPI space, Portfolio
 * and Growth, a team-managed space with its own "KPI" type): readings only for
 * the KPIs in scope, readings paged past Jira's caps (R4), no permission lookup
 * on load, and the spaces Add KPI offers.
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

const SMALL: Partial<ScaleOptions> = { kpis: 10, initiatives: 2, epicsPerInitiative: 3, storiesPerEpic: 1, subtasksPerStory: 0 };
const NO_CREATE = { browse: true, create: false, edit: true, link: true };

let jira: MockJira;
let spaces: KpiSpaces;

function load(options: Partial<ScaleOptions> = SMALL, multiSpace = true) {
  vi.resetModules();
  const fixture = buildScaleFixture(options);
  if (multiSpace) spaces = addKpiSpaces(fixture);
  jira = createMockJira(fixture);
  h.jira = jira;
}

async function call<T>(key: string, payload: unknown = {}) {
  const { handler } = await import('./resolver');
  const { setTraceSink } = await import('./requestLog');
  let trace: Trace | undefined;
  setTraceSink((t) => {
    trace = t;
  });
  const data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
    { call: { functionKey: key, payload }, context: { accountId: 'acc-1' } },
    { principal: { accountId: 'acc-1' } },
  )) as T;
  expect(jira.unhandled).toEqual([]);
  const requests = trace?.requests ?? [];
  return { data, count: (endpoint: string) => requests.filter((r) => r.endpoint === endpoint).length, endpoints: requests.map((r) => r.endpoint) };
}

/** The issue ids (and page token) of every changelog bulkfetch. */
function captureBulkfetch(j: MockJira): Array<{ ids: string[]; token?: string }> {
  const bodies: Array<{ ids: string[]; token?: string }> = [];
  j.intercept = (method, path, body) => {
    if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
      const req = JSON.parse(String(body)) as { issueIdsOrKeys: string[]; nextPageToken?: string };
      bodies.push({ ids: req.issueIdsOrKeys, ...(req.nextPageToken ? { token: req.nextPageToken } : {}) });
    }
    return undefined;
  };
  return bodies;
}

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const BULKFETCH = 'POST /rest/api/3/changelog/bulkfetch';
const MYPERMISSIONS = 'GET /rest/api/3/mypermissions';
const PROJECT_SEARCH = 'GET /rest/api/3/project/search';

describe('Timeline readings in scope (spec 11 · 08)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a one-space scope loads every KPI but fetches readings for that space only, with no permission lookup', async () => {
    load();
    const bulk = captureBulkfetch(jira);
    const { data, count } = await call<TimelineData>('getTimelineSkeleton', { readingSpaces: [GROWTH_PROJECT.key] });
    const nodes = flatten(data.roots);
    expect(nodes).toHaveLength(SMALL.kpis! + 5);
    const grow = [spaces.growUnderCentralId, spaces.growTwoParentsId, spaces.growUnderPortChildId];
    expect(bulk).toEqual([{ ids: grow }]);
    for (const n of nodes) {
      if (n.space?.key === GROWTH_PROJECT.key) {
        expect(n.readings).toHaveLength(2);
        expect(n).not.toHaveProperty('readingsPending');
      } else {
        expect(n.readings).toEqual([]);
        expect(n.readingsPending).toBe(true);
      }
    }
    expect(count(MYPERMISSIONS)).toBe(0);
    expect(count(BULKFETCH)).toBe(1);
  });

  it('several spaces: their KPIs only', async () => {
    load();
    const bulk = captureBulkfetch(jira);
    await call<TimelineData>('getTimelineSkeleton', { readingSpaces: ['port', GROWTH_PROJECT.key] });
    expect(bulk[0].ids.sort()).toEqual(
      [spaces.portRootId, spaces.portChildId, spaces.growUnderCentralId, spaces.growTwoParentsId, spaces.growUnderPortChildId].sort(),
    );
  });

  it('no scope (all KPIs): every KPI has its readings, still no permission lookup', async () => {
    load();
    const { data, count } = await call<TimelineData>('getTimelineSkeleton');
    expect(flatten(data.roots).every((n) => !n.readingsPending && n.readings.length > 0)).toBe(true);
    expect(count(MYPERMISSIONS)).toBe(0);
    expect(data.kpiTypeIconUrl).toMatch(/^data:/);
  });

  it('getTimelineReadings fetches just the KPIs that came into scope', async () => {
    load();
    const bulk = captureBulkfetch(jira);
    const { data, count } = await call<TimelineReadingsData>('getTimelineReadings', {
      kpiIds: [spaces.portRootId, spaces.portChildId],
    });
    expect(bulk).toEqual([{ ids: [spaces.portRootId, spaces.portChildId] }]);
    expect(Object.keys(data.readings).sort()).toEqual([spaces.portRootId, spaces.portChildId].sort());
    expect(data.readings[spaces.portRootId]).toEqual([
      { date: '2025-10-03', value: 10 },
      { date: '2025-12-02', value: 12 },
    ]);
    expect(count(MYPERMISSIONS)).toBe(0);
  });

  it('getTimelineReadings leaves out KPIs the user can’t see, and refuses ids that aren’t issue ids', async () => {
    load();
    jira.fixture.userView.access[PORTFOLIO_PROJECT.key] = { browse: false, create: false, edit: false, link: false };
    const { data } = await call<TimelineReadingsData>('getTimelineReadings', { kpiIds: [spaces.portRootId, spaces.growUnderCentralId] });
    expect(Object.keys(data.readings)).toEqual([spaces.growUnderCentralId]);
    await expect(call('getTimelineReadings', { kpiIds: ['KPI-1'] })).rejects.toThrow('Invalid KPI id.');
  });

  it('all KPIs past 1,000 issues and 1,000 histories: pages instead of cutting off (R4)', async () => {
    const kpis = 1200;
    load({ ...SMALL, kpis, readingsPerKpi: 2 }, false);
    const bulk = captureBulkfetch(jira);
    const { data, count } = await call<TimelineData>('getTimelineSkeleton');
    const nodes = flatten(data.roots);
    expect(nodes).toHaveLength(kpis);
    // Two batches (1,000 + 200 issues); the first has 2,000 histories, so two pages.
    expect(bulk.map((b) => [b.ids.length, b.token ?? null])).toEqual(
      expect.arrayContaining([
        [1000, null],
        [1000, '1000'],
        [200, null],
      ]),
    );
    expect(count(BULKFETCH)).toBe(3);
    expect(nodes.every((n) => n.readings.length === 2)).toBe(true);
  });

  it('a long series past one page keeps every reading (histories appended across pages)', async () => {
    load({ ...SMALL, kpis: 5, readingsPerKpi: 450 }, false);
    const { data, count } = await call<TimelineData>('getTimelineSkeleton');
    expect(count(BULKFETCH)).toBe(3);
    const nodes = flatten(data.roots);
    // Each KPI's 450 histories are on distinct dates.
    expect(nodes.map((n) => n.readings.length)).toEqual(nodes.map(() => 450));
  });
});

describe('getKpiCreateSpaces (spec 11 · 08)', () => {
  it('offers the spaces with the KPI work type where the user can create, in one request', async () => {
    load();
    const { data, count, endpoints } = await call<KpiCreateSpaces>('getKpiCreateSpaces', { kpiSpaceKeys: ['KPI', 'PORT', 'GROW'] });
    expect(data.spaces.map((s) => s.key)).toEqual(['GROW', 'KPI', 'PORT']);
    expect(data.spaces.find((s) => s.key === 'KPI')).toEqual({ id: KPI_PROJECT.id, key: 'KPI', name: KPI_PROJECT.name });
    expect(count(PROJECT_SEARCH)).toBe(1);
    expect(endpoints).not.toContain(MYPERMISSIONS);
  });

  it('a project without the KPI type (or with a team-managed "KPI" type of its own) isn’t offered', async () => {
    load();
    const { data } = await call<KpiCreateSpaces>('getKpiCreateSpaces');
    const keys = data.spaces.map((s) => s.key);
    expect(keys).not.toContain('TEAM');
    expect(keys).not.toContain('TMP');
  });

  it('a space without Create Issues isn’t offered', async () => {
    load();
    jira.fixture.userView.access[PORTFOLIO_PROJECT.key] = NO_CREATE;
    const { data } = await call<KpiCreateSpaces>('getKpiCreateSpaces');
    expect(data.spaces.map((s) => s.key)).toEqual(['GROW', 'KPI']);
  });

  it('the central space isn’t preselected: only a single possible space is', async () => {
    load();
    const many = await call<KpiCreateSpaces>('getKpiCreateSpaces', { kpiSpaceKeys: ['KPI', 'PORT', 'GROW'] });
    expect(many.data.preselect).toBeNull();
    const none = await call<KpiCreateSpaces>('getKpiCreateSpaces');
    expect(none.data.preselect).toBeNull();

    jira.fixture.userView.access[PORTFOLIO_PROJECT.key] = NO_CREATE;
    jira.fixture.userView.access[KPI_PROJECT.key] = NO_CREATE;
    const single = await call<KpiCreateSpaces>('getKpiCreateSpaces', { kpiSpaceKeys: ['KPI', 'PORT', 'GROW'] });
    expect(single.data).toEqual({ spaces: [GROWTH_PROJECT], preselect: GROWTH_PROJECT.id });
  });

  it('every KPI in one space (today’s installs): that space is filled in', async () => {
    load(SMALL, false);
    const { data } = await call<KpiCreateSpaces>('getKpiCreateSpaces', { kpiSpaceKeys: ['KPI'] });
    expect(data).toEqual({ spaces: [{ id: KPI_PROJECT.id, key: 'KPI', name: KPI_PROJECT.name }], preselect: KPI_PROJECT.id });
  });
});
