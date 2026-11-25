import type { Assignment, KpiDirection } from '../models/index';
import type {
  KpiOptionDto,
  KpiPickerSpace,
  KpiSuggestionsDto,
  TrackedByParentDto,
  WorkItemRefDto,
} from '../contracts';

/**
 * The KPI picker's pure rules (spec 11 · 07): what the two-pane browser lists
 * on open (`buildKpiSuggestions`), how a list nests and collapses (`kpiTree`,
 * `visibleRows`), and what typed or pasted text means (`parseKpiRefInput`).
 */

/** The deepest parent chain the picker walks (Q4: to the top, capped for safety). */
export const KPI_CHAIN_DEPTH_CAP = 10;

/** A KPI the backend loaded for the picker, before it's placed in a list. */
export interface PickerKpi {
  id: string;
  key: string;
  name: string;
  typeIconUrl: string | null;
  unit: string;
  direction: KpiDirection | null;
  space: KpiPickerSpace | null;
  /** its parent KPIs by hierarchy link, lowest link id first (the one-parent rule) */
  parentIds: string[];
  /** native rank (sibling order); null keeps input order */
  rank: string | null;
}

/** One parent of the work item (nearest first) and the targets it set. */
export interface PickerChainItem {
  item: WorkItemRefDto;
  space: KpiPickerSpace | null;
  targets: Assignment[];
}

export interface KpiSuggestionsInput {
  thisSpace: KpiPickerSpace;
  /** the site's central space ("Global KPIs"), if any */
  centralSpace: KpiPickerSpace | null;
  /** parents, nearest first (the chain walk) */
  chain: PickerChainItem[];
  /** every KPI loaded for the opening views: this space's, the parents' targets, their same-space sub-KPIs */
  kpis: PickerKpi[];
  /** KPIs this work item already targets: left out everywhere */
  ownTargetIds: readonly string[];
}

const byRank = (a: { rank: string | null }, b: { rank: string | null }): number => {
  if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  if (a.rank) return -1;
  if (b.rank) return 1;
  return 0;
};

/** A KPI's parent among `ids`: its lowest-id parent link that's in the set. */
function parentIn(kpi: PickerKpi, ids: ReadonlySet<string>): string | null {
  return kpi.parentIds.find((p) => p !== kpi.id && ids.has(p)) ?? null;
}

/**
 * KPIs as a list in rank order (siblings by rank, depth-first), each with its
 * parent within the list and whether it has sub-KPIs there. A KPI whose parent
 * isn't in the list is top level. Cycles are broken (the first member met is top level).
 */
export function toKpiOptions(kpis: readonly PickerKpi[], fallbackSpace: KpiPickerSpace): KpiOptionDto[] {
  const ids = new Set(kpis.map((k) => k.id));
  const childrenOf = new Map<string, PickerKpi[]>();
  const roots: PickerKpi[] = [];
  for (const k of kpis) {
    const p = parentIn(k, ids);
    if (p) childrenOf.set(p, [...(childrenOf.get(p) ?? []), k]);
    else roots.push(k);
  }
  const out: KpiOptionDto[] = [];
  const placed = new Set<string>();
  const walk = (k: PickerKpi, parentId: string | null) => {
    if (placed.has(k.id)) return;
    placed.add(k.id);
    const children = [...(childrenOf.get(k.id) ?? [])].sort(byRank).filter((c) => !placed.has(c.id));
    out.push(toOption(k, parentId, children.length > 0, fallbackSpace));
    for (const c of children) walk(c, k.id);
  };
  for (const r of [...roots].sort(byRank)) walk(r, null);
  // Members of a parent cycle have no root above them: place each loop at the top.
  for (const k of kpis) if (!placed.has(k.id)) walk(k, null);
  return out;
}

function toOption(k: PickerKpi, parentId: string | null, hasChildren: boolean, fallbackSpace: KpiPickerSpace): KpiOptionDto {
  return {
    id: k.id,
    key: k.key,
    name: k.name,
    typeIconUrl: k.typeIconUrl,
    unit: k.unit,
    direction: k.direction,
    space: k.space ? { key: k.space.key, name: k.space.name } : fallbackSpace,
    parentId,
    hasChildren,
  };
}

const spaceKeyOf = (k: PickerKpi): string | null => k.space?.key ?? null;

/**
 * What the KPI browser lists on open (spec 11 · 07): one "Tracked by parents"
 * band per parent with targets (nearest first; every target top level, never
 * nested under another; each with its same-space sub-KPIs), this space's KPIs,
 * the parents' spaces and the Global KPIs entry. KPIs this work item already
 * targets are left out everywhere.
 */
export function buildKpiSuggestions(input: KpiSuggestionsInput): KpiSuggestionsDto {
  const excluded = new Set(input.ownTargetIds);
  const pool = new Map<string, PickerKpi>();
  for (const k of input.kpis) if (!excluded.has(k.id) && !pool.has(k.id)) pool.set(k.id, k);
  const poolIds = new Set(pool.keys());
  const childrenOf = new Map<string, PickerKpi[]>();
  for (const k of pool.values()) {
    const p = parentIn(k, poolIds);
    if (p) childrenOf.set(p, [...(childrenOf.get(p) ?? []), k]);
  }

  const seenItems = new Set<string>();
  const chain = input.chain.filter((c) => !seenItems.has(c.item.id) && seenItems.add(c.item.id));

  const trackedByParents: TrackedByParentDto[] = [];
  for (const parent of chain) {
    const targetIds = [...new Set(parent.targets.map((a) => a.kpiId))].filter((id) => pool.has(id));
    const targetSet = new Set(targetIds);
    const targets = targetIds
      .map((id) => pool.get(id)!)
      .sort(byRank)
      .map((kpi) => {
        const a = parent.targets.find((t) => t.kpiId === kpi.id)!;
        const subs: PickerKpi[] = [];
        const seen = new Set<string>([kpi.id]);
        const collect = (id: string) => {
          for (const c of childrenOf.get(id) ?? []) {
            if (seen.has(c.id) || targetSet.has(c.id) || spaceKeyOf(c) !== spaceKeyOf(kpi)) continue;
            seen.add(c.id);
            subs.push(c);
            collect(c.id);
          }
        };
        collect(kpi.id);
        const tree = toKpiOptions([{ ...kpi, parentIds: [] }, ...subs], input.thisSpace);
        return {
          option: tree[0],
          target: { target: a.target, targetType: a.targetType, due: a.timing.due },
          subKpis: tree.slice(1),
        };
      });
    if (targets.length > 0) trackedByParents.push({ item: parent.item, targets });
  }

  const central = input.centralSpace && input.centralSpace.key !== input.thisSpace.key ? input.centralSpace : null;
  const parentSpaces: KpiPickerSpace[] = [];
  for (const c of chain) {
    const s = c.space;
    if (!s || s.key === input.thisSpace.key || s.key === central?.key || parentSpaces.some((p) => p.key === s.key)) continue;
    parentSpaces.push({ key: s.key, name: s.name });
  }

  return {
    thisSpace: { key: input.thisSpace.key, name: input.thisSpace.name },
    hasParents: chain.length > 0,
    trackedByParents,
    inThisSpace: toKpiOptions(
      [...pool.values()].filter((k) => spaceKeyOf(k) === input.thisSpace.key),
      input.thisSpace,
    ),
    parentSpaces,
    globalSpace: central ? { key: central.key, name: central.name } : null,
  };
}

// ── Nesting and collapsing (client) ─────────────────────────────────────────

export interface KpiTreeRow {
  option: KpiOptionDto;
  depth: number;
  hasChildren: boolean;
  /** ancestor ids within the list, nearest first */
  ancestors: string[];
}

/**
 * A list as a tree, depth-first in the list's order: each KPI's depth, whether
 * it has sub-KPIs in the list, and its ancestors. A KPI whose `parentId` isn't
 * in the list is top level (no note).
 */
export function kpiTree(options: readonly KpiOptionDto[]): KpiTreeRow[] {
  const ids = new Set(options.map((o) => o.id));
  const childrenOf = new Map<string, KpiOptionDto[]>();
  const roots: KpiOptionDto[] = [];
  for (const o of options) {
    if (o.parentId && o.parentId !== o.id && ids.has(o.parentId)) {
      childrenOf.set(o.parentId, [...(childrenOf.get(o.parentId) ?? []), o]);
    } else {
      roots.push(o);
    }
  }
  const out: KpiTreeRow[] = [];
  const placed = new Set<string>();
  const walk = (o: KpiOptionDto, ancestors: string[]) => {
    if (placed.has(o.id)) return;
    placed.add(o.id);
    const children = (childrenOf.get(o.id) ?? []).filter((c) => !placed.has(c.id));
    out.push({ option: o, depth: ancestors.length, hasChildren: children.length > 0, ancestors });
    for (const c of children) walk(c, [o.id, ...ancestors]);
  };
  for (const r of roots) walk(r, []);
  for (const o of options) if (!placed.has(o.id)) walk(o, []);
  return out;
}

/** Does a KPI match the search text (name or key, case-insensitive)? */
export function kpiMatches(option: Pick<KpiOptionDto, 'name' | 'key'>, text: string): boolean {
  const q = text.trim().toLowerCase();
  return !q || option.name.toLowerCase().includes(q) || option.key.toLowerCase().includes(q);
}

export interface VisibleKpiRow extends KpiTreeRow {
  /** its sub-KPIs are showing */
  open: boolean;
}

/**
 * The rows to draw: sub-KPIs start collapsed, and a row shows when every
 * ancestor is in `expanded`. With search text, the matches plus their
 * ancestors, every shown ancestor open ("searching opens the path").
 */
export function visibleRows(tree: readonly KpiTreeRow[], expanded: ReadonlySet<string>, text = ''): VisibleKpiRow[] {
  if (!text.trim()) {
    return tree
      .filter((r) => r.ancestors.every((a) => expanded.has(a)))
      .map((r) => ({ ...r, open: r.hasChildren && expanded.has(r.option.id) }));
  }
  const shown = new Set<string>();
  const opened = new Set<string>();
  for (const r of tree) {
    if (!kpiMatches(r.option, text)) continue;
    shown.add(r.option.id);
    for (const a of r.ancestors) {
      shown.add(a);
      opened.add(a);
    }
  }
  return tree.filter((r) => shown.has(r.option.id)).map((r) => ({ ...r, open: opened.has(r.option.id) }));
}

// ── Typed or pasted text ────────────────────────────────────────────────────

export type KpiRefInput =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  /** a whole key, typed or pasted: runs `lookupKpiRef` alongside the search */
  | { kind: 'key'; key: string; text: string }
  /** a Jira URL naming an issue (`/browse/KEY`, `?selectedIssue=KEY`): looked up only */
  | { kind: 'url'; key: string }
  /** a whole issue id (digits): runs `lookupKpiRef` alongside the search */
  | { kind: 'id'; id: string; text: string };

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

/** What the KPI field's text is: free text, a whole key or id, or a URL naming an issue. */
export function parseKpiRefInput(raw: string): KpiRefInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (KEY.test(text)) return { kind: 'key', key: text.toUpperCase(), text };
  if (/^\d{4,}$/.test(text)) return { kind: 'id', id: text, text };
  if (!/\s/.test(text) && text.includes('/')) {
    const browse = /\/browse\/([A-Z][A-Z0-9_]*-\d+)(?:[/?#]|$)/i.exec(text);
    if (browse) return { kind: 'url', key: browse[1].toUpperCase() };
    const selected = /[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)(?:[&#]|$)/i.exec(text);
    if (selected) return { kind: 'url', key: selected[1].toUpperCase() };
  }
  return { kind: 'text', text };
}

/** The key or id a ref names (for `lookupKpiRef`), or null when it's free text. */
export function kpiRefOf(input: KpiRefInput): string | null {
  if (input.kind === 'key' || input.kind === 'url') return input.key;
  if (input.kind === 'id') return input.id;
  return null;
}
