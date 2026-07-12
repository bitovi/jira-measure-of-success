import type { Assignment, KpiDefinition } from '../models/index.js';

/**
 * Group an issue's KPI assignments by their relationship to the parent — Issue
 * panel IP-1.4 (requirements §4.1). v1 authors INDEPENDENT targets (no value
 * inheritance, Q11); this only classifies which KPIs are shared / local / on the
 * parent but not yet tracked here.
 */
export interface PanelRow {
  kpiId: string;
  /** catalog entry, if the KPI is defined (untrusted data may reference gaps) */
  definition: KpiDefinition | undefined;
  /** the issue's own assignment (absent for `onParentNotTracked`) */
  assignment?: Assignment;
}

export interface GroupedPanel {
  /** tracked here AND on the parent */
  sharedWithParent: PanelRow[];
  /** tracked here only */
  onlyHere: PanelRow[];
  /** on the parent, not tracked here — offer "+ Track this" */
  onParentNotTracked: PanelRow[];
}

export function groupByRelationship(
  ownAssignments: Assignment[],
  parentAssignments: Assignment[],
  catalog: KpiDefinition[],
): GroupedPanel {
  const byId = new Map(catalog.map((k) => [k.id, k]));
  const ownIds = new Set(ownAssignments.map((a) => a.kpiId));
  const parentIds = new Set(parentAssignments.map((a) => a.kpiId));

  const sharedWithParent: PanelRow[] = [];
  const onlyHere: PanelRow[] = [];
  for (const a of ownAssignments) {
    const row: PanelRow = { kpiId: a.kpiId, definition: byId.get(a.kpiId), assignment: a };
    if (parentIds.has(a.kpiId)) sharedWithParent.push(row);
    else onlyHere.push(row);
  }

  const onParentNotTracked: PanelRow[] = [];
  for (const a of parentAssignments) {
    if (ownIds.has(a.kpiId)) continue;
    if (onParentNotTracked.some((r) => r.kpiId === a.kpiId)) continue;
    onParentNotTracked.push({ kpiId: a.kpiId, definition: byId.get(a.kpiId) });
  }

  return { sharedWithParent, onlyHere, onParentNotTracked };
}
