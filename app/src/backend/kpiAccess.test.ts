import { describe, it, expect, vi } from 'vitest';
import { buildScaleFixture, createMockJira, KPI_PROJECT, type MockJira } from './testing/scaleFixture';
import type { Trace } from './requestLog';
import type { PanelListData, PanelValuesData, TimelineData, TimelineNodeDto } from '../domain/index';

/**
 * Spec 10 — the KPI space follows the user's Jira permissions. Runs the REAL
 * resolver against the in-memory Jira, whose user view filters and
 * permission-checks `asUser` requests the way Jira does, and checks which
 * principal made each call through the resolver's own request trace.
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
// Epic 200000 (APP-1) targets KPI-1 (issue 1000, a root KPI).
const EPIC = '200000';
const KPI_1_ID = '1000';
const NO_ACCESS = { browse: false, create: false, edit: false, link: false };
const READ_ONLY = { browse: true, create: false, edit: false, link: false };

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
  const { setTraceSink } = await import('./requestLog');
  let trace: Trace | undefined;
  setTraceSink((t) => {
    trace = t;
  });
  let data: T | undefined;
  let error: Error | undefined;
  try {
    data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
      { call: { functionKey: key, payload }, context },
      { principal: { accountId: 'acc-1' } },
    )) as T;
  } catch (e) {
    error = e as Error;
  }
  expect(jira.unhandled).toEqual([]);
  /** `as` of every request to an endpoint (normalized like the trace) */
  const asOf = (endpoint: string) => (trace?.requests ?? []).filter((r) => r.endpoint === endpoint).map((r) => r.as);
  return { data, error, jira, trace: trace!, asOf };
}

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

/** Record the body of every bulkfetch so tests can see which issues were asked about. */
function captureBulkfetch(jira: MockJira): string[][] {
  const bodies: string[][] = [];
  jira.intercept = (method, path, body) => {
    if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
      bodies.push((JSON.parse(String(body)) as { issueIdsOrKeys: string[] }).issueIdsOrKeys);
    }
    return undefined;
  };
  return bodies;
}

describe('reads follow the user’s KPI-space permissions', () => {
  it('timeline: full access by default, KPI search and readings as the user', async () => {
    const { data, asOf } = await invoke<TimelineData>('getTimelineSkeleton', {});
    expect(data!.access).toEqual({ browse: true, create: true, edit: true, link: true });
    expect(flatten(data!.roots)).toHaveLength(SMALL.kpis);
    expect(asOf('GET /rest/api/3/search/jql [project]')).toEqual(['user']);
    expect(asOf('POST /rest/api/3/changelog/bulkfetch')).toEqual(['user']);
    expect(asOf('GET /rest/api/3/mypermissions')).toEqual(['user']);
  });

  it('timeline without Browse: no KPIs, no readings fetched, access says why', async () => {
    let bodies: string[][] = [];
    const { data, error } = await invoke<TimelineData>('getTimelineSkeleton', {}, (jira) => {
      jira.fixture.userView.access[KPI_PROJECT.key] = NO_ACCESS;
      bodies = captureBulkfetch(jira);
    });
    expect(error).toBeUndefined();
    expect(data!.roots).toEqual([]);
    expect(data!.access).toEqual(NO_ACCESS);
    expect(bodies).toEqual([]);
  });

  it('timeline: a KPI hidden by issue security is left out, and its readings are never asked for', async () => {
    let bodies: string[][] = [];
    const { data } = await invoke<TimelineData>('getTimelineSkeleton', {}, (jira) => {
      jira.fixture.userView.hidden.add(KPI_1_ID);
      bodies = captureBulkfetch(jira);
    });
    const keys = flatten(data!.roots).map((n) => n.kpiId);
    expect(keys).not.toContain('KPI-1');
    expect(keys).toHaveLength(SMALL.kpis - 1);
    expect(bodies.flat()).not.toContain(KPI_1_ID);
  });

  it('panel without Browse: empty catalog, the target shows as no-permission, access says why', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: EPIC }, (jira) => {
      jira.fixture.userView.access[KPI_PROJECT.key] = NO_ACCESS;
    });
    expect(data!.basis!.catalog).toEqual([]);
    expect(data!.basis!.access).toEqual(NO_ACCESS);
    expect(data!.basis!.noAccessKpiIds).toEqual(['KPI-1']);
    expect(data!.basis!.deletedKpiIds).toBeUndefined();
  });

  it('panel: a target on a KPI hidden by issue security is no-permission, not deleted', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: EPIC }, (jira) => {
      jira.fixture.userView.hidden.add(KPI_1_ID);
    });
    expect(data!.basis!.catalog.map((c) => c.id)).not.toContain('KPI-1');
    expect(data!.basis!.noAccessKpiIds).toEqual(['KPI-1']);
    expect(data!.basis!.deletedKpiIds).toBeUndefined();
  });

  it('panel: a KPI that exists but is not indexed yet is in neither list (unchanged)', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: EPIC }, (jira) => {
      const { issues } = jira.fixture;
      // Exists in Jira, but the KPI-space search doesn't return it yet.
      issues.set('1999', { ...issues.get(KPI_1_ID)!, id: '1999', key: 'KPI-99' });
      const epic = issues.get(EPIC)!;
      const prop = epic.properties['kpi-assignments'] as { assignments: Array<{ kpiId: string }> };
      prop.assignments.push({ ...prop.assignments[0], kpiId: 'KPI-99' });
    });
    expect(data!.basis!.noAccessKpiIds).toBeUndefined();
    expect(data!.basis!.deletedKpiIds).toBeUndefined();
  });

  it('panel: a deleted KPI is still reported deleted (unchanged)', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: EPIC }, (jira) => {
      jira.fixture.issues.delete(KPI_1_ID);
      jira.fixture.kpiIds = jira.fixture.kpiIds.filter((id) => id !== KPI_1_ID);
    });
    expect(data!.basis!.deletedKpiIds).toEqual(['KPI-1']);
    expect(data!.basis!.noAccessKpiIds).toBeUndefined();
  });

  it('panel values without Browse: no readings, nothing fetched for the KPI space', async () => {
    let bodies: string[][] = [];
    const { data } = await invoke<PanelValuesData>('getPanelValues', { issueId: EPIC }, (jira) => {
      jira.fixture.userView.access[KPI_PROJECT.key] = NO_ACCESS;
      bodies = captureBulkfetch(jira);
    });
    expect(data!.readings).toEqual({});
    expect(bodies).toEqual([]);
  });

  it('panel with Browse only: catalog listed, access reports read-only', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: EPIC }, (jira) => {
      jira.fixture.userView.access[KPI_PROJECT.key] = READ_ONLY;
    });
    expect(data!.basis!.catalog).toHaveLength(SMALL.kpis);
    expect(data!.basis!.access).toEqual(READ_ONLY);
  });

  // A failed lookup says nothing about the user's permissions: the search already
  // ran as the user (Jira filtered it), so its result stands and access is unknown.
  const failLookup = (jira: MockJira) => {
    jira.intercept = (_method, path) => (path === '/rest/api/3/mypermissions' ? { status: 503 } : undefined);
  };

  it('timeline when the permission lookup fails: KPIs still shown, access left unknown', async () => {
    const { data, error } = await invoke<TimelineData>('getTimelineSkeleton', {}, failLookup);
    expect(error).toBeUndefined();
    expect(flatten(data!.roots)).toHaveLength(SMALL.kpis);
    expect(data!.access).toBeUndefined();
  });

  it('panel when the permission lookup fails: catalog listed, access left unknown', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { issueId: EPIC }, failLookup);
    expect(data!.basis!.catalog).toHaveLength(SMALL.kpis);
    expect(data!.basis!.access).toBeUndefined();
    expect(data!.basis!.noAccessKpiIds).toBeUndefined();
  });

  it('timeline when the lookup and the search both fail: an error, not a no-permission state', async () => {
    const { data, error } = await invoke<TimelineData>('getTimelineSkeleton', {}, (jira) => {
      jira.intercept = (_method, path) =>
        path === '/rest/api/3/mypermissions' || path === '/rest/api/3/search/jql' ? { status: 503 } : undefined;
    });
    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/^Jira 503 while trying to list the KPIs/);
  });
});

describe('writes follow the user’s KPI-space permissions', () => {
  const kpiInput = (over: Record<string, unknown> = {}) => ({ name: 'New KPI', unit: '$', direction: null, ...over });
  const targetInput = (kpiId: string) => ({
    kpiId,
    issueId: EPIC,
    issueKey: 'APP-1',
    issueType: 'Epic',
    issueTypeIconUrl: null,
    issueSummary: 'Epic 1',
    date: '2026-12-31',
    value: 500,
  });

  it('createKpi runs as the user', async () => {
    const { error, asOf } = await invoke('createKpi', kpiInput({ parentKpiId: 'KPI-1' }));
    expect(error).toBeUndefined();
    expect(asOf('POST /rest/api/3/issue')).toEqual(['user']);
    expect(asOf('POST /rest/api/3/issueLink')).toEqual(['user']);
  });

  it('createKpi without Create Issues: says so, creates nothing', async () => {
    const { error, jira } = await invoke('createKpi', kpiInput(), (j) => {
      j.fixture.userView.access[KPI_PROJECT.key] = READ_ONLY;
    });
    expect(error?.message).toBe(
      'Adding a KPI needs Create Issues permission on the KPIs (KPI) project. Ask a Jira admin.',
    );
    expect(jira.writes).toEqual([]);
  });

  it('createKpi under a parent without Link Issues: refused before the create (no orphan)', async () => {
    const { error, jira } = await invoke('createKpi', kpiInput({ parentKpiId: 'KPI-1' }), (j) => {
      j.fixture.userView.access[KPI_PROJECT.key] = { browse: true, create: true, edit: true, link: false };
    });
    expect(error?.message).toMatch(/^Nesting a KPI under another needs Link Issues permission/);
    expect(jira.writes).toEqual([]);
  });

  it('createKpi when the permission lookup fails: refused with a retry message, creates nothing', async () => {
    const { error, jira } = await invoke('createKpi', kpiInput(), (j) => {
      j.intercept = (_method, path) => (path === '/rest/api/3/mypermissions' ? { status: 503 } : undefined);
    });
    expect(error?.message).toBe(
      "Couldn't check your permissions on the KPI space, so the KPI wasn't created. Try again.",
    );
    expect(jira.writes).toEqual([]);
  });

  it('when the link fails after the create, the rollback delete still runs as the app', async () => {
    const { error, jira, asOf } = await invoke('createKpi', kpiInput({ parentKpiId: 'KPI-1' }), (j) => {
      j.fixture.userView.isAdmin = false; // a plain user can't delete issues
      j.intercept = (method, path) => (method === 'POST' && path === '/rest/api/3/issueLink' ? { status: 500 } : undefined);
    });
    expect(error).toBeDefined();
    expect(asOf('DELETE /rest/api/3/issue/{id}')).toEqual(['app']);
    expect(jira.fixture.kpiIds).toHaveLength(SMALL.kpis);
  });

  it('recordValue writes as the user, so the reading names who recorded it', async () => {
    const { error, jira, asOf } = await invoke('recordValue', { kpiId: 'KPI-1', date: '2026-06-01', value: 42 });
    expect(error).toBeUndefined();
    expect(asOf('PUT /rest/api/3/issue/{id}')).toEqual(['user']);
    expect(jira.writes.some((w) => w.includes('/app/field/'))).toBe(false);
    const last = jira.fixture.readingChanges.get(KPI_1_ID)!.at(-1)!;
    expect(last).toMatchObject({ to: JSON.stringify({ d: '2026-06-01', v: 42 }), by: 'acc-1' });
  });

  it('recordValue without Edit Issues: says so, records nothing', async () => {
    let before = 0;
    const { error, jira } = await invoke('recordValue', { kpiId: 'KPI-1', date: '2026-06-01', value: 42 }, (j) => {
      j.fixture.userView.access[KPI_PROJECT.key] = READ_ONLY;
      before = j.fixture.readingChanges.get(KPI_1_ID)!.length;
    });
    expect(error?.message).toBe(
      'Recording a value on KPI-1 needs Edit Issues permission on the KPIs (KPI) project. Ask a Jira admin.',
    );
    expect(jira.fixture.readingChanges.get(KPI_1_ID)).toHaveLength(before);
  });

  it('recordValue on a KPI hidden from the user: refused, nothing written', async () => {
    const { error, jira } = await invoke('recordValue', { kpiId: 'KPI-1', date: '2026-06-01', value: 42 }, (j) => {
      j.fixture.userView.hidden.add(KPI_1_ID);
    });
    expect(error?.message).toMatch(/^KPI-1 doesn't exist, or you don't have permission to view it\. Viewing KPIs needs Browse Projects/);
    expect(jira.writes).toEqual([]);
  });

  it('recordValue on a work issue (not a KPI): refused, nothing written', async () => {
    const { error, jira } = await invoke('recordValue', { kpiId: 'APP-1', date: '2026-06-01', value: 42 });
    expect(error?.message).toBe("APP-1 isn't a KPI: values can only be recorded on KPIs in the KPI space.");
    expect(jira.writes).toEqual([]);
  });

  it('addTarget on a KPI hidden from the user: refused, no kpi-assignments write', async () => {
    const { error, jira } = await invoke('addTarget', targetInput('KPI-2'), (j) => {
      j.fixture.userView.hidden.add('1001');
    });
    expect(error?.message).toMatch(/^KPI-2 doesn't exist, or you don't have permission to view it\./);
    expect(jira.writes).toEqual([]);
  });

  it('addTarget pointing at a work issue instead of a KPI: refused', async () => {
    const { error, jira } = await invoke('addTarget', targetInput('WEB-2'));
    expect(error?.message).toBe("WEB-2 isn't a KPI: targets can only point at KPIs in the KPI space.");
    expect(jira.writes).toEqual([]);
  });

  it('saveAssignment on a KPI hidden from the user: refused', async () => {
    const assignment = {
      kpiId: 'KPI-1',
      inheritFromParent: false,
      target: 1,
      targetType: 'absolute',
      timing: { start: null, due: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 } },
      updatedBy: 'acc-1',
      updatedAt: 0,
    };
    const { error, jira } = await invoke('saveAssignment', { issueId: EPIC, assignment }, (j) => {
      j.fixture.userView.hidden.add(KPI_1_ID);
    });
    expect(error?.message).toMatch(/^KPI-1 doesn't exist, or you don't have permission to view it\. Viewing KPIs needs Browse Projects/);
    expect(jira.writes).toEqual([]);
  });

  it('removeAssignment of a target on a KPI hidden from the user still works (decided)', async () => {
    const { error, jira } = await invoke('removeAssignment', { issueId: EPIC, kpiId: 'KPI-1' }, (j) => {
      j.fixture.userView.hidden.add(KPI_1_ID);
    });
    expect(error).toBeUndefined();
    const prop = jira.fixture.issues.get(EPIC)!.properties['kpi-assignments'] as { kpiIds: string[] };
    expect(prop.kpiIds).toEqual([]);
  });
});

describe('Settings writes are enforced by Jira (Administer Jira, as the user)', () => {
  const SETTINGS = { moduleKey: 'kpi-settings-page' };
  const settingsWrites: Array<[string, unknown]> = [
    ['saveRollupConfig', { config: { dueDateRollup: {} } }],
    ['saveKpiSpaceKey', { key: 'KPI' }],
    ['createKpiSpace', { key: 'NEWKPI' }],
    ['saveKpiHierarchy', { linkTypeId: '10000', parentEnd: 'outward' }],
    ['createKpiHierarchyLinkType', undefined],
  ];

  it.each(settingsWrites)('%s from the Settings page by a non-admin: refused, nothing written', async (key, payload) => {
    let kvsBefore: string | undefined;
    const { error, jira } = await invoke(
      key,
      payload,
      (j) => {
        j.fixture.userView.isAdmin = false;
        kvsBefore = JSON.stringify([...j.fixture.kvs.entries()]);
      },
      SETTINGS,
    );
    expect(error?.message).toBe('Only Jira admins can change KPI settings.');
    expect(jira.writes).toEqual([]);
    expect(JSON.stringify([...jira.fixture.kvs.entries()])).toBe(kvsBefore);
  });

  it('an admin whose permission lookup fails: told to retry, not that they aren’t an admin', async () => {
    const { error, jira } = await invoke(
      'saveRollupConfig',
      { config: { dueDateRollup: {} } },
      (j) => {
        j.intercept = (_method, path) => (path === '/rest/api/3/mypermissions' ? { status: 503 } : undefined);
      },
      SETTINGS,
    );
    expect(error?.message).toBe("Couldn't check whether you're a Jira admin, so the change wasn't saved. Try again.");
    expect(jira.writes).toEqual([]);
  });

  it('an admin calling from another module is still refused by the page check', async () => {
    const { error } = await invoke('saveRollupConfig', { config: { dueDateRollup: {} } }, undefined, {
      moduleKey: 'kpi-timeline-page',
    });
    expect(error?.message).toMatch(/only be changed from the KPI Settings admin page/);
  });

  it('createKpiSpace (admin, fresh site): provisioning writes run as the user, reads as the app', async () => {
    const { error, jira, asOf } = await invoke(
      'createKpiSpace',
      { key: 'NEWKPI' },
      (j) => {
        j.fixture.issueTypes = j.fixture.issueTypes.filter((t) => t.name !== 'KPI');
        j.fixture.kvs.delete('kpi:hierarchy');
        j.fixture.linkTypes = j.fixture.linkTypes.filter((t) => t.name !== 'KPI Hierarchy');
      },
      SETTINGS,
    );
    expect(error).toBeUndefined();
    expect(asOf('GET /rest/api/3/mypermissions')).toEqual(['user']);
    expect(asOf('POST /rest/api/3/project')).toEqual(['user']);
    expect(asOf('POST /rest/api/3/issuetype')).toEqual(['user']);
    expect(asOf('PUT /rest/api/3/issuetypescheme/{id}/issuetype')).toEqual(['user']);
    expect(asOf('POST /rest/api/3/issueLinkType')).toEqual(['user']);
    // The reads around them stay app-identity (site-wide, nothing per-user).
    expect(new Set(asOf('GET /rest/api/3/project/NEWKPI'))).toEqual(new Set(['app']));
    expect(asOf('GET /rest/api/3/issuetype')).toEqual(['app']);
    expect(asOf('GET /rest/api/3/issuetypescheme/project')).toEqual(['app']);
    expect(jira.fixture.projects.get('NEWKPI')?.issueTypeNames).toContain('KPI');
    expect(jira.fixture.kvs.get('kpi:space')).toMatchObject({ key: 'NEWKPI' });
  });
});
