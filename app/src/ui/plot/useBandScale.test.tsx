import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TimelineNodeDto } from '@domain/index.js';
import { SCALE_GLIDE_MS, lerpDomain, useBandScale } from './useBandScale.js';

const node = (over: Partial<TimelineNodeDto> = {}): TimelineNodeDto => ({
  id: 'n1',
  kpiId: 'KPI-1',
  issueKey: 'KPI-1',
  name: 'Revenue',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
  readings: [
    { date: '2026-01-01', value: 100 },
    { date: '2026-06-01', value: 200 },
  ],
  children: [],
  ...over,
});

const withTarget = (over: Partial<TimelineNodeDto> = {}) =>
  node({
    targets: [
      { date: '2026-12-31', value: 1000, status: 'upcoming', provisional: false, relative: false, source: { issue: 'A-1', type: 'Epic', title: 't' } },
    ],
    ...over,
  });

describe('lerpDomain', () => {
  it('starts at the old range, ends at the new one', () => {
    const from = { min: 100, max: 200 };
    const to = { min: 100, max: 1000 };
    expect(lerpDomain(from, to, 0)).toEqual(from);
    expect(lerpDomain(from, to, 1)).toEqual(to);
    const mid = lerpDomain(from, to, 0.5);
    expect(mid.max).toBeGreaterThan(200);
    expect(mid.max).toBeLessThan(1000);
  });
});

describe('useBandScale', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it('glides to the wider range when a resolving row gets its targets, then settles', () => {
    const { result, rerender } = renderHook(({ n }) => useBandScale(n, 60), {
      initialProps: { n: node({ resolving: true }) },
    });
    const yBefore = result.current.yOf(200); // top of a readings-only scale
    expect(result.current.settled).toBe(true);

    rerender({ n: withTarget() });
    // the render where targets land: not settled, scale not yet jumped
    expect(result.current.settled).toBe(false);
    expect(result.current.yOf(200)).toBeCloseTo(yBefore, 5);

    advance(SCALE_GLIDE_MS / 2);
    const yMid = result.current.yOf(200);
    expect(result.current.settled).toBe(false);
    expect(yMid).toBeGreaterThan(yBefore); // reading sinks as the range widens

    advance(SCALE_GLIDE_MS);
    expect(result.current.settled).toBe(true);
    const yAfter = result.current.yOf(200);
    expect(yAfter).toBeGreaterThan(yMid);
  });

  it('snaps (no glide) for changes that are not a row finishing loading', () => {
    const { result, rerender } = renderHook(({ n }) => useBandScale(n, 60), {
      initialProps: { n: node() },
    });
    rerender({ n: withTarget() });
    expect(result.current.settled).toBe(true);
    const y = result.current.yOf(200);
    advance(SCALE_GLIDE_MS);
    expect(result.current.yOf(200)).toBe(y);
  });

  it('a row that already has its targets is settled from the first render', () => {
    const { result } = renderHook(() => useBandScale(withTarget(), 60));
    expect(result.current.settled).toBe(true);
  });
});
