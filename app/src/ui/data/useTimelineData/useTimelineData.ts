import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '@ui/bridge.js';
import type {
  AddedTarget,
  AddTargetInput,
  CreatedKpi,
  CreateKpiInput,
  IssuePickerItem,
  KpiCreateSpaces,
  KpiRefLookup,
  RecordValueInput,
  TimelineData,
  TimelineReadingDto,
  TimelineReadingsData,
  TimelineSkeletonInput,
  TimelineTargetsData,
  UpdatedKpi,
  UpdateKpiInput,
  UpdateKpiResult,
} from '@domain/index.js';
import { KPI_HIERARCHY_NOT_SET_UP, KPI_WORK_TYPE_NOT_SET_UP } from '@domain/index.js';
import { bridgeFetchKpiAccess, type FetchKpiAccess } from '@ui/data/useKpiAccess/index.js';
import { deriveTimelineView } from './timelineView.js';
import { browserTimelineFilters } from './timelineFilters.js';

/**
 * A mutation failure, as the save modals show it. Mutations reject, and the
 * modal turns the rejection into this with `toActionError`. `type-not-set-up` and
 * `hierarchy-not-set-up` are the specific backend guards (`No KPI work type is
 * configured yet …` / `KPI hierarchy is not set up …`) that the UI renders with
 * an "Open Settings" affordance; everything else is `generic`.
 */
export type TimelineActionError =
  | { kind: 'type-not-set-up'; message: string }
  | { kind: 'hierarchy-not-set-up'; message: string }
  | { kind: 'generic'; message: string };

export function toActionError(e: unknown): TimelineActionError {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes(KPI_WORK_TYPE_NOT_SET_UP)) return { kind: 'type-not-set-up', message };
  if (message.includes(KPI_HIERARCHY_NOT_SET_UP)) return { kind: 'hierarchy-not-set-up', message };
  return { kind: 'generic', message };
}

/**
 * Injectable loader hook for the Timeline (see usePanelData.ts for the pattern).
 */
export interface TimelineController {
  data: TimelineData | null;
  /** No skeleton yet — the page itself can't render. */
  pending: boolean;
  /** Phase 2 (targets) outstanding: KPIs and readings are shown, rows shimmer. */
  targetsPending: boolean;
  /** Phase 2 failed: KPIs stay visible, with an inline retryable banner. */
  targetsError: string | null;
  /** Try loading the targets again after a Phase 2 failure. */
  retryTargets(): void;
  /** Initial-load failure — drives the full-screen "Failed to load" state. */
  error: string | null;
  /**
   * Record a value at a date; `null` deletes (tombstones) that date. Resolves
   * once saved and on the timeline; rejects with the failure.
   */
  record(kpiId: string, date: string, value: number | null): Promise<void>;
  /**
   * Create a KPI (root or nested under parentKpiId) in `projectId`. Resolves with it once it's
   * saved and on the timeline (for the created flag); rejects with the failure (see `toActionError`).
   */
  createKpi(input: CreateKpiInput): Promise<CreatedKpi>;
  /**
   * Edit a KPI: send only the fields that changed (`kpiEditChanges`). Resolves
   * once it's saved and on the timeline; rejects with the failure, like
   * `createKpi`. When only part was saved (moved, but the name/unit/direction
   * save failed), the saved part is applied first, then it rejects.
   */
  updateKpi(input: UpdateKpiInput): Promise<void>;
  /** Type-ahead search for a contributing issue (Add Target picker). */
  searchIssues(query: string): Promise<IssuePickerItem[]>;
  /** Add a target for a KPI, held on the chosen contributing issue. Resolves/rejects like `createKpi`. */
  addTarget(input: AddTargetInput): Promise<void>;
  /**
   * One space's KPI permissions, for an action about to be used (spec 11 · 06;
   * null = Jira couldn't answer). Absent (stories): access stays unknown.
   */
  getKpiAccess?: FetchKpiAccess;
  /**
   * Load the readings of KPIs that are full rows but were left out of the load
   * (`readingsPending`, spec 11 · 08). Each KPI is asked for once.
   */
  loadReadings(kpiIds: string[]): void;
  /** the last `loadReadings` failure, or null */
  readingsError: string | null;
  /** ask again for the readings that failed */
  retryReadings(): void;
  /** Add KPI's spaces, and which to fill in (`kpiSpaceKeys`: the page's KPI spaces). */
  getKpiCreateSpaces(kpiSpaceKeys: string[]): Promise<KpiCreateSpaces>;
  /** A whole key, id or `/browse/` URL typed in the Parent search (07's lookup). */
  lookupKpiRef(ref: string): Promise<KpiRefLookup>;
}

export type UseTimeline = () => TimelineController;

interface TimelineRequests {
  skeleton: Promise<TimelineData>;
  targets: Promise<TimelineTargetsData>;
}

/** An unobserved rejection must not surface as an "unhandled rejection". */
function guarded<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** Console timing (ms since page load) so the real-site phase gap can be read off, not guessed. */
const mark = (what: string) => console.info(`[timeline] ${what} at ${Math.round(performance.now())}ms`);

/** Readings only for the remembered KPI space filter's spaces (spec 11 · 08); none remembered = every KPI. */
const requestSkeleton = () => {
  mark('KPIs requested');
  const spaces = browserTimelineFilters.read()?.spaces ?? [];
  const input: TimelineSkeletonInput = spaces.length ? { readingSpaces: spaces } : {};
  return guarded(call<TimelineData>('getTimelineSkeleton', input));
};
const requestTargets = () => {
  mark('targets requested');
  return guarded(call<TimelineTargetsData>('getTimelineTargets'));
};

// Phase 1 and Phase 2 are independent on the backend, so both start at once.
// The entry point calls `prefetchTimeline()` before the first render so the
// requests are already in flight while the theme and React mount.
let prefetched: TimelineRequests | null = null;

export function prefetchTimeline(): void {
  prefetched ??= { skeleton: requestSkeleton(), targets: requestTargets() };
}

function takeRequests(): TimelineRequests {
  const requests = prefetched ?? { skeleton: requestSkeleton(), targets: requestTargets() };
  // React StrictMode runs this initializer twice in the same render; both calls
  // must see the same requests. Release them afterwards so a later mount starts fresh.
  queueMicrotask(() => {
    if (prefetched === requests) prefetched = null;
  });
  return requests;
}

export const useTimelineData: UseTimeline = () => {
  const [requests] = useState(takeRequests);
  const [targetsRequest, setTargetsRequest] = useState(requests.targets);
  const [skeleton, setSkeleton] = useState<TimelineData | null>(null);
  const [contributions, setContributions] = useState<TimelineTargetsData['contributions'] | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  // KPIs, values and targets saved this session, laid over whatever is loaded (deriveTimelineView).
  const [created, setCreated] = useState<CreatedKpi[]>([]);
  const [edited, setEdited] = useState<UpdatedKpi[]>([]);
  const [readingEdits, setReadingEdits] = useState<RecordValueInput[]>([]);
  const [addedTargets, setAddedTargets] = useState<AddedTarget[]>([]);
  const [loadedReadings, setLoadedReadings] = useState<Record<string, TimelineReadingDto[]>>({});
  const [readingsError, setReadingsError] = useState<string | null>(null);
  const readingsAsked = useRef(new Set<string>());
  const readingsFailed = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    requests.skeleton.then(
      (d) => {
        mark('KPIs received');
        if (alive) setSkeleton(d);
      },
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [requests]);

  useEffect(() => {
    let alive = true;
    targetsRequest.then(
      (t) => {
        mark('targets received');
        if (alive) setContributions(t.contributions);
      },
      (e: unknown) => alive && setTargetsError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [targetsRequest]);

  const view = useMemo(
    () => deriveTimelineView({ skeleton, contributions, targetsError, created, edited, readingEdits, addedTargets, loadedReadings }),
    [skeleton, contributions, targetsError, created, edited, readingEdits, addedTargets, loadedReadings],
  );

  const loadReadings = useCallback((kpiIds: string[]) => {
    const wanted = [...new Set(kpiIds)].filter((id) => !readingsAsked.current.has(id));
    if (wanted.length === 0) return;
    wanted.forEach((id) => readingsAsked.current.add(id));
    mark(`readings of ${wanted.length} KPIs requested`);
    call<TimelineReadingsData>('getTimelineReadings', { kpiIds: wanted }).then(
      ({ readings }) => {
        // A KPI Jira left out gets an empty series, so it stops waiting.
        setLoadedReadings((prev) => ({ ...prev, ...Object.fromEntries(wanted.map((id) => [id, readings[id] ?? []])) }));
      },
      (e: unknown) => {
        wanted.forEach((id) => readingsAsked.current.delete(id));
        readingsFailed.current = [...new Set([...readingsFailed.current, ...wanted])];
        setReadingsError(e instanceof Error ? e.message : String(e));
      },
    );
  }, []);

  const retryReadings = () => {
    const failed = readingsFailed.current;
    readingsFailed.current = [];
    setReadingsError(null);
    loadReadings(failed);
  };

  const retryTargets = () => {
    setTargetsError(null);
    setTargetsRequest(requestTargets());
  };

  const record = async (kpiId: string, date: string, value: number | null) => {
    const edit: RecordValueInput = { kpiId, date, value };
    await call('recordValue', edit);
    setReadingEdits((prev) => [...prev, edit]);
  };

  const createKpi = async (input: CreateKpiInput) => {
    const kpi = await call<CreatedKpi>('createKpi', input);
    setCreated((prev) => [...prev, kpi]);
    return kpi;
  };

  const updateKpi = async (input: UpdateKpiInput) => {
    const { kpi, error: partial } = await call<UpdateKpiResult>('updateKpi', input);
    // Lay the result over the tree even when only part of the edit was saved: it's what Jira now holds.
    setEdited((prev) => [...prev, kpi]);
    if (partial) throw new Error(partial);
  };

  const searchIssues = (query: string) =>
    call<IssuePickerItem[]>('searchIssues', { query });

  const addTarget = async (input: AddTargetInput) => {
    const added = await call<AddedTarget>('addTarget', input);
    const sameTarget = (t: AddedTarget) =>
      t.assignment.kpiId === added.assignment.kpiId && t.source.key === added.source.key;
    setAddedTargets((prev) => [...prev.filter((t) => !sameTarget(t)), added]);
  };

  return {
    data: view.data,
    pending: view.data === null && error === null,
    targetsPending: view.targetsPending,
    targetsError: view.targetsError,
    retryTargets,
    error,
    record,
    createKpi,
    updateKpi,
    searchIssues,
    addTarget,
    getKpiAccess: bridgeFetchKpiAccess,
    loadReadings,
    readingsError,
    retryReadings,
    getKpiCreateSpaces: (kpiSpaceKeys) => call<KpiCreateSpaces>('getKpiCreateSpaces', { kpiSpaceKeys }),
    lookupKpiRef: (ref) => call<KpiRefLookup>('lookupKpiRef', { ref }),
  };
};
