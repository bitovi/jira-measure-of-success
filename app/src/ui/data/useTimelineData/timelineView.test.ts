import { describe, it, expect } from 'vitest';
import type { TimelineData, TimelineNodeDto } from '@domain/index.js';
import { deriveTimelineView } from './timelineView.js';

const kpi = (over: Partial<TimelineNodeDto> = {}): TimelineNodeDto => ({
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

const skeleton: TimelineData = { today: '2026-07-10', roots: [kpi()] };
const contributions = {
  'KPI-1': [
    {
      assignment: {
        kpiId: 'KPI-1',
        inheritFromParent: false,
        target: 150,
        targetType: 'absolute' as const,
        timing: {
          start: null,
          due: { mode: 'absolute' as const, absolute: '2026-09-30', anchor: 'issueDueDate' as const, offsetMonths: 0 },
        },
        updatedBy: 'u',
        updatedAt: 1,
      },
      source: { key: 'APP-1', type: 'Epic', title: 'Epic', iconUrl: null, due: null },
    },
  ],
};
const fullData: TimelineData = {
  today: '2026-07-10',
  roots: [kpi({ resolving: undefined, targets: [], readings: [{ date: '2026-07-01', value: 120 }] })],
};
const none = { skeleton: null, contributions: null, targetsError: null, full: null };

describe('deriveTimelineView', () => {
  it('shows nothing until the skeleton arrives (even if targets arrived first)', () => {
    expect(deriveTimelineView(none).data).toBeNull();
    expect(deriveTimelineView({ ...none, contributions }).data).toBeNull();
  });

  it('skeleton only: KPIs and readings render, rows keep resolving, targets pending', () => {
    const v = deriveTimelineView({ ...none, skeleton });
    expect(v.data).toBe(skeleton);
    expect(v.targetsPending).toBe(true);
    expect(v.data?.roots[0].resolving).toBe(true);
  });

  it('merges targets when Phase 2 lands, whichever phase finished first', () => {
    const v = deriveTimelineView({ ...none, skeleton, contributions });
    expect(v.targetsPending).toBe(false);
    expect(v.data?.roots[0].resolving).toBeUndefined();
    expect(v.data?.roots[0].targets.map((t) => t.date)).toEqual(['2026-09-30']);
    expect(v.data?.roots[0].readings).toEqual(skeleton.roots[0].readings);
  });

  it('Phase 2 failure keeps the KPIs, stops the shimmer and reports the error', () => {
    const v = deriveTimelineView({ ...none, skeleton, targetsError: 'boom' });
    expect(v.data?.roots[0].name).toBe('Revenue');
    expect(v.data?.roots[0].resolving).toBeUndefined();
    expect(v.targetsPending).toBe(false);
    expect(v.targetsError).toBe('boom');
  });

  it('a mutation result supersedes pending, late and failed Phase 2 alike', () => {
    for (const state of [
      { ...none, skeleton },
      { ...none, skeleton, contributions },
      { ...none, skeleton, targetsError: 'boom' },
      { ...none, full: fullData },
    ]) {
      const v = deriveTimelineView({ ...state, full: fullData });
      expect(v.data).toBe(fullData);
      expect(v.targetsPending).toBe(false);
      expect(v.targetsError).toBeNull();
    }
  });

  it('an empty KPI space has nothing to wait for', () => {
    const empty: TimelineData = { today: '2026-07-10', roots: [] };
    const v = deriveTimelineView({ ...none, skeleton: empty });
    expect(v.data).toBe(empty);
    expect(v.targetsPending).toBe(false);
  });
});
