import { describe, it, expect, vi } from 'vitest';
import { buildScaleFixture, createMockJira, KPI_HIERARCHY_LINK_TYPE, type MockJira } from './testing/scaleFixture';
import type {
  AddedTarget,
  AddTargetInput,
  CreatedKpi,
  KpiHierarchyStatus,
  PanelListData,
  TimelineData,
} from '../domain/index';

/**
 * The lightweight mutation results (specs/06-timeline-performance) and the
 * deleted-KPI check (getPanelList), run through the REAL resolver against the
 * in-memory Jira of the scale fixture.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers } = await import('./testing/scaleFixture');
  const requester = { requestJira: (route: unknown, init?: { method?: string; body?: unknown }) => h.jira!.requestJira(route, init) };
  return { default: { asUser: () => requester, asApp: () => requester }, ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.jira!.fixture.kvs.get(key),
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, value);
    },
  },
}));

const SMALL = { kpis: 10, initiatives: 2, epicsPerInitiative: 2, storiesPerEpic: 1, subtasksPerStory: 0 };
// Epic 200000 (APP-1) targets KPI-1; story 300000 is its child and has no targets.
const EPIC = '200000';
const STORY = '300000';

const SETTINGS = { moduleKey: 'kpi-settings-page' };

async function invoke<T>(
  key: string,
  payload: unknown,
  setup?: (jira: MockJira) => void,
  context: Record<string, unknown> = {},
) {
  vi.resetModules();
  const jira = createMockJira(buildScaleFixture(SMALL));
  h.jira = jira;
  setup?.(jira);
  const { handler } = await import('./resolver');
  let data: T | undefined;
  let error: Error | undefined;
  try {
    // Forge puts the invoking user in the runtime payload's principal.
    data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
      { call: { functionKey: key, payload }, context },
      { principal: { accountId: 'acc-1' } },
    )) as T;
  } catch (e) {
    error = e as Error;
  }
  expect(jira.unhandled).toEqual([]);
  return { data, error, jira };
}

const assignmentsOf = (jira: MockJira, id: string) =>
  (jira.fixture.issues.get(id)!.properties['kpi-assignments'] as { assignments: Array<{ kpiId: string; target: number }>; kpiIds: string[] });

const addTargetInput = (over: Partial<AddTargetInput> = {}): AddTargetInput => ({
  kpiId: 'KPI-2',
  issueId: EPIC,
  issueKey: 'APP-1',
  issueType: 'Epic',
  issueTypeIconUrl: null,
  issueSummary: 'Epic 1',
  date: '2026-12-31',
  value: 500,
  ...over,
});

describe('addTarget', () => {
  it('returns just the saved contribution, with an inlined icon', async () => {
    const { data, jira } = await invoke<AddedTarget>('addTarget', addTargetInput());
    expect(data!.assignment).toMatchObject({
      kpiId: 'KPI-2',
      target: 500,
      targetType: 'absolute',
      timing: { due: { mode: 'absolute', absolute: '2026-12-31' } },
      updatedBy: 'acc-1',
    });
    expect(data!.source).toMatchObject({ key: 'APP-1', type: 'Epic', title: 'Epic 1' });
    expect(data!.source.iconUrl).toMatch(/^data:image\/svg\+xml/);
    // Added alongside the epic's existing KPI-1 target, with the search index kept in sync.
    expect(assignmentsOf(jira, EPIC).kpiIds).toEqual(['KPI-1', 'KPI-2']);
  });

  it('updates the existing target in place for the same (issue, KPI)', async () => {
    const { jira } = await invoke<AddedTarget>('addTarget', addTargetInput({ kpiId: 'KPI-1', value: 999 }));
    const { assignments } = assignmentsOf(jira, EPIC);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ kpiId: 'KPI-1', target: 999 });
  });

  it('fails (instead of returning an unsaved target) when Jira rejects the write', async () => {
    const { data, error } = await invoke<AddedTarget>('addTarget', addTargetInput(), (jira) => {
      jira.intercept = (method, path) =>
        method === 'PUT' && path.endsWith('/properties/kpi-assignments')
          ? { status: 403, body: { errorMessages: ['You do not have permission to edit issues.'] } }
          : undefined;
    });
    expect(data).toBeUndefined();
    expect(error?.message).toBe(
      `Jira 403 while trying to save targets on issue ${EPIC}: You do not have permission to edit issues.`,
    );
  });
});

describe('recordValue', () => {
  it('writes the reading and returns nothing', async () => {
    const { data, error, jira } = await invoke('recordValue', { kpiId: 'KPI-1', date: '2026-06-01', value: 42 });
    expect(error).toBeUndefined();
    expect(data).toBeNull();
    expect(jira.writes).toEqual(['PUT /rest/api/3/app/field/customfield_10837/value']);
  });

  it.each([
    ['a non-ISO date', { kpiId: 'KPI-1', date: '06/01/2026', value: 42 }],
    ['a non-numeric value', { kpiId: 'KPI-1', date: '2026-06-01', value: '42' }],
    ['no KPI', { date: '2026-06-01', value: 42 }],
  ])('rejects %s without writing', async (_label, payload) => {
    const { error, jira } = await invoke('recordValue', payload);
    expect(error).toBeDefined();
    expect(jira.writes).toEqual([]);
  });
});

describe('createKpi', () => {
  it('returns just the new KPI, nested under its parent', async () => {
    const { data, jira } = await invoke<CreatedKpi>('createKpi', {
      name: 'Churn',
      unit: '%',
      direction: 'decrease',
      parentKpiId: 'KPI-1',
    });
    expect(data).toEqual({
      id: expect.any(String),
      kpiId: 'KPI-11',
      issueKey: 'KPI-11',
      name: 'Churn',
      unit: '%',
      direction: 'decrease',
      parentKpiId: 'KPI-1',
    });
    expect(jira.writes).toEqual(['POST /rest/api/3/issue', 'POST /rest/api/3/issueLink']);
    expect(jira.fixture.issues.get(data!.id)!.kpiParentId).toBe('1000');
  });

  it('rolls the new issue back when the hierarchy link fails, so a retry cannot duplicate it', async () => {
    const { data, error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { name: 'Churn', unit: '%', direction: null, parentKpiId: 'KPI-1' },
      (j) => {
        j.intercept = (method, path) => (method === 'POST' && path === '/rest/api/3/issueLink' ? { status: 500 } : undefined);
      },
    );
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 500 while trying to link KPI "KPI-11" under "KPI-1"/);
    expect(jira.writes).toEqual(['POST /rest/api/3/issue', 'POST /rest/api/3/issueLink', 'DELETE /rest/api/3/issue/KPI-11']);
    expect([...jira.fixture.issues.values()].some((i) => i.key === 'KPI-11')).toBe(false);
  });
});

describe('getPanelList: targets on KPIs missing from the catalog', () => {
  const targetsOn = (jira: MockJira, ...kpiIds: string[]) => {
    const base = assignmentsOf(jira, EPIC).assignments[0];
    jira.fixture.issues.get(STORY)!.properties['kpi-assignments'] = {
      assignments: kpiIds.map((kpiId) => ({ ...base, kpiId })),
      kpiIds,
    };
  };

  it('flags only KPIs Jira confirms are gone — not ones the search index has yet to list', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: STORY }, (jira) => {
      // KPI-50 exists but isn't in the KPI-space search yet (index lag); KPI-99 is deleted.
      jira.fixture.issues.set('5050', {
        ...jira.fixture.issues.get('1000')!,
        id: '5050',
        key: 'KPI-50',
        kpiParentId: null,
      });
      targetsOn(jira, 'KPI-1', 'KPI-50', 'KPI-99');
    });
    expect(data!.basis!.deletedKpiIds).toEqual(['KPI-99']);
  });

  it('checks nothing when every targeted KPI is listed', async () => {
    const { data, jira } = await invoke<PanelListData>('getPanelList', { issueId: STORY }, (j) => targetsOn(j, 'KPI-2'));
    expect(data!.basis!.deletedKpiIds).toBeUndefined();
    expect(jira.writes).toEqual([]);
  });

  it('fails rather than treat every KPI as deleted when the KPI-space search fails', async () => {
    const { data, error } = await invoke<PanelListData>('getPanelList', { issueId: STORY }, (jira) => {
      targetsOn(jira, 'KPI-1');
      jira.intercept = (method, path, _body, raw) =>
        method === 'GET' && path === '/rest/api/3/search/jql' && decodeURIComponent(raw).includes('jql=project=')
          ? { status: 503, body: { errorMessages: ['Service unavailable'] } }
          : undefined;
    });
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 503 while trying to list the KPIs in project KPI/);
  });
});

describe('KPI hierarchy link', () => {
  const unsetHierarchy = (jira: MockJira) => jira.fixture.kvs.delete('kpi:hierarchy');

  it('refuses to nest a new KPI (writing nothing) when no hierarchy link type is configured', async () => {
    const { error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { name: 'Churn', unit: '%', direction: null, parentKpiId: 'KPI-1' },
      unsetHierarchy,
    );
    expect(error?.message).toMatch(/^KPI hierarchy is not set up/);
    expect(jira.writes).toEqual([]);
  });

  it('still creates root KPIs without a hierarchy link type', async () => {
    const { error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { name: 'Churn', unit: '%', direction: null, parentKpiId: null },
      unsetHierarchy,
    );
    expect(error).toBeUndefined();
    expect(jira.writes).toEqual(['POST /rest/api/3/issue']);
  });

  it('getKpiHierarchy reports the configured type, resolved by id, plus every site type', async () => {
    const { data } = await invoke<KpiHierarchyStatus>('getKpiHierarchy', undefined);
    expect(data).toMatchObject({
      state: 'ready',
      linkTypeId: KPI_HIERARCHY_LINK_TYPE.id,
      parentEnd: 'inward',
      linkType: KPI_HIERARCHY_LINK_TYPE,
    });
    expect(data!.available.map((t) => t.name)).toEqual(['Blocks', 'Relates', 'KPI Hierarchy']);
  });

  it('getKpiHierarchy: unset with no config, missing once the stored type is deleted', async () => {
    const unset = await invoke<KpiHierarchyStatus>('getKpiHierarchy', undefined, unsetHierarchy);
    expect(unset.data!.state).toBe('unset');
    const missing = await invoke<KpiHierarchyStatus>('getKpiHierarchy', undefined, (jira) => {
      jira.fixture.linkTypes = jira.fixture.linkTypes.filter((t) => t.id !== KPI_HIERARCHY_LINK_TYPE.id);
    });
    expect(missing.data).toMatchObject({ state: 'missing', linkType: null, linkTypeId: KPI_HIERARCHY_LINK_TYPE.id });
  });

  it('getKpiHierarchy: unavailable (not a failed Settings load) when link types cannot be read', async () => {
    const { data, error } = await invoke<KpiHierarchyStatus>('getKpiHierarchy', undefined, (jira) => {
      jira.intercept = (method, path) =>
        method === 'GET' && path === '/rest/api/3/issueLinkType'
          ? { status: 404, body: { errorMessages: ['Issue linking is disabled.'] } }
          : undefined;
    });
    expect(error).toBeUndefined();
    expect(data).toMatchObject({ state: 'unavailable', message: expect.stringContaining('Issue linking is disabled.') });
  });

  it('saveKpiHierarchy stores an existing directional type and which end is the parent', async () => {
    const { data, jira } = await invoke<KpiHierarchyStatus>(
      'saveKpiHierarchy',
      { linkTypeId: '10000', parentEnd: 'outward' },
      undefined,
      SETTINGS,
    );
    expect(data).toMatchObject({ state: 'ready', linkType: { name: 'Blocks' }, parentEnd: 'outward' });
    expect(jira.fixture.kvs.get('kpi:hierarchy')).toEqual({ linkTypeId: '10000', parentEnd: 'outward' });
  });

  it('saveKpiHierarchy rejects symmetric, unknown and malformed types without saving', async () => {
    const relates = await invoke('saveKpiHierarchy', { linkTypeId: '10003', parentEnd: 'inward' }, undefined, SETTINGS);
    expect(relates.error?.message).toMatch(/can't tell a parent KPI from a child/);
    expect(relates.jira.fixture.kvs.get('kpi:hierarchy')).toEqual({ linkTypeId: KPI_HIERARCHY_LINK_TYPE.id, parentEnd: 'inward' });
    const unknown = await invoke('saveKpiHierarchy', { linkTypeId: '99999', parentEnd: 'inward' }, undefined, SETTINGS);
    expect(unknown.error?.message).toMatch(/No issue link type with id "99999"/);
    const malformed = await invoke('saveKpiHierarchy', { linkTypeId: '10000', parentEnd: 'sideways' }, undefined, SETTINGS);
    expect(malformed.error?.message).toMatch(/Pick a link type/);
    expect(malformed.jira.writes).toEqual([]);
  });

  it.each([
    ['saveKpiHierarchy', { linkTypeId: '10000', parentEnd: 'outward' }],
    ['createKpiHierarchyLinkType', undefined],
    ['saveRollupConfig', { config: { dueDateRollup: {} } }],
    ['saveKpiSpaceKey', { key: 'KPI' }],
    ['createKpiSpace', { key: 'NEWKPI' }],
  ])('%s is refused unless it comes from the Settings admin page', async (key, payload) => {
    for (const context of [{}, { moduleKey: 'kpi-issue-panel' }, { moduleKey: 'kpi-timeline-page' }]) {
      const { error, jira } = await invoke(key, payload, undefined, context);
      expect(error?.message).toMatch(/only be changed from the KPI Settings admin page/);
      expect(jira.writes).toEqual([]);
      expect(jira.fixture.kvs.get('kpi:hierarchy')).toEqual({ linkTypeId: KPI_HIERARCHY_LINK_TYPE.id, parentEnd: 'inward' });
    }
  });

  it('createKpiHierarchyLinkType creates the KPI Hierarchy type when the site has none and points the config at it', async () => {
    const { data, jira } = await invoke<KpiHierarchyStatus>(
      'createKpiHierarchyLinkType',
      undefined,
      (j) => {
        unsetHierarchy(j);
        j.fixture.linkTypes = j.fixture.linkTypes.filter((t) => t.id !== KPI_HIERARCHY_LINK_TYPE.id);
      },
      SETTINGS,
    );
    expect(jira.writes).toEqual(['POST /rest/api/3/issueLinkType']);
    expect(data).toMatchObject({
      state: 'ready',
      parentEnd: 'inward',
      linkType: { name: 'KPI Hierarchy', outward: 'is the parent KPI of', inward: 'is a child KPI of' },
    });
    expect(jira.fixture.kvs.get('kpi:hierarchy')).toEqual({ linkTypeId: data!.linkType!.id, parentEnd: 'inward' });
  });

  it('createKpiHierarchyLinkType refuses to adopt a same-named type that reads the same both ways', async () => {
    const { error, jira } = await invoke<KpiHierarchyStatus>(
      'createKpiHierarchyLinkType',
      undefined,
      (j) => {
        unsetHierarchy(j);
        j.fixture.linkTypes = j.fixture.linkTypes.map((t) =>
          t.id === KPI_HIERARCHY_LINK_TYPE.id ? { ...t, inward: 'relates to', outward: 'relates to' } : t,
        );
      },
      SETTINGS,
    );
    expect(error?.message).toMatch(/reads "relates to" both ways/);
    expect(jira.writes).toEqual([]);
    expect(jira.fixture.kvs.get('kpi:hierarchy')).toBeUndefined();
  });

  it('createKpiHierarchyLinkType adopts an existing KPI Hierarchy type instead of duplicating it', async () => {
    const { data, jira } = await invoke<KpiHierarchyStatus>('createKpiHierarchyLinkType', undefined, unsetHierarchy, SETTINGS);
    expect(jira.writes).toEqual([]);
    expect(data).toMatchObject({ state: 'ready', linkTypeId: KPI_HIERARCHY_LINK_TYPE.id });
  });
});

describe('KPI hierarchy link: reused types, deleted types, loops', () => {
  const useBlocksChildBlocksParent = (jira: MockJira) =>
    jira.fixture.kvs.set('kpi:hierarchy', { linkTypeId: '10000', parentEnd: 'outward' });
  const countNodes = (nodes: TimelineData['roots']): number =>
    nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);

  it('refuses to nest (writing nothing) when the configured link type was deleted', async () => {
    const { error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { name: 'Churn', unit: '%', direction: null, parentKpiId: 'KPI-1' },
      (j) => {
        j.fixture.linkTypes = j.fixture.linkTypes.filter((t) => t.id !== KPI_HIERARCHY_LINK_TYPE.id);
      },
    );
    expect(error?.message).toMatch(/^KPI hierarchy is not set up — the link type KPIs nest with was deleted/);
    expect(jira.writes).toEqual([]);
  });

  it('nests with a reused type, the parent on its outward end ("child blocks parent")', async () => {
    let body: unknown;
    const { data, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { name: 'Churn', unit: '%', direction: null, parentKpiId: 'KPI-1' },
      (j) => {
        useBlocksChildBlocksParent(j);
        j.intercept = (method, path, b) => {
          if (method === 'POST' && path === '/rest/api/3/issueLink') body = JSON.parse(String(b));
          return undefined;
        };
      },
    );
    expect(body).toEqual({ type: { id: '10000' }, inwardIssue: { key: 'KPI-11' }, outwardIssue: { key: 'KPI-1' } });
    expect(jira.fixture.issues.get(data!.id)!.kpiParentId).toBe('1000');
  });

  it('reads the tree back from a reused type on its configured end', async () => {
    const { data } = await invoke<TimelineData>('getTimelineSkeleton', undefined, useBlocksChildBlocksParent);
    expect(data!.roots.map((r) => r.children.length)).toEqual([4, 4]);
  });

  it('keeps every KPI of a link loop on the timeline (the loop is broken at its first member)', async () => {
    const { data } = await invoke<TimelineData>('getTimelineSkeleton', undefined, (j) => {
      // KPI-1 (root) ⇄ KPI-2 (its child): with no break, both would vanish with their subtree.
      j.fixture.issues.get('1000')!.kpiParentId = '1001';
    });
    expect(countNodes(data!.roots)).toBe(10);
    expect(data!.roots.map((r) => r.issueKey).sort()).toEqual(['KPI-1', 'KPI-6']);
  });
});
