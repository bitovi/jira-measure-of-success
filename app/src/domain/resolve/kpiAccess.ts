/**
 * Wording for "you don't have permission" messages about KPIs (spec 10). Since
 * spec 11 · 06 KPIs live in many spaces, so every message names the KPI's OWN
 * space. The backend throws these and the UI shows them as tooltips, so a
 * refused action reads the same whether it was disabled up front or rejected
 * by Jira.
 *
 * Pure: no @forge/*, no React.
 */
import type { KpiSpaceAccess } from '../contracts';

/** Something the user may be refused in a KPI's space, and the Jira permission it needs. */
export type KpiAccessAction = 'view' | 'add' | 'record' | 'edit' | 'nest';

const PERMISSION: Record<KpiAccessAction, string> = {
  view: 'Browse Projects',
  add: 'Create Issues',
  record: 'Edit Issues',
  edit: 'Edit Issues',
  nest: 'Link Issues',
};

/** "the Portfolio space", or the KPI's space when the caller doesn't know its name. */
function spacePhrase(spaceLabel?: string | null): string {
  return spaceLabel ? `the ${spaceLabel} space` : "the KPI's space";
}

/**
 * Why the user can't do `action`, naming the Jira permission, the KPI's space
 * and who can fix it. `kpiKey` names the KPI for per-KPI actions.
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
          : action === 'edit'
            ? kpiKey
              ? `Editing ${kpiKey}`
              : 'Editing a KPI'
            : 'Nesting a KPI under another';
  return `${doing} needs ${PERMISSION[action]} permission on ${spacePhrase(spaceLabel)}. Ask a Jira admin.`;
}

/**
 * Why `action` is refused given the user's access in the KPI's space, or null
 * when it's allowed. A null `access` (unknown: not looked up yet, or Jira
 * couldn't answer) allows everything; Jira's own refusal then explains it.
 */
export function kpiActionBlockedReason(
  action: Exclude<KpiAccessAction, 'view'>,
  access: KpiSpaceAccess | null | undefined,
  spaceLabel?: string | null,
  kpiKey?: string,
): string | null {
  if (!access) return null;
  const allowed =
    action === 'add' ? access.create : action === 'nest' ? access.link : access.edit;
  return allowed ? null : kpiPermissionMessage(action, spaceLabel, kpiKey);
}

/** The row label for a target whose KPI the user may not see. */
export const KPI_NO_ACCESS_LABEL = "You don't have permission to view this KPI";

/**
 * A KPI the user's lookup couldn't find. Jira answers the same 404 for "doesn't
 * exist" and "you may not see it", so the message covers both. Given an issue id
 * (the app's KPI identity) it says "This KPI": the key isn't known.
 */
export function kpiNotVisibleMessage(kpiKeyOrId: string, spaceLabel?: string | null): string {
  const subject = /^\d+$/.test(kpiKeyOrId) ? 'This KPI' : kpiKeyOrId;
  return `${subject} doesn't exist, or you don't have permission to view it. Viewing KPIs needs Browse Projects permission on ${spacePhrase(spaceLabel)}. Ask a Jira admin.`;
}

/**
 * The empty state when the user's KPI search finds nothing (spec 11 · 06, Q4):
 * with KPIs in many spaces, "none exist yet" and "none you may see" look the same.
 */
export const NO_KPIS_MESSAGE = "No KPIs to show. There may be none yet, or they're in spaces you can't access.";

/** Thrown when a KPI is created without a space (spec 11 · 06; 08 adds the space chooser). */
export const KPI_SPACE_REQUIRED = 'Choose a space for the new KPI';

/** Thrown when no KPI work type is configured (Settings → KPI building blocks). */
export const KPI_WORK_TYPE_NOT_SET_UP = 'No KPI work type is configured yet';
