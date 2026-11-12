import type { HierarchyLevel, RollupConfig, RollupMethod } from '../models/index';
import { DEFAULT_ROLLUP_METHOD, LEAF_ROLLUP_METHOD, levelKey, levelSetting } from '../models/index';

/**
 * Resolve the STORED rollup config against the discovered hierarchy levels into
 * a fully-populated map (one method per level), so the Settings form and the
 * timing engine share one source of defaults. Requirements ST-1.3 / plan §3.
 *
 * @param stored config as persisted in KVS (may be sparse or empty)
 * @param levels discovered hierarchy levels, ordered top (deepest parent) → leaf
 * @returns `{ levelKey: method }` for every level; unconfigured non-leaf →
 *   `widestRange`, the leaf level → always `parentOnly`.
 */
export function resolveConfig(
  stored: RollupConfig,
  levels: HierarchyLevel[],
): Record<string, RollupMethod> {
  const out: Record<string, RollupMethod> = {};
  levels.forEach((level, index) => {
    const key = levelKey(level.level);
    const isLeaf = index === levels.length - 1;
    if (isLeaf) {
      out[key] = LEAF_ROLLUP_METHOD;
      return;
    }
    out[key] =
      levelSetting(stored.dueDateRollup, { name: level.name, hierarchyLevel: level.level }) ?? DEFAULT_ROLLUP_METHOD;
  });
  return out;
}
