/**
 * Spaces holding KPIs, worked out from the KPIs loaded (spec 11 · 06): the app
 * keeps no list of KPI spaces.
 *
 * Pure: no @forge/*, no React.
 */
import type { KpiSpaceRef, TimelineNodeDto } from '../contracts';
import { KPI_SPACE_REQUIRED } from './kpiAccess';

/** Every distinct space of the KPIs in a tree, in tree order. */
export function kpiSpacesOf(roots: readonly TimelineNodeDto[]): KpiSpaceRef[] {
  const byKey = new Map<string, KpiSpaceRef>();
  const walk = (nodes: readonly TimelineNodeDto[]) => {
    for (const n of nodes) {
      if (n.space && !byKey.has(n.space.key)) byKey.set(n.space.key, n.space);
      walk(n.children);
    }
  };
  walk(roots);
  return [...byKey.values()];
}

/**
 * Where Add KPI creates a KPI until 08 adds the space chooser: the central
 * space when one is set up, else the one space every loaded KPI is in. With
 * neither, the user has to choose (an error until 08).
 */
export function defaultKpiCreateSpace(
  roots: readonly TimelineNodeDto[],
  centralSpace: KpiSpaceRef | null | undefined,
): { space: KpiSpaceRef } | { error: string } {
  if (centralSpace) return { space: centralSpace };
  const spaces = kpiSpacesOf(roots);
  if (spaces.length === 1) return { space: spaces[0] };
  return {
    error: `${KPI_SPACE_REQUIRED}: there's no central KPI space set up in Settings${
      spaces.length > 1 ? ', and the KPIs here are in more than one space' : ''
    }.`,
  };
}
