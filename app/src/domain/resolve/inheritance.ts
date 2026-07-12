import type { Assignment, IsoDate, TargetType, Timing } from '../models/index.js';

/**
 * Inheritance resolution — Brief §2.1.
 *
 * ⚠️ PARKED (not wired into v1). Per requirements §8-Q11, the product uses
 * INDEPENDENT per-issue targets — no value inheritance. This pure function is
 * kept (and tested) so the capability can be revived if that decision changes,
 * but nothing in v1 calls it. `effectiveDueDate` (timing rollup) is unaffected.
 *
 * Pure function. Given an issue's own assignment for a KPI and its ancestors'
 * assignments for the SAME KPI (nearest first), resolve each inheritable field:
 *
 *   - a non-null LOCAL value always wins (source: 'local')
 *   - otherwise, if inheritFromParent, use the nearest ancestor whose field is
 *     non-null (source: 'inherited', fromIssueKey)
 *   - otherwise the field is unset (source: 'unset')
 *
 * Inheritable fields: target and timing.start. `targetType` and the due rule are
 * always local. (Baseline / recorded values are not part of the model — the
 * panel is target-only.)
 */
export type FieldSource = 'local' | 'inherited' | 'unset';

export interface ResolvedField<T> {
  value: T | null;
  source: FieldSource;
  /** issue key the value was inherited from, when source === 'inherited' */
  fromIssueKey?: string;
}

export interface AncestorAssignment {
  issueKey: string;
  assignment: Assignment;
}

export interface ResolvedAssignment {
  kpiId: string;
  target: ResolvedField<number>;
  start: ResolvedField<IsoDate>;
  targetType: TargetType;
  timing: Timing;
}

function resolveField<T>(
  localValue: T | null,
  inherit: boolean,
  ancestors: AncestorAssignment[],
  pick: (a: Assignment) => T | null,
): ResolvedField<T> {
  if (localValue !== null && localValue !== undefined) {
    return { value: localValue, source: 'local' };
  }
  if (inherit) {
    for (const { issueKey, assignment } of ancestors) {
      const v = pick(assignment);
      if (v !== null && v !== undefined) {
        return { value: v, source: 'inherited', fromIssueKey: issueKey };
      }
    }
  }
  return { value: null, source: 'unset' };
}

/**
 * @param local     the issue's own assignment for a KPI
 * @param ancestors ancestor assignments for the SAME kpiId, nearest first
 */
export function resolveInheritance(
  local: Assignment,
  ancestors: AncestorAssignment[] = [],
): ResolvedAssignment {
  const sameKpi = ancestors.filter((a) => a.assignment.kpiId === local.kpiId);
  const inherit = local.inheritFromParent;

  return {
    kpiId: local.kpiId,
    target: resolveField(local.target, inherit, sameKpi, (a) => a.target),
    start: resolveField(local.timing.start, inherit, sameKpi, (a) => a.timing.start),
    targetType: local.targetType,
    timing: local.timing,
  };
}
