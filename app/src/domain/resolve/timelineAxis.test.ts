import { describe, it, expect } from 'vitest';
import { timelineWindow, quarterStartMs, fracOf, isVisible } from './timelineAxis.js';

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('timelineAxis', () => {
  it('quarterStartMs snaps to the quarter start', () => {
    expect(iso(quarterStartMs(Date.UTC(2026, 6, 10)))).toBe('2026-07-01'); // Jul → Q3
    expect(iso(quarterStartMs(Date.UTC(2026, 1, 15)))).toBe('2026-01-01'); // Feb → Q1
  });

  it('default window = previous + current + next quarter around today', () => {
    const w = timelineWindow(Date.UTC(2026, 6, 10)); // today in Q3 2026
    expect(w.quarters.map((q) => q.label)).toEqual(['Q2 2026', 'Q3 2026', 'Q4 2026']);
    expect(iso(w.startMs)).toBe('2026-04-01');
    expect(iso(w.endMs)).toBe('2027-01-01');
  });

  it('offset pans by whole quarters, crossing year boundaries', () => {
    const w = timelineWindow(Date.UTC(2026, 6, 10), 2); // shift forward two quarters
    expect(w.quarters.map((q) => q.label)).toEqual(['Q4 2026', 'Q1 2027', 'Q2 2027']);
  });

  it('offset backward across the year boundary', () => {
    const w = timelineWindow(Date.UTC(2026, 0, 10), -1); // today Q1 2026; default is Q4'25–Q2'26, back one
    expect(w.quarters.map((q) => q.label)).toEqual(['Q3 2025', 'Q4 2025', 'Q1 2026']);
  });

  it('fracOf maps window start → 0, end → 1, today near center', () => {
    const w = timelineWindow(Date.UTC(2026, 6, 10));
    expect(fracOf(w, w.startMs)).toBe(0);
    expect(fracOf(w, w.endMs)).toBe(1);
    const tf = fracOf(w, Date.UTC(2026, 6, 10));
    expect(tf).toBeGreaterThan(0.33);
    expect(tf).toBeLessThan(0.66);
  });

  it('isVisible flags dates outside the window', () => {
    const w = timelineWindow(Date.UTC(2026, 6, 10));
    expect(isVisible(w, Date.UTC(2026, 5, 1))).toBe(true);
    expect(isVisible(w, Date.UTC(2025, 0, 1))).toBe(false);
  });
});
