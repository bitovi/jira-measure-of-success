import { describe, it, expect } from 'vitest';
import { applyTargetContributions, clearResolving, type TargetContributionsByKpi } from './timelineLoad';
import type { TimelineData, TimelineNodeDto } from '../contracts';
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
