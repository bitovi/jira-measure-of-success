import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { call } from '@ui/bridge.js';
import type { KpiAccessResult, KpiSpaceAccess } from '@domain/index.js';
import { createKpiAccessCache, type FetchKpiAccess, type KpiAccessState } from './kpiAccessCache.js';

/** The real lookup: the `getKpiAccess` resolver (one `mypermissions` call for that space). */
export const bridgeFetchKpiAccess: FetchKpiAccess = async (projectKey) =>
  (await call<KpiAccessResult>('getKpiAccess', { projectKey })).access;

/**
 * Per-space KPI permissions for a surface (spec 11 · 06): the Timeline and
 * the issue panel look a space's access up the first time one of its KPI's
 * actions is used, and remember it for the page session.
 */
export interface KpiAccessController {
  /** the space's state (undefined: not asked yet, or the lookup failed) */
  stateOf(projectKey: string | null | undefined): KpiAccessState | undefined;
  /** the space's access once known, else null (unknown: everything stays enabled) */
  accessOf(projectKey: string | null | undefined): KpiSpaceAccess | null;
  /** the id of the action waiting on its space's access (its busy state), or null */
  pendingAction: string | null;
  /** why the last action was refused (shown instead of its dialog), or null */
  refusal: string | null;
  dismissRefusal(): void;
  /**
   * Run `proceed` once the space's access allows it. `reasonFor` turns the
   * space's access (null = unknown) into why the action is refused, or null.
   * Asks for the space's access first when it isn't known (`actionId` is busy
   * meanwhile); a refused action shows its reason instead. A failed lookup
   * lets the action go ahead: Jira's own refusal explains it.
   */
  guard(
    actionId: string,
    projectKey: string | null | undefined,
    reasonFor: (access: KpiSpaceAccess | null) => string | null,
    proceed: () => void,
  ): void;
}

/**
 * `fetchAccess` undefined (a story or test without a lookup): access stays
 * unknown and every action goes ahead at once.
 */
export function useKpiAccess(fetchAccess?: FetchKpiAccess): KpiAccessController {
  const [cache] = useState(() => createKpiAccessCache((key) => (fetchAccess ? fetchAccess(key) : Promise.resolve(null))));
  const versionRef = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) =>
      cache.subscribe(() => {
        versionRef.current += 1;
        onChange();
      }),
    [cache],
  );
  useSyncExternalStore(subscribe, () => versionRef.current);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const stateOf = (projectKey: string | null | undefined) => (projectKey ? cache.get(projectKey) : undefined);
  const accessOf = (projectKey: string | null | undefined) => {
    const state = stateOf(projectKey);
    return state?.status === 'ready' ? state.access : null;
  };

  const guard: KpiAccessController['guard'] = (actionId, projectKey, reasonFor, proceed) => {
    const decide = (access: KpiSpaceAccess | null) => {
      const reason = reasonFor(access);
      if (reason) setRefusal(reason);
      else proceed();
    };
    setRefusal(null);
    const known = accessOf(projectKey);
    if (!projectKey || known || !fetchAccess) return decide(known);
    setPendingAction(actionId);
    void cache.load(projectKey).then((access) => {
      setPendingAction((current) => (current === actionId ? null : current));
      decide(access);
    });
  };

  return { stateOf, accessOf, pendingAction, refusal, dismissRefusal: () => setRefusal(null), guard };
}
