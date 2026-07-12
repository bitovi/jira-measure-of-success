import type { KpiDirection, TargetType } from './models/index.js';
import type { ResolvedEndpoint } from './resolve/effectiveTiming.js';
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
export interface PreviewRowDto {
  issueKey: string;
  summary: string;
  issueTypeName: string;
  /** indentation depth for the hierarchy (0 = top) */
  indent: number;
  effectiveDue: ResolvedEndpoint;
  /** human timing label, e.g. "+3 months after due" / "on due date" */
  timingLabel: string;
  resolved: ResolvedTargetDateDto;
}

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
