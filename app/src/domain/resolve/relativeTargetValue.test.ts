import { describe, it, expect } from 'vitest';
import { applyTargetChange, isBaselineRelative, resolveRelativeTargetValue } from './relativeTargetValue.js';
import type { DatedValue } from './targetStatus.js';

function r(date: string, value: number): DatedValue {
  return { date, value };
}

describe('resolveRelativeTargetValue (FR-9…FR-11)', () => {
  it('absolute → passthrough, always baselined', () => {
    expect(
      resolveRelativeTargetValue({ targetType: 'absolute', target: 1_500_000 }, {
        dueDate: '2027-01-15',
        readings: [],
      }),
    ).toEqual({
      value: 1_500_000,
      baseline: null,
      baselineDate: null,
      baselineFrom: null,
      state: 'baselined',
      provisional: false,
    });
  });

  it('percent against a baselined (measured) value → baseline × (1 + percent) (§7-#1)', () => {
    const readings = [r('2027-01-15', 1_000_000)];
    const res = resolveRelativeTargetValue({ targetType: 'percent', target: 1 }, {
      dueDate: '2027-01-15',
      readings,
    });
    expect(res.state).toBe('baselined');
    expect(res.provisional).toBe(false);
    expect(res.baseline).toBe(1_000_000);
    expect(res.value).toBeCloseTo(1_010_000, 6);
  });

  it('percent against a provisional (carried) baseline → marked provisional (§7-#2)', () => {
    const readings = [r('2026-12-01', 1_326_000)];
    const res = resolveRelativeTargetValue({ targetType: 'percent', target: 1 }, {
      dueDate: '2027-01-15',
      readings,
    });
    expect(res.state).toBe('provisional');
    expect(res.provisional).toBe(true);
    expect(res.baseline).toBe(1_326_000);
    expect(res.baselineFrom).toBe('2026-12-01');
    expect(res.value).toBeCloseTo(1_339_260, 6);
  });

  it('percent with negative percent (a "decrease" KPI legitimately targets a drop, FR-6)', () => {
    const res = resolveRelativeTargetValue({ targetType: 'percent', target: -10 }, {
      dueDate: '2027-01-15',
      readings: [r('2027-01-15', 200)],
    });
    expect(res.value).toBeCloseTo(180, 6);
  });

  it('percent with zero readings → needsBaseline, no fabricated number (§7-#8, FR-9b)', () => {
    const res = resolveRelativeTargetValue({ targetType: 'percent', target: 1 }, {
      dueDate: '2027-01-15',
      readings: [],
    });
    expect(res).toEqual({
      value: null,
      baseline: null,
      baselineDate: '2027-01-15',
      baselineFrom: null,
      state: 'needsBaseline',
      provisional: true,
    });
  });

  it('percent with pending due date → provisional carry from latest reading (§7-#6)', () => {
    const res = resolveRelativeTargetValue({ targetType: 'percent', target: 1 }, {
      dueDate: null,
      readings: [r('2026-12-01', 1_000_000)],
    });
    expect(res.state).toBe('provisional');
    expect(res.baselineDate).toBeNull();
    expect(res.value).toBeCloseTo(1_010_000, 6);
  });

  it('relative against a baselined value → baseline + amount (additive)', () => {
    const res = resolveRelativeTargetValue({ targetType: 'relative', target: 100 }, {
      dueDate: '2027-01-15',
      readings: [r('2027-01-15', 1_200)],
    });
    expect(res.state).toBe('baselined');
    expect(res.provisional).toBe(false);
    expect(res.baseline).toBe(1_200);
    expect(res.value).toBe(1_300);
  });

  it('relative against a provisional (carried) baseline → marked provisional', () => {
    const res = resolveRelativeTargetValue({ targetType: 'relative', target: 100 }, {
      dueDate: '2027-01-15',
      readings: [r('2026-12-01', 1_200)],
    });
    expect(res.state).toBe('provisional');
    expect(res.provisional).toBe(true);
    expect(res.baselineFrom).toBe('2026-12-01');
    expect(res.value).toBe(1_300);
  });

  it('relative with a negative amount targets a drop', () => {
    const res = resolveRelativeTargetValue({ targetType: 'relative', target: -30 }, {
      dueDate: '2027-01-15',
      readings: [r('2027-01-15', 200)],
    });
    expect(res.value).toBe(170);
  });

  it('relative with zero readings → needsBaseline', () => {
    const res = resolveRelativeTargetValue({ targetType: 'relative', target: 100 }, {
      dueDate: '2027-01-15',
      readings: [],
    });
    expect(res.state).toBe('needsBaseline');
    expect(res.value).toBeNull();
  });
});

describe('applyTargetChange / isBaselineRelative', () => {
  it('percent multiplies, relative adds, absolute is the value itself', () => {
    expect(applyTargetChange(200, 'percent', 10)).toBeCloseTo(220, 6);
    expect(applyTargetChange(200, 'relative', 10)).toBe(210);
    expect(applyTargetChange(200, 'absolute', 10)).toBe(10);
  });

  it('only percent and relative are measured against a baseline', () => {
    expect(isBaselineRelative('percent')).toBe(true);
    expect(isBaselineRelative('relative')).toBe(true);
    expect(isBaselineRelative('absolute')).toBe(false);
    expect(isBaselineRelative(null)).toBe(false);
  });
});
