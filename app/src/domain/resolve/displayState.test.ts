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
