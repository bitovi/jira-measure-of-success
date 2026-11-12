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
 * as an overflow fallback. When the data range is NARROWER than the viewport,
 * `minWidth` appends future quarters (same QUARTER_PX columns) so the plot fills
 * the available width instead of leaving empty space on the right.
 */
export interface Axis {
  quarters: Array<{ startMs: number; label: string }>;
  domainStart: number;
  domainEnd: number;
  plotWidth: number;
  /** pixel offset of an ISO date */
  xOf: (iso: string) => number;
  /** inverse of `xOf`: the date (UTC ms) at a pixel offset */
  msAt: (x: number) => number;
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
 *
 * `minWidth` (px, usually the visible plot width) fills the viewport: extra
 * quarters are appended on the right until the columns cover it, and
 * `plotWidth` becomes exactly `minWidth` so the plot never overflows (the last
 * column may be partially visible). Only the right edge grows, so positions and
 * `domainStart` are unaffected (extend-only rule).
 *
 * `viewStart` (UTC ms, see `initialViewQuarterStart`) is the quarter the view
 * opens on. When the data range overflows `minWidth`, enough quarters are
 * appended that the columns from `viewStart` onward still cover `minWidth`, so
 * scrolling it to the left edge isn't clamped short by the end of the strip.
 */
export function buildAxis(
  dates: string[],
  today: string,
  opts: { padQuarters?: number; minWidth?: number; viewStart?: number } = {},
): Axis {
  const pad = opts.padQuarters ?? 1;
  const minWidth = Math.max(0, opts.minWidth ?? 0);
  const todayMs = ms(today);
  const times = dates.map(ms).filter((t) => Number.isFinite(t));
  times.push(todayMs);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);

  const firstQ = addQuarters(quarterStartMs(minT), -pad);
  const lastQ = addQuarters(quarterStartMs(maxT), pad);
  const dataCount = Math.max(1, quarterIndex(lastQ) - quarterIndex(firstQ) + 1);
  const overflows = dataCount * QUARTER_PX > minWidth;
  const viewStartX =
    overflows && minWidth > 0 && opts.viewStart !== undefined
      ? Math.max(0, quarterIndex(opts.viewStart) - quarterIndex(firstQ)) * QUARTER_PX
      : 0;
  const fillWidth = viewStartX + minWidth;
  const count = Math.max(dataCount, Math.ceil(fillWidth / QUARTER_PX));

  const quarters = Array.from({ length: count }, (_, i) => {
    const startMs = addQuarters(firstQ, i);
    return { startMs, label: quarterLabel(startMs) };
  });

  const domainStart = firstQ;
  const domainEnd = addQuarters(firstQ, count);
  const plotWidth = Math.max(dataCount * QUARTER_PX, fillWidth);
  // Piecewise per quarter: every quarter column is exactly QUARTER_PX wide, so a
  // date's pixel offset depends only on its own quarter's position — adding
  // quarters on the right never moves anything, and adding N on the left moves
  // everything by exactly N * QUARTER_PX (the extend-only rule, spec 06 P4).
  const firstIdx = quarterIndex(firstQ);
  const xOf = (iso: string) => {
    const t = ms(iso);
    const qStart = quarterStartMs(t);
    const qEnd = addQuarters(qStart, 1);
    return (quarterIndex(qStart) - firstIdx + (t - qStart) / (qEnd - qStart)) * QUARTER_PX;
  };
  const msAt = (x: number) => {
    const idx = Math.floor(x / QUARTER_PX);
    const qStart = addQuarters(firstQ, idx);
    const qEnd = addQuarters(qStart, 1);
    return qStart + (x / QUARTER_PX - idx) * (qEnd - qStart);
  };

  return { quarters, domainStart, domainEnd, plotWidth, xOf, msAt, todayMs };
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

/**
 * The quarter that should sit at the left edge when the timeline first opens
 * (specs/06-timeline-performance, P4): the CURRENT quarter, so the view shows it
 * and the ones after it — except during its first month, when the PREVIOUS
 * quarter is used instead so the most recent history stays visible.
 */
export function initialViewQuarterStart(today: string): number {
  const todayMs = ms(today);
  const current = quarterStartMs(todayMs);
  const d = new Date(current);
  const oneMonthIn = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return todayMs < oneMonthIn ? addQuarters(current, -1) : current;
}

/** `scrollLeft` that puts `initialViewQuarterStart(today)` at the left edge of `axis`. */
export function initialScrollLeft(axis: Axis, today: string): number {
  const startIso = new Date(initialViewQuarterStart(today)).toISOString().slice(0, 10);
  return Math.max(0, axis.xOf(startIso));
}

/**
 * How far existing content moved right when the axis start changed from
 * `prevDomainStart` to `axis.domainStart` (quarters added on the left). Adding
 * this to `scrollLeft` keeps whatever is on screen exactly where it was.
 */
export function scrollShiftForAxisChange(axis: Axis, prevDomainStart: number): number {
  return axis.xOf(new Date(prevDomainStart).toISOString().slice(0, 10));
}
