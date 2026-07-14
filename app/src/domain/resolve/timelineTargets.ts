import type { IsoDate, KpiDirection } from '../models/index';
import type { Assignment } from '../models/assignment';
import type { TimelineTargetDto } from '../contracts';
import { resolveRelativeTargetDate, type RelativeTargetContext } from './relativeTargetDate';
import { targetStatus, type DatedValue } from './targetStatus';

/**
 * Timeline target aggregation — turns the KPI targets authored on contributing
 * work issues (issue `kpi-assignments` properties) into the diamonds the KPI
 * Timeline renders. Pure: the resolver fetches the raw contributions from Jira,
 * this decides which become targets, where they sit on the axis, and their
 * hit/missed/upcoming status.
 *
 * v1 scope (specs/bug-fixes/timeline-targets-not-shown.md):
 *  - only `targetType: 'absolute'` targets are plotted; `delta` targets are
 *    skipped until baselines are modeled;
 *  - relative target dates are resolved from the contributing issue's OWN due
 *    (and its parent's own due) — no full subtree rollup — matching the panel;
 *  - a target whose date can't be resolved (pending anchor / unset absolute
 *    date / no target value) is skipped rather than plotted at a guessed spot.
 */

/** The contributing issue behind a target (for the "issues behind this KPI" list). */
export interface TargetSourceIssue {
  /** issue key, e.g. INIT-48 */
  key: string;
  /** issue type name, e.g. Initiative */
  type: string;
  /** issue summary */
  title: string;
  /** issue type icon URL (Jira `issuetype.iconUrl`), when available */
  iconUrl: string | null;
  /** the issue's own due date — anchor for `issueDueDate` relative timing */
  due: IsoDate | null;
  /** the parent's key + own due — anchor for `parentDueDate`; absent at the root */
  parent?: { key: string; due: IsoDate | null };
}

/** One issue's assignment targeting a given KPI, plus that issue's source info. */
export interface KpiTargetContribution {
  assignment: Assignment;
  source: TargetSourceIssue;
}

export function buildKpiTargets(
  contributions: readonly KpiTargetContribution[],
  readings: readonly DatedValue[],
  direction: KpiDirection | null,
  today: IsoDate,
): TimelineTargetDto[] {
  const out: TimelineTargetDto[] = [];
  for (const { assignment, source } of contributions) {
    // No target value, or a delta target (not plottable without a baseline).
    if (assignment.target === null) continue;
    if (assignment.targetType === 'delta') continue;

    const ctx: RelativeTargetContext = {
      issue: { issueKey: source.key, due: { date: source.due, source: 'own' } },
    };
    if (source.parent) {
      ctx.parent = { issueKey: source.parent.key, due: { date: source.parent.due, source: 'own' } };
    }

    const resolved = resolveRelativeTargetDate(assignment.timing.due, ctx, assignment.timing.start);
    if (resolved.pending || resolved.date === null) continue;

    out.push({
      date: resolved.date,
      value: assignment.target,
      status: targetStatus({ date: resolved.date, value: assignment.target }, readings, direction, today),
      source: { issue: source.key, type: source.type, title: source.title, iconUrl: source.iconUrl },
    });
  }

  // Chronological so diamonds render left → right; stable within a date.
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
