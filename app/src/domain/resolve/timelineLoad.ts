import type {
  CreatedKpi,
  KpiViewDto,
  TimelineData,
  TimelineNodeDto,
  TimelineReadingDto,
  TimelineTargetDto,
} from '../contracts';
import type { RecordValueInput } from '../models/index';
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

function containsKpi(nodes: readonly TimelineNodeDto[], kpiId: string): boolean {
  return nodes.some((n) => n.kpiId === kpiId || containsKpi(n.children, kpiId));
}

/**
 * Splice a just-created KPI into the tree (last among its siblings, where a new
 * issue's rank puts it), under `parentKpiId` or at the root when that parent
 * isn't present. A no-op once the tree already holds it, so it's safe to keep
 * applying after a later full load includes the KPI.
 */
export function insertCreatedKpi(data: TimelineData, kpi: CreatedKpi): TimelineData {
  if (containsKpi(data.roots, kpi.kpiId)) return data;
  const toNode = (depth: number): TimelineNodeDto => ({
    id: kpi.id,
    kpiId: kpi.kpiId,
    issueKey: kpi.issueKey,
    name: kpi.name,
    unit: kpi.unit,
    direction: kpi.direction,
    depth,
    targets: [],
    undated: [],
    readings: [],
    children: [],
  });
  if (kpi.parentKpiId && containsKpi(data.roots, kpi.parentKpiId)) {
    const parentId = kpi.parentKpiId;
    const insert = (node: TimelineNodeDto): TimelineNodeDto =>
      node.kpiId === parentId
        ? { ...node, children: [...node.children, toNode(node.depth + 1)] }
        : { ...node, children: node.children.map(insert) };
    return { ...data, roots: data.roots.map(insert) };
  }
  return { ...data, roots: [...data.roots, toNode(0)] };
}

/**
 * Lay just-saved targets over the loaded contributions (one per issue and KPI,
 * so a target from the same issue is replaced). Building markers from the merged
 * list keeps a saved target in its level's stacking chain (spec 09).
 */
export function withAddedContributions(
  contributions: TargetContributionsByKpi,
  added: readonly KpiTargetContribution[],
): TargetContributionsByKpi {
  if (added.length === 0) return contributions;
  const next: TargetContributionsByKpi = { ...contributions };
  for (const a of added) {
    const kpiId = a.assignment.kpiId;
    next[kpiId] = [...(next[kpiId] ?? []).filter((c) => c.source.key !== a.source.key), a];
  }
  return next;
}

/**
 * Put a just-saved target on its KPI's row. One target per (issue, KPI), so any
 * marker from the same source issue is replaced — which also keeps this
 * idempotent when a later load already includes the target.
 */
export function applyAddedTarget(data: TimelineData, added: KpiTargetContribution): TimelineData {
  const kpiId = added.assignment.kpiId;
  if (!containsKpi(data.roots, kpiId)) return data;
  const fromOtherIssue = (t: TimelineTargetDto) => t.source.issue !== added.source.key;
  const patch = (node: TimelineNodeDto): TimelineNodeDto => {
    if (node.kpiId !== kpiId) return { ...node, children: node.children.map(patch) };
    const built = buildKpiTargets([added], node.readings, node.direction, data.today);
    const targets = [...node.targets.filter(fromOtherIssue), ...built.dated].sort((a, b) =>
      (a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0,
    );
    return { ...node, targets, undated: [...node.undated.filter(fromOtherIssue), ...built.undated] };
  };
  return { ...data, roots: data.roots.map(patch) };
}

/**
 * Apply recorded/deleted values to one KPI's series, in order: the last edit for
 * a date wins and `null` removes that date — the same rule the backend applies
 * to the reading changelog (`readingsFromChangelog`). Returns the input when no
 * edit is for this KPI, so it's cheap to apply on every render.
 */
export function applyReadingEdits(
  readings: readonly TimelineReadingDto[],
  edits: readonly RecordValueInput[],
  kpiId: string,
): TimelineReadingDto[] {
  const mine = edits.filter((e) => e.kpiId === kpiId);
  if (mine.length === 0) return readings as TimelineReadingDto[];
  const byDate = new Map(readings.map((r) => [r.date, r.value]));
  for (const e of mine) {
    if (e.value === null) byDate.delete(e.date);
    else byDate.set(e.date, e.value);
  }
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** `applyReadingEdits` across a timeline tree (each node by its kpiId). */
export function applyReadingEditsToTree(
  data: TimelineData,
  edits: readonly RecordValueInput[],
): TimelineData {
  if (edits.length === 0) return data;
  const patch = (node: TimelineNodeDto): TimelineNodeDto => ({
    ...node,
    readings: applyReadingEdits(node.readings, edits, node.kpiId),
    children: node.children.map(patch),
  });
  return { ...data, roots: data.roots.map(patch) };
}

/**
 * A KPI issue's chart after recording values on it: new series, and markers
 * rebuilt from the raw contributions (status and relative target values depend
 * on the readings). Without contributions the markers are kept as they are.
 */
export function applyReadingEditsToKpiView(
  view: KpiViewDto,
  edits: readonly RecordValueInput[],
): KpiViewDto {
  const { node } = view;
  const readings = applyReadingEdits(node.readings, edits, node.kpiId);
  if (readings === node.readings) return view;
  if (!view.contributions) return { ...view, node: { ...node, readings } };
  const built = buildKpiTargets(view.contributions, readings, node.direction, view.today);
  return { ...view, node: { ...node, readings, targets: built.dated, undated: built.undated } };
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
