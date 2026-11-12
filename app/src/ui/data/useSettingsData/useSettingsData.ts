import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import {
  migrateRollupConfigToLevels,
  type DateFieldCatalog,
  type HierarchyLevel,
  type KpiHierarchyStatus,
  type KpiSpaceStatus,
  type RollupConfig,
  type SaveKpiHierarchyInput,
} from '@domain/index.js';

/**
 * Injectable loader hook for Settings (see usePanelData.ts for the pattern).
 * Returns the loaded hierarchy levels + stored config, the KPI-space status, and
 * the save/provision actions; the form's working state lives in the component.
 */
export interface SettingsController {
  /** the site's hierarchy levels, top → leaf; settings are keyed by `levelKey(level.level)` */
  levels: HierarchyLevel[] | null;
  config: RollupConfig | null;
  /** pickable date fields + site defaults; null while loading or if the lookup failed */
  dateFields: DateFieldCatalog | null;
  /** KPI space status (storage-model.md); null while loading. */
  space: KpiSpaceStatus | null;
  pending: boolean;
  error: string | null;
  /** persists the config; resolves once saved (for the UI's save state) */
  save(config: RollupConfig): Promise<void>;
  /** set/confirm the KPI-space project key (does not create the project) */
  saveSpaceKey(key: string): Promise<KpiSpaceStatus>;
  /** create (or connect) the KPI project for the given key */
  createSpace(key: string): Promise<KpiSpaceStatus>;
  /** which issue link type nests KPIs; null while loading */
  hierarchy: KpiHierarchyStatus | null;
  /** use an existing link type (and which end is the parent) to nest KPIs */
  saveHierarchy(input: SaveKpiHierarchyInput): Promise<KpiHierarchyStatus>;
  /** create (or adopt) the app's own `KPI Hierarchy` link type and use it */
  createHierarchyLinkType(): Promise<KpiHierarchyStatus>;
}

export type UseSettings = () => SettingsController;

export const useSettingsData: UseSettings = () => {
  const [levels, setLevels] = useState<HierarchyLevel[] | null>(null);
  const [config, setConfig] = useState<RollupConfig | null>(null);
  const [dateFields, setDateFields] = useState<DateFieldCatalog | null>(null);
  const [space, setSpace] = useState<KpiSpaceStatus | null>(null);
  const [hierarchy, setHierarchy] = useState<KpiHierarchyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lv, cfg, sp, df, hi] = await Promise.all([
          call<HierarchyLevel[]>('getHierarchyLevels'),
          call<RollupConfig>('getRollupConfig'),
          call<KpiSpaceStatus>('getKpiSpace'),
          // best-effort: without the field list the rollup methods still work
          call<DateFieldCatalog>('getDateFields').catch(() => null),
          call<KpiHierarchyStatus>('getKpiHierarchy'),
        ]);
        if (!alive) return;
        setLevels(lv);
        // Settings saved before level keys are keyed by issue-type name; re-key them
        // here (in memory) so the form shows them and the next save stores level keys.
        setConfig(migrateRollupConfigToLevels(cfg, lv));
        setDateFields(df);
        setSpace(sp);
        setHierarchy(hi);
      } catch (e: unknown) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (next: RollupConfig): Promise<void> => {
    await call('saveRollupConfig', { config: next });
    setConfig(next);
  };

  const saveSpaceKey = async (key: string): Promise<KpiSpaceStatus> => {
    const next = await call<KpiSpaceStatus>('saveKpiSpaceKey', { key });
    setSpace(next);
    return next;
  };

  const createSpace = async (key: string): Promise<KpiSpaceStatus> => {
    const next = await call<KpiSpaceStatus>('createKpiSpace', { key });
    setSpace(next);
    // Creating the space also sets up KPI nesting when it wasn't yet.
    setHierarchy(await call<KpiHierarchyStatus>('getKpiHierarchy'));
    return next;
  };

  const saveHierarchy = async (input: SaveKpiHierarchyInput): Promise<KpiHierarchyStatus> => {
    const next = await call<KpiHierarchyStatus>('saveKpiHierarchy', input);
    setHierarchy(next);
    return next;
  };

  const createHierarchyLinkType = async (): Promise<KpiHierarchyStatus> => {
    const next = await call<KpiHierarchyStatus>('createKpiHierarchyLinkType');
    setHierarchy(next);
    return next;
  };

  return {
    levels,
    config,
    dateFields,
    space,
    pending: levels === null && error === null,
    error,
    save,
    saveSpaceKey,
    createSpace,
    hierarchy,
    saveHierarchy,
    createHierarchyLinkType,
  };
};
