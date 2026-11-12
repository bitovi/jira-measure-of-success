import type { Assignment, IsoDate, KpiDirection } from '../models/index';
import type { DatedValue } from './targetStatus';
import { valueAt } from './targetStatus';
import { resolveRelativeTargetValue, type ResolvedTargetValue } from './relativeTargetValue';
import type { StackStep } from './baseline';
import { displayState, type DisplayState, type TargetWarning } from './displayState';
import { freezeIfDone } from './freeze';

/**
 * Panel target resolution — Feature 03, the read-time glue tying the pure value
 * modules together for one saved target. Shared by BOTH the Forge resolver and
 * the harness mock-resolver so the issue panel behaves identically (contract
 * parity, architecture §5/§6). The backend only gathers the inputs (due date,
 * target date, readings, closed flag); this decides value + state + warning.
 *
 * Baseline date = the DUE date (the anchor), NOT the offset target date (FR-4).
 * The target date is due date + offset (resolved separately upstream).
 */
export interface PanelTargetInput {
  assignment: Pick<Assignment, 'targetType' | 'target' | 'timing'>;
  /** the contributing issue's effective due date (baseline anchor); null pending */
  dueDate: IsoDate | null;
  /** the resolved target date (due date + offset), or null when pending */
  targetDate: IsoDate | null;
  readings: readonly DatedValue[];
  direction: KpiDirection | null;
  /** the contributing issue is resolved/closed (for freeze) */
  closed: boolean;
  today: IsoDate;
  /** this target's stacking chain (spec 09); omit for no stacking */
  steps?: readonly StackStep[];
}

export interface ResolvedPanelTarget {
  resolvedValue: ResolvedTargetValue;
  displayState: DisplayState;
  warning: TargetWarning;
  frozen: boolean;
  /** recorded value in effect at the target date (for met/missed/unknown rows) */
  actual: number | null;
}

export function resolvePanelTarget(input: PanelTargetInput): ResolvedPanelTarget {
  const { assignment, dueDate, targetDate, readings, direction, closed, today, steps } = input;

  const resolvedValue = resolveRelativeTargetValue(assignment, { dueDate, readings, steps });
  const { state, warning } = displayState({
    valueState: resolvedValue.state,
    today,
    dueDate,
    targetDate,
    readings,
    direction,
    target: resolvedValue.value,
  });
  const frozen = freezeIfDone(assignment, { closed, dueDate, today, readings }) !== null;
  const actual = targetDate !== null ? valueAt(readings, targetDate) : null;

  return { resolvedValue, displayState: state, warning, frozen, actual };
}
