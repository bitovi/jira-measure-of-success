import type { DatedValue } from './targetStatus';

/**
 * Forward projection of a KPI's recorded readings — the dashed "where is this
 * heading?" line on the KPI View and Timeline (Feature 04). Unlike a target
 * trajectory (a line drawn TO a target), this extrapolates the actual
 * measurement TREND forward.
 *
 * The trend is a **recency-weighted least-squares slope**: every reading
 * contributes to the slope, but its weight decays exponentially with age
 * (`w = 0.5 ^ (ageDays / halfLifeDays)`), so the most recently measured values
 * dominate. The ray is then anchored at the LATEST reading (so it visually
 * continues the recorded sparkline) and extended with that slope.
 *
 * Needs at least 2 readings — a single point has no trend. Returns `null`
 * otherwise so callers can simply skip drawing the line. Pure: no @forge/*,
 * no React.
 */
export interface Projection {
  /** trend in value units per day (recency-weighted) */
  slope: number;
  /** the latest reading's date — the ray origin */
  anchorDate: string;
  /** the latest reading's value — the ray origin (keeps it on the sparkline) */
  anchorValue: number;
  /** projected value at an arbitrary ISO date (past or future) */
  at(dateISO: string): number;
}

const DAY = 86_400_000;
const dayIndex = (iso: string): number => new Date(iso).getTime() / DAY;

export function projectSeries(
  readings: readonly DatedValue[],
  opts: { halfLifeDays?: number } = {},
): Projection | null {
  if (readings.length < 2) return null;

  const pts = [...readings].sort((a, b) => dayIndex(a.date) - dayIndex(b.date));
  const last = pts[pts.length - 1];
  const t0 = dayIndex(last.date);
  const halfLife = opts.halfLifeDays && opts.halfLifeDays > 0 ? opts.halfLifeDays : 30;

  // Weighted least-squares slope with x measured in days relative to the latest
  // reading (so x ≤ 0) and weights decaying by age.
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  for (const p of pts) {
    const x = dayIndex(p.date) - t0; // ≤ 0
    const w = Math.pow(0.5, -x / halfLife); // newest reading ⇒ weight 1
    sw += w;
    swx += w * x;
    swy += w * p.value;
    swxx += w * x * x;
    swxy += w * x * p.value;
  }
  const denom = sw * swxx - swx * swx;
  const slope = denom === 0 ? 0 : (sw * swxy - swx * swy) / denom;

  return {
    slope,
    anchorDate: last.date,
    anchorValue: last.value,
    at: (dateISO: string) => last.value + slope * (dayIndex(dateISO) - t0),
  };
}
