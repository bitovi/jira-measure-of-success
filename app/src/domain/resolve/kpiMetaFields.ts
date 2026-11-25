import type { KpiDirection } from '../models/kpiDefinition';
import { KpiMetaProperty } from '../models/kpiMeta';
import type { KpiDirectionField, KpiFieldsConfig } from '../models/kpiSiteConfig';

/**
 * Unit and direction in Jira fields (spec 11 · 05). With the fields chosen
 * (`KpiSiteConfig.fields`), the fields are the only source the app reads; the
 * `kpi-meta` property is still written on every KPI write, as a copy for the
 * customer's report, until the cleanup release. With `fields: null` the app
 * reads and writes `kpi-meta` only, as before.
 */

type KpiMeta = KpiMetaProperty;

/** The parts of a KPI's unit/direction an edit changes (a part left out is left alone). */
export type KpiMetaChange = Partial<KpiMeta>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The configured field ids, for a search's or GET's `fields=` (none when not chosen). */
export function kpiMetaFieldIds(cfg: KpiFieldsConfig | null): string[] {
  return cfg ? [cfg.unit.fieldId, cfg.direction.fieldId] : [];
}

function encodeDirection(field: KpiDirectionField, direction: KpiDirection | null): unknown {
  if (!direction) return null;
  return field.kind === 'text' ? direction : { id: field.optionIds[direction] };
}

/**
 * Jira field values for the parts of `meta` given (an edit sends only what
 * changed). An empty unit or no direction is `null`, which empties the field.
 * A select direction is written by option id (01 A5).
 */
export function encodeKpiMetaFields(cfg: KpiFieldsConfig, meta: KpiMetaChange): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.unit !== undefined) out[cfg.unit.fieldId] = meta.unit === '' ? null : meta.unit;
  if (meta.direction !== undefined) out[cfg.direction.fieldId] = encodeDirection(cfg.direction, meta.direction);
  return out;
}

function decodeUnit(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A direction field's value: text `increase` / `decrease`, or a select option
 * (`{ id }` as Jira returns it, or a bare option id as in a changelog's `to`).
 * Anything else reads as no direction, as an unparseable `kpi-meta` does.
 */
export function decodeKpiDirection(field: KpiDirectionField, value: unknown): KpiDirection | null {
  if (field.kind === 'text') {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return text === 'increase' || text === 'decrease' ? text : null;
  }
  const id = isObject(value) ? value.id : value;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (String(id) === field.optionIds.increase) return 'increase';
  if (String(id) === field.optionIds.decrease) return 'decrease';
  return null;
}

/**
 * Unit/direction from an issue's `fields` (as Jira returns them). Only the
 * fields present in `raw` are decoded; an empty one reads as `''` / `null`.
 */
export function decodeKpiMetaFields(cfg: KpiFieldsConfig, raw: Record<string, unknown>): Partial<KpiMeta> {
  const out: Partial<KpiMeta> = {};
  if (cfg.unit.fieldId in raw) out.unit = decodeUnit(raw[cfg.unit.fieldId]);
  if (cfg.direction.fieldId in raw) out.direction = decodeKpiDirection(cfg.direction, raw[cfg.direction.fieldId]);
  return out;
}

/** A stored `kpi-meta` as the app reads it (null when absent or not in the expected shape). */
export function parseKpiMeta(value: unknown): KpiMeta | null {
  const parsed = KpiMetaProperty.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Where a KPI's unit and direction come from. `fields: null` (not chosen yet):
 * `kpi-meta`, as before. Fields chosen: the fields, even when empty; `kpi-meta`
 * is ignored (a not-yet-migrated KPI shows no unit/direction until the
 * `kpi-meta-to-fields` migration runs; accepted, spec 11 overview).
 */
export function resolveKpiMeta(
  cfg: KpiFieldsConfig | null,
  source: { legacy: unknown; fields?: Record<string, unknown> | null },
): KpiMeta | null {
  if (!cfg) return parseKpiMeta(source.legacy);
  const decoded = decodeKpiMetaFields(cfg, source.fields ?? {});
  return { unit: decoded.unit ?? '', direction: decoded.direction ?? null };
}

/**
 * `kpi-meta.fields: true`: this KPI's fields hold its unit and direction
 * (created after the fields were chosen, or migrated). Reads ignore it; the
 * migration counts unmarked KPIs as pending, and the sync trigger's manifest
 * filter only passes marked ones.
 */
export function isMarkedKpiMeta(raw: unknown): boolean {
  return isObject(raw) && raw.fields === true;
}

/**
 * The `kpi-meta` to store: the stored value as it is (unknown keys, the
 * marker) with `unit` and `direction` replaced. `mark` adds the marker; it's
 * never removed here, so an edit keeps whatever the KPI had.
 */
export function kpiMetaToStore(stored: unknown, meta: KpiMeta, mark: boolean): Record<string, unknown> {
  const base = isObject(stored) ? stored : {};
  return { ...base, unit: meta.unit, direction: meta.direction, ...(mark ? { fields: true } : {}) };
}

/**
 * What a KPI edit writes for a unit/direction change, in one issue edit: the
 * changed fields (when chosen) and the whole `kpi-meta` (one property value).
 * `kpi-meta` starts from what's **stored** and changes only what the edit
 * changed, so a not-yet-migrated KPI keeps its other value for the migration.
 * The marker is carried over; a KPI with no readable `kpi-meta` gets one built
 * from `current` (its field values), marked when the fields are chosen. With
 * `fields: null` the property is the only write, and never marked.
 */
export function kpiMetaWrite(
  cfg: KpiFieldsConfig | null,
  stored: unknown,
  current: KpiMeta,
  change: KpiMetaChange,
): { fields: Record<string, unknown>; meta: Record<string, unknown> } {
  const storedMeta = parseKpiMeta(stored);
  const base = storedMeta ?? current;
  const next: KpiMeta = {
    unit: change.unit !== undefined ? change.unit : base.unit,
    direction: change.direction !== undefined ? change.direction : base.direction,
  };
  if (!cfg) {
    const { fields: _marker, ...unmarked } = kpiMetaToStore(stored, next, false);
    return { fields: {}, meta: unmarked };
  }
  return { fields: encodeKpiMetaFields(cfg, change), meta: kpiMetaToStore(stored, next, storedMeta === null) };
}

/** What a created KPI writes: every non-empty field, and a `kpi-meta` marked when the fields are chosen. */
export function kpiMetaCreate(
  cfg: KpiFieldsConfig | null,
  meta: KpiMeta,
): { fields: Record<string, unknown>; meta: Record<string, unknown> } {
  const fields = cfg ? encodeKpiMetaFields(cfg, meta) : {};
  for (const [id, value] of Object.entries(fields)) if (value === null) delete fields[id];
  return { fields, meta: kpiMetaToStore(undefined, meta, cfg !== null) };
}

// ── Sync trigger (Jira-side edits → kpi-meta) ───────────────────────────────

/**
 * One `changelog.items` entry of an `avi:jira:updated:issue` event (01 A8/A9).
 * Its display values are `fromString` / `toString`; they aren't declared, as
 * `toString` would clash with Object.prototype's (read it with `newText`).
 */
export interface IssueChangelogItem {
  field?: string;
  fieldId?: string;
  from?: string | null;
  to?: string | null;
  [key: string]: unknown;
}

/** A changelog item's new display value ('' when cleared or absent). */
const newText = (item: IssueChangelogItem): string => {
  const value = Object.prototype.hasOwnProperty.call(item, 'toString') ? item['toString'] : undefined;
  return typeof value === 'string' ? value : '';
};

/**
 * The `kpi-meta` to write after someone edited the unit or direction field in
 * Jira's own UI, or null to leave it alone: the fields aren't chosen, the KPI
 * isn't marked (the migration reconciles those), the edit didn't touch our
 * fields, or `kpi-meta` already holds the new values. Only the changed values
 * are taken from the changelog; the rest stays as stored (a marked
 * `kpi-meta` already mirrors the fields).
 */
export function kpiMetaFromChangelog(
  changelog: { items?: IssueChangelogItem[] | null } | null | undefined,
  cfg: KpiFieldsConfig | null,
  storedMeta: unknown,
): Record<string, unknown> | null {
  if (!cfg || !isMarkedKpiMeta(storedMeta)) return null;
  const items = changelog?.items ?? [];
  const unitItem = items.filter((i) => i.fieldId === cfg.unit.fieldId).at(-1);
  const directionItem = items.filter((i) => i.fieldId === cfg.direction.fieldId).at(-1);
  if (!unitItem && !directionItem) return null;

  const stored = parseKpiMeta(storedMeta);
  const current: KpiMeta = stored ?? { unit: '', direction: null };
  const next: KpiMeta = {
    unit: unitItem ? newText(unitItem) : current.unit,
    direction: directionItem
      ? decodeKpiDirection(cfg.direction, cfg.direction.kind === 'text' ? newText(directionItem) : (directionItem.to ?? null))
      : current.direction,
  };
  if (stored && next.unit === stored.unit && next.direction === stored.direction) return null;
  return kpiMetaToStore(storedMeta, next, true);
}

// ── Migration planner (kpi-meta-to-fields) ──────────────────────────────────

/** A value the migration found set differently in the field and in `kpi-meta`: the field won. */
export interface KpiMetaFieldDifference {
  part: 'unit' | 'direction';
  field: string | null;
  legacy: string | null;
}

export type KpiMetaToFieldsPlan =
  | { action: 'none'; reason: 'absent' | 'marked' }
  | {
      action: 'write';
      /** field values to set (only the ones copied from `kpi-meta`) */
      fields: Record<string, unknown>;
      /** the marked `kpi-meta`, matching the fields */
      meta: Record<string, unknown>;
      /** values where the field already held something else (it wins), for review */
      differences: KpiMetaFieldDifference[];
    };

/**
 * An unmarked `kpi-meta`, read part by part for the migration, which mustn't
 * lose a value because the other part is malformed. `unit`: a string, else
 * unreadable (`undefined`). `direction`: any case of increase/decrease; absent
 * or null is no direction; anything else is unreadable (`undefined`).
 */
function parseLegacyParts(raw: Record<string, unknown>): { unit?: string; direction?: KpiDirection | null } {
  const out: { unit?: string; direction?: KpiDirection | null } = {};
  if (typeof raw.unit === 'string') out.unit = raw.unit;
  if (raw.direction === undefined || raw.direction === null) out.direction = null;
  else if (typeof raw.direction === 'string') {
    const text = raw.direction.trim().toLowerCase();
    if (text === 'increase' || text === 'decrease') out.direction = text;
  }
  return out;
}

/**
 * One KPI of the `kpi-meta-to-fields` migration. Absent `kpi-meta`: nothing to
 * do. Marked: already done. Not an object: throws (reported as a failure;
 * nothing is written). Unmarked: unit and direction are read and reconciled
 * separately: an empty field gets `kpi-meta`'s value; an equal one is left
 * alone; a different one **wins** (it was set in Jira after the fields were
 * chosen, and it's what the app shows) and `kpi-meta` is rewritten to match.
 * The written `kpi-meta` is the stored one with only the reconciled parts
 * changed (normalized to what the fields now hold), plus the marker; unknown
 * keys, and a part that's unreadable with its field empty, stay as stored.
 */
export function planKpiMetaToFields(
  cfg: KpiFieldsConfig,
  current: { legacy: unknown; fields: Record<string, unknown> | null | undefined },
): KpiMetaToFieldsPlan {
  if (current.legacy === undefined || current.legacy === null) return { action: 'none', reason: 'absent' };
  if (isMarkedKpiMeta(current.legacy)) return { action: 'none', reason: 'marked' };
  if (!isObject(current.legacy)) {
    throw new Error("its kpi-meta isn't an object, so its unit and direction can't be read; it was left as it is");
  }

  const raw = current.legacy;
  const legacy = parseLegacyParts(raw);
  const field = resolveKpiMeta(cfg, { legacy: null, fields: current.fields ?? {} })!;
  const copy: KpiMetaChange = {};
  const differences: KpiMetaFieldDifference[] = [];
  const meta: Record<string, unknown> = { ...raw };

  if (field.unit === '') {
    if (legacy.unit !== undefined && legacy.unit !== '') copy.unit = legacy.unit;
  } else if (field.unit !== legacy.unit) {
    meta.unit = field.unit;
    differences.push({ part: 'unit', field: field.unit, legacy: legacy.unit || null });
  }

  // A field holding something that isn't a direction (e.g. an unmapped option) reads as empty.
  if (field.direction === null) {
    if (legacy.direction !== undefined && legacy.direction !== null) {
      copy.direction = legacy.direction;
      meta.direction = legacy.direction;
    }
  } else if (field.direction !== legacy.direction) {
    meta.direction = field.direction;
    differences.push({ part: 'direction', field: field.direction, legacy: legacy.direction ?? null });
  } else {
    meta.direction = field.direction;
  }

  return { action: 'write', fields: encodeKpiMetaFields(cfg, copy), meta: { ...meta, fields: true }, differences };
}
