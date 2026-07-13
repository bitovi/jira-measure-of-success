import { z } from 'zod';
import { IsoDate } from './assignment.js';

/**
 * A recorded KPI value ("reading"): a value at an effective date, plus who/when
 * it was recorded. Readings are KPI-global (storage-model.md) and stored via
 * Option B — the changelog of an app-only field on the KPI issue — then
 * reconstructed by `readingsFromChangelog`. This schema is the in-memory /
 * fixture shape; it is not the on-wire storage format. Untrusted input is parsed
 * with it at boundaries.
 */
export const KpiReading = z.object({
  date: IsoDate,
  value: z.number(),
  recordedBy: z.string().min(1),
  recordedAt: z.number().int().nonnegative(),
});
export type KpiReading = z.infer<typeof KpiReading>;

/**
 * @deprecated Legacy entity-property container (pre-Option-B, per-issue). Kept
 * for reference only; readings now live in the KPI issue's field changelog.
 */
export const KpiReadingsProperty = z.object({
  readings: z.array(KpiReading),
});
export type KpiReadingsProperty = z.infer<typeof KpiReadingsProperty>;

/** @deprecated Legacy per-issue readings property key (pre-Option-B). */
export function readingsPropertyKey(kpiId: string): string {
  return `kpi-readings-${kpiId}`;
}
