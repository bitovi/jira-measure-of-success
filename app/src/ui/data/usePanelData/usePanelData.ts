import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { Assignment, PanelData, PanelListData, PanelValuesData } from '@domain/index.js';
import { derivePanelView } from './panelView.js';

/**
 * Injectable loader hook for the Issue panel (the `@forge/bridge` seam).
 *
 * Surfaces take this as a prop defaulted to the real hook, so Storybook stories
 * and tests can swap in a stub that returns canned scenario data synchronously —
 * exercising loading / error / empty / pending branches with no bridge or async.
 * See the "injectable loader hook" convention in
 * `.claude/skills/implement-feature/SKILL.md` and tech-choices §5.
 *
 * The load is progressive (specs/07-issue-panel-performance): Phase 1
 * (`getPanelList`) has the targets, their grouping and the KPI catalog, so the
 * list and the form render first. Phase 2 (`getPanelValues`) brings the readings
 * and rolled-up due dates that the estimates, status pills and dates need.
 */
export interface PanelController {
  data: PanelData | null;
  /** true while Phase 1 (the list) is in flight */
  pending: boolean;
  /** Phase 2 (values) outstanding: the list is shown, estimates shimmer */
  valuesPending: boolean;
  /** Phase 2 failed: the list stays visible, with an inline retryable banner */
  valuesError: string | null;
  /** Try loading the values again after a Phase 2 failure */
  retryValues(): void;
  error: string | null;
  /** true while a save/remove mutation is in flight */
  busy: boolean;
  save(assignment: Assignment): void;
  remove(kpiId: string): void;
  /**
   * Record (or, with value=null, delete) a reading on a KPI — used by the KPI
   * View (Feature 04) when this issue IS a KPI. Refreshes the panel afterwards
   * so `data.kpiView` re-renders with the new series.
   */
  record(kpiId: string, date: string, value: number | null): void;
}

export type UsePanel = (issueId: string) => PanelController;

interface PanelRequests {
  list: Promise<PanelListData>;
  values: Promise<PanelValuesData>;
}

/** An unobserved rejection must not surface as an "unhandled rejection". */
function guarded<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** Console timing (ms since page load) so the real-site phase gap can be read off, not guessed. */
const mark = (what: string) => console.info(`[panel] ${what} at ${Math.round(performance.now())}ms`);

// Without an issue id the resolver loads the issue the panel is open on (Forge
// invocation context), which lets the load start before the context is read.
const payloadFor = (issueId: string | null) => (issueId ? { issueId } : undefined);

const requestList = (issueId: string | null) => {
  mark('list requested');
  return guarded(call<PanelListData>('getPanelList', payloadFor(issueId)));
};
const requestValues = (issueId: string | null) => {
  mark('values requested');
  return guarded(call<PanelValuesData>('getPanelValues', payloadFor(issueId)));
};
const startRequests = (issueId: string | null): PanelRequests => ({
  list: requestList(issueId),
  values: requestValues(issueId),
});

// The phases are independent on the backend, so both start at once. The Forge
// entry calls `prefetchPanel()` at module load, so they are already in flight
// while the theme loads, React mounts and the issue context is read.
let prefetched: PanelRequests | null = null;

export function prefetchPanel(): void {
  prefetched ??= startRequests(null);
}

function takeRequests(issueId: string): PanelRequests {
  const requests = prefetched ?? startRequests(issueId);
  // React StrictMode runs this initializer twice in the same render; both calls
  // must see the same requests. Release them afterwards so a later mount starts fresh.
  queueMicrotask(() => {
    if (prefetched === requests) prefetched = null;
  });
  return requests;
}

export const usePanelData: UsePanel = (issueId) => {
  const [requests, setRequests] = useState(() => takeRequests(issueId));
  const [list, setList] = useState<PanelListData | null>(null);
  const [values, setValues] = useState<PanelValuesData | null>(null);
  const [valuesError, setValuesError] = useState<string | null>(null);
  // A complete panel returned by a mutation. It supersedes the progressive
  // pieces (see derivePanelView).
  const [full, setFull] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadedFor = useRef(issueId);
  useEffect(() => {
    if (loadedFor.current === issueId) return;
    loadedFor.current = issueId;
    setFull(null);
    setRequests(startRequests(issueId));
  }, [issueId]);

  useEffect(() => {
    let alive = true;
    setList(null);
    setError(null);
    requests.list.then(
      (d) => {
        mark('list received');
        if (alive) setList(d);
      },
      (e: unknown) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [requests.list]);

  useEffect(() => {
    let alive = true;
    setValues(null);
    setValuesError(null);
    requests.values.then(
      (v) => {
        mark('values received');
        if (alive) setValues(v);
      },
      (e: unknown) => alive && setValuesError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [requests.values]);

  const view = useMemo(
    () => derivePanelView({ list, values, valuesError, full }),
    [list, values, valuesError, full],
  );

  const retryValues = () => setRequests((r) => ({ ...r, values: requestValues(issueId) }));

  const mutate = async (key: string, payload: unknown) => {
    setBusy(true);
    try {
      setFull(await call<PanelData>(key, payload));
    } finally {
      setBusy(false);
    }
  };

  // Recording a reading returns TimelineData (KPI-global), so ignore its result
  // and re-fetch the panel to refresh `kpiView` with the new series.
  const record = async (kpiId: string, date: string, value: number | null) => {
    setBusy(true);
    try {
      await call('recordValue', { kpiId, date, value });
      setFull(await call<PanelData>('getPanelData', { issueId }));
    } finally {
      setBusy(false);
    }
  };

  return {
    data: view.data,
    pending: view.data === null && error === null,
    valuesPending: view.valuesPending,
    valuesError: view.valuesError,
    retryValues,
    error,
    busy,
    save: (assignment) => void mutate('saveAssignment', { issueId, assignment }),
    remove: (kpiId) => void mutate('removeAssignment', { issueId, kpiId }),
    record: (kpiId, date, value) => void record(kpiId, date, value),
  };
};
