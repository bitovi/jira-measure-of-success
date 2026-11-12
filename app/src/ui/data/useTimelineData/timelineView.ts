import {
  applyAddedTarget,
  applyReadingEditsToTree,
  applyTargetContributions,
  clearResolving,
  insertCreatedKpi,
  type AddedTarget,
  type CreatedKpi,
  type RecordValueInput,
  type TargetContributionsByKpi,
  type TimelineData,
} from '@domain/index.js';

/**
 * What the Timeline should show, derived from the pieces of a progressive load
 * (specs/06-timeline-performance, P4) plus what was saved this session. Pure, so
 * the rules are unit-tested without React:
 *
 *  - the skeleton shows immediately (its nodes are `resolving`);
 *  - once the contributions arrive they are merged into it;
 *  - if Phase 2 failed, the KPIs stay visible with the shimmer cleared.
 *
 * Mutations return only what changed, never a rebuilt timeline, so saved KPIs,
 * recorded values and added targets are laid over the load. Values go in BEFORE
 * the targets are built: a target's hit/missed status and a relative target's
 * value depend on the readings. Each overlay is a no-op or an exact replacement
 * once the loaded data already includes it.
 */
export interface TimelineLoadState {
  skeleton: TimelineData | null;
  contributions: TargetContributionsByKpi | null;
  targetsError: string | null;
  created?: readonly CreatedKpi[];
  readingEdits?: readonly RecordValueInput[];
  addedTargets?: readonly AddedTarget[];
}

export interface TimelineView {
  data: TimelineData | null;
  /** Phase 2 is still outstanding (the rows are shimmering) */
  targetsPending: boolean;
  /** Phase 2 failed */
  targetsError: string | null;
}

export function deriveTimelineView(state: TimelineLoadState): TimelineView {
  const { skeleton, contributions, targetsError } = state;
  if (!skeleton) return { data: null, targetsPending: false, targetsError: null };

  let tree = skeleton;
  for (const kpi of state.created ?? []) tree = insertCreatedKpi(tree, kpi);
  tree = applyReadingEditsToTree(tree, state.readingEdits ?? []);

  let view: TimelineView;
  // No KPIs loaded → nothing for targets to attach to, so there is nothing to wait for.
  if (skeleton.roots.length === 0) view = { data: tree, targetsPending: false, targetsError: null };
  else if (contributions) {
    view = { data: applyTargetContributions(tree, contributions), targetsPending: false, targetsError: null };
  } else if (targetsError) view = { data: clearResolving(tree), targetsPending: false, targetsError };
  else view = { data: tree, targetsPending: true, targetsError: null };

  const added = state.addedTargets ?? [];
  if (added.length === 0 || !view.data) return view;
  let data = view.data;
  for (const target of added) data = applyAddedTarget(data, target);
  return { ...view, data };
}
