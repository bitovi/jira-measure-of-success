import { useCallback, useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import type {
  KpiFieldChoice,
  KpiFieldOption,
  KpiSetupStatus,
  KpiSpaceChoice,
  KpiSpaceSetupStatus,
  KpiWorkTypeChoice,
  SetUpCentralSpaceInput,
  SetUpKpiFieldsInput,
  SetUpKpiSpaceStepInput,
  SetUpKpiWorkTypeInput,
} from '@domain/index.js';

/**
 * Settings → KPI building blocks, Central KPI space, Using KPIs in other spaces
 * (spec 11 · 04). The resolver calls, as an object so stories can swap in an
 * in-memory site (`createKpiSetupSim`).
 */
export interface KpiSetupApi {
  getKpiSetup(): Promise<KpiSetupStatus>;
  getKpiWorkTypeChoices(): Promise<KpiWorkTypeChoice[]>;
  getKpiFieldChoices(): Promise<KpiFieldChoice[]>;
  getKpiFieldOptions(fieldId: string): Promise<KpiFieldOption[]>;
  getKpiSpaceChoices(): Promise<KpiSpaceChoice[]>;
  getKpiSpaceSetup(projectId: string): Promise<KpiSpaceSetupStatus>;
  setUpKpiWorkType(input: SetUpKpiWorkTypeInput): Promise<KpiSetupStatus>;
  setUpKpiFields(input: SetUpKpiFieldsInput): Promise<KpiSetupStatus>;
  setUpCentralSpace(input: SetUpCentralSpaceInput): Promise<KpiSetupStatus>;
  setUpKpiSpaceStep(input: SetUpKpiSpaceStepInput): Promise<KpiSpaceSetupStatus>;
  setUpEverything(input?: { key?: string }): Promise<KpiSetupStatus>;
}

export const bridgeKpiSetupApi: KpiSetupApi = {
  getKpiSetup: () => call('getKpiSetup'),
  getKpiWorkTypeChoices: () => call('getKpiWorkTypeChoices'),
  getKpiFieldChoices: () => call('getKpiFieldChoices'),
  getKpiFieldOptions: (fieldId) => call('getKpiFieldOptions', { fieldId }),
  getKpiSpaceChoices: () => call('getKpiSpaceChoices'),
  getKpiSpaceSetup: (projectId) => call('getKpiSpaceSetup', { projectId }),
  setUpKpiWorkType: (input) => call('setUpKpiWorkType', input),
  setUpKpiFields: (input) => call('setUpKpiFields', input),
  setUpCentralSpace: (input) => call('setUpCentralSpace', input),
  setUpKpiSpaceStep: (input) => call('setUpKpiSpaceStep', input),
  setUpEverything: (input) => call('setUpEverything', input ?? {}),
};

export interface KpiSetupController {
  /** null while loading */
  setup: KpiSetupStatus | null;
  error: string | null;
  /** the calls, for the pickers' lists and the per-space guide */
  api: KpiSetupApi;
  /** run a change that returns the new status, and show it (rejects with Jira's message) */
  apply(change: (api: KpiSetupApi) => Promise<KpiSetupStatus>): Promise<KpiSetupStatus>;
}

export type UseKpiSetup = () => KpiSetupController;

export function useKpiSetupData(api: KpiSetupApi = bridgeKpiSetupApi): KpiSetupController {
  const [setup, setSetup] = useState<KpiSetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getKpiSetup().then(
      (s) => alive && setSetup(s),
      (e: unknown) => alive && setError(String((e as Error)?.message ?? e)),
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const apply = useCallback(
    async (change: (a: KpiSetupApi) => Promise<KpiSetupStatus>) => {
      const next = await change(api);
      setSetup(next);
      return next;
    },
    [api],
  );

  return { setup, error, api, apply };
}
