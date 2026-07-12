import type { IsoDate, RollupConfig, RollupMethod } from '../models/index.js';
import { DEFAULT_ROLLUP_METHOD, LEAF_ROLLUP_METHOD } from '../models/index.js';

/**
 * Effective due-date resolution — Brief §6.1.
 *
 * Pure, recursive, memoized. Resolves an issue's effective due date bottom-up
 * using the per-level rollup method. Aggregation across children = LATEST child
 * (a parent finishes when its last child finishes). ISO date strings compare
 * chronologically, so `max` is a lexical string max.
 *
 * Guards against cycles and caps depth (hierarchy is <=5; cap at 10).
 */
export interface HierarchyNode {
  id: string;
  issueKey: string;
  issueTypeName: string;
  ownDueDate: IsoDate | null;
  childIds: string[];
}

export interface EffectiveDueDate {
  /** null => pending (no own date and no dated descendants) */
  date: IsoDate | null;
  source: 'own' | 'children' | 'pending';
  /** the determining child's key, when source === 'children' */
  fromIssueKey?: string;
}

const MAX_DEPTH = 10;
const PENDING: EffectiveDueDate = { date: null, source: 'pending' };

function methodFor(node: HierarchyNode, config: RollupConfig): RollupMethod {
  const configured = config.dueDateRollup[node.issueTypeName];
  if (configured) return configured;
  return node.childIds.length === 0 ? LEAF_ROLLUP_METHOD : DEFAULT_ROLLUP_METHOD;
}

/** Latest (max) of the resolved children; null when no child has a date. */
function latestChild(
  node: HierarchyNode,
  nodes: Map<string, HierarchyNode>,
  config: RollupConfig,
  memo: Map<string, EffectiveDueDate>,
  seen: Set<string>,
  depth: number,
): { date: IsoDate | null; fromIssueKey?: string } {
  let best: IsoDate | null = null;
  let fromIssueKey: string | undefined;
  for (const childId of node.childIds) {
    const child = nodes.get(childId);
    if (!child) continue;
    const resolved = resolve(childId, nodes, config, memo, seen, depth + 1);
    if (resolved.date !== null && (best === null || resolved.date > best)) {
      best = resolved.date;
      fromIssueKey = child.issueKey;
    }
  }
  return { date: best, fromIssueKey };
}

function resolve(
  id: string,
  nodes: Map<string, HierarchyNode>,
  config: RollupConfig,
  memo: Map<string, EffectiveDueDate>,
  seen: Set<string>,
  depth: number,
): EffectiveDueDate {
  const cached = memo.get(id);
  if (cached) return cached;

  const node = nodes.get(id);
  if (!node || depth > MAX_DEPTH || seen.has(id)) return PENDING;

  seen.add(id);
  const method = methodFor(node, config);
  const own = node.ownDueDate;

  let result: EffectiveDueDate;
  const children = () => latestChild(node, nodes, config, memo, seen, depth);

  switch (method) {
    case 'parentOnly': {
      result = own ? { date: own, source: 'own' } : PENDING;
      break;
    }
    case 'childrenOnly': {
      const c = children();
      result = c.date
        ? { date: c.date, source: 'children', fromIssueKey: c.fromIssueKey }
        : PENDING;
      break;
    }
    case 'childrenFirstThenParent': {
      const c = children();
      if (c.date) result = { date: c.date, source: 'children', fromIssueKey: c.fromIssueKey };
      else if (own) result = { date: own, source: 'own' };
      else result = PENDING;
      break;
    }
    case 'parentFirstThenChildren': {
      if (own) result = { date: own, source: 'own' };
      else {
        const c = children();
        result = c.date
          ? { date: c.date, source: 'children', fromIssueKey: c.fromIssueKey }
          : PENDING;
      }
      break;
    }
    case 'widestRange': {
      const c = children();
      const candidates: Array<{ date: IsoDate; source: 'own' | 'children'; key?: string }> = [];
      if (own) candidates.push({ date: own, source: 'own' });
      if (c.date) candidates.push({ date: c.date, source: 'children', key: c.fromIssueKey });
      if (candidates.length === 0) result = PENDING;
      else {
        const widest = candidates.reduce((a, b) => (b.date > a.date ? b : a));
        result = { date: widest.date, source: widest.source, fromIssueKey: widest.key };
      }
      break;
    }
  }

  seen.delete(id);
  memo.set(id, result);
  return result;
}

/**
 * Resolve the effective due date for one issue.
 * @param memo pass a shared Map to memoize across calls within one render.
 */
export function effectiveDueDate(
  issueId: string,
  nodes: Map<string, HierarchyNode>,
  config: RollupConfig,
  memo: Map<string, EffectiveDueDate> = new Map(),
): EffectiveDueDate {
  return resolve(issueId, nodes, config, memo, new Set(), 0);
}
