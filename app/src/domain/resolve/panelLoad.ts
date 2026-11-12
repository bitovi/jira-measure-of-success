import type { Assignment } from '../models/index';
import type { CatalogEntryDto, PanelBasis, PanelData, PanelRowDto, PanelValuesData } from '../contracts';
import type { ResolvedEndpoint } from './effectiveTiming';
import { groupByRelationship } from './panelGrouping';
import { resolvePanelTarget } from './panelTarget';
import { resolveRelativeTargetDate, type RelativeTargetContext } from './relativeTargetDate';
import { isBaselineRelative } from './relativeTargetValue';

/**
 * Progressive issue panel (specs/07-issue-panel-performance).
 *
 * Phase 1 (`PanelBasis`) has the issue's and its parent's targets and the KPI
 * catalog, so the target list and the "Set a KPI target" form can render right
 * away. Phase 2 (`PanelValuesData`) has the rolled-up due dates and the KPI
 * readings that the estimate line, status pill and dates need. This pure
 * function turns basis (+ values once they arrive) into `PanelData`. The backend
 * (the one-shot `getPanelData` and the mutations) and the client (merging
 * Phase 2) share it, so the two paths can't drift apart.
 */

/** True when a target is dated relative to the parent's due date, so the parent's rollup is needed. */
export function needsParentDue(assignments: Assignment[]): boolean {
  return assignments.some((a) => a.timing.due.mode === 'relative' && a.timing.due.anchor === 'parentDueDate');
}

const PENDING: ResolvedEndpoint = { date: null, source: 'pending' };

/**
 * The due date a target's baseline is measured at (FR-4): the date its timing
 * anchors to, or — for fixed-date timing — the issue's own (rolled-up) due date.
 * Fixed-date ABSOLUTE targets need no baseline, so they keep the target date and
 * stay independent of whether the issue has a due date.
 */
export function baselineDueEndpoint(
  a: Pick<Assignment, 'targetType' | 'timing'>,
  ctx: RelativeTargetContext,
  targetDate: string | null,
): ResolvedEndpoint {
  const due = a.timing.due;
  if (due.mode === 'relative' && due.anchor === 'issueDueDate') return ctx.issue.due;
  if (due.mode === 'relative' && due.anchor === 'parentDueDate') return ctx.parent?.due ?? PENDING;
  if (isBaselineRelative(a.targetType)) return ctx.issue.due;
  return { date: targetDate, source: 'own' };
}

/**
 * Build the panel from Phase 1, plus Phase 2 when it has arrived. Without
 * `values`, every tracked row and the panel itself are `resolving`: the bet and
 * the grouping are final, the value fields are empty until Phase 2.
 */
export function assemblePanel(basis: PanelBasis, values: PanelValuesData | null): PanelData {
  const readingsOf = (kpiId: string) => values?.readings[kpiId] ?? [];
  const catalog: CatalogEntryDto[] = values
    ? basis.catalog.map((c) => {
        const series = readingsOf(c.id);
        return { ...c, currentValue: series.length ? series[series.length - 1].value : null };
      })
    : basis.catalog;
  const defOf = (kpiId: string) => catalog.find((k) => k.id === kpiId);
  const deleted = new Set(basis.deletedKpiIds ?? []);

  const ctx: RelativeTargetContext = { issue: { issueKey: basis.issueKey, due: values?.issueDue ?? PENDING } };
  if (values?.parent) ctx.parent = values.parent;

  const grouped = groupByRelationship(
    basis.own,
    basis.parentKpiIds.map((kpiId) => ({ kpiId })),
    [],
  );

  const rows: PanelRowDto[] = [];
  const push = (kpiId: string, relationship: PanelRowDto['relationship'], a?: Assignment) => {
    const def = defOf(kpiId);
    const head = {
      kpiId,
      name: def?.name ?? kpiId,
      unit: def?.unit ?? '',
      direction: def?.direction ?? null,
    };
    const empty = {
      resolvedValue: null,
      displayState: null,
      warning: null,
      frozen: false,
      dueDate: null,
      dueDateRolledUp: false,
      actual: null,
    } satisfies Partial<PanelRowDto>;
    if (!a) {
      // Don't offer to track a parent's target on a KPI that no longer exists.
      if (deleted.has(kpiId)) return;
      rows.push({ ...head, target: null, targetType: null, targetDate: null, dueTiming: null, start: null, relationship, ...empty });
      return;
    }
    const bet = { target: a.target, targetType: a.targetType, dueTiming: a.timing.due, start: a.timing.start, relationship };
    if (deleted.has(kpiId)) {
      // A deleted KPI has no readings, so Phase 2 can't resolve anything for it.
      rows.push({ ...head, ...bet, targetDate: null, ...empty, kpiMissing: true });
      return;
    }
    if (!values) {
      rows.push({ ...head, ...bet, targetDate: null, ...empty, resolving: true });
      return;
    }
    const targetDate = resolveRelativeTargetDate(a.timing.due, ctx, a.timing.start);
    const dueEndpoint = baselineDueEndpoint(a, ctx, targetDate.date);
    const resolved = resolvePanelTarget({
      assignment: a,
      dueDate: dueEndpoint.date,
      targetDate: targetDate.date,
      readings: readingsOf(kpiId),
      direction: def?.direction ?? null,
      closed: basis.closed,
      today: values.today,
    });
    rows.push({
      ...head,
      target: bet.target,
      targetType: bet.targetType,
      targetDate,
      dueTiming: bet.dueTiming,
      start: bet.start,
      relationship,
      resolvedValue: resolved.resolvedValue,
      displayState: resolved.displayState,
      warning: resolved.warning,
      frozen: resolved.frozen,
      dueDate: dueEndpoint.date,
      dueDateRolledUp: dueEndpoint.source === 'children',
      actual: resolved.actual,
    });
  };
  for (const r of grouped.sharedWithParent) push(r.kpiId, 'shared', r.assignment);
  for (const r of grouped.onlyHere) push(r.kpiId, 'onlyHere', r.assignment);
  for (const r of grouped.onParentNotTracked) push(r.kpiId, 'onParentNotTracked');

  const data: PanelData = {
    issueKey: basis.issueKey,
    rows,
    catalog,
    issueDueDate: ctx.issue.due.date,
    issueDueRolledUp: ctx.issue.due.source === 'children',
  };
  return values ? data : { ...data, resolving: true };
}

/** Drop every `resolving` flag (Phase 2 failed: stop the shimmer, keep the list). */
export function clearPanelResolving(data: PanelData): PanelData {
  const { resolving, ...rest } = data;
  void resolving;
  return {
    ...rest,
    rows: data.rows.map((r) => {
      const { resolving: rowResolving, ...row } = r;
      void rowResolving;
      return row;
    }),
  };
}
