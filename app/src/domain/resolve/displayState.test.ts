import { describe, it, expect } from 'vitest';
import { displayState, type DisplayStateInput } from './displayState.js';
import type { DatedValue } from './targetStatus.js';

function r(date: string, value: number): DatedValue {
  return { date, value };
}

const base: DisplayStateInput = {
  valueState: 'baselined',
  today: '2027-02-01',
  dueDate: '2027-01-15',
  targetDate: '2027-04-15',
  readings: [],
  direction: 'increase',
  target: 1_010_000,
};

describe('displayState — the 8 FR-26 states (§7-#9)', () => {
  it('1 projected — due date in the future', () => {
    expect(
      displayState({ ...base, valueState: 'provisional', today: '2026-12-01', target: 1_010_000 }),
    ).toEqual({ state: 'projected', warning: null });
  });

  it('2 provisional — no due date (pending)', () => {
    expect(
      displayState({ ...base, valueState: 'provisional', dueDate: null, targetDate: null }),
    ).toEqual({ state: 'provisional', warning: null });
  });

  it('3 baselined — due date reached, reading covers it, target upcoming', () => {
    expect(
      displayState({ ...base, valueState: 'baselined', today: '2027-02-01' }),
    ).toEqual({ state: 'baselined', warning: null });
  });

  it('4 needsMeasurement — due date passed, no reading after it (stale)', () => {
    expect(
      displayState({ ...base, valueState: 'provisional', today: '2027-02-01' }),
    ).toEqual({ state: 'needsMeasurement', warning: 'staleBaseline' });
  });

  it('5 met — target date passed, actual meets target (increase)', () => {
    const readings = [r('2027-01-15', 1_000_000), r('2027-04-10', 1_020_000)];
    expect(
      displayState({ ...base, today: '2027-05-01', readings, target: 1_010_000 }),
    ).toEqual({ state: 'met', warning: null });
  });

  it('6 missed — target date passed, actual misses target (increase)', () => {
    const readings = [r('2027-01-15', 1_000_000), r('2027-04-10', 1_005_000)];
    expect(
      displayState({ ...base, today: '2027-05-01', readings, target: 1_010_000 }),
    ).toEqual({ state: 'missed', warning: null });
  });

  it('5 met — decrease KPI meets a lower target', () => {
    const readings = [r('2027-01-15', 200), r('2027-04-10', 170)];
    expect(
      displayState({
        ...base,
        direction: 'decrease',
        today: '2027-05-01',
        readings,
        target: 180,
      }),
    ).toEqual({ state: 'met', warning: null });
  });

  it('7 resultUnknown — target date passed, no reading since the baseline', () => {
    const readings = [r('2027-01-15', 1_000_000)]; // nothing after the due date
    expect(
      displayState({ ...base, today: '2027-05-01', readings, target: 1_010_000 }),
    ).toEqual({ state: 'resultUnknown', warning: 'unconfirmedResult' });
  });

  it('8 needsBaseline — zero readings', () => {
    expect(
      displayState({ ...base, valueState: 'needsBaseline', target: null }),
    ).toEqual({ state: 'needsBaseline', warning: 'needsBaseline' });
  });
});

describe('displayState — target dated before its due date (negative offset)', () => {
  const early: DisplayStateInput = {
    ...base,
    today: '2027-12-15',
    dueDate: '2027-12-31',
    targetDate: '2027-11-30',
    target: 100,
  };

  it('judges an absolute target once its date passes, even with the due date ahead', () => {
    const readings = [r('2027-10-01', 90), r('2027-11-30', 105)];
    expect(displayState({ ...early, readings })).toEqual({ state: 'met', warning: null });
    expect(displayState({ ...early, readings, target: 110 })).toEqual({ state: 'missed', warning: null });
  });

  it('is resultUnknown when no reading lands on/after the passed target date', () => {
    const readings = [r('2027-10-01', 90)];
    expect(displayState({ ...early, readings })).toEqual({ state: 'resultUnknown', warning: 'unconfirmedResult' });
  });

  it('stays projected for a percent target whose baseline (due date) is still ahead', () => {
    const readings = [r('2027-10-01', 90), r('2027-11-30', 105)];
    expect(displayState({ ...early, valueState: 'provisional', readings })).toEqual({
      state: 'projected',
      warning: null,
    });
  });

  it('stays projected before the target date', () => {
    expect(displayState({ ...early, today: '2027-11-01' })).toEqual({ state: 'projected', warning: null });
  });
});

describe('displayState — fixed-value target (judged on or after its target date)', () => {
  // An absolute target's due date is its target date (no baseline).
  const fixed: DisplayStateInput = {
    ...base,
    valueState: 'baselined',
    today: '2026-07-14',
    dueDate: '2026-06-30',
    targetDate: '2026-06-30',
    target: 100,
    fixedValue: true,
  };

  it('a reading on the target date judges it', () => {
    expect(displayState({ ...fixed, readings: [r('2026-06-30', 120)] })).toEqual({ state: 'met', warning: null });
    expect(displayState({ ...fixed, readings: [r('2026-06-30', 80)] })).toEqual({ state: 'missed', warning: null });
  });

  it('a reading only before the target date leaves it unknown', () => {
    expect(displayState({ ...fixed, readings: [r('2026-06-01', 120)] })).toEqual({
      state: 'resultUnknown',
      warning: 'unconfirmedResult',
    });
  });

  it('otherwise the first reading after the date judges it', () => {
    const readings = [r('2026-06-01', 120), r('2026-07-05', 90), r('2026-07-10', 130)];
    expect(displayState({ ...fixed, readings })).toEqual({ state: 'missed', warning: null });
  });
});
