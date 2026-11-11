import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildScaleFixture, createMockJira, type MockJira, type ScaleOptions } from './testing/scaleFixture';
import {
  assemblePanel,
  type PanelData,
  type PanelListData,
  type PanelValuesData,
  type TimelineData,
  type TimelineNodeDto,
} from '../domain/index';
import type { Trace } from './requestLog';

/**
 * Issue panel load (specs/07-issue-panel-performance), run through the REAL
 * resolver against the in-memory Jira of the scale fixture: the two progressive
 * phases, the issue-only rollup walk, and the KPI-issue path.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null, routes: [] as string[] }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers } = await import('./testing/scaleFixture');
  const requester = {
    requestJira: (route: unknown, init?: { method?: string; body?: unknown }) => {
      h.routes.push(decodeURIComponent(String((route as { value: string }).value)));
      return h.jira!.requestJira(route, init);
    },
  };
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

// Fixture ids: initiatives 100000+, epics 200000+ (epic N's target cycles
// absolute / relative to own due / relative to PARENT due / percent), stories 300000+.
const EPIC_OWN_DUE = '200001';
const EPIC_PARENT_DUE = '200002';
const INITIATIVE_OF_EPICS = '100000';
const STORY = '300000';
const KPI_ISSUE = '1000';

async function invoke<T>(
  key: string,
  { payload, context = {}, scale = {} }: { payload?: unknown; context?: unknown; scale?: Partial<ScaleOptions> } = {},
) {
  vi.resetModules();
  h.jira = createMockJira(buildScaleFixture(scale));
  h.routes = [];
  const { setTraceSink } = await import('./requestLog');
  const traces: Trace[] = [];
  setTraceSink((t) => traces.push(t));
  const { handler } = await import('./resolver');
  const data = (await handler({ call: { functionKey: key, payload }, context } as never)) as T;
  expect(h.jira.unhandled).toEqual([]);
  return { data, routes: [...h.routes], trace: traces[0] };
}

function findNode(nodes: TimelineNodeDto[], issueKey: string): TimelineNodeDto | undefined {
  for (const n of nodes) {
    if (n.issueKey === issueKey) return n;
    const found = findNode(n.children, issueKey);
    if (found) return found;
  }
  return undefined;
}

describe('issue panel load', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Phase 1 has the targets, grouping and catalog, with no readings and no rollup walk', async () => {
    const { data, routes } = await invoke<PanelListData>('getPanelList', { payload: { issueId: EPIC_OWN_DUE } });
    expect(data.panel).toBeUndefined();
    const basis = data.basis!;
    expect(basis.issueKey).toBe('WEB-2');
    expect(basis.own.map((a) => a.kpiId)).toEqual(['KPI-2']);
    expect(basis.catalog).toHaveLength(40);
    expect(basis.catalog.every((c) => c.currentValue === null)).toBe(true);
    // The issue's targets come inside the issue GET; no rollup walk, no readings.
    expect(routes.some((r) => r.includes(`/issue/${EPIC_OWN_DUE}/properties/`))).toBe(false);
    expect(routes.some((r) => /jql=(id|parent) in/.test(r))).toBe(false);
    expect(routes.some((r) => r.includes('changelog'))).toBe(false);

    const panel = assemblePanel(basis, null);
    expect(panel.resolving).toBe(true);
    expect(panel.rows).toHaveLength(1);
    expect(panel.rows[0]).toMatchObject({ kpiId: 'KPI-2', name: 'KPI 2', relationship: 'onlyHere', resolving: true });
  });

  it('walks only the issue subtree unless a target anchors to the parent due date', async () => {
    const own = await invoke<PanelValuesData>('getPanelValues', { payload: { issueId: EPIC_OWN_DUE } });
    expect(own.data.parent).toBeNull();
    expect(own.routes.some((r) => r.includes(INITIATIVE_OF_EPICS))).toBe(false);

    const parent = await invoke<PanelValuesData>('getPanelValues', { payload: { issueId: EPIC_PARENT_DUE } });
    expect(parent.data.parent?.issueKey).toBe('INIT-1');
    expect(parent.routes.some((r) => r.includes(`parent in (${INITIATIVE_OF_EPICS})`))).toBe(true);
  });

  it('resolves the same dates as the timeline rollup', async () => {
    const timeline = await invoke<TimelineData>('getTimelineData');
    const { data } = await invoke<PanelData>('getPanelData', { payload: { issueId: EPIC_PARENT_DUE } });
    const row = data.rows[0];
    const node = findNode(timeline.data.roots, row.kpiId)!;
    const fromTimeline = [...node.targets, ...node.undated].find((t) => t.source.issue === data.issueKey)!;
    expect(row.targetDate?.date ?? null).toBe(fromTimeline.date);
    expect(data.resolving).toBeUndefined();
    expect(row.resolving).toBeUndefined();
  });

  it('a story without targets lists its epic\'s KPI as "on parent" and reports its due date', async () => {
    const { data } = await invoke<PanelData>('getPanelData', { payload: { issueId: STORY } });
    expect(data.rows.map((r) => [r.kpiId, r.relationship])).toEqual([['KPI-1', 'onParentNotTracked']]);
    expect(data.issueDueDate).not.toBeNull();
  });

  it('falls back to the issue in the invocation context when the payload has none', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', {
      context: { extension: { issue: { id: EPIC_OWN_DUE } } },
    });
    expect(data.basis?.issueKey).toBe('WEB-2');
  });

  it('a KPI issue gets its complete KPI chart from Phase 1', async () => {
    const { data } = await invoke<PanelListData>('getPanelList', { payload: { issueId: KPI_ISSUE } });
    expect(data.panel?.kpiView?.node.issueKey).toBe('KPI-1');
    const values = await invoke<PanelValuesData>('getPanelValues', { payload: { issueId: KPI_ISSUE } });
    expect(values.data.readings).toEqual({});
  });
});
