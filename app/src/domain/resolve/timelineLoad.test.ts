import { describe, it, expect } from 'vitest';
import {
  applyAddedTarget,
  applyTargetContributions,
  clearResolving,
  insertCreatedKpi,
  withAddedContributions,
  type TargetContributionsByKpi,
} from './timelineLoad';
import type { CreatedKpi, TimelineData, TimelineNodeDto } from '../contracts';
import type { Assignment } from '../models/assignment';

const assignment = (over: Partial<Assignment> & Pick<Assignment, 'timing'>): Assignment => ({
  kpiId: 'KPI-1',
  inheritFromParent: false,
  target: 100,
  targetType: 'absolute',
  updatedBy: 'u',
  updatedAt: 1,
  ...over,
});

const source = (issue: string, due: string | null) => ({
  key: issue,
  type: 'Epic',
  title: issue,
  iconUrl: null,
  due,
});

const absolute = (date: string) => ({
  start: null,
  due: { mode: 'absolute' as const, absolute: date, anchor: 'issueDueDate' as const, offsetMonths: 0 },
});
const relative = (offsetMonths: number) => ({
  start: null,
  due: { mode: 'relative' as const, absolute: null, anchor: 'issueDueDate' as const, offsetMonths },
});

const node = (over: Partial<TimelineNodeDto>): TimelineNodeDto => ({
  id: 'n1',
  kpiId: 'KPI-1',
  issueKey: 'KPI-1',
  name: 'Revenue',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
  readings: [{ date: '2026-01-01', value: 100 }],
  children: [],
  resolving: true,
  ...over,
});

const skeleton: TimelineData = {
  today: '2026-07-10',
  roots: [node({ children: [node({ id: 'n2', kpiId: 'KPI-2', issueKey: 'KPI-2', depth: 1 })] })],
};

describe('applyTargetContributions', () => {
  const contributions: TargetContributionsByKpi = {
    'KPI-1': [
      { assignment: assignment({ timing: absolute('2026-09-30') }), source: source('APP-2', null) },
      { assignment: assignment({ timing: absolute('2026-03-31'), target: 90 }), source: source('APP-1', null) },
      // relative to an issue with no (rolled-up) due date → undated
      { assignment: assignment({ timing: relative(1) }), source: source('APP-3', null) },
    ],
    'KPI-2': [{ assignment: assignment({ kpiId: 'KPI-2', timing: relative(2) }), source: source('APP-4', '2026-08-01') }],
    'KPI-404': [{ assignment: assignment({ kpiId: 'KPI-404', timing: absolute('2026-09-30') }), source: source('X-1', null) }],
  };

  const merged = applyTargetContributions(skeleton, contributions);

  it('fills dated targets chronologically, with status from the readings', () => {
    const kpi1 = merged.roots[0];
    expect(kpi1.targets.map((t) => [t.date, t.source.issue])).toEqual([
      ['2026-03-31', 'APP-1'],
      ['2026-09-30', 'APP-2'],
    ]);
    // past date, target 90, latest reading 100 on an "increase" KPI → hit; future → upcoming
    expect(kpi1.targets.map((t) => t.status)).toEqual(['hit', 'upcoming']);
  });

  it('routes pending targets to the undated lane', () => {
    expect(merged.roots[0].undated.map((t) => t.source.issue)).toEqual(['APP-3']);
  });

  it('resolves relative dates from the source due date, recursing into children', () => {
    const kpi2 = merged.roots[0].children[0];
    expect(kpi2.targets.map((t) => t.date)).toEqual(['2026-10-01']);
  });

  it('clears the resolving flag and keeps the key order stable', () => {
    expect(merged.roots[0].resolving).toBeUndefined();
    expect('resolving' in merged.roots[0]).toBe(false);
    expect(Object.keys(merged.roots[0])).toEqual([
      'id', 'kpiId', 'issueKey', 'name', 'unit', 'direction', 'depth',
      'targets', 'undated', 'readings', 'children',
    ]);
  });

  it('ignores contributions for KPIs that are not in the tree, and does not mutate the input', () => {
    expect(JSON.stringify(merged)).not.toContain('X-1');
    expect(skeleton.roots[0].resolving).toBe(true);
    expect(skeleton.roots[0].targets).toEqual([]);
  });

  it('an empty contribution map just clears resolving', () => {
    const empty = applyTargetContributions(skeleton, {});
    expect(empty.roots[0].targets).toEqual([]);
    expect(empty.roots[0].resolving).toBeUndefined();
  });

  it('is deterministic: applying twice gives the same result', () => {
    expect(applyTargetContributions(skeleton, contributions)).toEqual(merged);
  });
});

describe('clearResolving', () => {
  it('drops the flag on every node and keeps everything else', () => {
    const cleared = clearResolving(skeleton);
    expect(cleared.roots[0].resolving).toBeUndefined();
    expect(cleared.roots[0].children[0].resolving).toBeUndefined();
    expect(cleared.roots[0].children[0].name).toBe('Revenue');
  });
});

describe('insertCreatedKpi', () => {
  const created = (over: Partial<CreatedKpi> = {}): CreatedKpi => ({
    id: '10099',
    kpiId: 'KPI-9',
    issueKey: 'KPI-9',
    name: 'Churn',
    unit: '%',
    direction: 'decrease',
    parentKpiId: null,
    ...over,
  });

  it('appends a root KPI with no readings or targets', () => {
    const out = insertCreatedKpi(skeleton, created());
    expect(out.roots.map((n) => n.kpiId)).toEqual(['KPI-1', 'KPI-9']);
    expect(out.roots[1]).toMatchObject({ depth: 0, name: 'Churn', readings: [], targets: [], undated: [] });
    expect(out.roots[1].resolving).toBeUndefined();
  });

  it('nests under its parent, one level deeper, after existing siblings', () => {
    const out = insertCreatedKpi(skeleton, created({ parentKpiId: 'KPI-1' }));
    expect(out.roots[0].children.map((n) => [n.kpiId, n.depth])).toEqual([
      ['KPI-2', 1],
      ['KPI-9', 1],
    ]);
    expect(skeleton.roots[0].children).toHaveLength(1);
  });

  it('falls back to the root when the parent is not in the tree', () => {
    const out = insertCreatedKpi(skeleton, created({ parentKpiId: 'KPI-404' }));
    expect(out.roots.map((n) => n.kpiId)).toEqual(['KPI-1', 'KPI-9']);
  });

  it('is a no-op once the tree already holds the KPI (a later load caught up)', () => {
    expect(insertCreatedKpi(skeleton, created({ kpiId: 'KPI-2' }))).toBe(skeleton);
  });
});

describe('applyAddedTarget', () => {
  const merged = applyTargetContributions(skeleton, {
    'KPI-1': [{ assignment: assignment({ timing: absolute('2026-09-30') }), source: source('APP-2', null) }],
  });

  it('adds a marker in date order, with status from the KPI readings', () => {
    const out = applyAddedTarget(merged, {
      assignment: assignment({ timing: absolute('2026-03-31'), target: 90 }),
      source: source('APP-1', null),
    });
    expect(out.roots[0].targets.map((t) => [t.date, t.source.issue, t.status])).toEqual([
      ['2026-03-31', 'APP-1', 'hit'],
      ['2026-09-30', 'APP-2', 'upcoming'],
    ]);
  });

  it("replaces the same issue's marker (one target per issue + KPI), so re-applying is idempotent", () => {
    const added = { assignment: assignment({ timing: absolute('2026-12-31'), target: 200 }), source: source('APP-2', null) };
    const once = applyAddedTarget(merged, added);
    expect(once.roots[0].targets.map((t) => [t.date, t.value])).toEqual([['2026-12-31', 200]]);
    expect(applyAddedTarget(once, added)).toEqual(once);
  });

  it('reaches nested KPIs and keeps a still-resolving row resolving', () => {
    const out = applyAddedTarget(skeleton, {
      assignment: assignment({ kpiId: 'KPI-2', timing: absolute('2026-09-30') }),
      source: source('APP-5', null),
    });
    const kpi2 = out.roots[0].children[0];
    expect(kpi2.targets.map((t) => t.source.issue)).toEqual(['APP-5']);
    expect(kpi2.resolving).toBe(true);
  });

  it('ignores a target for a KPI that is not in the tree', () => {
    const added = { assignment: assignment({ kpiId: 'KPI-404', timing: absolute('2026-09-30') }), source: source('X', null) };
    expect(applyAddedTarget(merged, added)).toBe(merged);
  });
});

describe('withAddedContributions (spec 09)', () => {
  const pct = (key: string, due: string) => ({
    assignment: assignment({ targetType: 'percent', target: 10, timing: relative(1) }),
    source: { ...source(key, due), hierarchyLevel: 1 },
  });
  const loaded: TargetContributionsByKpi = { 'KPI-1': [pct('A', '2027-03-31'), pct('B', '2027-06-30')] };

  it('replaces the same issue’s contribution and adds new ones', () => {
    const reset = { assignment: assignment({ target: 50, timing: absolute('2027-05-15') }), source: { ...source('A', null), hierarchyLevel: 1 } };
    const merged = withAddedContributions(loaded, [reset]);
    expect(merged['KPI-1'].map((c) => [c.source.key, c.assignment.target])).toEqual([['B', 10], ['A', 50]]);
    expect(loaded['KPI-1']).toHaveLength(2);
    expect(withAddedContributions(loaded, [])).toBe(loaded);
  });

  it('a saved target stacks with the rest of its level', () => {
    const data: TimelineData = { today: '2026-07-01', roots: [node({ readings: [{ date: '2027-01-01', value: 100 }] })] };
    const added = { assignment: assignment({ target: 200, timing: absolute('2027-05-15') }), source: { ...source('C', null), hierarchyLevel: 1 } };
    const built = applyTargetContributions(data, withAddedContributions(loaded, [added]));
    const b = built.roots[0].targets.find((t) => t.source.issue === 'B')!;
    // A's +10% (Apr 30), then C resets to 200 (May 15), then B's own +10%.
    expect(b.value).toBeCloseTo(220, 6);
  });
});
