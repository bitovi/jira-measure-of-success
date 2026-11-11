import {
  applyTargetContributions,
  clearResolving,
  type TargetContributionsByKpi,
  type TimelineData,
} from '@domain/index.js';

/**
 * What the Timeline should show, derived from the pieces of a progressive load
 * (specs/06-timeline-performance, P4). Pure, so the rules are unit-tested
 * without React:
 *
 *  - `full` (a complete result returned by a mutation) always wins: it already
 *    contains the targets, so a Phase 2 result that lands later — or was
 *    already in flight when the user saved — can never overwrite it.
 *  - otherwise the skeleton shows immediately (its nodes are `resolving`);
 *  - once the contributions arrive they are merged into it;
 *  - if Phase 2 failed, the KPIs stay visible with the shimmer cleared.
 */
export interface TimelineLoadState {
  skeleton: TimelineData | null;
  contributions: TargetContributionsByKpi | null;
  targetsError: string | null;
  full: TimelineData | null;
}

export interface TimelineView {
  data: TimelineData | null;
  /** Phase 2 is still outstanding (the rows are shimmering) */
  targetsPending: boolean;
  /** Phase 2 failed (and no complete result has superseded it) */
  targetsError: string | null;
}

export function deriveTimelineView(state: TimelineLoadState): TimelineView {
  const { skeleton, contributions, targetsError, full } = state;
  if (full) return { data: full, targetsPending: false, targetsError: null };
  if (!skeleton) return { data: null, targetsPending: false, targetsError: null };
  // No KPIs → nothing for targets to attach to, so there is nothing to wait for.
  if (skeleton.roots.length === 0) return { data: skeleton, targetsPending: false, targetsError: null };
  if (contributions) {
    return {
      data: applyTargetContributions(skeleton, contributions),
      targetsPending: false,
      targetsError: null,
    };
  }
  if (targetsError) return { data: clearResolving(skeleton), targetsPending: false, targetsError };
  return { data: skeleton, targetsPending: true, targetsError: null };
}
