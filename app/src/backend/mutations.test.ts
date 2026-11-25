import { describe, it, expect, vi } from 'vitest';
import {
  buildScaleFixture,
  createMockJira,
  extraKpiLinkId,
  KPI_HIERARCHY_LINK_TYPE,
  kpiLinkId,
  storedTargets,
  type MockJira,
} from './testing/scaleFixture';
import type {
  AddedTarget,
  AddTargetInput,
  CreatedKpi,
  KpiHierarchyStatus,
  PanelListData,
  StoredAssignment,
  TimelineData,
  UpdateKpiInput,
  UpdateKpiResult,
} from '../domain/index';

/**
 * The lightweight mutation results (specs/06-timeline-performance) and the
 * deleted-KPI check (getPanelList), run through the REAL resolver against the
 * in-memory Jira of the scale fixture.
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
  jira.fixture.issues.get(id)!.properties['kpi-assignments'] as {
    assignments: Array<{ kpiId: string; kpiIssueId?: string; target: number }>;
    kpiIds: string[];
    kpiIssueIds: string[];
    refsVersion?: number;
  };

const addTargetInput = (over: Partial<AddTargetInput> = {}): AddTargetInput => ({
  kpiId: '1001',
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
      kpiId: '1001',
      target: 500,
      targetType: 'absolute',
      timing: { due: { mode: 'absolute', absolute: '2026-12-31' } },
      updatedBy: 'acc-1',
    });
    expect(data!.source).toMatchObject({ key: 'APP-1', type: 'Epic', title: 'Epic 1' });
    expect(data!.source.iconUrl).toMatch(/^data:image\/svg\+xml/);
    // Added alongside the epic's existing KPI-1 target, with both search indexes kept in sync.
    expect(assignmentsOf(jira, EPIC)).toMatchObject({ kpiIssueIds: ['1000', '1001'], kpiIds: ['KPI-1', 'KPI-2'], refsVersion: 2 });
  });

  it('updates the existing target in place for the same (issue, KPI)', async () => {
    const { jira } = await invoke<AddedTarget>('addTarget', addTargetInput({ kpiId: '1000', value: 999 }));
    const { assignments } = assignmentsOf(jira, EPIC);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ kpiIssueId: '1000', kpiId: 'KPI-1', target: 999 });
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
    const { data, error, jira } = await invoke('recordValue', { kpiId: '1000', date: '2026-06-01', value: 42 });
    expect(error).toBeUndefined();
    expect(data).toBeNull();
    // Spec 10 Path A: the standard issue edit, as the user (not the app-only field API).
    expect(jira.writes).toEqual(['PUT /rest/api/3/issue/1000']);
  });

  it.each([
    ['a non-ISO date', { kpiId: '1000', date: '06/01/2026', value: 42 }],
    ['a non-numeric value', { kpiId: '1000', date: '2026-06-01', value: '42' }],
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
      projectId: '10000',
      name: 'Churn',
      unit: '%',
      direction: 'decrease',
      parentKpiId: '1000',
    });
    expect(data).toEqual({
      id: expect.stringMatching(/^\d+$/),
      kpiId: data!.id,
      issueKey: 'KPI-11',
      name: 'Churn',
      unit: '%',
      direction: 'decrease',
      parentKpiId: '1000',
      space: { id: '10000', key: 'KPI', name: 'KPIs (KPI)' },
    });
    expect(jira.writes).toEqual(['POST /rest/api/3/issue', 'POST /rest/api/3/issueLink']);
    expect(jira.fixture.issues.get(data!.id)!.kpiParentId).toBe('1000');
  });

  it('rolls the new issue back when the hierarchy link fails, so a retry cannot duplicate it', async () => {
    const { data, error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { projectId: '10000', name: 'Churn', unit: '%', direction: null, parentKpiId: '1000' },
      (j) => {
        j.intercept = (method, path) => (method === 'POST' && path === '/rest/api/3/issueLink' ? { status: 500 } : undefined);
      },
    );
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 500 while trying to link KPI "KPI-11" under "1000"/);
    expect(jira.writes).toEqual(['POST /rest/api/3/issue', 'POST /rest/api/3/issueLink', 'DELETE /rest/api/3/issue/KPI-11']);
    expect([...jira.fixture.issues.values()].some((i) => i.key === 'KPI-11')).toBe(false);
  });
});

describe('updateKpi', () => {
  // KPI-1 (1000) ─ KPI-2…KPI-5; KPI-6 (1005) ─ KPI-7…KPI-10. KPI-2 is "count", decrease.
  const kpi2 = (over: Partial<UpdateKpiInput> = {}): UpdateKpiInput => ({ kpiId: '1001', ...over });
  const issue = (jira: MockJira, id: string) => jira.fixture.issues.get(id)!;
  const LINK_KPI2 = `DELETE /rest/api/3/issueLink/${kpiLinkId('1001')}`;
  const failSearch = (j: MockJira) => {
    j.intercept = (_method, path) => (path === '/rest/api/3/search/jql' ? { status: 500 } : undefined);
  };
  /** A KPI created moments ago: readable by key/id, but not in the KPI-space search yet. */
  const unindexedKpi = (j: MockJira, id: string, key: string, kpiParentId: string | null) => {
    j.fixture.issues.set(id, { ...issue(j, '1001'), id, key, summary: key, kpiParentId, properties: {}, unindexed: true });
  };

  it('renames and changes unit/direction in one issue edit, returning the KPI as saved', async () => {
    const { data, jira } = await invoke<UpdateKpiResult>('updateKpi', kpi2({ name: ' Orders ', unit: '$', direction: 'increase' }));
    expect(data).toEqual({
      kpi: { id: '1001', kpiId: '1001', issueKey: 'KPI-2', name: 'Orders', unit: '$', direction: 'increase' },
      error: null,
    });
    expect(jira.writes).toEqual(['PUT /rest/api/3/issue/1001']);
    expect(issue(jira, '1001').summary).toBe('Orders');
    expect(issue(jira, '1001').properties['kpi-meta']).toEqual({ unit: '$', direction: 'increase' });
    expect(issue(jira, '1001').kpiParentId).toBe('1000');
  });

  it("changes only the fields sent, so a stale timeline can't undo someone else's edit", async () => {
    const { data, jira } = await invoke<UpdateKpiResult>('updateKpi', kpi2({ unit: '$' }), (j) => {
      // Since this timeline loaded, someone renamed KPI-2, flipped its direction and moved it.
      issue(j, '1001').summary = 'Renamed elsewhere';
      issue(j, '1001').properties['kpi-meta'] = { unit: 'count', direction: 'increase' };
      issue(j, '1001').kpiParentId = '1005';
    });
    expect(data!.kpi).toEqual({
      id: '1001',
      kpiId: '1001',
      issueKey: 'KPI-2',
      name: 'Renamed elsewhere',
      unit: '$',
      direction: 'increase',
    });
    expect(jira.writes).toEqual(['PUT /rest/api/3/issue/1001']);
    expect(issue(jira, '1001').summary).toBe('Renamed elsewhere');
    expect(issue(jira, '1001').properties['kpi-meta']).toEqual({ unit: '$', direction: 'increase' });
    expect(issue(jira, '1001').kpiParentId).toBe('1005');
  });

  it('writes nothing when nothing changed, and never moves a KPI whose parent was left out', async () => {
    const same = await invoke<UpdateKpiResult>('updateKpi', kpi2({ name: 'KPI 2', unit: 'count', direction: 'decrease' }));
    expect(same.error).toBeUndefined();
    expect(same.jira.writes).toEqual([]);
    expect(same.data!.kpi).not.toHaveProperty('parentKpiId');
    const renamed = await invoke<UpdateKpiResult>('updateKpi', kpi2({ name: 'Orders' }));
    expect(renamed.jira.writes).toEqual(['PUT /rest/api/3/issue/1001']);
    expect(issue(renamed.jira, '1001').kpiParentId).toBe('1000');
  });

  it('moves the KPI under another parent: removes the old link, then adds the new one', async () => {
    const { data, jira } = await invoke<UpdateKpiResult>('updateKpi', kpi2({ parentKpiId: '1005' }));
    expect(data).toEqual({ kpi: expect.objectContaining({ parentKpiId: '1005' }), error: null });
    expect(jira.writes).toEqual([LINK_KPI2, 'POST /rest/api/3/issueLink']);
    expect(issue(jira, '1001').kpiParentId).toBe('1005');
  });

  it('moves the KPI to the root by removing its parent link', async () => {
    const { data, jira } = await invoke<UpdateKpiResult>('updateKpi', kpi2({ parentKpiId: null }));
    expect(data!.kpi.parentKpiId).toBeNull();
    expect(jira.writes).toEqual([LINK_KPI2]);
    expect(issue(jira, '1001').kpiParentId).toBeNull();
  });

  it('nests a root KPI without removing anything', async () => {
    const { jira } = await invoke('updateKpi', { kpiId: '1005', parentKpiId: '1000' });
    expect(jira.writes).toEqual(['POST /rest/api/3/issueLink']);
    expect(issue(jira, '1005').kpiParentId).toBe('1000');
  });

  it('removes a current parent the search has not listed yet (no second parent)', async () => {
    const { data, jira } = await invoke<UpdateKpiResult>('updateKpi', { kpiId: '5051', parentKpiId: '1005' }, (j) => {
      unindexedKpi(j, '5050', 'KPI-50', '1000');
      unindexedKpi(j, '5051', 'KPI-51', '5050');
    });
    expect(data!.error).toBeNull();
    expect(jira.writes).toEqual([`DELETE /rest/api/3/issueLink/${kpiLinkId('5051')}`, 'POST /rest/api/3/issueLink']);
    expect(issue(jira, '5051')).toMatchObject({ kpiParentId: '1005' });
    expect(issue(jira, '5051').extraKpiParentIds ?? []).toEqual([]);
  });

  it('removes every parent link of a KPI with two, keeping the one it moves to', async () => {
    const twoParents = (j: MockJira) => {
      issue(j, '1001').extraKpiParentIds = ['1005'];
    };
    const toRoot = await invoke<UpdateKpiResult>('updateKpi', kpi2({ parentKpiId: null }), twoParents);
    expect(toRoot.jira.writes).toEqual([LINK_KPI2, `DELETE /rest/api/3/issueLink/${extraKpiLinkId('1001', '1005')}`]);
    expect(issue(toRoot.jira, '1001')).toMatchObject({ kpiParentId: null, extraKpiParentIds: [] });
    const toSix = await invoke<UpdateKpiResult>('updateKpi', kpi2({ parentKpiId: '1005' }), twoParents);
    expect(toSix.jira.writes).toEqual([LINK_KPI2]);
    expect(issue(toSix.jira, '1001')).toMatchObject({ kpiParentId: null, extraKpiParentIds: ['1005'] });
  });

  it('refuses (writing nothing) to nest a KPI under itself or one of its descendants', async () => {
    const self = await invoke('updateKpi', kpi2({ parentKpiId: '1001' }));
    expect(self.error?.message).toBe("KPI-2 can't be nested under itself.");
    expect(self.jira.writes).toEqual([]);
    const descendant = await invoke('updateKpi', { kpiId: '1000', name: 'Renamed', parentKpiId: '1002' });
    expect(descendant.error?.message).toBe("KPI-1 can't be nested under KPI-3: KPI-3 is nested under KPI-1.");
    expect(descendant.jira.writes).toEqual([]);
  });

  it('catches a loop through a just-created KPI the search index has not listed yet', async () => {
    const { error, jira } = await invoke('updateKpi', { kpiId: '1000', parentKpiId: '5050' }, (j) => {
      unindexedKpi(j, '5050', 'KPI-50', '1000');
    });
    expect(error?.message).toBe("KPI-1 can't be nested under KPI-50: KPI-50 is nested under KPI-1.");
    expect(jira.writes).toEqual([]);
  });

  it('checks for loops with current reads, not the search (which may still show an old tree)', async () => {
    const { error, jira } = await invoke('updateKpi', kpi2({ parentKpiId: '1005' }), (j) => {
      issue(j, '1005').kpiParentId = '1001'; // KPI-6 was just moved under KPI-2
      failSearch(j);
    });
    expect(error?.message).toBe("KPI-2 can't be nested under KPI-6: KPI-6 is nested under KPI-2.");
    expect(jira.writes).toEqual([]);
  });

  it("follows every parent when checking for loops, not just the first", async () => {
    const { error, jira } = await invoke('updateKpi', kpi2({ parentKpiId: '1006' }), (j) => {
      issue(j, '1005').extraKpiParentIds = ['1001']; // KPI-6 is a root that's also linked under KPI-2
    });
    expect(error?.message).toBe("KPI-2 can't be nested under KPI-7: KPI-7 is nested under KPI-2.");
    expect(jira.writes).toEqual([]);
  });

  it('puts the old link back when the new one fails', async () => {
    const { data, error, jira } = await invoke('updateKpi', kpi2({ parentKpiId: '1005' }), (j) => {
      j.intercept = (method, path, body) =>
        method === 'POST' && path === '/rest/api/3/issueLink' && String(body).includes('"KPI-6"')
          ? { status: 500 }
          : undefined;
    });
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 500 while trying to link KPI "KPI-2" under "KPI-6"/);
    expect(jira.writes).toEqual([LINK_KPI2, 'POST /rest/api/3/issueLink', 'POST /rest/api/3/issueLink']);
    expect(issue(jira, '1001').kpiParentId).toBe('1000');
  });

  it('puts removed links back when a later removal fails', async () => {
    const extra = extraKpiLinkId('1001', '1005');
    const { data, error, jira } = await invoke('updateKpi', kpi2({ parentKpiId: null }), (j) => {
      issue(j, '1001').extraKpiParentIds = ['1005'];
      j.intercept = (method, path) =>
        method === 'DELETE' && path === `/rest/api/3/issueLink/${extra}` ? { status: 500 } : undefined;
    });
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(new RegExp(`^Jira 500 while trying to remove issue link ${extra}`));
    expect(jira.writes).toEqual([LINK_KPI2, `DELETE /rest/api/3/issueLink/${extra}`, 'POST /rest/api/3/issueLink']);
    expect(issue(jira, '1001')).toMatchObject({ kpiParentId: '1000', extraKpiParentIds: ['1005'] });
  });

  it("when an old link can't be put back, reports where the KPI now is", async () => {
    const { data, jira } = await invoke<UpdateKpiResult>('updateKpi', kpi2({ name: 'Orders', parentKpiId: '1005' }), (j) => {
      j.intercept = (method, path) => (method === 'POST' && path === '/rest/api/3/issueLink' ? { status: 500 } : undefined);
    });
    expect(data!.kpi).toMatchObject({ name: 'KPI 2', parentKpiId: null });
    expect(data!.error).toMatch(/^Jira 500 while trying to link KPI "KPI-2" under "KPI-6".*\. KPI-2 was taken off KPI-1; nest it again in Jira\.$/);
    // The rename never ran: nothing more is written once the move is in doubt.
    expect(jira.writes).toEqual([LINK_KPI2, 'POST /rest/api/3/issueLink', 'POST /rest/api/3/issueLink']);
    expect(issue(jira, '1001')).toMatchObject({ summary: 'KPI 2', kpiParentId: null });
  });

  it('when the name/unit save fails after a move, returns the moved KPI with the error', async () => {
    const { data, error, jira } = await invoke<UpdateKpiResult>('updateKpi', kpi2({ unit: '$', parentKpiId: '1005' }), (j) => {
      j.intercept = (method, path) => (method === 'PUT' && path === '/rest/api/3/issue/1001' ? { status: 500 } : undefined);
    });
    expect(error).toBeUndefined();
    expect(data!.kpi).toMatchObject({ unit: 'count', direction: 'decrease', parentKpiId: '1005' });
    expect(data!.error).toMatch(/^KPI-2 was moved, but its name, unit and direction weren't saved: Jira 500/);
    expect(jira.writes).toEqual([LINK_KPI2, 'POST /rest/api/3/issueLink', 'PUT /rest/api/3/issue/1001']);
    expect(issue(jira, '1001').kpiParentId).toBe('1005');
  });

  it('when only the name/unit save was asked for and it fails, rejects', async () => {
    const { data, error } = await invoke('updateKpi', kpi2({ unit: '$' }), (j) => {
      j.intercept = (method, path) => (method === 'PUT' && path === '/rest/api/3/issue/1001' ? { status: 500 } : undefined);
    });
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 500 while trying to edit KPI 1001/);
  });

  it('refuses to nest before a hierarchy link type is configured, but still edits a root', async () => {
    const unset = (j: MockJira) => j.fixture.kvs.delete('kpi:hierarchy');
    const nest = await invoke('updateKpi', { kpiId: '1005', parentKpiId: '1000' }, unset);
    expect(nest.error?.message).toMatch(/^KPI hierarchy is not set up/);
    expect(nest.jira.writes).toEqual([]);
    const rename = await invoke<UpdateKpiResult>('updateKpi', { kpiId: '1005', name: 'Six', parentKpiId: null }, unset);
    expect(rename.data!.kpi).toMatchObject({ name: 'Six', parentKpiId: null });
  });

  it.each([
    ['an empty name', kpi2({ name: '  ' }), 'A KPI needs a name.'],
    ['a name longer than Jira allows', kpi2({ name: 'x'.repeat(256) }), 'A KPI name can be at most 255 characters.'],
    ['an unknown direction', { kpiId: '1001', direction: 'sideways' }, /./],
    ['an empty parent', { kpiId: '1001', parentKpiId: '' }, /./],
    ['no KPI', { name: 'Orders' }, /./],
  ])('refuses %s without writing', async (_label, payload, message) => {
    const { error, jira } = await invoke('updateKpi', payload);
    expect(error?.message).toMatch(message);
    expect(jira.writes).toEqual([]);
  });

  it('refuses issues that are not KPIs (not of the KPI work type)', async () => {
    const notKpi = await invoke('updateKpi', kpi2({ kpiId: 'APP-1', name: 'X' }));
    expect(notKpi.error?.message).toBe("APP-1 isn't a KPI, so it can't be edited here.");
    const underWork = await invoke('updateKpi', kpi2({ parentKpiId: 'APP-1' }));
    expect(underWork.error?.message).toBe("APP-1 isn't a KPI: KPIs can only be nested under KPIs.");
    expect(notKpi.jira.writes).toEqual([]);
    expect(underWork.jira.writes).toEqual([]);
  });
});

describe('getPanelList: targets on KPIs missing from the catalog', () => {
  /** Targets on STORY, each `[id, key]` (migrated) or a bare key (a key-only reference). */
  const targetsOn = (jira: MockJira, ...refs: Array<[string, string] | string>) => {
    const base = assignmentsOf(jira, EPIC).assignments[0];
    jira.fixture.issues.get(STORY)!.properties['kpi-assignments'] = storedTargets(
      refs.map((ref) => {
        const { kpiIssueId, ...rest } = base;
        void kpiIssueId;
        return typeof ref === 'string' ? { ...rest, kpiId: ref } : { ...rest, kpiIssueId: ref[0], kpiId: ref[1] };
      }) as StoredAssignment[],
      true,
    );
  };

  it('flags only KPIs Jira confirms are gone — not ones the search index has yet to list', async () => {
    const { data, jira } = await invoke<PanelListData>('getPanelList', { issueId: STORY }, (jira) => {
      // KPI-50 exists but isn't in the KPI-space search yet (index lag); KPI-99 (9999) is deleted.
      jira.fixture.issues.set('5050', {
        ...jira.fixture.issues.get('1000')!,
        id: '5050',
        key: 'KPI-50',
        kpiParentId: null,
        unindexed: true,
      });
      targetsOn(jira, ['1000', 'KPI-1'], ['5050', 'KPI-50'], ['9999', 'KPI-99'], 'KPI-404');
    });
    // A key-only reference is deleted without asking Jira.
    expect(data!.basis!.deletedKpiIds).toEqual(['9999', 'KPI-404']);
    expect(data!.basis!.kpiKeys).toEqual({ '5050': 'KPI-50' });
    expect(jira.unhandled).toEqual([]);
  });

  it('checks nothing when every targeted KPI is listed', async () => {
    const { data, jira } = await invoke<PanelListData>('getPanelList', { issueId: STORY }, (j) => targetsOn(j, ['1001', 'KPI-2']));
    expect(data!.basis!.deletedKpiIds).toBeUndefined();
    expect(jira.writes).toEqual([]);
  });

  it('fails rather than treat every KPI as deleted when the KPI-space search fails', async () => {
    const { data, error } = await invoke<PanelListData>('getPanelList', { issueId: STORY }, (jira) => {
      targetsOn(jira, ['1000', 'KPI-1']);
      jira.intercept = (method, path, _body, raw) =>
        method === 'GET' && path === '/rest/api/3/search/jql' && decodeURIComponent(raw).includes('jql=issuetype')
          ? { status: 503, body: { errorMessages: ['Service unavailable'] } }
          : undefined;
    });
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 503 while trying to list the KPIs/);
  });
});

describe('KPI hierarchy link', () => {
  const unsetHierarchy = (jira: MockJira) => jira.fixture.kvs.delete('kpi:hierarchy');

  it('refuses to nest a new KPI (writing nothing) when no hierarchy link type is configured', async () => {
    const { error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { projectId: '10000', name: 'Churn', unit: '%', direction: null, parentKpiId: '1000' },
      unsetHierarchy,
    );
    expect(error?.message).toMatch(/^KPI hierarchy is not set up/);
    expect(jira.writes).toEqual([]);
  });

  it('still creates root KPIs without a hierarchy link type', async () => {
    const { error, jira } = await invoke<CreatedKpi>(
      'createKpi',
      { projectId: '10000', name: 'Churn', unit: '%', direction: null, parentKpiId: null },
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
      { projectId: '10000', name: 'Churn', unit: '%', direction: null, parentKpiId: '1000' },
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
      { projectId: '10000', name: 'Churn', unit: '%', direction: null, parentKpiId: '1000' },
      (j) => {
        useBlocksChildBlocksParent(j);
        j.intercept = (method, path, b) => {
          if (method === 'POST' && path === '/rest/api/3/issueLink') body = JSON.parse(String(b));
          return undefined;
        };
      },
    );
    expect(body).toEqual({ type: { id: '10000' }, inwardIssue: { key: 'KPI-11' }, outwardIssue: { id: '1000' } });
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
