import type { TimelineNodeDto, TimelineTargetDto } from '@domain/index.js';

/**
 * Plot key vocabulary (spec 08). Every mark the plot draws belongs to one or more
 * key "kinds"; the key bar lists the kinds present (with counts) and, when one is
 * hovered or pinned, every mark NOT of that kind is dimmed.
 *
 * Target kinds:
 *  - `hit` / `missed` — the target's status (a past-due relative target that is
 *    still an estimate keeps its hit/missed status; its error bar says "may change");
 *  - `upcoming-fixed` / `upcoming-relative` — upcoming targets split by whether the
 *    value is an estimate. A future relative target is always an estimate and a
 *    fixed target never is, so `provisional` cleanly separates the two;
 *  - `undated` — pending targets shown in the Undated lane (counted only there);
 *  - `type:<issue type>` — the source issue's type, for the per-type entries.
 */
export type TypeKeyKind = `type:${string}`;
export type KeyKind =
  | 'recorded'
  | 'projection'
  | 'hit'
  | 'missed'
  | 'upcoming-fixed'
  | 'upcoming-relative'
  | 'undated'
  | TypeKeyKind;

export const typeKind = (type: string): TypeKeyKind => `type:${type}`;

/** The key kinds a DATED target marker belongs to. */
export function targetKeyKinds(t: TimelineTargetDto): KeyKind[] {
  const status: KeyKind =
    t.status === 'hit'
      ? 'hit'
      : t.status === 'missed'
        ? 'missed'
        : t.provisional
          ? 'upcoming-relative'
          : 'upcoming-fixed';
  return [status, typeKind(t.source.type)];
}

/** The key kinds an UNDATED target chip belongs to. */
export function undatedKeyKinds(t: TimelineTargetDto): KeyKind[] {
  return ['undated', typeKind(t.source.type)];
}

export interface KeyTypeEntry {
  /** issue type display name, e.g. "Epic" */
  type: string;
  /** a same-origin `data:` icon for the type, when one is available */
  iconUrl: string | null;
  count: number;
}

export interface KeySummary {
  /** any KPI has at least one recorded value */
  recorded: boolean;
  /** any KPI has a projected trend (≥ 2 recorded values) */
  projection: boolean;
  counts: Record<'hit' | 'missed' | 'upcoming-fixed' | 'upcoming-relative' | 'undated', number>;
  /** distinct source-issue types across dated + undated targets, most common first */
  types: KeyTypeEntry[];
}

/** Every node in the given trees (depth-first), INCLUDING collapsed descendants. */
export function flattenNodes(roots: readonly TimelineNodeDto[]): TimelineNodeDto[] {
  const out: TimelineNodeDto[] = [];
  const walk = (nodes: readonly TimelineNodeDto[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Summarize what the key should list for exactly these nodes (no recursion). */
export function summarizeKey(nodes: readonly TimelineNodeDto[]): KeySummary {
  const counts: KeySummary['counts'] = {
    hit: 0,
    missed: 0,
    'upcoming-fixed': 0,
    'upcoming-relative': 0,
    undated: 0,
  };
  const types = new Map<string, KeyTypeEntry>();
  const addType = (t: TimelineTargetDto) => {
    const entry = types.get(t.source.type) ?? { type: t.source.type, iconUrl: null, count: 0 };
    entry.count += 1;
    const icon = t.source.iconUrl;
    if (!entry.iconUrl && icon && icon.startsWith('data:')) entry.iconUrl = icon;
    types.set(t.source.type, entry);
  };

  let recorded = false;
  let projection = false;
  for (const node of nodes) {
    if (node.readings.length > 0) recorded = true;
    if (node.readings.length > 1) projection = true;
    for (const t of node.targets) {
      if (t.date === null) continue;
      counts[targetKeyKinds(t)[0] as keyof KeySummary['counts']] += 1;
      addType(t);
    }
    for (const t of node.undated) {
      counts.undated += 1;
      addType(t);
    }
  }

  return {
    recorded,
    projection,
    counts,
    types: [...types.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}
