import type { IsoDate, KpiDirection } from '../models/index';
import type { DatedValue } from './targetStatus';
import { valueAt } from './targetStatus';
import type { BaselineState } from './baseline';

/**
 * Combined display-state classification — Feature 03, requirements §5.9 / FR-26.
 *
 * The single source of truth for the eight status-pill states and the two
 * warnings. A pure function of `{ baseline state, today vs due date, today vs
 * target date, readings }`. The UI only formats what this returns (pill copy,
 * `≈`/`~`, warning strip). No @forge/*, no React.
 *
 * The eight states (FR-26):
 *  1 projected        due date in the future
 *  2 provisional      no due date (pending rollup)
 *  3 baselined        due date reached, a reading covers it
 *  4 needsMeasurement due date passed, no reading after it (stale baseline)
 *  5 met              target date passed, actual meets target
 *  6 missed           target date passed, actual misses target
 *  7 resultUnknown    target date passed, no reading since the baseline
 *  8 needsBaseline    zero readings
 */
export type DisplayState =
  | 'projected'
  | 'provisional'
  | 'baselined'
  | 'needsMeasurement'
  | 'met'
  | 'missed'
  | 'resultUnknown'
  | 'needsBaseline';

export type TargetWarning =
  | 'staleBaseline' // FR-26a: due date passed with no measurement
  | 'unconfirmedResult' // FR-26a: target date passed with no reading since baseline
  | 'needsBaseline' // FR-9b: a percent/relative target needs at least one reading
  | null;

export interface DisplayStateInput {
  valueState: BaselineState;
  today: IsoDate;
  /** effective due date, or null when pending */
  dueDate: IsoDate | null;
  /** resolved target date (due date + offset), or null when pending */
  targetDate: IsoDate | null;
  readings: readonly DatedValue[];
  direction: KpiDirection | null;
  /** the resolved target value, for met/missed comparison; null when no baseline */
  target: number | null;
}

const ms = (iso: IsoDate): number => new Date(iso).getTime();

export function displayState(input: DisplayStateInput): {
  state: DisplayState;
  warning: TargetWarning;
} {
  const { valueState, today, dueDate, targetDate, readings, direction, target } = input;

  // 8 — zero readings: no baseline, never a fabricated number.
  if (valueState === 'needsBaseline') {
    return { state: 'needsBaseline', warning: 'needsBaseline' };
  }

  // 2 — no due date at all (pending rollup).
  if (dueDate === null) {
    return { state: 'provisional', warning: null };
  }

  const todayT = ms(today);
  const dueT = ms(dueDate);

  // 1 — due date is still in the future.
  if (todayT < dueT) {
    return { state: 'projected', warning: null };
  }

  // Due date has been reached or passed.
  const targetPassed = targetDate !== null && todayT >= ms(targetDate);

  if (targetPassed) {
    // 5/6/7 — the target date is in the past; try to judge the result.
    const hasConfirming = readings.some((r) => ms(r.date) > dueT);
    const actual = valueAt(readings, targetDate!);
    if (!hasConfirming || actual === null || target === null) {
      return { state: 'resultUnknown', warning: 'unconfirmedResult' };
    }
    const met = direction === 'decrease' ? actual <= target : actual >= target;
    return { state: met ? 'met' : 'missed', warning: null };
  }

  // Due date reached/passed, target date still upcoming.
  if (valueState === 'baselined') {
    // 3 — a reading covers the due date.
    return { state: 'baselined', warning: null };
  }
  // 4 — no reading covers the due date; the carried baseline may be stale.
  return { state: 'needsMeasurement', warning: 'staleBaseline' };
}
