import { kvs } from '@forge/kvs';
import {
  KpiDefinition,
  RollupConfig,
  DEFAULT_ROLLUP_METHOD,
  type KpiDefinition as KpiDefinitionT,
  type RollupConfig as RollupConfigT,
} from '@domain/index.js';

/** App-level config in Forge KVS. Brief §4.4 — single low-write-frequency doc. */
const ROLLUP_CONFIG_KEY = 'kpi:config:rollup';
/** KPI catalog — one KVS key per definition (Brief §4.1). */
const KPI_DEF_PREFIX = 'kpi:def:';
/** KVS key holding the list of catalog KPI ids (a small index). */
const KPI_CATALOG_INDEX_KEY = 'kpi:def:__index';

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

/** Read the whole KPI catalog (validated). Missing/malformed entries are skipped. */
export async function readCatalog(): Promise<KpiDefinitionT[]> {
  const index = (await kvs.get(KPI_CATALOG_INDEX_KEY)) as string[] | undefined;
  if (!Array.isArray(index)) return [];
  const defs: KpiDefinitionT[] = [];
  for (const id of index) {
    const parsed = KpiDefinition.safeParse(await kvs.get(`${KPI_DEF_PREFIX}${id}`));
    if (parsed.success && !parsed.data.archived) defs.push(parsed.data);
  }
  return defs;
}

/** Create/update a KPI definition and keep the catalog index in sync. */
export async function writeCatalogEntry(entry: unknown): Promise<KpiDefinitionT> {
  const valid = KpiDefinition.parse(entry);
  await kvs.set(`${KPI_DEF_PREFIX}${valid.id}`, valid);
  const index = ((await kvs.get(KPI_CATALOG_INDEX_KEY)) as string[] | undefined) ?? [];
  if (!index.includes(valid.id)) await kvs.set(KPI_CATALOG_INDEX_KEY, [...index, valid.id]);
  return valid;
}

export { DEFAULT_ROLLUP_METHOD };
