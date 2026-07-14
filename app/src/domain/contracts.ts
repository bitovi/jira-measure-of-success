import type { DueTiming, IsoDate, KpiDirection, TargetType } from './models/index';
import type { TargetStatus } from './resolve/targetStatus';

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
}

export interface CatalogEntryDto {
  id: string;
  name: string;
  unit: string;
  direction: KpiDirection;
}

export interface PanelData {
  issueKey: string;
  rows: PanelRowDto[];
  catalog: CatalogEntryDto[];
}

// ── Settings preview ────────────────────────────────────────────────────────
// (removed — the Settings page has no preview; the only setting is Due Date
// Rollup. Relative target dates are authored per-assignment on the Issue panel.)

// ── Timeline ────────────────────────────────────────────────────────────────
export interface TimelineTargetDto {
  date: string;
  value: number;
  status: TargetStatus;
  source: { issue: string; type: string; title: string };
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
  readings: TimelineReadingDto[];
  children: TimelineNodeDto[];
}

export interface TimelineData {
  /** ISO date treated as "today" for status classification + the axis marker */
  today: string;
  roots: TimelineNodeDto[];
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

/** Input for creating a KPI (an issue in the KPI space). Nest by parentKpiId. */
export interface CreateKpiInput {
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** parent KPI to nest under; null/omitted = a root KPI */
  parentKpiId?: string | null;
}
