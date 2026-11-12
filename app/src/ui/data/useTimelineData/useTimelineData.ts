import { useEffect, useMemo, useState } from 'react';
import { call } from '@ui/bridge.js';
import type {
  AddedTarget,
  AddTargetInput,
  CreatedKpi,
  CreateKpiInput,
  IssuePickerItem,
  RecordValueInput,
  TimelineData,
  TimelineTargetsData,
} from '@domain/index.js';
import { KPI_HIERARCHY_NOT_SET_UP } from '@domain/index.js';
import { deriveTimelineView } from './timelineView.js';

/**
 * A mutation failure, as the save modals show it. Mutations reject, and the
 * modal turns the rejection into this with `toActionError`. `space-not-set-up` and
 * `hierarchy-not-set-up` are the specific backend guards (`KPI space is not set
 * up …` / `KPI hierarchy is not set up …`) that the UI renders with an "Open
 * Settings" affordance; everything else is `generic`.
 */
export type TimelineActionError =
  | { kind: 'space-not-set-up'; message: string }
  | { kind: 'hierarchy-not-set-up'; message: string }
  | { kind: 'generic'; message: string };

const SPACE_NOT_SET_UP = 'KPI space is not set up';

export function toActionError(e: unknown): TimelineActionError {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes(SPACE_NOT_SET_UP)) return { kind: 'space-not-set-up', message };
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
   * Create a KPI (root or nested under parentKpiId). Resolves once it's saved
   * and on the timeline; rejects with the failure (see `toActionError`).
   */
  createKpi(input: CreateKpiInput): Promise<void>;
  /** Type-ahead search for a contributing issue (Add Target picker). */
  searchIssues(query: string): Promise<IssuePickerItem[]>;
  /** Add a target for a KPI, held on the chosen contributing issue. Resolves/rejects like `createKpi`. */
  addTarget(input: AddTargetInput): Promise<void>;
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

const requestSkeleton = () => {
  mark('KPIs requested');
  return guarded(call<TimelineData>('getTimelineSkeleton'));
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
  const [readingEdits, setReadingEdits] = useState<RecordValueInput[]>([]);
  const [addedTargets, setAddedTargets] = useState<AddedTarget[]>([]);
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
    () => deriveTimelineView({ skeleton, contributions, targetsError, created, readingEdits, addedTargets }),
    [skeleton, contributions, targetsError, created, readingEdits, addedTargets],
  );

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
    searchIssues,
    addTarget,
  };
};
