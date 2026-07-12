import { describe, it, expect } from 'vitest';
import { targetStatus, valueAt } from './targetStatus.js';
import type { KpiReading } from '../models/index.js';

function reading(date: string, value: number): KpiReading {
  return { date, value, recordedBy: 'u', recordedAt: 0 };
}

const readings = [reading('2026-01-01', 100), reading('2026-04-01', 150), reading('2026-07-01', 200)];

describe('valueAt', () => {
  it('returns the last reading on or before the date', () => {
    expect(valueAt(readings, '2026-05-01')).toBe(150);
    expect(valueAt(readings, '2026-07-01')).toBe(200);
  });
  it('returns null before the first reading', () => {
    expect(valueAt(readings, '2025-12-01')).toBeNull();
  });
});

describe('targetStatus', () => {
  const asOf = '2026-06-30';

  it('future target → upcoming', () => {
    expect(targetStatus({ date: '2026-12-31', value: 300 }, readings, 'increase', asOf)).toBe('upcoming');
  });

  it('past increase target met → hit', () => {
    expect(targetStatus({ date: '2026-04-01', value: 140 }, readings, 'increase', asOf)).toBe('hit');
  });

  it('past increase target not met → missed', () => {
    expect(targetStatus({ date: '2026-04-01', value: 160 }, readings, 'increase', asOf)).toBe('missed');
  });

  it('past decrease target met → hit', () => {
    expect(targetStatus({ date: '2026-04-01', value: 160 }, readings, 'decrease', asOf)).toBe('hit');
  });

  it('past target with nothing recorded → upcoming', () => {
    expect(targetStatus({ date: '2026-02-01', value: 100 }, [], 'increase', asOf)).toBe('upcoming');
  });

  it('no direction defaults to increase comparison', () => {
    expect(targetStatus({ date: '2026-04-01', value: 140 }, readings, null, asOf)).toBe('hit');
  });
});
