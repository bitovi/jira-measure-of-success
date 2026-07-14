import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { AddTargetInput, CreateKpiInput, IssuePickerItem, TimelineData } from '@domain/index.js';

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
  pending: boolean;
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

export const useTimelineData: UseTimeline = () => {
  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<TimelineActionError | null>(null);

  useEffect(() => {
    let alive = true;
    call<TimelineData>('getTimelineData')
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const record = async (kpiId: string, date: string, value: number | null) => {
    try {
      setActionError(null);
      setData(await call<TimelineData>('recordValue', { kpiId, date, value }));
    } catch (e) {
      setActionError(toActionError(e));
    }
  };

  const createKpi = async (input: CreateKpiInput) => {
    try {
      setActionError(null);
      setData(await call<TimelineData>('createKpi', input));
    } catch (e) {
      setActionError(toActionError(e));
    }
  };

  const searchIssues = (query: string) =>
    call<IssuePickerItem[]>('searchIssues', { query });

  const addTarget = async (input: AddTargetInput) => {
    try {
      setActionError(null);
      setData(await call<TimelineData>('addTarget', input));
    } catch (e) {
      setActionError(toActionError(e));
    }
  };

  return {
    data,
    pending: data === null && error === null,
    error,
    actionError,
    clearActionError: () => setActionError(null),
    record: (kpiId, date, value) => void record(kpiId, date, value),
    createKpi: (input) => void createKpi(input),
    searchIssues,
    addTarget: (input) => void addTarget(input),
  };
};
