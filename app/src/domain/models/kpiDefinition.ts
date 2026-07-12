import { z } from 'zod';

/**
 * KPI definition (catalog entry) — stored in Forge KVS under `kpi:def:{kpiId}`.
 * Brief §4.1. One key per definition; deletion is soft (`archived`).
 */
export const KpiDirection = z.enum(['increase', 'decrease']);
export type KpiDirection = z.infer<typeof KpiDirection>;

export const KpiDefinition = z.object({
  /** slug, e.g. "revenue", "nps", "cycle-time" — unique across the catalog */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kpiId must be a lowercase slug'),
  name: z.string().min(1),
  unit: z.string().min(1),
  direction: KpiDirection,
  description: z.string().default(''),
  archived: z.boolean().default(false),
  createdBy: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type KpiDefinition = z.infer<typeof KpiDefinition>;
