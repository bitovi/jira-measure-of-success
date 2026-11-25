/**
 * The Timeline's filters, remembered in the browser (spec 11 · 08): the KPI
 * space filter and Work from. Custom UI runs in a third-party iframe, where
 * storage can be partitioned, cleared or blocked; then nothing is remembered
 * and the page opens on all KPIs.
 */
export interface TimelineFilters {
  /** KPI space keys; empty = all KPIs */
  spaces: string[];
  /** projects of the work items that set targets; empty = all */
  workFrom: string[];
}

export interface TimelineFilterStore {
  read(): TimelineFilters | null;
  write(filters: TimelineFilters): void;
}

export const TIMELINE_FILTERS_KEY = 'kpi-timeline:filters';

const keyList = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];

/** Parse what was stored; anything unexpected reads as nothing remembered. */
export function parseTimelineFilters(raw: string | null): TimelineFilters | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { spaces?: unknown; workFrom?: unknown } | null;
    if (!value || typeof value !== 'object') return null;
    return { spaces: keyList(value.spaces), workFrom: keyList(value.workFrom) };
  } catch {
    return null;
  }
}

/** `localStorage`, fail-safe: a read or write that throws is ignored. */
export function storageTimelineFilters(storage: () => Storage | undefined): TimelineFilterStore {
  return {
    read() {
      try {
        return parseTimelineFilters(storage()?.getItem(TIMELINE_FILTERS_KEY) ?? null);
      } catch {
        return null;
      }
    },
    write(filters) {
      try {
        storage()?.setItem(TIMELINE_FILTERS_KEY, JSON.stringify(filters));
      } catch {
        // storage unavailable: the page opens on all KPIs next time
      }
    },
  };
}

export const browserTimelineFilters: TimelineFilterStore = storageTimelineFilters(() =>
  typeof window === 'undefined' ? undefined : window.localStorage,
);

/** Remembers nothing (stories that don't test remembering). */
export const noTimelineFilters: TimelineFilterStore = { read: () => null, write: () => {} };

/** Remembers in memory (stories and tests). */
export function memoryTimelineFilters(initial: TimelineFilters | null = null): TimelineFilterStore & { saved: TimelineFilters | null } {
  const store = {
    saved: initial,
    read: () => store.saved,
    write: (filters: TimelineFilters) => {
      store.saved = filters;
    },
  };
  return store;
}
