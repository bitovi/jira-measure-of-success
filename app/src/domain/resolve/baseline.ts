import type { IsoDate, TargetType } from '../models/index';
import type { DatedValue } from './targetStatus';

/**
 * Baseline resolution — Feature 03 (relative values), requirements §5.3 / FR-9…FR-11.
 *
 * The baseline is the KPI's value AT the due date. It has exactly two official
 * outcomes and one "no data" outcome, driven by MEASURED readings:
 *
 *  - **measured**      a reading lands exactly on the due date          → baselined
 *  - **interpolated**  the due date is bracketed by two readings        → baselined
 *  - **carried**       no reading covers it → last reading flat-carried → provisional
 *  - **none**          zero readings → no number                        → needsBaseline
 *
 * Other work items' targets are ignored EXCEPT earlier targets at the SAME
 * hierarchy level on the same KPI: while the baseline is carried, those are
 * stacked on top (`stackedBaselineAt`, spec 09). Targets at other levels are
 * always ignored. Stacking is wired into the KPI tree and KPI View only; the
 * issue panel still passes no steps (spec 09 Step 4, deferred).
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

/**
 * One earlier target in a stacking chain (spec 09), its target date already
 * resolved. `change` is the stored target: a percent, an amount, or (absolute)
 * the value the chain resets to.
 */
export interface StackStep {
  issueKey: string;
  /** the step's source issue type name, e.g. Initiative (for "Stacked on 2 earlier Initiative targets") */
  issueType: string;
  /** Jira `issuetype.hierarchyLevel` of the step's source issue; null = unknown */
  level: number | null;
  /** the step's resolved TARGET date (when its benefit is expected) */
  date: IsoDate;
  targetType: TargetType;
  change: number;
}

export interface StackedBaseline extends Baseline {
  /** the steps applied on top of the carried reading, in the order applied */
  stackedFrom: StackStep[];
  /** `baselineAt`'s value before any step was applied */
  unstackedValue: number | null;
}

/** Apply one chain step: percent multiplies, relative adds, absolute resets. */
function applyStep(value: number, step: StackStep): number {
  if (step.targetType === 'percent') return value * (1 + step.change / 100);
  if (step.targetType === 'relative') return value + step.change;
  return step.change;
}

/** Date, then a fixed tiebreak, so same-date steps give one result in any input order. */
function compareSteps(a: StackStep, b: StackStep): number {
  const d = ms(a.date) - ms(b.date);
  if (d !== 0) return d;
  if (a.issueKey !== b.issueKey) return a.issueKey < b.issueKey ? -1 : 1;
  if (a.targetType !== b.targetType) return a.targetType < b.targetType ? -1 : 1;
  return a.change - b.change;
}

/**
 * `baselineAt`, plus — only while the baseline is carried (provisional) — the
 * earlier same-level targets stacked on top (spec 09). `steps` is the target's
 * chain (same KPI, same level, not the target itself). Only steps whose target
 * date falls in (last reading, due date] apply: earlier ones are already in the
 * readings. A pending due date keeps the flat "assume due today" carry.
 */
export function stackedBaselineAt(
  readings: readonly DatedValue[],
  dueDate: IsoDate | null,
  steps: readonly StackStep[] = [],
): StackedBaseline {
  const base = baselineAt(readings, dueDate);
  if (base.kind !== 'carried' || dueDate === null || base.value === null || base.from === null || steps.length === 0) {
    return { ...base, stackedFrom: [], unstackedValue: base.value };
  }
  const last = ms(base.from);
  const due = ms(dueDate);
  const applied = steps.filter((s) => ms(s.date) > last && ms(s.date) <= due).sort(compareSteps);
  const value = applied.reduce(applyStep, base.value);
  return { ...base, value, stackedFrom: applied, unstackedValue: base.value };
}
