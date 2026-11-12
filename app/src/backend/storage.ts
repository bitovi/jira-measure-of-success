import { kvs } from '@forge/kvs';
import {
  KpiHierarchyLink,
  RollupConfig,
  DEFAULT_ROLLUP_METHOD,
  type RollupConfig as RollupConfigT,
} from '../domain/index';

/** App-level config in Forge KVS. Brief §4.4 — single low-write-frequency doc. */
const ROLLUP_CONFIG_KEY = 'kpi:config:rollup';

/**
 * Read-only: never writes. A config saved before level keys may still be keyed by
 * issue-type NAME; the rollup engine honors those keys (`levelSetting`), and the
 * Settings page re-keys them in memory (`migrateRollupConfigToLevels`) so the
 * admin's next save stores level keys.
 */
export async function readRollupConfig(): Promise<RollupConfigT> {
  const raw = await kvs.get(ROLLUP_CONFIG_KEY);
  const parsed = RollupConfig.safeParse(raw);
  return parsed.success ? parsed.data : { dueDateRollup: {} };
}

export async function writeRollupConfig(config: unknown): Promise<RollupConfigT> {
  // Validate at the trust boundary before persisting.
  const valid = RollupConfig.parse(config);
  await kvs.set(ROLLUP_CONFIG_KEY, valid);
  return valid;
}

export { DEFAULT_ROLLUP_METHOD };

/**
 * KPI-space pointer (storage-model.md) — the project key/id where KPI issues
 * live. This is app-internal metadata (not domain data), so KVS is fine; the KPI
 * data itself lives in the project and is Jira-REST/CascadeMCP-reachable.
 */
const KPI_SPACE_KEY = 'kpi:space';

export interface KpiSpaceConfig {
  key: string | null;
  projectId: string | null;
  name: string | null;
}

export async function readKpiSpaceConfig(): Promise<KpiSpaceConfig> {
  const raw = (await kvs.get(KPI_SPACE_KEY)) as Partial<KpiSpaceConfig> | undefined;
  return { key: raw?.key ?? null, projectId: raw?.projectId ?? null, name: raw?.name ?? null };
}

export async function writeKpiSpaceConfig(cfg: KpiSpaceConfig): Promise<void> {
  await kvs.set(KPI_SPACE_KEY, cfg);
}

/**
 * KPI hierarchy link pointer — which (global) issue link type nests KPIs and
 * which of its ends is the parent. Null until an admin picks or creates one.
 */
const KPI_HIERARCHY_KEY = 'kpi:hierarchy';

export async function readKpiHierarchyConfig(): Promise<KpiHierarchyLink | null> {
  const parsed = KpiHierarchyLink.safeParse(await kvs.get(KPI_HIERARCHY_KEY));
  return parsed.success ? parsed.data : null;
}

export async function writeKpiHierarchyConfig(cfg: KpiHierarchyLink): Promise<void> {
  await kvs.set(KPI_HIERARCHY_KEY, KpiHierarchyLink.parse(cfg));
}
