import type { KpiSpaceAccess } from '@domain/index.js';

/**
 * Where a space's KPI permissions stand on this page (spec 11 · 06): asked for
 * the first time an action needs them, then remembered for the page session.
 */
export type KpiAccessState = { status: 'loading' } | { status: 'ready'; access: KpiSpaceAccess };

/** Ask the backend for one space's access; null when Jira couldn't answer (the action goes ahead). */
export type FetchKpiAccess = (projectKey: string) => Promise<KpiSpaceAccess | null>;

export interface KpiAccessCache {
  /** the space's state; undefined when it was never asked (or the last lookup failed) */
  get(projectKey: string): KpiAccessState | undefined;
  /**
   * The space's access, asking at most once per space: callers while a lookup
   * is in flight share it. null when it couldn't be looked up; a failed lookup
   * isn't remembered, so the next action asks again.
   */
  load(projectKey: string): Promise<KpiSpaceAccess | null>;
  /** called whenever a space's state changes */
  subscribe(listener: () => void): () => void;
}

export function createKpiAccessCache(fetchAccess: FetchKpiAccess): KpiAccessCache {
  const states = new Map<string, KpiAccessState>();
  const inFlight = new Map<string, Promise<KpiSpaceAccess | null>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  return {
    get: (projectKey) => states.get(projectKey),
    load(projectKey) {
      const known = states.get(projectKey);
      if (known?.status === 'ready') return Promise.resolve(known.access);
      const pending = inFlight.get(projectKey);
      if (pending) return pending;
      states.set(projectKey, { status: 'loading' });
      notify();
      const request = fetchAccess(projectKey)
        .catch(() => null)
        .then((access) => {
          inFlight.delete(projectKey);
          if (access) states.set(projectKey, { status: 'ready', access });
          else states.delete(projectKey);
          notify();
          return access;
        });
      inFlight.set(projectKey, request);
      return request;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
