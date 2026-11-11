import { describe, expect, test } from 'vitest';
import { niceTicks } from './niceTicks';

describe('niceTicks', () => {
  test('rounds a revenue-scale domain to whole 100K steps', () => {
    const { min, max, ticks, step } = niceTicks(1_000_000, 1_500_000, 5);
    expect(step).toBe(100_000);
    expect(min).toBe(1_000_000);
    expect(max).toBe(1_500_000);
    expect(ticks).toEqual([
      1_000_000, 1_100_000, 1_200_000, 1_300_000, 1_400_000, 1_500_000,
    ]);
  });

  test('produces bounds that bracket the input', () => {
    const { min, max } = niceTicks(37, 512, 5);
    expect(min).toBeLessThanOrEqual(37);
    expect(max).toBeGreaterThanOrEqual(512);
  });

  test('ticks are evenly spaced by step and inclusive of both bounds', () => {
    const { min, max, ticks, step } = niceTicks(0, 97, 5);
    expect(ticks[0]).toBe(min);
    expect(ticks[ticks.length - 1]).toBe(max);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 6);
    }
  });

  test('picks a 1/2/5×10ⁿ step for small domains', () => {
    expect(niceTicks(0, 10, 5).step).toBe(2);
    expect(niceTicks(0, 1, 5).step).toBe(0.2);
    expect(niceTicks(0, 3, 5).step).toBe(0.5);
  });

  test('handles a flat domain (min === max) by widening to a band', () => {
    const { min, max, ticks } = niceTicks(100, 100, 5);
    expect(min).toBeLessThan(100);
    expect(max).toBeGreaterThan(100);
    expect(ticks.length).toBeGreaterThan(1);
  });

  test('handles an inverted domain by swapping bounds', () => {
    const asc = niceTicks(0, 100, 5);
    const desc = niceTicks(100, 0, 5);
    expect(desc).toEqual(asc);
  });

  test('falls back to a unit band for non-finite inputs', () => {
    const { min, max, ticks } = niceTicks(NaN, NaN, 5);
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(ticks.length).toBeGreaterThan(1);
  });
});
