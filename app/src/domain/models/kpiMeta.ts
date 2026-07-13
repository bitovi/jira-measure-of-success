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
