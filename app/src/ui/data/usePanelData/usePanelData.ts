import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { Assignment, PanelData, PanelListData, PanelParts, PanelValuesData, RecordValueInput } from '@domain/index.js';
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
  /** the last save/remove failed (the panel keeps its previous data) */
  actionError: string | null;
  dismissActionError(): void;
  save(assignment: Assignment): void;
  remove(kpiId: string): void;
  /**
   * Record (or, with value=null, delete) a reading on a KPI — from the KPI View
   * (Feature 04) when this issue IS a KPI, or a target card's "Record a value".
   * Resolves once saved and applied to the panel (no reload); rejects with the
   * failure, which the record modal shows.
   */
  record(kpiId: string, date: string, value: number | null): Promise<void>;
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
  // The parts a save/remove returned. They supersede the initial load (see derivePanelView).
  const [mutated, setMutated] = useState<PanelParts | null>(null);
  // Values recorded this session, applied over the loaded readings.
  const [readingEdits, setReadingEdits] = useState<RecordValueInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadedFor = useRef(issueId);
  useEffect(() => {
    if (loadedFor.current === issueId) return;
    loadedFor.current = issueId;
    setMutated(null);
    setReadingEdits([]);
    setBusy(false);
    setActionError(null);
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
    () => derivePanelView({ list, values, valuesError, mutated, readingEdits }),
    [list, values, valuesError, mutated, readingEdits],
  );

  const retryValues = () => setRequests((r) => ({ ...r, values: requestValues(issueId) }));

  // Run a mutation for the CURRENT issue. If the issue changes while it's in
  // flight, its result (or failure) belongs to the old issue and is dropped.
  const runAction = async (load: () => Promise<PanelParts>) => {
    const forIssue = issueId;
    const stillCurrent = () => loadedFor.current === forIssue;
    setBusy(true);
    setActionError(null);
    try {
      const next = await load();
      if (stillCurrent()) setMutated(next);
    } catch (e: unknown) {
      if (stillCurrent()) setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  };

  const mutate = (key: string, payload: unknown) => runAction(() => call<PanelParts>(key, payload));

  // The record modal shows progress and failure itself, so this doesn't touch
  // `busy`/`actionError` — it saves, then applies the value locally.
  const record = async (kpiId: string, date: string, value: number | null) => {
    const forIssue = issueId;
    const edit: RecordValueInput = { kpiId, date, value };
    await call('recordValue', edit);
    if (loadedFor.current === forIssue) setReadingEdits((prev) => [...prev, edit]);
  };

  return {
    data: view.data,
    pending: view.data === null && error === null,
    valuesPending: view.valuesPending,
    valuesError: view.valuesError,
    retryValues,
    error,
    busy,
    actionError,
    dismissActionError: () => setActionError(null),
    save: (assignment) => void mutate('saveAssignment', { issueId, assignment }),
    remove: (kpiId) => void mutate('removeAssignment', { issueId, kpiId }),
    record,
  };
};
