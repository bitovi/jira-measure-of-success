import type { IsoDate, KpiDirection } from '../models/index';
import type { Assignment } from '../models/assignment';
import type { TargetDetailDto, TimelineTargetDto } from '../contracts';
import { resolveRelativeTargetDate } from './relativeTargetDate';
import { isBaselineRelative } from './relativeTargetValue';
import { resolvePanelTarget } from './panelTarget';
import { baselineDueEndpoint } from './panelLoad';
import { targetStatus, type DatedValue } from './targetStatus';
import { contributionContext, resolveStackSteps, stackChain } from './stackSteps';

/**
 * Timeline target aggregation — turns the KPI targets authored on contributing
 * work issues (issue `kpi-assignments` properties) into the markers the KPI
 * Timeline renders. Pure: the resolver fetches the raw contributions from Jira,
 * this decides which become dated markers, which become UNDATED chips (pending
 * anchor), where they sit, their hit/missed/upcoming status, and whether they're
 * a provisional ESTIMATE (relative value not yet baselined, Feature 03 FR-22…24).
 *
 *  - `absolute` targets plot at their resolved date, never provisional;
 *  - `percent`/`relative` targets (a % or additive change on the baseline at the due date) resolve a value
 *    and plot with `provisional` = true until the baseline is baselined;
 *  - a target whose date can't be resolved (pending anchor) becomes an UNDATED
 *    chip (`date: null`) rather than being plotted at a guessed spot;
 *  - a `percent`/`relative` target with no baseline value yet (zero readings) is skipped.
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
  /** the issue's effective due date — anchor for `issueDueDate` relative timing */
  due: IsoDate | null;
  /** true when `due` was rolled up from descendants (shown as "Rolled-up due date") */
  dueRolledUp?: boolean;
  /** the parent's key + effective due — anchor for `parentDueDate`; absent at the root */
  parent?: { key: string; due: IsoDate | null; dueRolledUp?: boolean };
  /** Jira `issuetype.hierarchyLevel` — targets stack only within a level (spec 09); null/absent = unknown */
  hierarchyLevel?: number | null;
}

/** One issue's assignment targeting a given KPI, plus that issue's source info. */
export interface KpiTargetContribution {
  assignment: Assignment;
  source: TargetSourceIssue;
}

/** Dated markers + undated chips for one KPI row. */
export interface BuiltKpiTargets {
  dated: TimelineTargetDto[];
  undated: TimelineTargetDto[];
}

export function buildKpiTargets(
  contributions: readonly KpiTargetContribution[],
  readings: readonly DatedValue[],
  direction: KpiDirection | null,
  today: IsoDate,
): BuiltKpiTargets {
  const dated: TimelineTargetDto[] = [];
  const undated: TimelineTargetDto[] = [];

  // Pass 1: every dated target as a stacking step (spec 09). Pass 2 resolves each
  // target with the other steps at its hierarchy level.
  const steps = resolveStackSteps(contributions);

  for (const { assignment, source } of contributions) {
    if (assignment.target === null) continue;

    const ctx = contributionContext(source);
    const resolvedDate = resolveRelativeTargetDate(assignment.timing.due, ctx, assignment.timing.start);

    // The baseline anchor — the same rule the issue panel uses (FR-4).
    const dueEndpoint = baselineDueEndpoint(assignment, ctx, resolvedDate.date);
    const dueDate = dueEndpoint.date;

    // The same resolution the issue panel's card shows, kept for the marker tooltip.
    const resolved = resolvePanelTarget({
      assignment,
      dueDate,
      targetDate: resolvedDate.date,
      readings,
      direction,
      // The timeline doesn't carry the source issue's done status yet, so it never
      // freezes. Harmless today (nothing reads `frozen`); Follow-up F1 adds it.
      closed: false,
      today,
      steps: stackChain(steps, { issueKey: source.key, level: source.hierarchyLevel }),
    });
    const resolvedValue = resolved.resolvedValue;
    if (resolvedValue.value === null) continue; // percent/relative with no baseline yet → skip

    const src = { issue: source.key, type: source.type, title: source.title, iconUrl: source.iconUrl };
    const relative = isBaselineRelative(assignment.targetType);
    const detail: TargetDetailDto = {
      target: assignment.target,
      targetType: assignment.targetType,
      dueTiming: assignment.timing.due,
      start: assignment.timing.start,
      targetDate: resolvedDate,
      resolvedValue,
      displayState: resolved.displayState,
      warning: resolved.warning,
      dueDate,
      dueDateRolledUp: dueEndpoint.source === 'children',
      actual: resolved.actual,
    };

    if (resolvedDate.pending || resolvedDate.date === null) {
      undated.push({
        date: null,
        value: resolvedValue.value,
        status: 'upcoming',
        provisional: resolvedValue.provisional,
        relative,
        detail,
        source: src,
      });
      continue;
    }

    dated.push({
      date: resolvedDate.date,
      value: resolvedValue.value,
      status: targetStatus({ date: resolvedDate.date, value: resolvedValue.value }, readings, direction, today),
      provisional: resolvedValue.provisional,
      relative,
      detail,
      source: src,
    });
  }

  // Chronological so markers render left → right; stable within a date.
  dated.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0));
  return { dated, undated };
}
