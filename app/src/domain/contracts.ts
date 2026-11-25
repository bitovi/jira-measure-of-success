import type {
  Assignment,
  DueTiming,
  IsoDate,
  KpiDirection,
  KpiHierarchyLink,
  KpiParentEnd,
  MigrationRecord,
  MigrationStatus,
  TargetType,
} from './models/index';
import type { ResolvedEndpoint } from './resolve/effectiveTiming';
import type { TargetStatus } from './resolve/targetStatus';
import type { BaselineState, StackStep } from './resolve/baseline';
import type { DisplayState, TargetWarning } from './resolve/displayState';
import type { KpiTargetContribution } from './resolve/timelineTargets';
import type { IssueLinkTypeInfo } from './resolve/kpiLinks';

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
  /** earlier same-level targets stacked onto a carried baseline (spec 09); absent when none */
  stackedFrom?: StackStep[];
  /** with `stackedFrom`: the carried latest reading the steps were stacked onto */
  unstackedBaseline?: number;
}

export interface PanelRowDto {
  /** the KPI's Jira issue id (spec 11 · 03); a deleted KPI's key-only reference keeps its key */
  kpiId: string;
  /** the KPI's issue key, for labels and `/browse/{key}` links (the id when Jira didn't give one) */
  kpiKey: string;
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
  /**
   * compute-on-read freeze: closed issue + past due date (FR-16). Not shown by any
   * UI and not saved — see Follow-up F1 in specs/09-stacked-targets/plan.md.
   */
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
   * true when the target points at a KPI that no longer exists (the KPI issue
   * was deleted). The row keeps the
   * stored bet so it can be removed, but has no values, status or record action.
   */
  kpiMissing?: boolean;
  /**
   * true when the target points at a KPI the user doesn't have permission to see
   * (no Browse on the KPI's space, or an issue security level) — spec 10. Like
   * `kpiMissing` it shows only the stored bet: no values, status or record
   * action; it can still be removed (the target lives on this work issue).
   */
  kpiNoAccess?: boolean;
}

/** A Jira space (project) holding KPIs, as the KPI's own `project` field returns it (spec 11 · 06). */
export interface KpiSpaceRef {
  id: string;
  key: string;
  name: string;
}

export interface CatalogEntryDto {
  /** the KPI's Jira issue id */
  id: string;
  /** the KPI's issue key (display only) */
  key: string;
  /** the KPI's space (always set by the backend; absent on hand-built data) */
  space?: KpiSpaceRef;
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
  /** the KPIs this work item and its parent target (spec 11 · 07: not every KPI) */
  kpis: CatalogEntryDto[];
  /**
   * What the "Set a KPI target" browser shows on open (spec 11 · 07). Absent
   * when no KPI work type is configured (there are no KPIs), and on a KPI's own panel.
   */
  picker?: KpiSuggestionsDto;
  /** the issue's effective due date (baseline + relative-timing anchor); null pending */
  issueDueDate: string | null;
  /** true when that due date was rolled up from descendants ("Rolled up due date") */
  issueDueRolledUp: boolean;
  /**
   * Set ONLY when THIS issue is itself a KPI (an issue of the KPI work type,
   * Feature 04 / spec 11 · 06). When present the panel renders the single-KPI
   * chart (KpiView) instead of the associate/target-editor form. Carries this
   * KPI's own series.
   */
  kpiView?: KpiViewDto | null;
  /** true while Phase 2 (readings + rolled-up dates) is outstanding — spec 07 */
  resolving?: boolean;
  /**
   * With `kpiView` only: the user's permissions in THIS KPI's space (spec 10,
   * spec 11 · 06), fetched with the load. Absent when Jira couldn't answer — the
   * UI then behaves as if allowed and Jira's refusal explains a denied action.
   */
  access?: KpiSpaceAccess;
}

/**
 * Phase 1 of the progressive issue panel (spec 07): what the target list and the
 * "Set a KPI target" form need — the issue's and its parent's targets, those
 * KPIs' definitions and the KPI browser's opening views (spec 11 · 07). No
 * readings and no rolled-up dates.
 */
export interface PanelBasis {
  issueKey: string;
  /** the issue's status category is "done" (Feature 03 freeze) */
  closed: boolean;
  /** the issue's own targets */
  own: Assignment[];
  /** KPI ids targeted on the parent issue (only used to group the rows); key-only references keep their key */
  parentKpiIds: string[];
  /** the targeted KPIs' definitions (own and parent's), without `currentValue` (that needs readings) */
  kpis: CatalogEntryDto[];
  /** the KPI browser's opening views; absent when no KPI work type is configured */
  picker?: KpiSuggestionsDto;
  /**
   * Targeted KPI ids (own or parent's) that Jira confirmed no longer exist, plus
   * every key-only reference (read as deleted without asking Jira, spec 11 · 03).
   * A KPI merely missing from `kpis` isn't enough — the search index lags
   * new KPIs — so only these are shown as "KPI deleted".
   */
  deletedKpiIds?: string[];
  /**
   * Targeted KPI ids (own or parent's) that exist but the user may not see
   * (spec 10). Shown as "You don't have permission to view this KPI".
   */
  noAccessKpiIds?: string[];
  /** keys of targeted KPIs `kpis` doesn't list but Jira found (KPI id → key), for their labels */
  kpiKeys?: Record<string, string>;
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
  /** reading series per KPI id (the issue's own targets' KPIs only, spec 11 · 07) */
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
  /**
   * Set when Jira has this KPI under more than one parent KPI (spec 11 · 06,
   * one-parent rule): how many, and the key of the one the Timeline shows it
   * under (the lowest link id).
   */
  parentLinks?: { count: number; shownKey: string };
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

// ── KPI picker (spec 11 · 07) ───────────────────────────────────────────────

/** A space as the KPI picker names it. */
export interface KpiPickerSpace {
  key: string;
  name: string;
}

/** A work item as the picker shows it: `{type icon} {key} {summary}`. */
export interface WorkItemRefDto {
  id: string;
  key: string;
  summary: string;
  /** for the icon's tooltip */
  typeName: string;
  /** an inlined `data:` URL (inlineIssueTypeIcons); null if it couldn't be fetched */
  typeIconUrl: string | null;
}

/** One KPI in a picker list. Lists are sent in rank order. */
export interface KpiOptionDto {
  /** issue id (spec 11 · 03) */
  id: string;
  key: string;
  name: string;
  /** the KPI work type's icon, inlined; null if it couldn't be fetched */
  typeIconUrl: string | null;
  unit: string;
  direction: KpiDirection | null;
  space: KpiPickerSpace;
  /** KPI-tree parent within the list it was sent with; null = top level there */
  parentId: string | null;
  /** has sub-KPIs in the list it was sent with: draw a chevron */
  hasChildren: boolean;
}

/** A parent's target as the picker's Target column words it (as the panel's target cards). */
export interface TargetSummaryDto {
  target: number | null;
  targetType: TargetType;
  due: DueTiming;
}

/** One parent work item with targets: a band in "Tracked by parents". */
export interface TrackedByParentDto {
  item: WorkItemRefDto;
  targets: Array<{
    option: KpiOptionDto;
    target: TargetSummaryDto;
    /** the KPI's same-space sub-KPIs, every level (shown collapsed); `parentId` within this target's tree */
    subKpis: KpiOptionDto[];
  }>;
}

/** What the KPI browser shows on open: Tracked by parents, This space, and the menu entries. */
export interface KpiSuggestionsDto {
  thisSpace: KpiPickerSpace;
  /** the work item has at least one parent (for the empty Tracked by parents message) */
  hasParents: boolean;
  /** one band per parent with targets, nearest first; a KPI may be under several */
  trackedByParents: TrackedByParentDto[];
  inThisSpace: KpiOptionDto[];
  /** the parents' spaces (not this space nor the central space), nearest first */
  parentSpaces: KpiPickerSpace[];
  /** the central space, if the site has one and it isn't this space: the Global KPIs entry */
  globalSpace: KpiPickerSpace | null;
}

/** `listKpisInSpaces`: a parent space's or Global KPIs' KPIs (names, units, nesting; no readings). */
export interface ListKpisInSpacesInput {
  projectKeys: string[];
}

/** `searchKpis`: All KPIs' search, optionally in one space (its Space filter). */
export interface SearchKpisInput {
  text: string;
  projectKey?: string;
}

export interface SearchKpisResult {
  kpis: KpiOptionDto[];
  /** more matched than were returned (the cap) */
  truncated: boolean;
}

/** `listKpiSpaces`: spaces that can hold KPIs, filtered by key or name, paged. */
export interface ListKpiSpacesInput {
  query: string;
  startAt?: number;
}

export interface ListKpiSpacesResult {
  spaces: KpiPickerSpace[];
  /** where the next page starts; null on the last page */
  nextStartAt: number | null;
}

/** `lookupKpiRef`: a whole key, an old key of a moved KPI, an issue id or a `/browse/` URL. */
export interface LookupKpiRefInput {
  ref: string;
}

export type KpiRefLookup =
  | { kind: 'kpi'; option: KpiOptionDto }
  | { kind: 'notKpi'; item: WorkItemRefDto }
  | { kind: 'hidden' };

/** `getKpiCurrentValue`: the picked KPI's latest reading, for the form's preview. */
export interface GetKpiCurrentValueInput {
  kpiId: string;
}

export interface KpiCurrentValue {
  kpiId: string;
  value: number | null;
}

// ── Settings preview ────────────────────────────────────────────────────────
// (removed — the Settings page has no preview; the only setting is Due Date
// Rollup. Relative target dates are authored per-assignment on the Issue panel.)

// ── Timeline ────────────────────────────────────────────────────────────────
/**
 * What the issue panel's target card is built from, for one timeline marker: the
 * bet (type, amount, timing) and its resolution. The marker tooltip feeds it to
 * the same presentation rules as the card, so the two read alike.
 */
export type TargetDetailDto = Pick<
  PanelRowDto,
  | 'target'
  | 'targetType'
  | 'dueTiming'
  | 'start'
  | 'targetDate'
  | 'resolvedValue'
  | 'displayState'
  | 'warning'
  | 'dueDate'
  | 'dueDateRolledUp'
  | 'actual'
>;

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
  /** the bet + resolution behind this marker, for the tooltip; absent on hand-built targets */
  detail?: TargetDetailDto;
  source: { issue: string; type: string; title: string; iconUrl?: string | null };
}

export interface TimelineReadingDto {
  date: string;
  value: number;
}

export interface TimelineNodeDto {
  id: string;
  /** the KPI's Jira issue id */
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
  /** the KPI's space (always set by the backend; absent on hand-built data) */
  space?: KpiSpaceRef;
}

export interface TimelineData {
  /** ISO date treated as "today" for status classification + the axis marker */
  today: string;
  roots: TimelineNodeDto[];
  /**
   * The central KPI space (spec 11 · 04), when one is set up. Until 08's space
   * chooser, Add KPI creates there by default (`defaultKpiCreateSpace`).
   */
  centralSpace?: KpiSpaceRef | null;
  /** true when no KPI work type is configured yet (Settings → KPI building blocks) */
  noWorkType?: boolean;
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

/**
 * What the current user may do in ONE space holding KPIs — their Jira project
 * permissions there (spec 10; per space since spec 11 · 06). The server
 * enforces these; the UI looks them up when an action is used
 * (`getKpiAccess`) and disables controls with a reason.
 */
export interface KpiSpaceAccess {
  /** BROWSE_PROJECTS: see KPIs and their readings */
  browse: boolean;
  /** CREATE_ISSUES: Add KPI */
  create: boolean;
  /** EDIT_ISSUES: record / delete a value, edit a KPI's name, unit and direction */
  edit: boolean;
  /** LINK_ISSUES: nest a KPI under a parent (new or moved) */
  link: boolean;
}

export const FULL_KPI_SPACE_ACCESS: KpiSpaceAccess = { browse: true, create: true, edit: true, link: true };

/** The `getKpiAccess` payload: the space (project key) whose access an action needs. */
export interface GetKpiAccessInput {
  projectKey: string;
}

/**
 * `getKpiAccess` result. `access` is null when Jira couldn't answer the
 * lookup: the action then goes ahead and Jira's own refusal explains it.
 */
export interface KpiAccessResult {
  projectKey: string;
  access: KpiSpaceAccess | null;
}

// ── KPI hierarchy link (resolve/kpiLinks) ───────────────────────────────
// KPIs nest via an issue link type. Link types are global to the site; an admin
// either has the app create its own `KPI Hierarchy` type or picks an existing
// directional one (and which end is the parent).
export type KpiHierarchyState =
  | 'unset' // no link type chosen yet — KPIs can't be nested
  | 'missing' // the chosen link type was deleted from the site
  | 'unavailable' // the site's link types couldn't be read (e.g. issue linking is disabled)
  | 'ready';

export interface KpiHierarchyStatus {
  state: KpiHierarchyState;
  /** the configured type, resolved against the site (null unless 'ready') */
  linkType: IssueLinkTypeInfo | null;
  /** stored type id (set for 'ready' and 'missing') */
  linkTypeId: string | null;
  parentEnd: KpiParentEnd;
  /** every link type on the site, for the picker */
  available: IssueLinkTypeInfo[];
  /** why the state is 'unavailable' */
  message?: string;
}

/** The `saveKpiHierarchy` payload — validated with the `KpiHierarchyLink` schema. */
export type SaveKpiHierarchyInput = KpiHierarchyLink;

// `RecordValueInput` (the recordValue payload) is a Zod schema: see models/kpiReading.

/** Input for creating a KPI (an issue of the KPI work type). Nest by parentKpiId. */
export interface CreateKpiInput {
  /** the space (project id) to create the KPI in; required (spec 11 · 06) */
  projectId: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** parent KPI's issue id to nest under; null/omitted = a root KPI */
  parentKpiId?: string | null;
}

/**
 * `createKpi` result: just the new KPI, not a rebuilt timeline. A new KPI has no
 * readings or targets, so the client splices it into the tree it already has —
 * no wait for Jira's search index to catch up and no full rebuild.
 */
export interface CreatedKpi {
  id: string;
  /** the new KPI's issue id */
  kpiId: string;
  issueKey: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** the parent KPI's issue id; null = a root KPI */
  parentKpiId: string | null;
  /** the space it was created in */
  space?: KpiSpaceRef;
}

/**
 * `updateKpi` result: the KPI as it now is in Jira, which the client lays over
 * its tree (like `CreatedKpi`). Name, unit and direction are always the current
 * values. `parentKpiId` is set only when the edit set the parent (null = root);
 * when it's absent the KPI stays where the client has it.
 */
export interface UpdatedKpi {
  id: string;
  /** the KPI's issue id */
  kpiId: string;
  issueKey: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  parentKpiId?: string | null;
}

/**
 * What `updateKpi` returns. `error` is set when only part of the edit was saved
 * (the move went through, then the name/unit/direction save failed): the client
 * applies `kpi`, which is what Jira now holds, and then shows the error.
 */
export interface UpdateKpiResult {
  kpi: UpdatedKpi;
  error: string | null;
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
  /** the KPI's issue id */
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

// ── Data migrations (spec 11 · 02) ──────────────────────────────────────
/** One registered migration, as `getMigrations` lists it for Settings → Upgrade data. */
export interface MigrationDto {
  id: string;
  title: string;
  description: string;
  writeAs: 'user' | 'app';
  dependsOn: string[];
  /** the stored record, or a fresh `pending` one for a migration that has never run */
  record: MigrationRecord;
  /** every `dependsOn` is `done` */
  ready: boolean;
  /** the `dependsOn` ids that aren't `done` */
  blockedBy: string[];
  /** `status()`, counted as the app; null for a `done` migration (never re-counted) or when it couldn't be counted */
  status: MigrationStatus | null;
  /** why `status()` failed, when it did */
  statusError?: string;
}

export interface MigrationsData {
  migrations: MigrationDto[];
}

// ── KPI configuration (spec 11 · 04) ────────────────────────────────────
/** A building block's state: not chosen, in use, or chosen but gone from Jira (a deleted field or type). */
export type KpiBlockState = 'unset' | 'ready' | 'broken';

export interface KpiWorkTypeStatus {
  state: KpiBlockState;
  id: string | null;
  /** the type's current name (the saved one when it was deleted) */
  name: string | null;
  iconUrl: string | null;
}

export interface KpiFieldInfo {
  id: string;
  /** null when the field no longer exists */
  name: string | null;
}

export interface KpiDirectionFieldInfo extends KpiFieldInfo {
  kind: 'text' | 'select';
  /** a select's option labels for increase / decrease (null = the option is gone) */
  increase?: string | null;
  decrease?: string | null;
}

export interface KpiFieldsStatus {
  state: KpiBlockState;
  unit: KpiFieldInfo | null;
  direction: KpiDirectionFieldInfo | null;
  /** why it's broken */
  problem?: string;
}

export interface KpiCentralSpaceStatus {
  /** `misconfigured`: the space exists but doesn't offer the KPI work type */
  state: KpiBlockState | 'misconfigured';
  projectId: string | null;
  key: string | null;
  name: string | null;
  problem?: string;
}

/** `getKpiSetup`: the KPI building blocks and the central space, checked against the site. */
export interface KpiSetupStatus {
  /** false until Settings saves a configuration; until then it's derived from the older records */
  saved: boolean;
  workType: KpiWorkTypeStatus;
  fields: KpiFieldsStatus;
  centralSpace: KpiCentralSpaceStatus;
  /** set by a Settings change that finished with optional steps left undone (e.g. screens) */
  warnings?: string[];
}

/** A work type the admin can pick as the KPI type (`getKpiWorkTypeChoices`). */
export interface KpiWorkTypeChoice {
  id: string;
  name: string;
  iconUrl: string | null;
}

/** A field the admin can pick for unit or direction (`getKpiFieldChoices`). */
export interface KpiFieldChoice {
  id: string;
  name: string;
  kind: 'text' | 'select';
}

/** An option of a single-select field (`getKpiFieldOptions`). */
export interface KpiFieldOption {
  id: string;
  value: string;
}

/** A company-managed space (`getKpiSpaceChoices`). */
export interface KpiSpaceChoice {
  id: string;
  key: string;
  name: string;
  /** offers the KPI work type already */
  hasKpiWorkType: boolean;
}

/**
 * `getKpiSpaceSetup` / `setUpKpiSpaceStep`: which of the guide's steps a space
 * has done. null = can't tell yet (the block it needs isn't chosen).
 */
export interface KpiSpaceSetupStatus {
  projectId: string;
  key: string;
  name: string;
  workType: boolean | null;
  fields: boolean | null;
  screens: boolean | null;
  /** why a step can't be checked or done (e.g. a team-managed space) */
  problem?: string;
}
