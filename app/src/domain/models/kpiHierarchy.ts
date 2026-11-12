import { z } from 'zod';

/**
 * Which end of the KPI hierarchy link type the PARENT sits on. See
 * resolve/kpiLinks for the direction model.
 */
export const KpiParentEnd = z.enum(['outward', 'inward']);
export type KpiParentEnd = z.infer<typeof KpiParentEnd>;

/**
 * Which link type nests KPIs, and which of its ends is the parent. Stored in KVS
 * under `kpi:hierarchy` (by type id — names can be renamed) and sent as the
 * `saveKpiHierarchy` payload.
 */
export const KpiHierarchyLink = z.object({
  linkTypeId: z.string().trim().min(1),
  parentEnd: KpiParentEnd,
});
export type KpiHierarchyLink = z.infer<typeof KpiHierarchyLink>;
