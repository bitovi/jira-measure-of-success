import { call } from '@ui/bridge.js';
import type {
  KpiCurrentValue,
  KpiOptionDto,
  KpiRefLookup,
  ListKpiSpacesResult,
  SearchKpisResult,
} from '@domain/index.js';

/**
 * The KPI picker's lazy loads (spec 11 · 07): each view that isn't loaded with
 * the panel, the search, the Space filter's list, a pasted key's lookup and the
 * picked KPI's current value. Injectable so stories and tests swap in canned data.
 */
export interface KpiPickerApi {
  listKpisInSpaces(projectKeys: string[]): Promise<KpiOptionDto[]>;
  searchKpis(text: string, projectKey?: string): Promise<SearchKpisResult>;
  listKpiSpaces(query: string, startAt?: number): Promise<ListKpiSpacesResult>;
  lookupKpiRef(ref: string): Promise<KpiRefLookup>;
  getKpiCurrentValue(kpiId: string): Promise<KpiCurrentValue>;
}

/** The real loads: the picker's resolvers. */
export const bridgeKpiPickerApi: KpiPickerApi = {
  listKpisInSpaces: (projectKeys) => call<KpiOptionDto[]>('listKpisInSpaces', { projectKeys }),
  searchKpis: (text, projectKey) => call<SearchKpisResult>('searchKpis', { text, ...(projectKey ? { projectKey } : {}) }),
  listKpiSpaces: (query, startAt = 0) => call<ListKpiSpacesResult>('listKpiSpaces', { query, startAt }),
  lookupKpiRef: (ref) => call<KpiRefLookup>('lookupKpiRef', { ref }),
  getKpiCurrentValue: (kpiId) => call<KpiCurrentValue>('getKpiCurrentValue', { kpiId }),
};

/**
 * Remember every load for the life of the picker (re-opening a view or
 * re-running a search makes no new request). A failed load is forgotten so
 * it can be retried.
 */
export function cachedKpiPickerApi(api: KpiPickerApi): KpiPickerApi {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const pending = load();
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  };
  return {
    listKpisInSpaces: (keys) => once(`spaces:${[...keys].sort().join(',')}`, () => api.listKpisInSpaces(keys)),
    searchKpis: (text, projectKey) =>
      once(`search:${projectKey ?? ''}:${text.trim().toLowerCase()}`, () => api.searchKpis(text.trim(), projectKey)),
    listKpiSpaces: (query, startAt = 0) =>
      once(`spaceList:${startAt}:${query.trim().toLowerCase()}`, () => api.listKpiSpaces(query.trim(), startAt)),
    lookupKpiRef: (ref) => once(`lookup:${ref.toUpperCase()}`, () => api.lookupKpiRef(ref)),
    getKpiCurrentValue: (kpiId) => once(`value:${kpiId}`, () => api.getKpiCurrentValue(kpiId)),
  };
}
