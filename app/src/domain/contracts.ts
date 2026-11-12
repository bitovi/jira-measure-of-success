import type { Assignment, DueTiming, IsoDate, KpiDirection, TargetType } from './models/index';
import type { ResolvedEndpoint } from './resolve/effectiveTiming';
import type { TargetStatus } from './resolve/targetStatus';
import type { BaselineState } from './resolve/baseline';
import type { DisplayState, TargetWarning } from './resolve/displayState';
import type { KpiTargetContribution } from './resolve/timelineTargets';

/**
 * Resolver payload contracts — the `invoke(...)` seam between Custom UI and the
 * backend. The Forge resolver (src/backend) and the harness mock-resolver must
 * both produce these EXACT shapes so surfaces behave identically locally and in
 * Jira. Pure types only (no @forge/*), so every layer can import them.
 */

// ── Issue panel ─────────────────────────────────────────────────────────────
export type PanelRelationship = 'shared' | 'onlyHere' | 'onParentNotTracked';

export interface ResolvedTargetDateDto {
  date: string | null;
  pending: boolean;
  source: string;
}

/**
 * Read-time resolution of a relative target's VALUE (Feature 03). Attached to a
 * panel row so the saved-target card can render the baseline note + status pill
 * without any arithmetic in React.
 */
export interface ResolvedTargetValueDto {
  /** null only when `state === 'needsBaseline'` */
  value: number | null;
  baseline: number | null;
  baselineDate: string | null;
  baselineFrom: string | null;
  state: BaselineState;
  provisional: boolean;
}

export interface PanelRowDto {
  kpiId: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** null for rows that are only on the parent (not tracked here) */
  target: number | null;
  targetType: TargetType | null;
  targetDate: ResolvedTargetDateDto | null;
  /** raw due timing (absolute/relative anchor + offset) for editing; null for untracked rows */
  dueTiming: DueTiming | null;
  /** the assignment's KPI start date (anchor for relative `kpiStart` dates) */
  start: IsoDate | null;
  relationship: PanelRelationship;
  // ── Feature 03: relative-value resolution (null for untracked rows) ────────
  /** resolved target value + baseline state (null for untracked rows) */
  resolvedValue: ResolvedTargetValueDto | null;
  /** combined display state driving the status pill (the 8 FR-26 states) */
  displayState: DisplayState | null;
  /** the warning to surface, if any (stale baseline / unconfirmed result / needs baseline) */
  warning: TargetWarning;
  /** compute-on-read freeze: closed issue + past due date (FR-16) */
  frozen: boolean;
  /** the contributing issue's effective due date (the baseline anchor); null when pending */
  dueDate: string | null;
  /** true when the due date was rolled up from descendants (UI: "Rolled up due date") */
  dueDateRolledUp: boolean;
  /** recorded value in effect at the target date (for met/missed/unknown rows) */
  actual: number | null;
  /**
   * true while the values that need readings or rolled-up dates (the estimate
   * line, status pill, dates) are still loading — spec 07 progressive panel.
   */
  resolving?: boolean;
  /**
   * true when the target points at a KPI that's no longer in the catalog (the
   * KPI issue was deleted or moved out of the KPI space). The row keeps the
   * stored bet so it can be removed, but has no values, status or record action.
   */
  kpiMissing?: boolean;
}

export interface CatalogEntryDto {
  id: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** the KPI's latest recorded value, for the authoring "current value" note (FR-5) */
  currentValue?: number | null;
  /** nesting depth in the KPI tree (0 = root); entries are ordered depth-first so the
   *  picker can indent to show parent/child relationships. Defaults to 0 when absent. */
  depth?: number;
}

export interface PanelData {
  issueKey: string;
  rows: PanelRowDto[];
  catalog: CatalogEntryDto[];
  /** the issue's effective due date (baseline + relative-timing anchor); null pending */
  issueDueDate: string | null;
  /** true when that due date was rolled up from descendants ("Rolled up due date") */
  issueDueRolledUp: boolean;
  /**
   * Set ONLY when THIS issue is itself a KPI (lives in the KPI space, Feature
   * 04). When present the panel renders the single-KPI chart (KpiView) instead
   * of the associate/target-editor form. Carries this KPI's own series.
   */
  kpiView?: KpiViewDto | null;
  /** true while Phase 2 (readings + rolled-up dates) is outstanding — spec 07 */
  resolving?: boolean;
}

/**
 * Phase 1 of the progressive issue panel (spec 07): what the target list and the
 * "Set a KPI target" form need — the issue's and its parent's targets and the
 * KPI catalog. No readings and no rolled-up dates.
 */
export interface PanelBasis {
  issueKey: string;
  /** the issue's status category is "done" (Feature 03 freeze) */
  closed: boolean;
  /** the issue's own targets */
  own: Assignment[];
  /** KPI ids targeted on the parent issue (only used to group the rows) */
  parentKpiIds: string[];
  /** the KPI picker catalog, without `currentValue` (that needs readings) */
  catalog: CatalogEntryDto[];
  /**
   * Targeted KPI ids (own or parent's) that Jira confirmed no longer exist. A KPI
   * merely missing from the catalog isn't enough — the search index lags new
   * KPIs — so only these are shown as "KPI deleted".
   */
  deletedKpiIds?: string[];
}

/**
 * `getPanelList` result. An ordinary work item gets the `basis`. A KPI issue
 * (Feature 04) gets its complete `panel` (the KPI chart), so no Phase 2 is needed.
 */
export type PanelListData = { basis: PanelBasis; panel?: undefined } | { panel: PanelData; basis?: undefined };

/**
 * Phase 2 of the progressive issue panel (spec 07): the facts that need the
 * rollup walk or the KPI readings. The client turns basis + values into rows
 * with the same `assemblePanel` the backend uses.
 */
export interface PanelValuesData {
  /** ISO "today" used for status classification */
  today: string;
  /** the issue's effective (possibly rolled-up) due date */
  issueDue: ResolvedEndpoint;
  /** the parent's key and effective due — only loaded when a target anchors to it */
  parent: { issueKey: string; due: ResolvedEndpoint } | null;
  /** reading series per KPI id (every KPI in the space) */
  readings: Record<string, TimelineReadingDto[]>;
}

/** The single-KPI chart payload for a KPI issue's panel (Feature 04). */
export interface KpiViewDto {
  /** this KPI's own series (readings + dated/undated targets) */
  node: TimelineNodeDto;
  /** ISO "today" for the axis marker + status classification */
  today: string;
  /**
   * The raw targets behind `node`'s markers, so the client can rebuild them
   * (`buildKpiTargets`) after recording a value — a marker's status and a
   * relative target's value depend on the readings.
   */
  contributions?: KpiTargetContribution[];
}

/**
 * The issue panel's save/remove result: the same two pieces as the progressive
 * load, so the client keeps assembling the panel itself (and can lay recorded
 * values over it) instead of receiving a finished one.
 */
export interface PanelParts {
  list: PanelListData;
  values: PanelValuesData;
}

// ── Settings preview ────────────────────────────────────────────────────────
// (removed — the Settings page has no preview; the only setting is Due Date
// Rollup. Relative target dates are authored per-assignment on the Issue panel.)

// ── Timeline ────────────────────────────────────────────────────────────────
export interface TimelineTargetDto {
  /** null = pending/undated (Feature 03, FR-24) — rendered in the Undated lane */
  date: string | null;
  value: number;
  status: TargetStatus;
  /** true = an estimate (baseline not yet baselined); rendered distinct (FR-23) */
  provisional: boolean;
  /**
   * true = a percent/relative change on a baseline, false = a fixed value. Not the
   * same as `provisional`: a relative target stops being an estimate once its
   * baseline is recorded, but it's still a relative target.
   */
  relative: boolean;
  source: { issue: string; type: string; title: string; iconUrl?: string | null };
}

export interface TimelineReadingDto {
  date: string;
  value: number;
}

export interface TimelineNodeDto {
  id: string;
  kpiId: string;
  /** Jira issue key of the KPI issue (for deep-linking to /browse/{key}) */
  issueKey: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  depth: number;
  targets: TimelineTargetDto[];
  /** pending targets with no resolvable date — right-pinned "Undated" lane (FR-24) */
  undated: TimelineTargetDto[];
  readings: TimelineReadingDto[];
  children: TimelineNodeDto[];
  /** true while relative/rolled-up targets are still resolving (shimmer, FR-20/25) */
  resolving?: boolean;
}

export interface TimelineData {
  /** ISO date treated as "today" for status classification + the axis marker */
  today: string;
  roots: TimelineNodeDto[];
}

/**
 * Phase 2 of the progressive timeline load: the raw target contributions per
 * KPI (assignment + source issue with rolled-up dates). The client turns them
 * into markers with `applyTargetContributions`.
 */
export interface TimelineTargetsData {
  contributions: Record<string, KpiTargetContribution[]>;
}

// ── KPI space (storage-model.md) ────────────────────────────────────────
// KPIs live as issues in a dedicated project. An admin sets the project key; the
// app creates the project (+ KPI issue type) or connects to an existing one.
export type KpiSpaceState =
  | 'unset' // no key chosen yet
  | 'missing' // key chosen but the project doesn't exist
  | 'misconfigured' // project exists but the KPI issue type isn't available in it
  | 'ready'; // project exists, has the KPI issue type, and is connected

export interface KpiSpaceStatus {
  key: string | null;
  projectId: string | null;
  name: string | null;
  state: KpiSpaceState;
}

// `RecordValueInput` (the recordValue payload) is a Zod schema: see models/kpiReading.

/** Input for creating a KPI (an issue in the KPI space). Nest by parentKpiId. */
export interface CreateKpiInput {
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** parent KPI to nest under; null/omitted = a root KPI */
  parentKpiId?: string | null;
}

/**
 * `createKpi` result: just the new KPI, not a rebuilt timeline. A new KPI has no
 * readings or targets, so the client splices it into the tree it already has —
 * no wait for Jira's search index to catch up and no full rebuild.
 */
export interface CreatedKpi {
  id: string;
  kpiId: string;
  issueKey: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  parentKpiId: string | null;
}

/**
 * `addTarget` result: the saved target as a raw contribution (assignment + its
 * source issue, icon already inlined). The client turns it into a marker with
 * the KPI readings it already holds.
 */
export type AddedTarget = KpiTargetContribution;

// ── Add target (issue picker) ────────────────────────────────────────────────
/**
 * A candidate contributing issue for the Add Target picker — a type-ahead over
 * Jira's issue-picker endpoint (`GET /rest/api/3/issue/picker`), the same source
 * the native Parent field uses.
 */
export interface IssuePickerItem {
  id: string;
  key: string;
  summary: string;
  /** issue type display name when known (Jira's picker endpoint omits it) */
  issueType: string | null;
  /** issue type icon URL (Jira's picker `img`), when available */
  iconUrl: string | null;
}

/**
 * Input for adding a target to a KPI. A target is held as an assignment on a
 * contributing work issue (kpi-assignments), due on an absolute date — so the
 * picker chooses the issue that owns the target.
 */
export interface AddTargetInput {
  kpiId: string;
  issueId: string;
  issueKey: string;
  issueType: string | null;
  /** issue type icon URL, when available */
  issueTypeIconUrl: string | null;
  issueSummary: string;
  /** ISO date the target is due */
  date: string;
  value: number;
}
