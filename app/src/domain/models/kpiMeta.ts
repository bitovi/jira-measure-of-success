import { z } from 'zod';
import { KpiDirection } from './kpiDefinition';

/**
 * A KPI's unit and direction. Spec 11 · 05: once the KPI fields are chosen in
 * Settings (`KpiSiteConfig.fields`), they live in those **Jira fields**, and
 * this `kpi-meta` issue entity property is only a compatibility copy for the
 * customer's report, written on every KPI write until the cleanup release
 * (resolve/kpiMetaFields.ts). Before fields are chosen (`fields: null`),
 * `kpi-meta` is still the only source.
 *
 * Stored shape: `{ unit, direction }`, plus `fields: true` once the KPI's fields
 * hold its values (created after the fields were chosen, or migrated). The
 * schema below doesn't list the marker, so the customer's reader, which parses
 * `unit` and `direction` only, is unaffected.
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
 * moves the KPI to the root; leaving it out keeps the KPI where it is. `kpiId`
 * and `parentKpiId` are issue ids (spec 11 · 03). Parsed at the bridge boundary.
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
