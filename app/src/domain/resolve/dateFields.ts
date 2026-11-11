import type { DateFieldChoice, IsoDate, RollupConfig } from '../models/index';

/**
 * Per-level date-field selection — which Jira field holds each issue type's own
 * start / due date (e.g. an Initiative read from "Target start"/"Target end",
 * a Story from "Start date"/"Due date"). Pure: the backend supplies the site's
 * defaults and reads the returned field ids off each issue.
 */

/** Jira's system "Due date" field id (same on every site). */
export const DUE_DATE_FIELD_ID = 'duedate';
/** Jira Cloud's usual "Start date" field id, used when the site lookup fails. */
export const FALLBACK_START_FIELD_ID = 'customfield_10015';

/** A date/datetime field the admin can pick. */
export interface DateFieldOption {
  id: string;
  name: string;
}

/** The fields used when a level has no explicit choice. */
export interface DateFieldDefaults {
  start: string;
  due: string;
}

/** The Settings payload: every pickable date field plus the site defaults. */
export interface DateFieldCatalog {
  fields: DateFieldOption[];
  defaults: DateFieldDefaults;
}

export const FALLBACK_DATE_FIELD_DEFAULTS: DateFieldDefaults = {
  start: FALLBACK_START_FIELD_ID,
  due: DUE_DATE_FIELD_ID,
};

export interface DateFieldSelection {
  /** every field id any level reads — request these from Jira */
  fieldIds: string[];
  /** the start/due field ids for one issue type */
  forType(issueTypeName: string): DateFieldDefaults;
}

export function dateFieldSelection(
  config: Pick<RollupConfig, 'dateFields'> | null | undefined,
  defaults: DateFieldDefaults = FALLBACK_DATE_FIELD_DEFAULTS,
): DateFieldSelection {
  const choices: Record<string, DateFieldChoice> = config?.dateFields ?? {};
  const forType = (issueTypeName: string): DateFieldDefaults => ({
    start: choices[issueTypeName]?.start ?? defaults.start,
    due: choices[issueTypeName]?.due ?? defaults.due,
  });
  const ids = new Set<string>([defaults.start, defaults.due]);
  for (const c of Object.values(choices)) {
    if (c.start) ids.add(c.start);
    if (c.due) ids.add(c.due);
  }
  return { fieldIds: [...ids], forType };
}

/**
 * Normalize a Jira date (`2026-03-01`) or datetime (`2026-03-01T09:00:00.000-0600`)
 * field value to an ISO day. Datetimes keep the calendar day in their own offset.
 */
export function toIsoDay(value: unknown): IsoDate | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
}

/** Read an issue's own start/due from its raw `fields` using the selection for its type. */
export function readOwnDates(
  fields: Record<string, unknown> | undefined,
  issueTypeName: string,
  selection: DateFieldSelection,
): { ownStart: IsoDate | null; ownDue: IsoDate | null } {
  const { start, due } = selection.forType(issueTypeName);
  return { ownStart: toIsoDay(fields?.[start]), ownDue: toIsoDay(fields?.[due]) };
}
