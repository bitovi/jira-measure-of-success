import type { Assignment, IsoDate } from '../models/index';
import type { DatedValue } from './targetStatus';
import { addMonths } from './relativeTargetDate';
import { resolveRelativeTargetValue } from './relativeTargetValue';

/**
 * Freeze relative → fixed — Feature 03, requirements §5.6 / FR-16…FR-18.
 *
 * Once a contributing issue is CLOSED and its rolled-up due date is in the PAST,
 * a relative target is a settled fact: its date and baseline value are captured
 * from actuals, the percent is applied once, and the result is a fixed
 * `{ date, value }` snapshot.
 *
 * v1 is COMPUTE-ON-READ (Q5): this is a pure function, not a write. The stored
 * assignment stays `delta` + relative; the resolver merely presents the snapshot
 * (and a `frozen: true` flag) when the condition holds. Returns `null` when the
 * target is not yet frozen. No @forge/*, no React.
 */
export interface FreezeContext {
  /** the contributing issue is resolved/closed */
  closed: boolean;
  /** the effective (rolled-up) due date, or null when pending */
  dueDate: IsoDate | null;
  today: IsoDate;
  readings: readonly DatedValue[];
}

const ms = (iso: IsoDate): number => new Date(iso).getTime();

export function freezeIfDone(
  assignment: Pick<Assignment, 'targetType' | 'target' | 'timing'>,
  ctx: FreezeContext,
): { date: IsoDate; value: number } | null {
  const { closed, dueDate, today, readings } = ctx;

  // FR-16: freeze only when closed AND the due date is in the past.
  if (!closed || dueDate === null || ms(dueDate) >= ms(today)) return null;

  // Date snapshot: absolute → the fixed date; relative → due date + offset.
  const due = assignment.timing.due;
  const date = due.mode === 'absolute' ? due.absolute : addMonths(dueDate, due.offsetMonths);
  if (date === null) return null;

  // Value snapshot from actuals (baseline at the due date, percent applied once).
  const resolved = resolveRelativeTargetValue(assignment, { dueDate, readings });
  if (resolved.value === null) return null;

  return { date, value: resolved.value };
}
