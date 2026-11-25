import {
  KpiSiteConfig,
  kpiSiteConfigFrom,
  type KpiFieldsConfig,
  parseStoredKpiSiteConfig,
  type KpiSiteConfig as KpiSiteConfigT,
} from '../domain/index';
import { findProject, listIssueTypes } from './jira';
import { perInvocation } from './requestLog';
import {
  KPI_SITE_CONFIG_CACHE_KEY,
  readKpiHierarchyConfig,
  readKpiSpaceConfig,
  readStoredKpiSiteConfig,
  writeKpiHierarchyConfig,
  writeKpiSpaceConfig,
  writeStoredKpiSiteConfig,
} from './storage';

/**
 * The KPI site configuration (spec 11 · 04). `readKpiSiteConfig()` is the only
 * way backend code learns the KPI work type and the unit/direction field ids.
 */

export interface LoadedKpiSiteConfig {
  config: KpiSiteConfigT;
  /** false = nothing saved yet: derived from `kpi:space`, `kpi:hierarchy` and the type named KPI */
  saved: boolean;
}

/** The configuration and whether it was saved, read once per invocation. */
export function loadKpiSiteConfig(): Promise<LoadedKpiSiteConfig> {
  return perInvocation(KPI_SITE_CONFIG_CACHE_KEY, async () => {
    const [stored, legacySpace, hierarchy] = await Promise.all([
      readStoredKpiSiteConfig(),
      readKpiSpaceConfig(),
      readKpiHierarchyConfig(),
    ]);
    let space = legacySpace;
    // A space connected by key before its project existed: resolve it, as the timeline does.
    if (space.key && !space.projectId) {
      const project = await findProject(space.key).catch(() => null);
      if (project) space = { key: space.key, projectId: project.id, name: project.name };
    }
    // The work type is only derived (the type named KPI) when nothing is saved yet.
    const issueTypes = parseStoredKpiSiteConfig(stored) ? null : await listIssueTypes().catch(() => null);
    return kpiSiteConfigFrom({ stored, space, hierarchy, issueTypes });
  });
}

/** The install's KPI configuration (saved, or derived from an older install's records). */
export async function readKpiSiteConfig(): Promise<KpiSiteConfigT> {
  return (await loadKpiSiteConfig()).config;
}

/**
 * Just the unit/direction fields (null until chosen, spec 11 · 05). Fields are
 * only ever set in the saved record, so this reads KVS alone: no Jira request,
 * unlike `readKpiSiteConfig` on an install with nothing saved.
 */
export async function readKpiFieldsConfig(): Promise<KpiFieldsConfig | null> {
  return parseStoredKpiSiteConfig(await readStoredKpiSiteConfig())?.fields ?? null;
}

export type KpiSiteConfigPatch = Partial<KpiSiteConfigT>;

/**
 * Change part of the configuration. Work type, fields and schemes go to
 * `kpi:config:site` (saving the derived parts with them, so the work type an
 * older install had is kept); the central space and hierarchy to their own
 * records. Validated whole before anything is written.
 */
export async function writeKpiSiteConfig(patch: KpiSiteConfigPatch): Promise<KpiSiteConfigT> {
  const { config } = await loadKpiSiteConfig();
  const next = KpiSiteConfig.parse({ ...config, ...patch });
  if ('workType' in patch || 'fields' in patch || 'schemes' in patch) {
    await writeStoredKpiSiteConfig({ workType: next.workType, fields: next.fields, schemes: next.schemes });
  }
  if ('centralSpace' in patch && next.centralSpace) {
    const { key, projectId, name } = next.centralSpace;
    await writeKpiSpaceConfig({ key, projectId, name });
  }
  if ('hierarchy' in patch && next.hierarchy) await writeKpiHierarchyConfig(next.hierarchy);
  return next;
}
