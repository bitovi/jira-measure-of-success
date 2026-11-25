/**
 * Spaces holding KPIs, worked out from the KPIs loaded (spec 11 · 06): the app
 * keeps no list of KPI spaces. Plus the Timeline's KPI space scope and Add
 * KPI's space rule (spec 11 · 08).
 *
 * Pure: no @forge/*, no React.
 */
import type { KpiSpaceRef, TimelineNodeDto } from '../contracts';
import { projectKeyOfIssueKey } from './projectKey';
import { filterTimelineByProjects } from './timelineProjectFilter';

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

/** A KPI's space key: its space, else its key's prefix (hand-built data). */
export function kpiSpaceKeyOf(node: Pick<TimelineNodeDto, 'space' | 'issueKey'>): string {
  return node.space?.key ?? projectKeyOfIssueKey(node.issueKey);
}

/**
 * Which space Add KPI fills in (spec 11 · 08): only when there's no choice to
 * make. The one space the user can create KPIs in, or, when every KPI on the
 * page is in one space, that space (if the user can create there). Never the
 * central space, the filter or the parent's space just because: the user picks.
 * Returns the project id, or null.
 */
export function kpiCreateSpacePreselect(
  creatable: readonly KpiSpaceRef[],
  kpiSpaceKeys: readonly string[],
): string | null {
  if (creatable.length === 1) return creatable[0].id;
  const keys = new Set(kpiSpaceKeys);
  if (keys.size !== 1) return null;
  const [only] = keys;
  return creatable.find((s) => s.key === only)?.id ?? null;
}

/** The Timeline's two filters: KPI space (the KPIs' own spaces) and Work from (the targets' work items' spaces). */
export interface TimelineScope {
  /** KPI space keys; null or empty = all KPIs */
  spaces: ReadonlySet<string> | null;
  /** projects of the work items that set targets; null or empty = all */
  workFrom: ReadonlySet<string> | null;
}

export interface ScopedTimeline {
  roots: TimelineNodeDto[];
  /** ids of the nodes kept only as context: ancestors outside the KPI space filter (compact rows) */
  context: ReadonlySet<string>;
}

/**
 * The tree the Timeline shows for a scope (spec 11 · 08). Work from narrows as
 * before (`filterTimelineByProjects`: a KPI stays when it or a descendant has a
 * matching target, its own targets narrowed). Then the KPI space filter keeps
 * the KPIs in the chosen spaces as full rows plus their ancestors as context
 * (only the path up; no unrelated siblings). Depths are unchanged: every
 * ancestor of a kept KPI is kept.
 */
export function scopeTimeline(roots: TimelineNodeDto[], scope: TimelineScope): ScopedTimeline {
  const narrowed = filterTimelineByProjects(roots, scope.workFrom);
  const spaces = scope.spaces;
  const context = new Set<string>();
  if (!spaces || spaces.size === 0) return { roots: narrowed, context };
  const keep = (nodes: TimelineNodeDto[]): TimelineNodeDto[] =>
    nodes.flatMap((node) => {
      const children = keep(node.children);
      const inScope = spaces.has(kpiSpaceKeyOf(node));
      if (!inScope && children.length === 0) return [];
      if (!inScope) context.add(node.id);
      return [{ ...node, children }];
    });
  return { roots: keep(narrowed), context };
}

/** The KPI ids shown as full rows (not context), collapsed rows included. */
export function fullRowKpiIds(scoped: ScopedTimeline): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly TimelineNodeDto[]) => {
    for (const n of nodes) {
      if (!scoped.context.has(n.id)) out.push(n.kpiId);
      walk(n.children);
    }
  };
  walk(scoped.roots);
  return out;
}

/** Whether the scoped tree shows the KPI `kpiId` (as a full row or context). */
export function scopeShowsKpi(scoped: ScopedTimeline, kpiId: string): boolean {
  const walk = (nodes: readonly TimelineNodeDto[]): boolean =>
    nodes.some((n) => n.kpiId === kpiId || walk(n.children));
  return walk(scoped.roots);
}
