import type { Assignment, KpiDefinition } from '../models/index';

/**
 * Group an issue's KPI assignments by their relationship to the parent — Issue
 * panel IP-1.4 (requirements §4.1). v1 authors INDEPENDENT targets (no value
 * inheritance, Q11); this only classifies which of the issue's KPIs are shared
 * with the parent and which are local. KPIs on the parent but not here are
 * offered by the KPI browser's "Tracked by parents" view instead.
 */
export interface PanelRow {
  kpiId: string;
  /** catalog entry, if the KPI is defined (untrusted data may reference gaps) */
  definition: KpiDefinition | undefined;
  /** the issue's own assignment */
  assignment: Assignment;
}

export interface GroupedPanel {
  /** tracked here AND on the parent */
  sharedWithParent: PanelRow[];
  /** tracked here only */
  onlyHere: PanelRow[];
}

export function groupByRelationship(
  ownAssignments: Assignment[],
  parentAssignments: Pick<Assignment, 'kpiId'>[],
  catalog: KpiDefinition[],
): GroupedPanel {
  const byId = new Map(catalog.map((k) => [k.id, k]));
  const parentIds = new Set(parentAssignments.map((a) => a.kpiId));

  const sharedWithParent: PanelRow[] = [];
  const onlyHere: PanelRow[] = [];
  for (const a of ownAssignments) {
    const row: PanelRow = { kpiId: a.kpiId, definition: byId.get(a.kpiId), assignment: a };
    if (parentIds.has(a.kpiId)) sharedWithParent.push(row);
    else onlyHere.push(row);
  }

  return { sharedWithParent, onlyHere };
}
