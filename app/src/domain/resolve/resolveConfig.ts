import type { RollupConfig, RollupMethod } from '../models/index.js';
import { DEFAULT_ROLLUP_METHOD, LEAF_ROLLUP_METHOD } from '../models/index.js';

/**
 * Resolve the STORED rollup config against the discovered hierarchy levels into
 * a fully-populated map (one method per level), so the Settings form and the
 * timing engine share one source of defaults. Requirements ST-1.3 / plan §3.
 *
 * @param stored config as persisted in KVS (may be sparse or empty)
 * @param levels discovered issue-type names, ordered top (deepest parent) → leaf
 * @returns `{ levelName: method }` for every level; unconfigured non-leaf →
 *   `widestRange`, the leaf level → always `parentOnly`.
 */
export function resolveConfig(
  stored: RollupConfig,
  levels: string[],
): Record<string, RollupMethod> {
  const out: Record<string, RollupMethod> = {};
  levels.forEach((level, index) => {
    const isLeaf = index === levels.length - 1;
    if (isLeaf) {
      out[level] = LEAF_ROLLUP_METHOD;
      return;
    }
    out[level] = stored.dueDateRollup[level] ?? DEFAULT_ROLLUP_METHOD;
  });
  return out;
}
