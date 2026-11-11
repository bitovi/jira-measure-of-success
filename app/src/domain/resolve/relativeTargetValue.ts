import type { Assignment, IsoDate, TargetType } from '../models/index';
import type { DatedValue } from './targetStatus';
import { baselineAt, type BaselineState } from './baseline';

/**
 * Relative target VALUE resolution — Feature 03, requirements §5.3 / FR-9…FR-11.
 *
 * Sibling to `resolveRelativeTargetDate` (which resolves the DATE half). This
 * resolves the VALUE half:
 *  - `absolute` target → the stored number, passed through (always baselined).
 *  - `percent` target  → a PERCENT applied to the baseline value at the due date
 *                        (`baseline × (1 + percent/100)`; stored `target` IS the
 *                        percent, `1` = +1%, Q8), propagating the baseline state.
 *  - `relative` target → an additive AMOUNT on the same baseline
 *                        (`baseline + amount`; `100` = +100 in KPI units).
 *
 * Pure: no @forge/*, no React. The author supplies the sign; the KPI's direction
 * is used only for hit/miss classification (in `displayState`), not for the sign.
 */
export interface ResolvedTargetValue {
  /** null only when the baseline needs a reading (`state === 'needsBaseline'`) */
  value: number | null;
  baseline: number | null;
  /** the date the baseline is measured at (the due date), or null when pending */
  baselineDate: IsoDate | null;
  /** which reading date the baseline value was carried/measured from */
  baselineFrom: IsoDate | null;
  state: BaselineState;
  /** true unless the baseline is official (`state === 'baselined'`) */
  provisional: boolean;
}

export interface RelativeTargetValueContext {
  /** the contributing issue's effective due date, or null when pending */
  dueDate: IsoDate | null;
  readings: readonly DatedValue[];
}

/** True for target kinds measured against the KPI's value at the due date. */
export function isBaselineRelative(targetType: TargetType | null | undefined): boolean {
  return targetType === 'percent' || targetType === 'relative';
}

/** The target a baseline-relative change resolves to: percent multiplies, relative adds. */
export function applyTargetChange(baseline: number, targetType: TargetType, change: number): number {
  if (targetType === 'percent') return baseline * (1 + change / 100);
  if (targetType === 'relative') return baseline + change;
  return change;
}

export function resolveRelativeTargetValue(
  assignment: Pick<Assignment, 'targetType' | 'target'>,
  ctx: RelativeTargetValueContext,
): ResolvedTargetValue {
  if (assignment.targetType === 'absolute') {
    return {
      value: assignment.target,
      baseline: null,
      baselineDate: null,
      baselineFrom: null,
      state: 'baselined',
      provisional: false,
    };
  }

  // percent / relative: a change on the baseline value at the due date.
  const baseline = baselineAt(ctx.readings, ctx.dueDate);
  const change = assignment.target ?? 0;

  if (baseline.value === null) {
    return {
      value: null,
      baseline: null,
      baselineDate: ctx.dueDate,
      baselineFrom: baseline.from,
      state: baseline.state, // 'needsBaseline'
      provisional: true,
    };
  }

  return {
    value: applyTargetChange(baseline.value, assignment.targetType, change),
    baseline: baseline.value,
    baselineDate: ctx.dueDate,
    baselineFrom: baseline.from,
    state: baseline.state,
    provisional: baseline.state !== 'baselined',
  };
}
