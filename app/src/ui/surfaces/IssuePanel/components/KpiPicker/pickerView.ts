import {
  kpiTree,
  visibleRows,
  type KpiOptionDto,
  type KpiPickerSpace,
  type KpiSuggestionsDto,
  type TargetSummaryDto,
} from '@domain/index.js';

/**
 * The KPI browser's view rules (spec 11 · 07), pure so they're unit-tested
 * without React: which views the left menu has, which one it opens on, what
 * each list draws, and how a KPI is described ("where it came from").
 */

/** A left-menu view: Tracked by parents, This space, a parent space, Global KPIs, All KPIs. */
export type PickerViewId = 'tracked' | 'thisSpace' | 'global' | 'all' | `space:${string}`;

export interface MenuEntry {
  id: PickerViewId;
  label: string;
  /** a space entry's key, drawn as a key chip */
  spaceKey?: string;
  /** listed under "Parent spaces" */
  parentSpace?: boolean;
  /** known empty (only the views loaded on open can be): greyed, "Nothing here" */
  empty: boolean;
}

/** Drop KPIs this work item targets now (a target saved since the panel loaded) from every list. */
export function withoutTracked(s: KpiSuggestionsDto, trackedIds: ReadonlySet<string>): KpiSuggestionsDto {
  if (trackedIds.size === 0) return s;
  return {
    ...s,
    trackedByParents: s.trackedByParents
      .map((band) => ({
        ...band,
        targets: band.targets
          .filter((t) => !trackedIds.has(t.option.id))
          .map((t) => ({ ...t, subKpis: t.subKpis.filter((o) => !trackedIds.has(o.id)) })),
      }))
      .filter((band) => band.targets.length > 0),
    inThisSpace: s.inThisSpace.filter((o) => !trackedIds.has(o.id)),
  };
}

/** The left menu, in order: Tracked by parents, This space, Parent spaces (then Global KPIs), All KPIs. */
export function menuEntries(s: KpiSuggestionsDto): MenuEntry[] {
  return [
    { id: 'tracked', label: 'Tracked by parents', empty: s.trackedByParents.length === 0 },
    { id: 'thisSpace', label: 'This space', spaceKey: s.thisSpace.key, empty: s.inThisSpace.length === 0 },
    ...s.parentSpaces.map(
      (p): MenuEntry => ({ id: `space:${p.key}`, label: p.name, spaceKey: p.key, parentSpace: true, empty: false }),
    ),
    ...(s.globalSpace
      ? [{ id: 'global', label: 'Global KPIs', spaceKey: s.globalSpace.key, parentSpace: true, empty: false } satisfies MenuEntry]
      : []),
    { id: 'all', label: 'All KPIs', empty: false },
  ];
}

/** Opens on Tracked by parents, or This space when Tracked by parents is empty (Q1: always). */
export function defaultView(s: KpiSuggestionsDto): PickerViewId {
  return s.trackedByParents.length > 0 ? 'tracked' : 'thisSpace';
}

/** The space a lazily loaded view lists, or null for the views that aren't one space. */
export function viewSpace(s: KpiSuggestionsDto, view: PickerViewId): KpiPickerSpace | null {
  if (view === 'global') return s.globalSpace;
  if (view.startsWith('space:')) {
    const key = view.slice('space:'.length);
    return s.parentSpaces.find((p) => p.key === key) ?? { key, name: key };
  }
  return null;
}

/** One drawn KPI row. */
export interface PickerRow {
  option: KpiOptionDto;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  /** expand-state key: per place, so the same KPI under two bands opens separately */
  toggleId: string;
  /** Tracked by parents: the parent's target, on its top-level rows */
  target?: TargetSummaryDto | null;
}

/** A list's rows: collapsed sub-KPIs, or the matches and their opened ancestors while searching. */
export function listRows(
  options: readonly KpiOptionDto[],
  place: string,
  expanded: ReadonlySet<string>,
  text: string,
): PickerRow[] {
  const tree = kpiTree(options);
  const open = new Set(tree.filter((r) => expanded.has(`${place}|${r.option.id}`)).map((r) => r.option.id));
  return visibleRows(tree, open, text).map((r) => ({
    option: r.option,
    depth: r.depth,
    hasChildren: r.hasChildren,
    open: r.open,
    toggleId: `${place}|${r.option.id}`,
  }));
}

/** All KPIs' results grouped by space (in the order first met), each group's rows nested within it. */
export function groupBySpace(options: readonly KpiOptionDto[]): Array<{ space: KpiPickerSpace; options: KpiOptionDto[] }> {
  const groups = new Map<string, { space: KpiPickerSpace; options: KpiOptionDto[] }>();
  for (const o of options) {
    const g = groups.get(o.space.key) ?? { space: o.space, options: [] };
    g.options.push(o);
    groups.set(o.space.key, g);
  }
  return [...groups.values()];
}

/** Where a KPI came from, relative to this work item (the picked KPI's line, a pasted key). */
export function whereLabel(s: KpiSuggestionsDto, option: Pick<KpiOptionDto, 'id' | 'space'>): string {
  const tracked = s.trackedByParents.some((b) =>
    b.targets.some((t) => t.option.id === option.id || t.subKpis.some((o) => o.id === option.id)),
  );
  if (tracked) return 'Tracked by parents';
  if (option.space.key === s.thisSpace.key) return 'In this space';
  if (s.globalSpace && option.space.key === s.globalSpace.key) return 'Global KPIs';
  if (s.parentSpaces.some((p) => p.key === option.space.key)) return 'In a parent space';
  return 'In another space';
}

/** The picked KPI as the field shows it: `{KEY} {Name} ({unit})`. */
export function pickedLabel(option: Pick<KpiOptionDto, 'key' | 'name' | 'unit'>): string {
  return `${option.key} ${option.name}${option.unit.trim() ? ` (${option.unit.trim()})` : ''}`;
}

/** `a` or `an` before a work type name. */
export function article(typeName: string): string {
  return /^[aeiou]/i.test(typeName) ? 'an' : 'a';
}
