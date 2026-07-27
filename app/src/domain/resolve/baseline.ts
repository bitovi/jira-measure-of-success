import type { IsoDate } from '../models/index';
import type { DatedValue } from './targetStatus';

/**
 * Baseline resolution — Feature 03 (relative values), requirements §5.3 / FR-9…FR-11.
 *
 * The baseline is the KPI's value AT the due date. It has exactly two official
 * outcomes and one "no data" outcome, driven only by MEASURED readings (other
 * work items' future targets are ignored):
 *
 *  - **measured**      a reading lands exactly on the due date          → baselined
 *  - **interpolated**  the due date is bracketed by two readings        → baselined
 *  - **carried**       no reading covers it → last reading flat-carried → provisional
 *  - **none**          zero readings → no number                        → needsBaseline
 *
 * There is NO trend/slope extrapolation (that is a future "Rate of change" type):
 * the carried value is the latest reading held flat. When the due date is `null`
 * (pending rollup), the baseline is the "assume due today" carry from the latest
 * reading (FR-13 / Q2). Pure: no @forge/*, no React.
 */

export type BaselineState = 'baselined' | 'provisional' | 'needsBaseline';
export type BaselineKind = 'measured' | 'interpolated' | 'carried' | 'none';

export interface Baseline {
  /** null only when `state === 'needsBaseline'` */
  value: number | null;
  state: BaselineState;
  /** the reading (or baseline) date the value came from; null when no readings */
  from: IsoDate | null;
  kind: BaselineKind;
}

const ms = (iso: IsoDate): number => new Date(iso).getTime();

/** The latest reading in the series (max effective date), or null if empty. */
function latest(readings: readonly DatedValue[]): DatedValue | null {
  let best: DatedValue | null = null;
  for (const r of readings) {
    if (best === null || ms(r.date) > ms(best.date)) best = r;
  }
  return best;
}

/**
 * Resolve the baseline value at `dueDate` from a reading series.
 *
 * @param readings measured readings (any order); only these are consulted
 * @param dueDate  the due date to baseline at, or `null` when pending (assume today)
 */
export function baselineAt(
  readings: readonly DatedValue[],
  dueDate: IsoDate | null,
): Baseline {
  if (readings.length === 0) {
    return { value: null, state: 'needsBaseline', from: null, kind: 'none' };
  }

  // Pending due date → "assume due today": carry the latest reading (FR-13/Q2).
  if (dueDate === null) {
    const last = latest(readings)!;
    return { value: last.value, state: 'provisional', from: last.date, kind: 'carried' };
  }

  const due = ms(dueDate);

  // measured — a reading lands exactly on the due date.
  const onDate = readings.find((r) => ms(r.date) === due);
  if (onDate) {
    return { value: onDate.value, state: 'baselined', from: onDate.date, kind: 'measured' };
  }

  // interpolated — the due date is bracketed by a reading before and one after.
  let before: DatedValue | null = null;
  let after: DatedValue | null = null;
  for (const r of readings) {
    const t = ms(r.date);
    if (t < due && (before === null || t > ms(before.date))) before = r;
    if (t > due && (after === null || t < ms(after.date))) after = r;
  }
  if (before && after) {
    const span = ms(after.date) - ms(before.date);
    const frac = span === 0 ? 0 : (due - ms(before.date)) / span;
    const value = before.value + (after.value - before.value) * frac;
    return { value, state: 'baselined', from: dueDate, kind: 'interpolated' };
  }

  // carried — no reading covers the due date; flat-carry the latest reading.
  const last = latest(readings)!;
  return { value: last.value, state: 'provisional', from: last.date, kind: 'carried' };
}
