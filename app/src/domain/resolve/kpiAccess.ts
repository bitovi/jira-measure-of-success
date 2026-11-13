/**
 * Wording for "you don't have permission" messages about the KPI space (spec
 * 10). The backend throws these and the UI shows them as tooltips, so a refused
 * action reads the same whether it was disabled up front or rejected by Jira.
 *
 * Pure: no @forge/*, no React.
 */

/** Something the user may be refused in the KPI space, and the Jira permission it needs. */
export type KpiAccessAction = 'view' | 'add' | 'record' | 'nest';

const PERMISSION: Record<KpiAccessAction, string> = {
  view: 'Browse Projects',
  add: 'Create Issues',
  record: 'Edit Issues',
  nest: 'Link Issues',
};

/** "the KPIs (KPI) project", or a generic name when the caller doesn't know it. */
function projectPhrase(spaceLabel?: string | null): string {
  return spaceLabel ? `the ${spaceLabel} project` : 'the KPI space project';
}

/**
 * Why the user can't do `action`, naming the Jira permission and project and who
 * can fix it. `kpiKey` names the KPI for per-KPI actions.
 */
export function kpiPermissionMessage(action: KpiAccessAction, spaceLabel?: string | null, kpiKey?: string): string {
  const doing =
    action === 'view'
      ? kpiKey
        ? `Viewing ${kpiKey}`
        : 'Viewing KPIs'
      : action === 'add'
        ? 'Adding a KPI'
        : action === 'record'
          ? kpiKey
            ? `Recording a value on ${kpiKey}`
            : 'Recording a value'
          : 'Nesting a KPI under another';
  return `${doing} needs ${PERMISSION[action]} permission on ${projectPhrase(spaceLabel)}. Ask a Jira admin.`;
}

/** The row label for a target whose KPI the user may not see. */
export const KPI_NO_ACCESS_LABEL = "You don't have permission to view this KPI";

/**
 * A KPI the user's lookup couldn't find. Jira answers the same 404 for "doesn't
 * exist" and "you may not see it", so the message covers both.
 */
export function kpiNotVisibleMessage(kpiKey: string, spaceLabel?: string | null): string {
  return `${kpiKey} doesn't exist, or you don't have permission to view it. Viewing KPIs needs Browse Projects permission on ${projectPhrase(spaceLabel)}. Ask a Jira admin.`;
}

/** The empty state when the user can't browse the KPI space at all. */
export function kpiSpaceNoAccessMessage(spaceLabel?: string | null): string {
  return `You don't have permission to view the KPI space${spaceLabel ? ` (${spaceLabel})` : ''}. Ask a Jira admin for Browse Projects permission on that project.`;
}
