import { z } from 'zod';

/**
 * App configuration — Forge KVS, single doc under `kpi:config:rollup`.
 * Brief §4.4. Keyed by Jira HIERARCHY LEVEL (`issuetype.hierarchyLevel`, as a
 * string — e.g. `"2"`), so every issue type at a level (Milestone AND
 * Increment) shares the level's settings. Configs saved before this were keyed
 * by issue-type name; those keys are migrated on read and still honored as a
 * fallback (see `levelSetting`).
 */

/** One level of the site's issue-type hierarchy, as Settings shows it. */
export interface HierarchyLevel {
  /** Jira `hierarchyLevel` (0 = Story/Task level, 1 = Epic, higher = parents) */
  level: number;
  /** representative issue-type name, used in option wording ("From Epics") */
  name: string;
  /** every issue type at this level, `name` first */
  issueTypeNames: string[];
}

/** The config-map key for a hierarchy level. */
export function levelKey(level: number): string {
  return String(level);
}

/** "Milestone / Increment" — every issue type the level's settings apply to. */
export function levelLabel(level: HierarchyLevel): string {
  return level.issueTypeNames.join(' / ');
}

/** The minimal issue-type info needed to find its level's settings. */
export interface IssueTypeRef {
  name: string;
  hierarchyLevel: number | null;
}

/**
 * The setting for an issue's level: the level key wins; a legacy
 * issue-type-name key is the fallback (configs saved before level keys).
 */
export function levelSetting<T>(
  map: Record<string, T> | undefined,
  issueType: IssueTypeRef,
): T | undefined {
  if (!map) return undefined;
  const byLevel = issueType.hierarchyLevel != null ? map[levelKey(issueType.hierarchyLevel)] : undefined;
  return byLevel ?? map[issueType.name];
}

const isLevelKey = (key: string): boolean => /^-?\d+$/.test(key);

/**
 * Re-key a config's legacy issue-type-NAME entries by hierarchy level. An
 * existing level entry wins over a legacy one; names not found at any level
 * (deleted/renamed types) are dropped. Pass the site's full level list — an
 * empty list means it couldn't be read, and nothing is changed. Idempotent —
 * returns the same object when there was nothing to migrate.
 */
export function migrateRollupConfigToLevels(config: RollupConfig, levels: HierarchyLevel[]): RollupConfig {
  if (levels.length === 0) return config;
  const levelOf = new Map<string, number>();
  for (const l of levels) for (const n of l.issueTypeNames) levelOf.set(n, l.level);

  let changed = false;
  const migrate = <T>(map: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!map) return map;
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(map)) if (isLevelKey(key)) out[key] = value;
    for (const [key, value] of Object.entries(map)) {
      if (isLevelKey(key)) continue;
      changed = true;
      const level = levelOf.get(key);
      if (level !== undefined) out[levelKey(level)] ??= value;
    }
    return out;
  };

  const dueDateRollup = migrate(config.dueDateRollup) ?? {};
  const dateFields = migrate(config.dateFields);
  if (!changed) return config;
  return { ...config, dueDateRollup, ...(dateFields ? { dateFields } : {}) };
}

/** True when the config still has issue-type-name keys (pre-level configs). */
export function hasLegacyRollupKeys(config: RollupConfig): boolean {
  return [...Object.keys(config.dueDateRollup), ...Object.keys(config.dateFields ?? {})].some(
    (k) => !isLevelKey(k),
  );
}

/** Due-date rollup methods. Brief §6.1. */
export const RollupMethod = z.enum([
  'childrenFirstThenParent', // children's range if any, else own dates
  'childrenOnly', // earliest start + latest due of children; ignore own
  'parentFirstThenChildren', // own wins per-field; children fill gaps
  'parentOnly', // never roll up; own dates only (leaf default)
  'widestRange', // default: earliest start + latest due across own + all children
]);
export type RollupMethod = z.infer<typeof RollupMethod>;

/**
 * Which Jira date fields an issue type's own start/due dates are read from
 * (field ids, e.g. `duedate`, `customfield_10015`). Omitted endpoints use the
 * site defaults ("Start date" / "Due date").
 */
export const DateFieldChoice = z.object({
  start: z.string().min(1).optional(),
  due: z.string().min(1).optional(),
});
export type DateFieldChoice = z.infer<typeof DateFieldChoice>;

export const RollupConfig = z.object({
  /** levelKey(hierarchyLevel) -> method */
  dueDateRollup: z.record(z.string(), RollupMethod),
  /** levelKey(hierarchyLevel) -> the date fields to read for that level (default Start date / Due date) */
  dateFields: z.record(z.string(), DateFieldChoice).optional(),
  /**
   * Optional rollup DEPTH CAP (Feature 03, FR-19): how many hierarchy levels
   * below the queried issue due-date rollup may descend. `0` = own date only;
   * `1` = immediate children only; unset/null = no cap (correct but potentially
   * slow on large sites). Bounds fan-out cost per requirements §5.7.
   */
  depthCap: z.number().int().nonnegative().nullable().optional(),
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
