import { quarterStartMs } from '@domain/index.js';
import { ms } from './scale.js';

/**
 * The horizontal (date) axis shared by the KPI Timeline and the KPI View
 * (Feature 04). Both surfaces plot readings/targets against the SAME
 * quarter-based axis, so the axis math lives here and is built once by
 * `buildAxis`.
 *
 * Feature 04 decision: the axis FITS THE DATA RANGE (was a fixed 9-quarter
 * window centered on today). The domain is the min/max of the plotted dates
 * (always including `today` so the today line stays on-canvas), snapped outward
 * to whole quarters with a pad quarter on each side. When the range fits the
 * viewport there's no horizontal scroll; a genuinely wide range still scrolls
 * as an overflow fallback.
 */
export interface Axis {
  quarters: Array<{ startMs: number; label: string }>;
  domainStart: number;
  domainEnd: number;
  plotWidth: number;
  xOf: (iso: string) => number;
  todayMs: number;
}

/** Pixels per quarter column. */
export const QUARTER_PX = 220;
/** Right-edge padding so the last marker/dot isn't clipped. */
export const PAD_R = 16;

/** Advance a quarter-start (UTC ms) by `n` quarters (may be negative). */
export function addQuarters(quarterStart: number, n: number): number {
  const d = new Date(quarterStart);
  const totalQ = d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3) + n;
  const year = Math.floor(totalQ / 4);
  const q = ((totalQ % 4) + 4) % 4;
  return Date.UTC(year, q * 3, 1);
}

/** "Q3 2026" label for a quarter-start (UTC ms). */
export function quarterLabel(quarterStart: number): string {
  const d = new Date(quarterStart);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/** Absolute quarter index (year·4 + quarter) for counting quarters between dates. */
function quarterIndex(msVal: number): number {
  const d = new Date(msVal);
  return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
}

/**
 * Build the fit-to-data-range axis. `dates` are the plotted ISO dates (readings
 * ∪ dated targets, from one KPI or the union across a tree); `today` is always
 * folded in. With no dates the axis falls back to a previous→next quarter window
 * around today (matching the old centered behavior for the empty case).
 */
export function buildAxis(
  dates: string[],
  today: string,
  opts: { padQuarters?: number } = {},
): Axis {
  const pad = opts.padQuarters ?? 1;
  const todayMs = ms(today);
  const times = dates.map(ms).filter((t) => Number.isFinite(t));
  times.push(todayMs);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);

  const firstQ = addQuarters(quarterStartMs(minT), -pad);
  const lastQ = addQuarters(quarterStartMs(maxT), pad);
  const count = Math.max(1, quarterIndex(lastQ) - quarterIndex(firstQ) + 1);

  const quarters = Array.from({ length: count }, (_, i) => {
    const startMs = addQuarters(firstQ, i);
    return { startMs, label: quarterLabel(startMs) };
  });

  const domainStart = firstQ;
  const domainEnd = addQuarters(firstQ, count);
  const plotWidth = count * QUARTER_PX;
  const xOf = (iso: string) => ((ms(iso) - domainStart) / (domainEnd - domainStart)) * plotWidth;

  return { quarters, domainStart, domainEnd, plotWidth, xOf, todayMs };
}

/** The ISO dates a node contributes to the shared axis (readings + dated targets). */
export function axisDatesOf(node: {
  readings: Array<{ date: string }>;
  targets: Array<{ date: string | null }>;
}): string[] {
  const dates = node.readings.map((r) => r.date);
  for (const t of node.targets) if (t.date) dates.push(t.date);
  return dates;
}
