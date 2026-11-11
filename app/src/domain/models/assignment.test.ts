import { describe, expect, it } from 'vitest';
import { Assignment, AssignmentProperty, TargetType } from './assignment';

const base = {
  kpiId: 'kpi-1',
  inheritFromParent: false,
  target: 2,
  timing: { start: null, due: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 } },
  updatedBy: 'u',
  updatedAt: 0,
};

describe('TargetType', () => {
  it('accepts absolute, percent and relative', () => {
    expect(TargetType.parse('absolute')).toBe('absolute');
    expect(TargetType.parse('percent')).toBe('percent');
    expect(TargetType.parse('relative')).toBe('relative');
  });

  it('normalizes legacy "delta" to "percent"', () => {
    expect(TargetType.parse('delta')).toBe('percent');
  });

  it('rejects unknown kinds', () => {
    expect(TargetType.safeParse('amount').success).toBe(false);
    expect(TargetType.safeParse(undefined).success).toBe(false);
  });
});

describe('Assignment', () => {
  it('reads a legacy delta assignment as percent', () => {
    const parsed = AssignmentProperty.parse({ assignments: [{ ...base, targetType: 'delta' }] });
    expect(parsed.assignments[0]!.targetType).toBe('percent');
  });

  it('round-trips a relative (additive) assignment', () => {
    const a = Assignment.parse({ ...base, target: 100, targetType: 'relative' });
    expect(a).toMatchObject({ target: 100, targetType: 'relative' });
    expect(Assignment.parse(a)).toEqual(a);
  });
});
