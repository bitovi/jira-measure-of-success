import { kvs } from '@forge/kvs';
import {
  RollupConfig,
  DEFAULT_ROLLUP_METHOD,
  type RollupConfig as RollupConfigT,
} from '../domain/index';

/** App-level config in Forge KVS. Brief §4.4 — single low-write-frequency doc. */
const ROLLUP_CONFIG_KEY = 'kpi:config:rollup';

export async function readRollupConfig(): Promise<RollupConfigT> {
  const raw = await kvs.get(ROLLUP_CONFIG_KEY);
  const parsed = RollupConfig.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { dueDateRollup: {} };
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
