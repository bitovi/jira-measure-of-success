import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildScaleFixture,
  createMockJira,
  DEFAULT_SCALE,
  type MockJira,
  type ScaleFixture,
  type ScaleOptions,
} from './testing/scaleFixture';
import {
  applyTargetContributions,
  type TimelineData,
  type TimelineNodeDto,
  type TimelineTargetsData,
} from '../domain/index';
import type { Trace } from './requestLog';

/**
 * Timeline performance at the expected scale (specs/06-timeline-performance):
 * 40 KPIs, 2,000 contributing epics, 12,000+ descendants. Runs the REAL
 * resolver against an in-memory Jira and asserts the request budget from the
 * resolver's own trace. Each step of the plan changes rows of the budgets below
 * from the previous step's numbers to the target, and the output fingerprint
 * must stay identical unless the step is meant to change output.
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

/** Cold start (fresh module caches), then one invocation of resolver function `key`. */
async function runResolver<T>(key: string, overrides: Partial<ScaleOptions> = {}) {
  vi.resetModules();
  const jira = createMockJira(buildScaleFixture(overrides));
  h.jira = jira;
  const { setTraceSink, summarizeTrace } = await import('./requestLog');
  const traces: Trace[] = [];
  setTraceSink((t) => traces.push(t));
  const { handler } = await import('./resolver');
  const data = (await handler({ call: { functionKey: key }, context: {} } as never)) as T;
  expect(traces).toHaveLength(1);
  return { data, trace: traces[0], summary: summarizeTrace(traces[0]), jira };
}

const runTimeline = (overrides: Partial<ScaleOptions> = {}) =>
  runResolver<TimelineData>('getTimelineData', overrides);

function flatten(nodes: TimelineNodeDto[]): TimelineNodeDto[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Latest due across an issue's own date and all descendants (the default `widestRange` rollup). */
function latestDue(fixture: ScaleFixture, id: string): string | null {
  const issue = fixture.issues.get(id)!;
  let best = issue.due;
  for (const c of fixture.childrenOf.get(id) ?? []) {
    const d = latestDue(fixture, c);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

const ceil = (n: number, d: number) => Math.ceil(n / d);

describe('getTimelineData at scale', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('request budget per endpoint, full build (what mutations return)', async () => {
    const { summary, jira } = await runTimeline({ latencyMs: 2 });
    const o = DEFAULT_SCALE;
    const epics = o.initiatives * o.epicsPerInitiative;
    const stories = epics * o.storiesPerEpic;
    const subtasks = stories * o.subtasksPerStory;
    // The rollup walk starts from every contributing epic + its initiative,
    // then descends one level per round (id in + parent in per batch of 40).
    const walkBatches = ceil(epics + o.initiatives, 40) + ceil(stories, 40) + ceil(subtasks, 40);

    // Printed so each plan step can compare stage timings and counts.
    console.log(`[perf full] ${JSON.stringify(summary, null, 2)}`);

    const BUDGET: Record<string, number> = {
      // step 3: the targets arrive inside the contributions search, so no
      // per-issue `kpi-assignments` GETs (was one per contributing epic)
      // step 2: kpi-meta arrives with the KPI-space search; one shared /field lookup
      'GET /rest/api/3/field': 1,
      // spec 10: the user's KPI-space permissions, fetched alongside the KPI search
      'GET /rest/api/3/mypermissions': 1,
      'GET /rest/api/3/search/jql [project]': 1,
      'GET /rest/api/3/search/jql [kpi-assignments index]': ceil(epics, 100),
      // + the separate parent fetch in fetchTargetContributions
      'GET /rest/api/3/search/jql [id in]': ceil(o.initiatives, 40) + walkBatches,
      'GET /rest/api/3/search/jql [parent in]': walkBatches,
      'POST /rest/api/3/changelog/bulkfetch': 1,
      'GET /rest/api/2/universal_avatar/view/type/issuetype/avatar/{id}': 1,
    };
    expect(summary.byEndpoint).toEqual(BUDGET);
    expect(jira.unhandled).toEqual([]);
  });

  it('output is complete and stable (fingerprint for later equivalence checks)', async () => {
    const { data, jira } = await runTimeline();
    const nodes = flatten(data.roots);
    expect(nodes).toHaveLength(DEFAULT_SCALE.kpis);
    expect(data.roots).toHaveLength(DEFAULT_SCALE.kpis / 5);

    const targets = nodes.flatMap((n) => [...n.targets, ...n.undated]);
    expect(targets).toHaveLength(jira.fixture.contributorIds.length);

    // Epic #10 (APP-10) has no own due date and a target relative to it, so the
    // marker must sit on the date rolled up from its stories and subtasks.
    const epicId = jira.fixture.contributorIds[9];
    const epic = jira.fixture.issues.get(epicId)!;
    expect(epic.key).toBe('APP-10');
    expect(epic.due).toBeNull();
    const marker = nodes.find((n) => n.kpiId === 'KPI-10')!.targets.find((t) => t.source.issue === 'APP-10');
    expect(marker?.date).toBe(latestDue(jira.fixture, epicId));

    // Changed by spec 08 (targets carry `relative`); identical to the previous digest with it stripped.
    // Changed by spec 09 (same-level relative targets stack); identical to the previous digest with chains disabled.
    // Changed by PR #3 review (marker status uses the shared displayState rule); identical to the previous digest with `status` stripped.
    // `detail` (the tooltip's bet + resolution) is left out so this still guards the rest of the output.
    // Spec 10 added `access` (the user's KPI-space permissions); left out, so the digest is unchanged.
    expect(data.access).toEqual({ browse: true, create: true, edit: true, link: true });
    const digest = createHash('sha256')
      .update(JSON.stringify(data, (key, value) => (key === 'detail' || key === 'access' ? undefined : value)))
      .digest('hex');
    expect(digest).toMatchInlineSnapshot(`"d1eb83616cf65f687391c5f7297dc8cb1cb2e9ca27f449acf3b3db414fdbe0ad"`);
  });

  it('the contributions search asks for the kpi-assignments property and never reads it per issue', async () => {
    const { trace } = await runResolver<TimelineTargetsData>('getTimelineTargets');
    const searches = trace.requests.filter((r) => r.endpoint.endsWith('[kpi-assignments index]'));
    expect(searches).toHaveLength(Math.ceil(DEFAULT_SCALE.initiatives * DEFAULT_SCALE.epicsPerInitiative / 100));
    expect(trace.requests.some((r) => r.endpoint.includes('/properties/'))).toBe(false);
  });

  it('an unparseable kpi-assignments property yields no targets for that issue instead of failing', async () => {
    vi.resetModules();
    const fixture = buildScaleFixture({ initiatives: 1, epicsPerInitiative: 3 });
    fixture.issues.get(fixture.contributorIds[1])!.properties['kpi-assignments'] = { assignments: 'nope' };
    h.jira = createMockJira(fixture);
    const { fetchTargetContributions } = await import('./jira');
    const { issues } = await fetchTargetContributions();
    expect(issues.map((i) => i.assignments.length)).toEqual([1, 0, 1]);
  });

  describe('progressive loading (spec 06 P4)', () => {
    it('Phase 1 (skeleton) makes no contributions search, no per-KPI requests and no walk', async () => {
      const { data, summary, jira } = await runResolver<TimelineData>('getTimelineSkeleton', { latencyMs: 2 });
      console.log(`[perf phase1] ${JSON.stringify(summary, null, 2)}`);

      expect(summary.byEndpoint).toEqual({
        'GET /rest/api/3/field': 1,
        'GET /rest/api/3/mypermissions': 1,
        'GET /rest/api/3/search/jql [project]': 1,
        'POST /rest/api/3/changelog/bulkfetch': 1,
      });
      expect(summary.totalRequests).toBe(4);
      expect(Object.keys(summary.stages)).toEqual(
        expect.arrayContaining(['config', 'fields', 'kpiSpaceIssues', 'readings']),
      );
      expect(jira.unhandled).toEqual([]);

      // Every KPI is present with its readings and meta, marked resolving, with no targets yet.
      const nodes = flatten(data.roots);
      expect(nodes).toHaveLength(DEFAULT_SCALE.kpis);
      for (const n of nodes) {
        expect(n.resolving).toBe(true);
        expect(n.targets).toEqual([]);
        expect(n.undated).toEqual([]);
        expect(n.readings).toHaveLength(DEFAULT_SCALE.readingsPerKpi);
      }
      expect(nodes.find((n) => n.kpiId === 'KPI-1')).toMatchObject({ unit: '%', direction: 'increase' });
      expect(nodes.find((n) => n.kpiId === 'KPI-2')).toMatchObject({ unit: 'count', direction: 'decrease' });
    });

    it('the /field lookup starts together with the config read (not after it)', async () => {
      const { trace } = await runResolver<TimelineData>('getTimelineSkeleton', { latencyMs: 5 });
      const field = trace.requests.find((r) => r.endpoint === 'GET /rest/api/3/field')!;
      const search = trace.requests.find((r) => r.endpoint.endsWith('[project]'))!;
      expect(field.startMs).toBeLessThan(search.startMs);
      // the KPI-space search waited for the field lookup, it did not trigger a second one
      expect(trace.requests.filter((r) => r.endpoint === 'GET /rest/api/3/field')).toHaveLength(1);
    });

    it('Phase 2 (targets) needs no KPI space, readings or kpi-meta requests', async () => {
      const { data, summary } = await runResolver<TimelineTargetsData>('getTimelineTargets');
      expect(Object.keys(summary.byEndpoint)).not.toEqual(
        expect.arrayContaining(['POST /rest/api/3/changelog/bulkfetch']),
      );
      expect(summary.byEndpoint).not.toHaveProperty('GET /rest/api/3/search/jql [project]');
      expect(summary.byEndpoint).not.toHaveProperty('GET /rest/api/3/field');
      expect(Object.values(data.contributions).flat()).toHaveLength(DEFAULT_SCALE.initiatives * DEFAULT_SCALE.epicsPerInitiative);
      expect(Object.keys(data.contributions)).toHaveLength(DEFAULT_SCALE.kpis);
    });

    it('merging Phase 2 into Phase 1 on the client equals the full build', async () => {
      // One cold start at a time: they share the module registry and mock Jira handle.
      const skeleton = await runResolver<TimelineData>('getTimelineSkeleton');
      const targets = await runResolver<TimelineTargetsData>('getTimelineTargets');
      const full = await runTimeline();
      // Round-trip through JSON like the Forge bridge does.
      const merged = applyTargetContributions(
        JSON.parse(JSON.stringify(skeleton.data)) as TimelineData,
        (JSON.parse(JSON.stringify(targets.data)) as TimelineTargetsData).contributions,
      );
      expect(merged).toEqual(full.data);
      expect(JSON.stringify(merged)).toBe(JSON.stringify(full.data));
    });
  });
});
