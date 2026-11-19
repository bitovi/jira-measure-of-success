import { z } from 'zod';
import { KpiDirection } from './kpiDefinition';

/**
 * KPI metadata stored as an issue entity property on the KPI issue (unit +
 * direction). Unlike readings — which need a real field's changelog (Option B,
 * storage-model.md) — this is low-churn descriptive data, so an entity property
 * is fine and it's still standard-Jira-REST readable for CascadeMCP.
 */
export const KPI_META_PROPERTY_KEY = 'kpi-meta';

export const KpiMetaProperty = z.object({
  unit: z.string(),
  direction: KpiDirection.nullable(),
});
export type KpiMetaProperty = z.infer<typeof KpiMetaProperty>;

/** Jira's limit on an issue summary, which holds the KPI name. */
export const KPI_NAME_MAX_LENGTH = 255;

/**
 * `updateKpi` input: only the parts of the KPI to change. A field that's left
 * out is left alone in Jira, so an edit made from an out-of-date timeline can't
 * write back old values for fields the user didn't touch. `parentKpiId: null`
 * moves the KPI to the root; leaving it out keeps the KPI where it is. Parsed at
 * the bridge boundary.
 */
export const UpdateKpiInput = z.object({
  kpiId: z.string().min(1, 'No KPI to edit.'),
  name: z
    .string()
    .trim()
    .min(1, 'A KPI needs a name.')
    .max(KPI_NAME_MAX_LENGTH, `A KPI name can be at most ${KPI_NAME_MAX_LENGTH} characters.`)
    .optional(),
  unit: z.string().trim().optional(),
  direction: KpiDirection.nullable().optional(),
  parentKpiId: z.string().min(1).nullable().optional(),
});
export type UpdateKpiInput = z.infer<typeof UpdateKpiInput>;
