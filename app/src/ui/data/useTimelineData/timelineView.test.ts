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
const none = { skeleton: null, contributions: null, targetsError: null };

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

  it('an empty KPI space has nothing to wait for', () => {
    const empty: TimelineData = { today: '2026-07-10', roots: [] };
    const v = deriveTimelineView({ ...none, skeleton: empty });
    expect(v.data).toBe(empty);
    expect(v.targetsPending).toBe(false);
  });

  describe('KPIs and targets saved this session', () => {
    const createdKpi = {
      id: '10099',
      kpiId: 'KPI-9',
      issueKey: 'KPI-9',
      name: 'Churn',
      unit: '%',
      direction: 'decrease' as const,
      parentKpiId: null,
    };
    const added = { ...contributions['KPI-1'][0], source: { ...contributions['KPI-1'][0].source, key: 'APP-7' } };

    it('a KPI created in an empty space shows up', () => {
      const empty: TimelineData = { today: '2026-07-10', roots: [] };
      const v = deriveTimelineView({ ...none, skeleton: empty, created: [createdKpi] });
      expect(v.data?.roots.map((n) => n.kpiId)).toEqual(['KPI-9']);
      expect(v.targetsPending).toBe(false);
    });

    it('overlays stay on top of every base: pending, merged and failed Phase 2', () => {
      for (const state of [
        { ...none, skeleton },
        { ...none, skeleton, contributions },
        { ...none, skeleton, targetsError: 'boom' },
      ]) {
        const v = deriveTimelineView({ ...state, created: [createdKpi], addedTargets: [added] });
        expect(v.data?.roots.map((n) => n.kpiId)).toEqual(['KPI-1', 'KPI-9']);
        expect(v.data?.roots[0].targets.map((t) => t.source.issue)).toContain('APP-7');
      }
    });

    it('a target added while Phase 2 is pending keeps the row shimmering', () => {
      const v = deriveTimelineView({ ...none, skeleton, addedTargets: [added] });
      expect(v.targetsPending).toBe(true);
      expect(v.data?.roots[0].resolving).toBe(true);
      expect(v.data?.roots[0].targets.map((t) => t.source.issue)).toEqual(['APP-7']);
    });

    it('with no overlays the base view is returned untouched', () => {
      const v = deriveTimelineView({ ...none, skeleton, created: [], readingEdits: [], addedTargets: [] });
      expect(v.data).toBe(skeleton);
    });
  });

  describe('values recorded this session', () => {
    // Target 150 due 2026-06-30 (past). The loaded 100 reading is from before that date, so
    // it can't be judged yet; a value recorded on the date judges it.
    const pastTarget = {
      'KPI-1': [
        {
          ...contributions['KPI-1'][0],
          assignment: {
            ...contributions['KPI-1'][0].assignment,
            timing: { start: null, due: { ...contributions['KPI-1'][0].assignment.timing.due, absolute: '2026-06-30' } },
          },
        },
      ],
    };

    it('appear in the series, and the targets are re-classified against them', () => {
      expect(deriveTimelineView({ ...none, skeleton, contributions: pastTarget }).data?.roots[0].targets[0].status).toBe(
        'upcoming',
      );
      const v = deriveTimelineView({
        ...none,
        skeleton,
        contributions: pastTarget,
        readingEdits: [{ kpiId: 'KPI-1', date: '2026-06-30', value: 160 }],
      });
      expect(v.data?.roots[0].readings.map((r) => r.value)).toEqual([100, 160]);
      expect(v.data?.roots[0].targets[0].status).toBe('hit');
    });

    it('apply in order: an edit replaces that date, a delete removes it', () => {
      const v = deriveTimelineView({
        ...none,
        skeleton,
        readingEdits: [
          { kpiId: 'KPI-1', date: '2026-02-01', value: 110 },
          { kpiId: 'KPI-1', date: '2026-02-01', value: 120 },
          { kpiId: 'KPI-1', date: '2026-01-01', value: null },
        ],
      });
      expect(v.data?.roots[0].readings).toEqual([{ date: '2026-02-01', value: 120 }]);
    });

    it('reach a KPI created this session', () => {
      const v = deriveTimelineView({
        ...none,
        skeleton,
        created: [{ id: '9', kpiId: 'KPI-9', issueKey: 'KPI-9', name: 'New', unit: '', direction: null, parentKpiId: null }],
        readingEdits: [{ kpiId: 'KPI-9', date: '2026-07-01', value: 5 }],
      });
      expect(v.data?.roots[1].readings).toEqual([{ date: '2026-07-01', value: 5 }]);
    });
  });
});
