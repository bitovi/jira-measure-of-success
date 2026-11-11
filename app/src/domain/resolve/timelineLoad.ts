import type { TimelineData, TimelineNodeDto } from '../contracts';
import { buildKpiTargets, type KpiTargetContribution } from './timelineTargets';

/**
 * Progressive timeline loading (specs/06-timeline-performance, P4).
 *
 * Phase 1 (the skeleton) delivers the KPI tree with readings and every node
 * flagged `resolving`. Phase 2 delivers the RAW target contributions per KPI,
 * and this pure function turns them into the dated/undated markers. A target's
 * value (percent of a baseline) and hit/missed status depend on the KPI's
 * readings and direction, which the skeleton already carries — so Phase 2 never
 * re-reads them. The backend (full `buildTimelineData` for mutations) and the
 * client (merging Phase 2 into the skeleton) share this one implementation.
 */

/** Raw per-KPI contributions, keyed by KPI id (a KPI's id is its issue key). */
export type TargetContributionsByKpi = Record<string, KpiTargetContribution[]>;

/** Fill every node's targets from `contributions` and clear its `resolving` flag. */
export function applyTargetContributions(
  data: TimelineData,
  contributions: TargetContributionsByKpi,
): TimelineData {
  const apply = (node: TimelineNodeDto): TimelineNodeDto => {
    const built = buildKpiTargets(
      contributions[node.kpiId] ?? [],
      node.readings,
      node.direction,
      data.today,
    );
    // Rebuilding from the destructured rest keeps the key order stable.
    const { resolving, ...rest } = node;
    void resolving;
    return { ...rest, targets: built.dated, undated: built.undated, children: node.children.map(apply) };
  };
  return { ...data, roots: data.roots.map(apply) };
}

/** Drop the `resolving` flag everywhere (Phase 2 failed: stop the shimmer, keep the KPIs). */
export function clearResolving(data: TimelineData): TimelineData {
  const clear = (node: TimelineNodeDto): TimelineNodeDto => {
    const { resolving, ...rest } = node;
    void resolving;
    return { ...rest, children: node.children.map(clear) };
  };
  return { ...data, roots: data.roots.map(clear) };
}
