import { z } from 'zod';

/**
 * KPI assignment on an issue — stored as a Jira issue entity property.
 * Brief §4.2. Values that are `null` + `inheritFromParent` are resolved from
 * the nearest ancestor assigning the same KPI, at read time.
 *
 * Scope note: the issue panel sets TARGETS only. Baseline and recorded/current
 * values are intentionally NOT modeled here (the brief was wrong to include
 * them) — recorded values are a Timeline concept, not per-issue assignment data.
 */

/** ISO calendar date, e.g. "2026-01-01". */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');
export type IsoDate = z.infer<typeof IsoDate>;

export const TargetType = z.enum(['absolute', 'delta']);
export type TargetType = z.infer<typeof TargetType>;

/** What a relative due date is measured from. Brief §4.2 / §6.1. */
export const DueAnchor = z.enum(['issueDueDate', 'parentDueDate', 'kpiStart']);
export type DueAnchor = z.infer<typeof DueAnchor>;

export const DueTiming = z
  .object({
    mode: z.enum(['absolute', 'relative']),
    /** used only when mode === "absolute" */
    absolute: IsoDate.nullable(),
    /** used only when mode === "relative" */
    anchor: DueAnchor,
    /** months added to the resolved anchor date */
    offsetMonths: z.number().int(),
  })
  .refine((t) => (t.mode === 'absolute' ? t.absolute !== null : true), {
    message: 'absolute mode requires an absolute date',
    path: ['absolute'],
  });
export type DueTiming = z.infer<typeof DueTiming>;

export const Timing = z.object({
  start: IsoDate.nullable(),
  due: DueTiming,
});
export type Timing = z.infer<typeof Timing>;

export const Assignment = z.object({
  kpiId: z.string().min(1),
  inheritFromParent: z.boolean(),
  /** target value; null when inherited/unset */
  target: z.number().nullable(),
  targetType: TargetType,
  timing: Timing,
  updatedBy: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
});
export type Assignment = z.infer<typeof Assignment>;

/** The whole issue-entity-property value: an array of assignments. */
export const AssignmentProperty = z.object({
  assignments: z.array(Assignment),
  /**
   * Denormalized list of the assigned KPI ids, written alongside `assignments`
   * so the manifest's `kpi-assignments` → `kpiIds` search index (searchAlias)
   * is populated. This is what lets the timeline discover which issues set a
   * target for a given KPI (JQL `issue.property[kpi-assignments].kpiIds = ...`).
   * Optional on read for backward-compat with assignments saved before the
   * index was written.
   */
  kpiIds: z.array(z.string()).optional(),
});
export type AssignmentProperty = z.infer<typeof AssignmentProperty>;
