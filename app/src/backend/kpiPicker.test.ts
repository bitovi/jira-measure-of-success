import { describe, it, expect, vi } from 'vitest';
import {
  addKpiSpaces,
  buildScaleFixture,
  createMockJira,
  fixtureTarget,
  GROWTH_PROJECT,
  KPI_PROJECT,
  PORTFOLIO_PROJECT,
  storedTargets,
  type FixtureIssue,
  type KpiSpaces,
  type MockJira,
  type ScaleFixture,
} from './testing/scaleFixture';
import type {
  KpiCurrentValue,
  KpiOptionDto,
  KpiRefLookup,
  KpiSuggestionsDto,
  ListKpiSpacesResult,
  PanelListData,
  PanelValuesData,
  SearchKpisResult,
} from '../domain/index';
import type { Trace } from './requestLog';

/**
 * Spec 11 · 07 — the KPI picker's loads, through the REAL resolver on the
 * in-memory Jira: what opening the panel asks for (Tracked by parents and
 * This space only), and each lazily loaded view.
 *
 * The chain: Story APP-10000 → Epic APP-1 (targets KPI-1, whose sub-KPIs are
 * KPI-2…KPI-5) → Initiative INIT-1 (targets KPI-1 and PORT-1, whose sub-KPI is
 * PORT-2; GROW-2 is also linked under PORT-1, in another space).
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
const STORY = '300000';
const EPIC = '200000';
const INITIATIVE = '100000';
const NO_ACCESS = { browse: false, create: false, edit: false, link: false };

let jira: MockJira;
let spaces: KpiSpaces;

/** The chain above: the initiative targets KPI-1 and PORT-1. */
function withChainTargets(fixture: ScaleFixture): void {
  fixture.issues.get(INITIATIVE)!.properties['kpi-assignments'] = storedTargets(
    [
      fixtureTarget('KPI-1', { kpiIssueId: '1000', target: 3, targetType: 'percent' }),
      fixtureTarget('PORT-1', { kpiIssueId: spaces.portRootId, target: 12 }),
    ],
    true,
  );
}

/** `n` more spaces of `perSpace` KPIs each (keys S1-1…), none of them related to the story. */
function addManySpaces(fixture: ScaleFixture, n: number, perSpace: number): void {
  for (let s = 1; s <= n; s += 1) {
    const key = `S${s}`;
    fixture.projects.set(key, { id: String(30_000 + s), name: `Space ${s}`, issueTypeNames: ['KPI'] });
    for (let k = 0; k < perSpace; k += 1) {
      const id = String(600_000 + s * 1000 + k);
      fixture.issues.set(id, {
        id,
        key: `${key}-${k + 1}`,
        type: 'KPI',
        summary: `Space ${s} KPI ${k + 1}`,
        parentId: null,
        due: null,
        start: null,
        kpiParentId: k === 0 ? null : String(600_000 + s * 1000),
        properties: { 'kpi-meta': { unit: '%', direction: 'increase' } },
      } satisfies FixtureIssue);
    }
  }
}

function load(setup?: (fixture: ScaleFixture, j: MockJira) => void) {
  vi.resetModules();
  const fixture = buildScaleFixture(SMALL);
  spaces = addKpiSpaces(fixture);
  withChainTargets(fixture);
  jira = createMockJira(fixture);
  h.jira = jira;
  setup?.(fixture, jira);
}

async function call<T>(key: string, payload: unknown = {}, context: Record<string, unknown> = {}) {
  const { handler } = await import('./resolver');
  const { setTraceSink } = await import('./requestLog');
  let trace: Trace | undefined;
  setTraceSink((t) => {
    trace = t;
  });
  const routes: string[] = [];
  const before = jira.intercept;
  jira.intercept = (method, path, body, raw, as) => {
    routes.push(`${method} ${decodeURIComponent(raw)}`);
    return before?.(method, path, body, raw, as);
  };
  let data: T | undefined;
  let error: Error | undefined;
  try {
    data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
      { call: { functionKey: key, payload }, context: { accountId: 'acc-1', ...context } },
      { principal: { accountId: 'acc-1' } },
    )) as T;
  } catch (e) {
    error = e as Error;
  } finally {
    jira.intercept = before;
  }
  expect(jira.unhandled).toEqual([]);
  const requests = trace?.requests ?? [];
  return {
    data,
    error,
    routes,
    total: requests.length,
    count: (endpoint: string) => requests.filter((r) => r.endpoint === endpoint).length,
    endpoints: requests.map((r) => r.endpoint),
  };
}

const searches = (routes: string[]) =>
  routes.filter((r) => r.startsWith('GET /rest/api/3/search/jql')).map((r) => /jql=([^&]*)/.exec(r)![1]);
const keys = (options: KpiOptionDto[]) => options.map((o) => o.key);

function everyOption(picker: KpiSuggestionsDto): KpiOptionDto[] {
  return [
    ...picker.inThisSpace,
    ...picker.trackedByParents.flatMap((b) => b.targets.flatMap((t) => [t.option, ...t.subKpis])),
  ];
}

describe('opening the panel (Phase 1)', () => {
  it('loads Tracked by parents and This space: bands nearest first, targets with their values and same-space sub-KPIs', async () => {
    load();
    const { data } = await call<PanelListData>('getPanelList', { issueId: STORY });
    const picker = data!.basis!.picker!;
    expect(picker.thisSpace).toEqual({ key: 'APP', name: 'APP' });
    expect(picker.hasParents).toBe(true);
    expect(picker.trackedByParents.map((b) => [b.item.key, b.item.typeName])).toEqual([
      ['APP-1', 'Epic'],
      ['INIT-1', 'Initiative'],
    ]);
    const [epic, initiative] = picker.trackedByParents;
    expect(epic.targets.map((t) => t.option.key)).toEqual(['KPI-1']);
    expect(keys(epic.targets[0].subKpis).sort()).toEqual(['KPI-2', 'KPI-3', 'KPI-4', 'KPI-5']);
    expect(epic.targets[0].subKpis.every((o) => o.parentId === '1000')).toBe(true);
    expect(epic.targets[0].option.hasChildren).toBe(true);
    // KPI-1 is under both parents; PORT-1 brings PORT-2 but not GROW-2 (another space).
    expect(initiative.targets.map((t) => [t.option.key, t.target.target])).toEqual(
      expect.arrayContaining([
        ['KPI-1', 3],
        ['PORT-1', 12],
      ]),
    );
    expect(keys(initiative.targets.find((t) => t.option.key === 'PORT-1')!.subKpis)).toEqual(['PORT-2']);
    expect(initiative.targets.find((t) => t.option.key === 'PORT-1')!.option.space).toEqual({
      key: PORTFOLIO_PROJECT.key,
      name: PORTFOLIO_PROJECT.name,
    });
    expect(picker.inThisSpace).toEqual([]);
    expect(picker.parentSpaces).toEqual([{ key: 'INIT', name: 'INIT' }]);
    expect(picker.globalSpace).toEqual({ key: KPI_PROJECT.key, name: KPI_PROJECT.name });
  });

  it('requests: no query over all KPIs, one GET per chain level, one id in (…) for every target, one per sub-KPI level; nothing for other views, counts or permissions', async () => {
    load();
    const { routes, count, endpoints } = await call<PanelListData>('getPanelList', { issueId: STORY });
    const jql = searches(routes);
    // This space; the targets (own + every parent's); one sub-KPI level.
    expect(jql).toHaveLength(3);
    expect(jql.every((q) => /^issuetype = \d+ AND (project in|id in) \(/.test(q))).toBe(true);
    expect(jql[0]).toMatch(/project in \("APP"\)/);
    expect(jql.filter((q) => q.includes('id in ('))).toHaveLength(2);
    // The issue, then one GET per parent (Epic, Initiative).
    expect(routes.filter((r) => /^GET \/rest\/api\/3\/issue\/\d+\?fields=parent,issuetype,project,summary&properties=kpi-assignments/.test(r))).toHaveLength(2);
    expect(count('GET /rest/api/3/issue/{id}')).toBe(3);
    expect(endpoints).not.toContain('GET /rest/api/3/mypermissions');
    expect(endpoints).not.toContain('GET /rest/api/3/project/search');
    expect(endpoints).not.toContain('POST /rest/api/3/changelog/bulkfetch');
    expect(endpoints).not.toContain('POST /rest/api/3/search/approximate-count');
  });

  it('icons are fetched once per distinct type, never per KPI, and every icon is a data: URL or null', async () => {
    load();
    const { data, routes } = await call<PanelListData>('getPanelList', { issueId: STORY });
    const iconFetches = routes.filter((r) => r.includes('/universal_avatar/'));
    // KPI, Epic, Initiative.
    expect(iconFetches).toHaveLength(3);
    expect(new Set(iconFetches).size).toBe(3);
    const picker = data!.basis!.picker!;
    const icons = [...everyOption(picker).map((o) => o.typeIconUrl), ...picker.trackedByParents.map((b) => b.item.typeIconUrl)];
    expect(icons.every((u) => u === null || u.startsWith('data:'))).toBe(true);
    expect(icons.filter((u) => u !== null).length).toBeGreaterThan(0);
  });

  it('on 2,000 KPIs over 20 spaces, the request count does not grow with the number of spaces', async () => {
    load();
    const few = await call<PanelListData>('getPanelList', { issueId: STORY });
    load((fixture) => addManySpaces(fixture, 20, 100));
    const many = await call<PanelListData>('getPanelList', { issueId: STORY });
    expect(many.total).toBe(few.total);
    expect(searches(many.routes)).toEqual(searches(few.routes));
  });

  it('leaves out KPIs the work item already targets, and a parent whose targets are all tracked here has no band', async () => {
    load((fixture) => {
      fixture.issues.get(STORY)!.properties['kpi-assignments'] = storedTargets(
        [fixtureTarget('KPI-1', { kpiIssueId: '1000' })],
        true,
      );
    });
    const { data } = await call<PanelListData>('getPanelList', { issueId: STORY });
    const picker = data!.basis!.picker!;
    expect(picker.trackedByParents.map((b) => b.item.key)).toEqual(['INIT-1']);
    expect(everyOption(picker).map((o) => o.id)).not.toContain('1000');
    expect(data!.basis!.kpis.map((k) => k.id)).toEqual(['1000']);
  });

  it('a space the user can’t browse: its KPIs are never offered, the parent targeting them has no band for them', async () => {
    load((fixture) => {
      fixture.userView.access[PORTFOLIO_PROJECT.key] = NO_ACCESS;
    });
    const { data } = await call<PanelListData>('getPanelList', { issueId: STORY });
    expect(everyOption(data!.basis!.picker!).some((o) => o.space.key === 'PORT')).toBe(false);
  });

  it('a work item at the top has no parents; This space lists its space’s KPIs as a tree', async () => {
    load((fixture) => {
      // A work item in the Growth space with no parent.
      fixture.issues.set('700000', {
        id: '700000',
        key: 'GROW-50',
        type: 'Story',
        summary: 'Top-level story',
        parentId: null,
        due: null,
        start: null,
        properties: {},
      });
    });
    const { data } = await call<PanelListData>('getPanelList', { issueId: '700000' });
    const picker = data!.basis!.picker!;
    expect(picker.hasParents).toBe(false);
    expect(picker.trackedByParents).toEqual([]);
    expect(picker.thisSpace.key).toBe(GROWTH_PROJECT.key);
    expect(keys(picker.inThisSpace)).toEqual(expect.arrayContaining(['GROW-1', 'GROW-2', 'GROW-3']));
    expect(picker.parentSpaces).toEqual([]);
    expect(picker.globalSpace?.key).toBe('KPI');
  });

  it('best effort: a parent Jira fails to return ends the walk, and failed sub-KPI loads leave the targets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    load((_fixture, j) => {
      let searches = 0;
      j.intercept = (method, path, _body, raw) => {
        if (method === 'GET' && path === `/rest/api/3/issue/${INITIATIVE}`) return { status: 500 };
        // The second `id in` search is the sub-KPI level (after the targets).
        if (path === '/rest/api/3/search/jql' && raw.includes('id%20in') && ++searches === 2) return { status: 503 };
        return undefined;
      };
    });
    const { data } = await call<PanelListData>('getPanelList', { issueId: STORY });
    const picker = data!.basis!.picker!;
    expect(picker.trackedByParents.map((b) => b.item.key)).toEqual(['APP-1']);
    expect(picker.trackedByParents[0].targets.map((t) => [t.option.key, t.subKpis])).toEqual([['KPI-1', []]]);
    expect(picker.parentSpaces).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('no KPI work type configured: no picker', async () => {
    load((fixture) => {
      fixture.issueTypes = fixture.issueTypes.filter((t) => t.name !== 'KPI');
    });
    const { data } = await call<PanelListData>('getPanelList', { issueId: STORY });
    expect(data!.basis!.picker).toBeUndefined();
  });

  it('Phase 2 reads only the work item’s own targets, never every KPI', async () => {
    load((fixture) => {
      fixture.issues.get(STORY)!.properties['kpi-assignments'] = storedTargets(
        [fixtureTarget('KPI-3', { kpiIssueId: '1002' })],
        true,
      );
    });
    const bodies: string[][] = [];
    jira.intercept = (method, path, body) => {
      if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
        bodies.push((JSON.parse(String(body)) as { issueIdsOrKeys: string[] }).issueIdsOrKeys);
      }
      return undefined;
    };
    const { data, routes } = await call<PanelValuesData>('getPanelValues', { issueId: STORY });
    expect(bodies).toEqual([['1002']]);
    expect(Object.keys(data!.readings)).toEqual(['1002']);
    expect(searches(routes).some((q) => q.startsWith('issuetype'))).toBe(false);
  });
});

describe('views that load when opened', () => {
  it('listKpisInSpaces searches only the spaces asked for, nested, with no readings', async () => {
    load();
    const { data, routes, endpoints } = await call<KpiOptionDto[]>('listKpisInSpaces', { projectKeys: ['PORT'] });
    expect(searches(routes)).toEqual([expect.stringMatching(/^issuetype = \d+ AND project in \("PORT"\) ORDER BY/)]);
    expect(data!.map((o) => [o.key, o.parentId, o.hasChildren])).toEqual([
      ['PORT-1', null, true],
      ['PORT-2', spaces.portRootId, false],
    ]);
    expect(endpoints).not.toContain('POST /rest/api/3/changelog/bulkfetch');
  });

  it('searchKpis: every space by summary, capped; with projectKey, one space', async () => {
    load();
    const all = await call<SearchKpisResult>('searchKpis', { text: 'growth' });
    expect(searches(all.routes)).toEqual([expect.stringMatching(/^issuetype = \d+ AND summary ~ "growth\*" ORDER BY/)]);
    expect(keys(all.data!.kpis).sort()).toEqual(['GROW-1', 'GROW-2', 'GROW-3']);
    expect(all.data!.truncated).toBe(false);

    const one = await call<SearchKpisResult>('searchKpis', { text: 'portfolio', projectKey: 'PORT' });
    expect(searches(one.routes)).toEqual([
      expect.stringMatching(/^issuetype = \d+ AND project in \("PORT"\) AND summary ~ "portfolio\*"/),
    ]);
    expect(keys(one.data!.kpis)).toEqual(['PORT-1', 'PORT-2']);

    const spaceOnly = await call<SearchKpisResult>('searchKpis', { text: '', projectKey: 'GROW' });
    expect(keys(spaceOnly.data!.kpis)).toEqual(expect.arrayContaining(['GROW-1', 'GROW-2', 'GROW-3']));

    const nothing = await call<SearchKpisResult>('searchKpis', { text: '  ' });
    expect(nothing.data).toEqual({ kpis: [], truncated: false });
    expect(nothing.total).toBe(0);
  });

  it('searchKpis says when more matched than it returns', async () => {
    load((fixture) => addManySpaces(fixture, 2, 40));
    const { data } = await call<SearchKpisResult>('searchKpis', { text: 'space' });
    expect(data!.kpis).toHaveLength(50);
    expect(data!.truncated).toBe(true);
  });

  it('listKpiSpaces keeps only spaces with the KPI work type the user can browse, filtered, and pages', async () => {
    load((fixture) => {
      addManySpaces(fixture, 60, 0);
      fixture.userView.access.S2 = NO_ACCESS;
    });
    const first = await call<ListKpiSpacesResult>('listKpiSpaces', { query: '' });
    expect(first.routes.filter((r) => r.includes('/project/search'))).toEqual([
      expect.stringMatching(/action=browse&query=&expand=issueTypes&orderBy=key&startAt=0&maxResults=50$/),
    ]);
    // TEAM and the team-managed TMP have no (site-wide) KPI type.
    expect(first.data!.spaces.map((s) => s.key)).not.toContain('TEAM');
    expect(first.data!.spaces.map((s) => s.key)).not.toContain('TMP');
    expect(first.data!.spaces.map((s) => s.key)).not.toContain('S2');
    expect(first.data!.nextStartAt).toBe(50);
    const second = await call<ListKpiSpacesResult>('listKpiSpaces', { query: '', startAt: 50 });
    expect(second.data!.nextStartAt).toBeNull();
    const filtered = await call<ListKpiSpacesResult>('listKpiSpaces', { query: 'portf' });
    expect(filtered.data!.spaces).toEqual([{ key: 'PORT', name: 'Portfolio' }]);
  });

  it('getKpiCurrentValue reads one KPI’s readings', async () => {
    load();
    const { data, count } = await call<KpiCurrentValue>('getKpiCurrentValue', { kpiId: spaces.portRootId });
    expect(data).toEqual({ kpiId: spaces.portRootId, value: 12 });
    expect(count('POST /rest/api/3/changelog/bulkfetch')).toBe(1);
  });
});

describe('lookupKpiRef', () => {
  it('a key, a URL or an id: the KPI, from any space, with its icon', async () => {
    load();
    for (const ref of ['PORT-2', 'port-2', 'https://acme.atlassian.net/browse/PORT-2', spaces.portChildId]) {
      const { data, count } = await call<KpiRefLookup>('lookupKpiRef', { ref });
      expect(data).toMatchObject({ kind: 'kpi', option: { id: spaces.portChildId, key: 'PORT-2', space: { key: 'PORT' } } });
      expect(data!.kind === 'kpi' && data!.option.typeIconUrl?.startsWith('data:')).toBe(true);
      expect(count('GET /rest/api/3/issue/{id}')).toBe(1);
    }
  });

  it('an old key of a moved KPI resolves to its new key (Jira follows the move)', async () => {
    load((fixture) => {
      fixture.issues.get(spaces.portChildId)!.formerKeys = ['KPI-55'];
    });
    const { data } = await call<KpiRefLookup>('lookupKpiRef', { ref: 'KPI-55' });
    expect(data).toMatchObject({ kind: 'kpi', option: { key: 'PORT-2' } });
  });

  it('a work item that isn’t a KPI', async () => {
    load();
    const { data } = await call<KpiRefLookup>('lookupKpiRef', { ref: 'APP-1' });
    expect(data).toMatchObject({ kind: 'notKpi', item: { id: EPIC, key: 'APP-1', typeName: 'Epic', summary: 'Epic 1' } });
    expect(data!.kind === 'notKpi' && data!.item.typeIconUrl?.startsWith('data:')).toBe(true);
  });

  it('hidden or missing: Jira doesn’t say which', async () => {
    load((fixture) => {
      fixture.userView.access[GROWTH_PROJECT.key] = NO_ACCESS;
    });
    expect((await call<KpiRefLookup>('lookupKpiRef', { ref: 'GROW-1' })).data).toEqual({ kind: 'hidden' });
    expect((await call<KpiRefLookup>('lookupKpiRef', { ref: 'NOPE-1' })).data).toEqual({ kind: 'hidden' });
    const free = await call<KpiRefLookup>('lookupKpiRef', { ref: 'revenue' });
    expect(free.data).toEqual({ kind: 'hidden' });
    expect(free.total).toBe(0);
  });
});
