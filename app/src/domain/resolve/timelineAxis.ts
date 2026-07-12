/**
 * Timeline date-axis math — Timeline TL-1 (requirements §4.2, Q5). The default
 * window is the PREVIOUS + CURRENT + NEXT quarter centered on today; scrolling
 * pans by whole quarters (`offsetQuarters`). Pure: maps dates to a 0..1 fraction
 * of the visible window so the UI can position gridlines, dots and diamonds.
 */
export interface TimelineWindow {
  startMs: number;
  endMs: number;
  /** the three visible quarters, left → right */
  quarters: Array<{ label: string; startMs: number }>;
}

function utc(year: number, month0: number, day = 1): number {
  return Date.UTC(year, month0, day);
}

/** First day (UTC ms) of the quarter containing `ms`. */
export function quarterStartMs(ms: number): number {
  const d = new Date(ms);
  const q = Math.floor(d.getUTCMonth() / 3);
  return utc(d.getUTCFullYear(), q * 3, 1);
}

/** Advance a quarter-start by `n` quarters (may be negative). */
function addQuarters(quarterStart: number, n: number): number {
  const d = new Date(quarterStart);
  const totalQ = d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3) + n;
  const year = Math.floor(totalQ / 4);
  const q = ((totalQ % 4) + 4) % 4;
  return utc(year, q * 3, 1);
}

function quarterLabel(quarterStart: number): string {
  const d = new Date(quarterStart);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/**
 * Build the visible window: three quarters starting one quarter before the one
 * containing `todayMs`, shifted by `offsetQuarters`.
 */
export function timelineWindow(todayMs: number, offsetQuarters = 0): TimelineWindow {
  const current = quarterStartMs(todayMs);
  const first = addQuarters(current, -1 + offsetQuarters);
  const quarters = [0, 1, 2].map((i) => {
    const startMs = addQuarters(first, i);
    return { label: quarterLabel(startMs), startMs };
  });
  const endMs = addQuarters(first, 3);
  return { startMs: first, endMs, quarters };
}

/** Fraction (0..1) of the window at which `ms` falls; may fall outside [0,1]. */
export function fracOf(window: TimelineWindow, ms: number): number {
  return (ms - window.startMs) / (window.endMs - window.startMs);
}

/** Whether a date is within the visible window. */
export function isVisible(window: TimelineWindow, ms: number): boolean {
  return ms >= window.startMs && ms <= window.endMs;
}
