import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { RollupConfig } from '@domain/index.js';

/**
 * Injectable loader hook for Settings (see usePanelData.ts for the pattern).
 * Returns the loaded hierarchy levels + stored config and a save action; the
 * form's working state lives in the component.
 */
export interface SettingsController {
  levels: string[] | null;
  config: RollupConfig | null;
  pending: boolean;
  error: string | null;
  /** persists the config; resolves once saved (for the UI's save state) */
  save(config: RollupConfig): Promise<void>;
}

export type UseSettings = () => SettingsController;

export const useSettingsData: UseSettings = () => {
  const [levels, setLevels] = useState<string[] | null>(null);
  const [config, setConfig] = useState<RollupConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lv, cfg] = await Promise.all([
          call<string[]>('getHierarchyLevels'),
          call<RollupConfig>('getRollupConfig'),
        ]);
        if (!alive) return;
        setLevels(lv);
        setConfig(cfg);
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

  return {
    levels,
    config,
    pending: levels === null && error === null,
    error,
    save,
  };
};
