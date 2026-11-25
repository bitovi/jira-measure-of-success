import { z } from 'zod';
import { KpiHierarchyLink } from './kpiHierarchy';

/**
 * Where KPIs live on this site and which Jira pieces they use (spec 11 · 04).
 * `readKpiSiteConfig()` (backend) is the only way backend code learns the KPI
 * work type and the unit/direction field ids.
 */

const id = z.string().trim().min(1);

/** The work type KPIs are created as (and, from 06, recognised by). */
export const KpiWorkTypeRef = z.object({ id, name: z.string() });
export type KpiWorkTypeRef = z.infer<typeof KpiWorkTypeRef>;

/** Which option of a single-select direction field means which direction. */
export const KpiDirectionOptionIds = z
  .object({ increase: id, decrease: id })
  .refine((o) => o.increase !== o.decrease, { message: 'Increase and decrease need different options.' });

/**
 * The direction field: a text field holding `increase` / `decrease`, or a
 * single select whose two options are mapped to them.
 */
export const KpiDirectionField = z.discriminatedUnion('kind', [
  z.object({ fieldId: id, kind: z.literal('text') }),
  z.object({ fieldId: id, kind: z.literal('select'), optionIds: KpiDirectionOptionIds }),
]);
export type KpiDirectionField = z.infer<typeof KpiDirectionField>;

/** Unit and direction, chosen together: both or neither (`fields: null`). */
export const KpiFieldsConfig = z
  .object({ unit: z.object({ fieldId: id }), direction: KpiDirectionField })
  .refine((f) => f.unit.fieldId !== f.direction.fieldId, {
    message: 'Unit and direction need two different fields.',
  });
export type KpiFieldsConfig = z.infer<typeof KpiFieldsConfig>;

export const KpiCentralSpace = z.object({ projectId: id, key: id, name: z.string() });
export type KpiCentralSpace = z.infer<typeof KpiCentralSpace>;

export const KpiSchemeRef = z.object({ id, name: z.string() });
export type KpiSchemeRef = z.infer<typeof KpiSchemeRef>;

/** Optional building blocks, recorded so Settings can show "Using …". Not used by reads/writes. */
export const KpiSchemes = z.object({
  workTypeScheme: KpiSchemeRef.optional(),
  fieldScheme: KpiSchemeRef.optional(),
  screenScheme: KpiSchemeRef.optional(),
});
export type KpiSchemes = z.infer<typeof KpiSchemes>;

export const KpiSiteConfig = z.object({
  workType: KpiWorkTypeRef.nullable(),
  /** null = not chosen yet (05 keeps using `kpi-meta` only). */
  fields: KpiFieldsConfig.nullable(),
  centralSpace: KpiCentralSpace.nullable(),
  hierarchy: KpiHierarchyLink.nullable(),
  schemes: KpiSchemes,
});
export type KpiSiteConfig = z.infer<typeof KpiSiteConfig>;

/**
 * What `kpi:config:site` holds. The central space and the hierarchy link stay
 * in their own records (`kpi:space`, `kpi:hierarchy`), so each has one source
 * and the readers 06 hasn't switched yet keep working; `readKpiSiteConfig`
 * puts the parts together.
 */
export const StoredKpiSiteConfig = KpiSiteConfig.pick({ workType: true, fields: true, schemes: true });
export type StoredKpiSiteConfig = z.infer<typeof StoredKpiSiteConfig>;

/** The name of the work type the app creates, and the one an older install used. */
export const DEFAULT_KPI_WORK_TYPE_NAME = 'KPI';
export const DEFAULT_KPI_UNIT_FIELD_NAME = 'KPI Unit';
export const DEFAULT_KPI_DIRECTION_FIELD_NAME = 'KPI Direction';
/** The created direction field's options. */
export const KPI_DIRECTION_OPTION_VALUES = { increase: 'Increase', decrease: 'Decrease' } as const;

// ── Settings payloads (parsed at the resolver boundary) ─────────────────────

export const SetUpKpiWorkTypeInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create') }),
  z.object({ mode: z.literal('existing'), id }),
]);
export type SetUpKpiWorkTypeInput = z.infer<typeof SetUpKpiWorkTypeInput>;

const create = z.object({ mode: z.literal('create') });

/** Create the app's field, or use one the site has. Unit and direction are saved together. */
export const SetUpKpiFieldsInput = z.object({
  unit: z.discriminatedUnion('mode', [create, z.object({ mode: z.literal('existing'), fieldId: id })]),
  direction: z.union([
    create,
    z.object({ mode: z.literal('existing'), fieldId: id, kind: z.literal('text') }),
    z.object({ mode: z.literal('existing'), fieldId: id, kind: z.literal('select'), optionIds: KpiDirectionOptionIds }),
  ]),
});
export type SetUpKpiFieldsInput = z.infer<typeof SetUpKpiFieldsInput>;

export const SetUpCentralSpaceInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create'), key: id }),
  z.object({ mode: z.literal('existing'), projectId: id }),
]);
export type SetUpCentralSpaceInput = z.infer<typeof SetUpCentralSpaceInput>;

/** The per-space steps the guide offers to do for a Jira admin. */
export const KpiSpaceStep = z.enum(['workType', 'fields', 'screens']);
export type KpiSpaceStep = z.infer<typeof KpiSpaceStep>;

export const SetUpKpiSpaceStepInput = z.object({ projectId: id, step: KpiSpaceStep });
export type SetUpKpiSpaceStepInput = z.infer<typeof SetUpKpiSpaceStepInput>;
