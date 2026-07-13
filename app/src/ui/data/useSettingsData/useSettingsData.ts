import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { KpiSpaceStatus, RollupConfig } from '@domain/index.js';

/**
 * Injectable loader hook for Settings (see usePanelData.ts for the pattern).
 * Returns the loaded hierarchy levels + stored config, the KPI-space status, and
 * the save/provision actions; the form's working state lives in the component.
 */
export interface SettingsController {
  levels: string[] | null;
  config: RollupConfig | null;
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
}

export type UseSettings = () => SettingsController;

export const useSettingsData: UseSettings = () => {
  const [levels, setLevels] = useState<string[] | null>(null);
  const [config, setConfig] = useState<RollupConfig | null>(null);
  const [space, setSpace] = useState<KpiSpaceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lv, cfg, sp] = await Promise.all([
          call<string[]>('getHierarchyLevels'),
          call<RollupConfig>('getRollupConfig'),
          call<KpiSpaceStatus>('getKpiSpace'),
        ]);
        if (!alive) return;
        setLevels(lv);
        setConfig(cfg);
        setSpace(sp);
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
    return next;
  };

  return {
    levels,
    config,
    space,
    pending: levels === null && error === null,
    error,
    save,
    saveSpaceKey,
    createSpace,
  };
};
