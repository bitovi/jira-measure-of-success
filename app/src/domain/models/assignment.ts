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

/**
 * How a target's value is read:
 *  - `absolute` — the stored number IS the target ("total").
 *  - `percent`  — a % change applied to the KPI's value at the due date (`1` = +1%).
 *  - `relative` — an additive change to the KPI's value at the due date (`100` = +100).
 * Legacy `delta` (the pre-rename name for `percent`) is normalized on read.
 */
export const TARGET_TYPES = ['absolute', 'percent', 'relative'] as const;
export const TargetType = z.preprocess((v) => (v === 'delta' ? 'percent' : v), z.enum(TARGET_TYPES));
export type TargetType = (typeof TARGET_TYPES)[number];

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

/**
 * A KPI target, as the app works with it. `kpiId` is the KPI's Jira issue id
 * (spec 11 · 03), except for a reference to a deleted KPI kept by its key (see
 * `readStoredAssignments`).
 */
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

/**
 * A target as stored in the `kpi-assignments` issue property. `kpiId` keeps its
 * original meaning, the KPI's issue KEY (what the customer's reporting app
 * reads), and `kpiIssueId` holds the id. Data saved before spec 11 · 03 has no
 * `kpiIssueId`. Only `domain/resolve/kpiRef` converts between this and `Assignment`.
 */
export const StoredAssignment = Assignment.extend({
  kpiIssueId: z.string().optional(),
});
export type StoredAssignment = z.infer<typeof StoredAssignment>;

/** The `refsVersion` that marks a work item's references as migrated to ids. */
export const REFS_VERSION = 2;

/** The whole `kpi-assignments` issue-entity-property value. */
export const StoredAssignments = z.object({
  assignments: z.array(StoredAssignment),
  /**
   * Denormalized KPI keys, indexed as `kpiIds` (a `text` path). Kept for the
   * customer's reporting app (spec 11, Compatibility); this app no longer reads it.
   */
  kpiIds: z.array(z.string()).optional(),
  /**
   * Denormalized KPI issue ids, indexed as `kpiIssueIds` (a `string` path): what
   * Timeline discovery (`kpiIssueIds IS NOT EMPTY`) and exact lookups search.
   * A property path can't index a field inside an array of objects, hence the copy.
   */
  kpiIssueIds: z.array(z.string()).optional(),
  /** `REFS_VERSION` once every reference has a `kpiIssueId` (deleted KPIs aside); indexed for the migration's pending count */
  refsVersion: z.number().optional(),
});
export type StoredAssignments = z.infer<typeof StoredAssignments>;
