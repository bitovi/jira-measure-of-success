import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import {
  migrateRollupConfigToLevels,
  type DateFieldCatalog,
  type HierarchyLevel,
  type KpiHierarchyStatus,
  type RollupConfig,
  type SaveKpiHierarchyInput,
} from '@domain/index.js';

/**
 * Injectable loader hook for Settings (see usePanelData.ts for the pattern).
 * Returns the loaded hierarchy levels + stored config, the KPI hierarchy link,
 * and their save actions; the form's working state lives in the component.
 * The KPI building blocks and central space load through `useKpiSetupData`.
 */
export interface SettingsController {
  /** the site's hierarchy levels, top → leaf; settings are keyed by `levelKey(level.level)` */
  levels: HierarchyLevel[] | null;
  config: RollupConfig | null;
  /** pickable date fields + site defaults; null while loading or if the lookup failed */
  dateFields: DateFieldCatalog | null;
  pending: boolean;
  error: string | null;
  /** persists the config; resolves once saved (for the UI's save state) */
  save(config: RollupConfig): Promise<void>;
  /** which issue link type nests KPIs; null while loading */
  hierarchy: KpiHierarchyStatus | null;
  /** use an existing link type (and which end is the parent) to nest KPIs */
  saveHierarchy(input: SaveKpiHierarchyInput): Promise<KpiHierarchyStatus>;
  /** create (or adopt) the app's own `KPI Hierarchy` link type and use it */
  createHierarchyLinkType(): Promise<KpiHierarchyStatus>;
  /** re-read the hierarchy (setting up a central space also sets up nesting) */
  reloadHierarchy(): Promise<void>;
}

export type UseSettings = () => SettingsController;

export const useSettingsData: UseSettings = () => {
  const [levels, setLevels] = useState<HierarchyLevel[] | null>(null);
  const [config, setConfig] = useState<RollupConfig | null>(null);
  const [dateFields, setDateFields] = useState<DateFieldCatalog | null>(null);
  const [hierarchy, setHierarchy] = useState<KpiHierarchyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lv, cfg, df, hi] = await Promise.all([
          call<HierarchyLevel[]>('getHierarchyLevels'),
          call<RollupConfig>('getRollupConfig'),
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

  const reloadHierarchy = async (): Promise<void> => {
    setHierarchy(await call<KpiHierarchyStatus>('getKpiHierarchy'));
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
    pending: levels === null && error === null,
    error,
    save,
    hierarchy,
    saveHierarchy,
    createHierarchyLinkType,
    reloadHierarchy,
  };
};
