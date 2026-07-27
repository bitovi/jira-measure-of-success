import { describe, expect, test } from 'vitest';
import { projectSeries } from './projectSeries';

const r = (date: string, value: number) => ({ date, value });

describe('projectSeries', () => {
  test('returns null with fewer than 2 readings', () => {
    expect(projectSeries([])).toBeNull();
    expect(projectSeries([r('2026-01-01', 100)])).toBeNull();
  });

  test('anchors the ray at the latest reading (continuity with the sparkline)', () => {
    const p = projectSeries([r('2026-01-01', 100), r('2026-02-01', 130)])!;
    expect(p.anchorDate).toBe('2026-02-01');
    expect(p.anchorValue).toBe(130);
    expect(p.at('2026-02-01')).toBeCloseTo(130, 6);
  });

  test('a rising series projects upward (positive slope, higher future value)', () => {
    const p = projectSeries([
      r('2026-01-01', 100),
      r('2026-02-01', 110),
      r('2026-03-01', 120),
    ])!;
    expect(p.slope).toBeGreaterThan(0);
    expect(p.at('2026-04-01')).toBeGreaterThan(120);
  });

  test('a flat series projects flat (~zero slope)', () => {
    const p = projectSeries([
      r('2026-01-01', 500),
      r('2026-02-01', 500),
      r('2026-03-01', 500),
    ])!;
    expect(p.slope).toBeCloseTo(0, 6);
    expect(p.at('2026-06-01')).toBeCloseTo(500, 3);
  });

  test('a falling series projects downward', () => {
    const p = projectSeries([r('2026-01-01', 200), r('2026-03-01', 140)])!;
    expect(p.slope).toBeLessThan(0);
    expect(p.at('2026-05-01')).toBeLessThan(140);
  });

  test('recency weighting: a recent uptick steepens the slope vs. a long half-life', () => {
    // Flat for three months, then a sharp recent rise.
    const series = [
      r('2026-01-01', 100),
      r('2026-02-01', 100),
      r('2026-03-01', 100),
      r('2026-03-31', 130),
    ];
    const recent = projectSeries(series, { halfLifeDays: 10 })!;
    const smooth = projectSeries(series, { halfLifeDays: 100000 })!; // ≈ unweighted OLS
    expect(recent.slope).toBeGreaterThan(smooth.slope);
  });
});
