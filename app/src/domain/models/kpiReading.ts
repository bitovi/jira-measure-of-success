import { z } from 'zod';
import { IsoDate } from './assignment.js';

/**
 * Recorded KPI value ("reading") — stored per (issue, KPI) as a Jira issue
 * entity property under key `kpi-readings-{kpiId}` (requirements §8-Q6).
 * Jira is the source of record; readable/writable over standard REST so
 * external tools (CascadeMCP, API clients) can set values. Untrusted → parsed
 * with this schema at the boundary.
 */
export const KpiReading = z.object({
  date: IsoDate,
  value: z.number(),
  recordedBy: z.string().min(1),
  recordedAt: z.number().int().nonnegative(),
});
export type KpiReading = z.infer<typeof KpiReading>;

/** The whole entity-property value at key `kpi-readings-{kpiId}`. */
export const KpiReadingsProperty = z.object({
  readings: z.array(KpiReading),
});
export type KpiReadingsProperty = z.infer<typeof KpiReadingsProperty>;

/** Entity-property key for a KPI's readings on an issue. */
export function readingsPropertyKey(kpiId: string): string {
  return `kpi-readings-${kpiId}`;
}
