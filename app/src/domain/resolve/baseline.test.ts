import { describe, it, expect } from 'vitest';
import { baselineAt } from './baseline.js';
import type { DatedValue } from './targetStatus.js';

function r(date: string, value: number): DatedValue {
  return { date, value };
}

describe('baselineAt — measured / interpolated / carried / none (FR-9…FR-11)', () => {
  it('zero readings → needsBaseline, no number (FR-9b)', () => {
    expect(baselineAt([], '2027-01-15')).toEqual({
      value: null,
      state: 'needsBaseline',
      from: null,
      kind: 'none',
    });
  });

  it('measured — a reading lands exactly on the due date', () => {
    const readings = [r('2026-12-01', 100), r('2027-01-15', 130), r('2027-03-01', 150)];
    expect(baselineAt(readings, '2027-01-15')).toEqual({
      value: 130,
      state: 'baselined',
      from: '2027-01-15',
      kind: 'measured',
    });
  });

  it('interpolated — due date bracketed by two readings (linear, not last-on-or-before)', () => {
    // 2027-01-01 = 100, 2027-03-02 = 160 (60 days apart); due 2027-01-31 = 30 days in.
    const readings = [r('2027-01-01', 100), r('2027-03-02', 160)];
    const b = baselineAt(readings, '2027-01-31');
    expect(b.state).toBe('baselined');
    expect(b.kind).toBe('interpolated');
    expect(b.from).toBe('2027-01-31');
    // 30/60 of the way from 100 → 160 = 130
    expect(b.value).toBeCloseTo(130, 6);
  });

  it('carried — due date in the future, no reading after it → provisional flat-carry (FR-9a)', () => {
    const readings = [r('2026-11-01', 1_326_000), r('2026-12-01', 1_330_000)];
    expect(baselineAt(readings, '2027-01-15')).toEqual({
      value: 1_330_000,
      state: 'provisional',
      from: '2026-12-01',
      kind: 'carried',
    });
  });

  it('carried — due date passed but no reading after it → provisional (needs measurement context)', () => {
    const readings = [r('2026-11-01', 100), r('2026-12-01', 110)];
    expect(baselineAt(readings, '2026-12-20')).toEqual({
      value: 110,
      state: 'provisional',
      from: '2026-12-01',
      kind: 'carried',
    });
  });

  it('pending due date (null) → carry the latest reading ("assume due today", FR-13/Q2)', () => {
    const readings = [r('2026-11-01', 100), r('2026-12-01', 110)];
    expect(baselineAt(readings, null)).toEqual({
      value: 110,
      state: 'provisional',
      from: '2026-12-01',
      kind: 'carried',
    });
  });

  it('single reading → flat-carried provisional', () => {
    expect(baselineAt([r('2026-11-01', 100)], '2027-01-15')).toEqual({
      value: 100,
      state: 'provisional',
      from: '2026-11-01',
      kind: 'carried',
    });
  });

  it('measured-only — reading order does not matter', () => {
    const readings = [r('2027-03-01', 150), r('2026-12-01', 100), r('2027-01-15', 130)];
    expect(baselineAt(readings, '2027-01-15').value).toBe(130);
  });
});
