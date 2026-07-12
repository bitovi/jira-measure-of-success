import type { IsoDate, RollupConfig, RollupMethod } from '../models/index.js';
import { DEFAULT_ROLLUP_METHOD, LEAF_ROLLUP_METHOD } from '../models/index.js';

/**
 * Effective TIMING resolution — Brief §6.1, requirements §5.2.
 *
 * Generalizes `effectiveDueDate` to roll up a `{ start, due }` RANGE, ported in
 * spirit from Bitovi's `jira-timeline-report` (`src/jira/rollup/dates/dates.ts`)
 * — aggregation across children = EARLIEST child start + LATEST child due
 * (`mergeStartAndDueData`). Pure, recursive, memoized, cycle-guarded.
 *
 * ISO date strings compare chronologically, so earliest = lexical min and
 * latest = lexical max. v1 surfaces read `.due` where a single date is needed.
 */
export interface TimingNode {
  id: string;
  issueKey: string;
  issueTypeName: string;
  ownStart: IsoDate | null;
  ownDue: IsoDate | null;
  childIds: string[];
}

export interface ResolvedEndpoint {
  /** null => pending (no own date and no dated descendants) */
  date: IsoDate | null;
  source: 'own' | 'children' | 'pending';
  /** the determining child's key, when source === 'children' */
  fromIssueKey?: string;
}

export interface EffectiveTiming {
  start: ResolvedEndpoint;
  due: ResolvedEndpoint;
}

type Endpoint = 'start' | 'due';

const MAX_DEPTH = 10;
const PENDING: ResolvedEndpoint = { date: null, source: 'pending' };

function methodFor(node: TimingNode, config: RollupConfig): RollupMethod {
  const configured = config.dueDateRollup[node.issueTypeName];
  if (configured) return configured;
  return node.childIds.length === 0 ? LEAF_ROLLUP_METHOD : DEFAULT_ROLLUP_METHOD;
}

/** `start` keeps the earliest date; `due` keeps the latest. */
function isBetter(endpoint: Endpoint, candidate: IsoDate, current: IsoDate): boolean {
  return endpoint === 'due' ? candidate > current : candidate < current;
}

function resolve(
  id: string,
  endpoint: Endpoint,
  nodes: Map<string, TimingNode>,
  config: RollupConfig,
  memo: Map<string, ResolvedEndpoint>,
  seen: Set<string>,
  depth: number,
): ResolvedEndpoint {
  const memoKey = `${endpoint}:${id}`;
  const cached = memo.get(memoKey);
  if (cached) return cached;

  const node = nodes.get(id);
  if (!node || depth > MAX_DEPTH || seen.has(id)) return PENDING;

  seen.add(id);
  const method = methodFor(node, config);
  const own = endpoint === 'due' ? node.ownDue : node.ownStart;

  const children = (): { date: IsoDate | null; fromIssueKey?: string } => {
    let best: IsoDate | null = null;
    let fromIssueKey: string | undefined;
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (!child) continue;
      const resolved = resolve(childId, endpoint, nodes, config, memo, seen, depth + 1);
      if (resolved.date !== null && (best === null || isBetter(endpoint, resolved.date, best))) {
        best = resolved.date;
        fromIssueKey = child.issueKey;
      }
    }
    return { date: best, fromIssueKey };
  };

  let result: ResolvedEndpoint;
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
        const widest = candidates.reduce((a, b) => (isBetter(endpoint, b.date, a.date) ? b : a));
        result = { date: widest.date, source: widest.source, fromIssueKey: widest.key };
      }
      break;
    }
  }

  seen.delete(id);
  memo.set(memoKey, result);
  return result;
}

/**
 * Resolve the effective `{ start, due }` timing for one issue.
 * @param memo pass a shared Map to memoize across calls within one render.
 */
export function effectiveTiming(
  issueId: string,
  nodes: Map<string, TimingNode>,
  config: RollupConfig,
  memo: Map<string, ResolvedEndpoint> = new Map(),
): EffectiveTiming {
  return {
    start: resolve(issueId, 'start', nodes, config, memo, new Set(), 0),
    due: resolve(issueId, 'due', nodes, config, memo, new Set(), 0),
  };
}
