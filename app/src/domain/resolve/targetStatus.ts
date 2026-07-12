import type { IsoDate, KpiDirection, KpiReading } from '../models/index.js';

/**
 * Classify a KPI target as hit / missed / upcoming — Timeline TL-3 (requirements
 * §4.2). Ported from the kpi-timeline-v2 mock `targetStatus`:
 *  - a target whose date is in the future is `upcoming`;
 *  - a past target with nothing recorded by its date is `upcoming` (can't judge);
 *  - otherwise compare the value in effect at the target date against the target,
 *    respecting the KPI's direction.
 */
export type TargetStatus = 'hit' | 'missed' | 'upcoming';

export interface TimelineTarget {
  date: IsoDate;
  value: number;
}

/** Recorded value in effect at `iso` = last reading on or before it, else null. */
export function valueAt(readings: KpiReading[], iso: IsoDate): number | null {
  const t = new Date(iso).getTime();
  let latest: number | null = null;
  let latestT = -Infinity;
  for (const r of readings) {
    const rt = new Date(r.date).getTime();
    if (rt <= t && rt >= latestT) {
      latest = r.value;
      latestT = rt;
    }
  }
  return latest;
}

export function targetStatus(
  target: TimelineTarget,
  readings: KpiReading[],
  direction: KpiDirection | null,
  asOf: IsoDate,
): TargetStatus {
  if (new Date(target.date).getTime() > new Date(asOf).getTime()) return 'upcoming';
  const actual = valueAt(readings, target.date);
  if (actual === null) return 'upcoming';
  const met = direction === 'decrease' ? actual <= target.value : actual >= target.value;
  return met ? 'hit' : 'missed';
}
