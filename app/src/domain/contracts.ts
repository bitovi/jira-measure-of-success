import type { DueTiming, IsoDate, KpiDirection, TargetType } from './models/index.js';
import type { TargetStatus } from './resolve/targetStatus.js';

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
