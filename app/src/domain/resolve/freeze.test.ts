import { describe, it, expect } from 'vitest';
import { freezeIfDone } from './freeze.js';
import type { Assignment } from '../models/index.js';
import type { DatedValue } from './targetStatus.js';

function r(date: string, value: number): DatedValue {
  return { date, value };
}

const relativeDelta: Pick<Assignment, 'targetType' | 'target' | 'timing'> = {
  targetType: 'percent',
  target: 1, // +1%
  timing: {
    start: null,
    due: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
  },
};

describe('freezeIfDone (FR-16…FR-18, §7-#11)', () => {
  it('closed + past due → frozen {date, value} from actuals', () => {
    const readings = [r('2026-10-15', 1_000_000)]; // baseline at due date (carried)
    const frozen = freezeIfDone(relativeDelta, {
      closed: true,
      dueDate: '2026-10-15',
      today: '2027-02-01',
      readings,
    });
    expect(frozen).not.toBeNull();
    // due 2026-10-15 + 3 months = 2027-01-15
    expect(frozen!.date).toBe('2027-01-15');
    expect(frozen!.value).toBeCloseTo(1_010_000, 6);
  });

  it('relative (additive) target → frozen value is baseline + amount', () => {
    const frozen = freezeIfDone({ ...relativeDelta, targetType: 'relative', target: 250 }, {
      closed: true,
      dueDate: '2026-10-15',
      today: '2027-02-01',
      readings: [r('2026-10-15', 1_000)],
    });
    expect(frozen).toEqual({ date: '2027-01-15', value: 1_250 });
  });

  it('not closed → null (stays relative)', () => {
    expect(
      freezeIfDone(relativeDelta, {
        closed: false,
        dueDate: '2026-10-15',
        today: '2027-02-01',
        readings: [r('2026-10-15', 1_000_000)],
      }),
    ).toBeNull();
  });

  it('due date still in the future → null', () => {
    expect(
      freezeIfDone(relativeDelta, {
        closed: true,
        dueDate: '2027-06-15',
        today: '2027-02-01',
        readings: [r('2026-10-15', 1_000_000)],
      }),
    ).toBeNull();
  });

  it('pending due date → null', () => {
    expect(
      freezeIfDone(relativeDelta, {
        closed: true,
        dueDate: null,
        today: '2027-02-01',
        readings: [r('2026-10-15', 1_000_000)],
      }),
    ).toBeNull();
  });

  it('no readings → null (nothing to snapshot)', () => {
    expect(
      freezeIfDone(relativeDelta, {
        closed: true,
        dueDate: '2026-10-15',
        today: '2027-02-01',
        readings: [],
      }),
    ).toBeNull();
  });

  it('absolute target → snapshot uses the fixed date + passthrough value', () => {
    const abs: Pick<Assignment, 'targetType' | 'target' | 'timing'> = {
      targetType: 'absolute',
      target: 1_500_000,
      timing: {
        start: null,
        due: { mode: 'absolute', absolute: '2026-11-30', anchor: 'issueDueDate', offsetMonths: 0 },
      },
    };
    const frozen = freezeIfDone(abs, {
      closed: true,
      dueDate: '2026-11-30',
      today: '2027-02-01',
      readings: [r('2026-11-30', 1_400_000)],
    });
    expect(frozen).toEqual({ date: '2026-11-30', value: 1_500_000 });
  });
});
