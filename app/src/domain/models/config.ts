import { z } from 'zod';

/**
 * App configuration — Forge KVS, single doc under `kpi:config:rollup`.
 * Brief §4.4. Keyed by issue-type NAME discovered at runtime (not hardcoded).
 */

/** Due-date rollup methods. Brief §6.1. */
export const RollupMethod = z.enum([
  'childrenFirstThenParent', // children's range if any, else own dates
  'childrenOnly', // earliest start + latest due of children; ignore own
  'parentFirstThenChildren', // own wins per-field; children fill gaps
  'parentOnly', // never roll up; own dates only (leaf default)
  'widestRange', // default: earliest start + latest due across own + all children
]);
export type RollupMethod = z.infer<typeof RollupMethod>;

export const RollupConfig = z.object({
  /** issueTypeName -> method */
  dueDateRollup: z.record(z.string(), RollupMethod),
});
export type RollupConfig = z.infer<typeof RollupConfig>;

export const DEFAULT_ROLLUP_METHOD: RollupMethod = 'widestRange';
export const LEAF_ROLLUP_METHOD: RollupMethod = 'parentOnly';

/** Naive English pluralization sufficient for issue-type names (Story→Stories). */
export function pluralize(name: string): string {
  if (/[^aeiou]y$/i.test(name)) return name.replace(/y$/i, 'ies');
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

/**
 * The five per-level rollup option labels, wording per settings.html
 * (requirements ST-1.2). `selfName` is the level's own issue-type name;
 * `childName` is the next-deeper level's name (singular — pluralized here).
 */
export function labelsFor(selfName: string, childName: string): Record<RollupMethod, string> {
  const children = pluralize(childName);
  return {
    childrenFirstThenParent: `From ${children}, then ${selfName}`,
    childrenOnly: `From ${children}`,
    parentFirstThenChildren: `From ${selfName}, then ${children}`,
    parentOnly: `From ${selfName} only`,
    widestRange: `From ${selfName} or ${children} (earliest → latest)`,
  };
}

/** Label for the leaf level, whose control is disabled (requirements ST-2.1). */
export function leafLabel(selfName: string): string {
  return `From ${selfName} only (leaf level)`;
}
