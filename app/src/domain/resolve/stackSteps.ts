import type { StackStep } from './baseline';
import { resolveRelativeTargetDate, type RelativeTargetContext } from './relativeTargetDate';
import type { KpiTargetContribution } from './timelineTargets';

/**
 * Stacking chains — spec 09. A relative target's carried baseline has the
 * earlier targets at the SAME hierarchy level on the same KPI stacked on top;
 * other levels are ignored. Both the KPI tree and the issue panel build their
 * steps here, so a step's date can't differ between the two. Pure.
 */

/** The resolution context for a contribution's source issue (effective due + parent due). */
export function contributionContext(source: KpiTargetContribution['source']): RelativeTargetContext {
  const endpoint = (date: string | null, rolledUp: boolean | undefined) =>
    ({ date, source: rolledUp ? 'children' : 'own' }) as const;
  const ctx: RelativeTargetContext = {
    issue: { issueKey: source.key, due: endpoint(source.due, source.dueRolledUp) },
  };
  if (source.parent) {
    ctx.parent = { issueKey: source.parent.key, due: endpoint(source.parent.due, source.parent.dueRolledUp) };
  }
  return ctx;
}

/**
 * One KPI's contributions → the steps that can stack: each target with its
 * target date resolved (the same rule the markers use). Targets with a pending
 * date or an unknown level are dropped — they can't be placed.
 *
 * Closed status is ignored: a Done issue still stacks if its (rolled-up) target
 * date lands after the last reading. Follow-up F1 (specs/09-stacked-targets/plan.md)
 * filters frozen steps here, in shared code, so the panel and the tree agree.
 */
export function resolveStackSteps(contributions: readonly KpiTargetContribution[]): StackStep[] {
  const steps: StackStep[] = [];
  for (const { assignment, source } of contributions) {
    const level = source.hierarchyLevel ?? null;
    if (assignment.target === null || level === null) continue;
    const date = resolveRelativeTargetDate(assignment.timing.due, contributionContext(source), assignment.timing.start);
    if (date.pending || date.date === null) continue;
    steps.push({
      issueKey: source.key,
      issueType: source.type,
      level,
      date: date.date,
      targetType: assignment.targetType,
      change: assignment.target,
    });
  }
  return steps;
}

/**
 * A target's chain: the other steps at its level. A target with an unknown
 * level neither stacks nor is stacked on.
 */
export function stackChain(
  steps: readonly StackStep[],
  self: { issueKey: string; level: number | null | undefined },
): StackStep[] {
  const level = self.level ?? null;
  if (level === null) return [];
  return steps.filter((s) => s.level === level && s.issueKey !== self.issueKey);
}
