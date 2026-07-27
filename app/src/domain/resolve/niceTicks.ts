/**
 * "Nice" axis ticks — the D3-style 1/2/5×10ⁿ step selection used to turn a raw
 * value domain into round, evenly-spaced gridline values. Pure + unit-testable;
 * the KPI View's vertical value axis (Feature 04) builds its tick gridlines +
 * labels on top of this. The Timeline's per-row band scale does NOT use ticks.
 */
export interface NiceTicks {
  /** rounded-outward lower bound (≤ input min) */
  min: number;
  /** rounded-outward upper bound (≥ input max) */
  max: number;
  /** evenly-spaced tick values from `min` to `max` inclusive */
  ticks: number[];
  /** the step between ticks (a 1/2/5×10ⁿ value) */
  step: number;
}

/**
 * Compute "nice" bounds + ~`count` evenly-spaced ticks spanning [min, max].
 * The step is the smallest 1/2/5×10ⁿ value that yields roughly `count`
 * intervals; the bounds are rounded outward to whole steps so the axis starts
 * and ends on a labelled gridline.
 */
export function niceTicks(min: number, max: number, count = 5): NiceTicks {
  const n = count > 0 ? count : 5;
  // Degenerate / inverted inputs — widen to a unit band so the axis still draws.
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 0.5;
    min -= pad;
    max += pad;
  }

  const rawStep = (max - min) / n;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let niceNormalized: number;
  if (normalized < 1.5) niceNormalized = 1;
  else if (normalized < 3) niceNormalized = 2;
  else if (normalized < 7) niceNormalized = 5;
  else niceNormalized = 10;
  const step = niceNormalized * magnitude;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const steps = Math.round((niceMax - niceMin) / step);
  const ticks: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    // Re-derive each tick from the index (not by accumulation) to avoid float drift.
    ticks.push(niceMin + i * step);
  }

  return { min: niceMin, max: niceMax, ticks, step };
}
