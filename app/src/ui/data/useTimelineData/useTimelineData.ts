import { useEffect, useMemo, useState } from 'react';
import { call } from '@ui/bridge.js';
import type {
  AddTargetInput,
  CreateKpiInput,
  IssuePickerItem,
  TimelineData,
  TimelineTargetsData,
} from '@domain/index.js';
import { deriveTimelineView } from './timelineView.js';

/**
 * A mutation (record / createKpi) failure, surfaced as inline, dismissible
 * state rather than an unhandled promise rejection. `space-not-set-up` is the
 * specific backend guard (`KPI space is not set up …`) that the UI renders with
 * an "Open Settings" affordance; everything else is `generic`.
 */
export type TimelineActionError =
  | { kind: 'space-not-set-up'; message: string }
  | { kind: 'generic'; message: string };

const SPACE_NOT_SET_UP = 'KPI space is not set up';

function toActionError(e: unknown): TimelineActionError {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes(SPACE_NOT_SET_UP)) return { kind: 'space-not-set-up', message };
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
  /** Mutation (record / createKpi) failure — drives the inline banner. */
  actionError: TimelineActionError | null;
  /** Dismiss the current mutation error. */
  clearActionError(): void;
  /** Record a value at a date. Pass `null` to delete (tombstone) that date. */
  record(kpiId: string, date: string, value: number | null): void;
  /** create a KPI (root or nested under parentKpiId) */
  createKpi(input: CreateKpiInput): void;
  /** Type-ahead search for a contributing issue (Add Target picker). */
  searchIssues(query: string): Promise<IssuePickerItem[]>;
  /** Add a target for a KPI, held on the chosen contributing issue. */
  addTarget(input: AddTargetInput): void;
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
  // A complete timeline returned by a mutation. It already includes targets, so
  // it supersedes the progressive pieces (see deriveTimelineView).
  const [full, setFull] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<TimelineActionError | null>(null);

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
    () => deriveTimelineView({ skeleton, contributions, targetsError, full }),
    [skeleton, contributions, targetsError, full],
  );

  const retryTargets = () => {
    setTargetsError(null);
    setTargetsRequest(requestTargets());
  };

  const record = async (kpiId: string, date: string, value: number | null) => {
    try {
      setActionError(null);
      setFull(await call<TimelineData>('recordValue', { kpiId, date, value }));
    } catch (e) {
      setActionError(toActionError(e));
    }
  };

  const createKpi = async (input: CreateKpiInput) => {
    try {
      setActionError(null);
      setFull(await call<TimelineData>('createKpi', input));
    } catch (e) {
      setActionError(toActionError(e));
    }
  };

  const searchIssues = (query: string) =>
    call<IssuePickerItem[]>('searchIssues', { query });

  const addTarget = async (input: AddTargetInput) => {
    try {
      setActionError(null);
      setFull(await call<TimelineData>('addTarget', input));
    } catch (e) {
      setActionError(toActionError(e));
    }
  };

  return {
    data: view.data,
    pending: view.data === null && error === null,
    targetsPending: view.targetsPending,
    targetsError: view.targetsError,
    retryTargets,
    error,
    actionError,
    clearActionError: () => setActionError(null),
    record: (kpiId, date, value) => void record(kpiId, date, value),
    createKpi: (input) => void createKpi(input),
    searchIssues,
    addTarget: (input) => void addTarget(input),
  };
};
