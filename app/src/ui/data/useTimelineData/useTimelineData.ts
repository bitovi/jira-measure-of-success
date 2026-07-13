import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { CreateKpiInput, TimelineData } from '@domain/index.js';

/**
 * Injectable loader hook for the Timeline (see usePanelData.ts for the pattern).
 */
export interface TimelineController {
  data: TimelineData | null;
  pending: boolean;
  error: string | null;
  record(kpiId: string, date: string, value: number): void;
  /** create a KPI (root or nested under parentKpiId) */
  createKpi(input: CreateKpiInput): void;
}

export type UseTimeline = () => TimelineController;

export const useTimelineData: UseTimeline = () => {
  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    call<TimelineData>('getTimelineData')
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const record = async (kpiId: string, date: string, value: number) => {
    setData(await call<TimelineData>('recordValue', { kpiId, date, value }));
  };

  const createKpi = async (input: CreateKpiInput) => {
    setData(await call<TimelineData>('createKpi', input));
  };

  return {
    data,
    pending: data === null && error === null,
    error,
    record: (kpiId, date, value) => void record(kpiId, date, value),
    createKpi: (input) => void createKpi(input),
  };
};
