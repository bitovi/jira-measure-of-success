import { REFS_VERSION, type Assignment, type StoredAssignment, type StoredAssignments } from '../models/index';

/**
 * KPI references in stored targets (spec 11 · 03). Inside the app a KPI is its
 * Jira issue id; the key is display-only. The `kpi-assignments` property stores
 * both: `kpiIssueId` (the id) and `kpiId` (the KPI's key when it was written,
 * for the customer's reporting app). These functions are the only code that
 * knows about that split.
 *
 * Pure: no @forge/*, no React.
 */

export type KpiRef = { kind: 'id'; id: string } | { kind: 'key'; key: string } | { kind: 'invalid' };

const ISSUE_ID = /^\d+$/;
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** Ids are digits; keys are PROJECT-123. */
export function parseKpiRef(raw: string): KpiRef {
  const value = raw.trim();
  if (ISSUE_ID.test(value)) return { kind: 'id', id: value };
  if (ISSUE_KEY.test(value)) return { kind: 'key', key: value };
  return { kind: 'invalid' };
}

/** True for an issue id (digits), the app's KPI identity. */
export function isKpiIssueId(raw: string): boolean {
  return parseKpiRef(raw).kind === 'id';
}

/** The id a stored reference points at: `kpiIssueId`, else a digits-only `kpiId`; null when it has none. */
function storedId(s: StoredAssignment): string | null {
  if (s.kpiIssueId !== undefined) {
    const ref = parseKpiRef(s.kpiIssueId);
    if (ref.kind === 'id') return ref.id;
  }
  const ref = parseKpiRef(s.kpiId);
  return ref.kind === 'id' ? ref.id : null;
}

function toAssignment(s: StoredAssignment, kpiId: string): Assignment {
  const { kpiIssueId, ...rest } = s;
  void kpiIssueId;
  return { ...rest, kpiId };
}

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * Stored → domain, for reads. Uses `kpiIssueId` only; a reference without one is
 * a deleted KPI, kept by its stored `kpiId` (so it shows as "deleted" and can be
 * removed) and listed in `deletedKeys`. When two references point at the same
 * KPI (e.g. a key-only target and a later one by id, after the migration gave
 * the first its id), the one with the latest `updatedAt` wins, in the first's
 * place; on a tie, the first.
 */
export function readStoredAssignments(stored: StoredAssignments): { assignments: Assignment[]; deletedKeys: string[] } {
  const assignments: Assignment[] = [];
  const deletedKeys: string[] = [];
  const indexOf = new Map<string, number>();
  for (const s of stored.assignments) {
    const id = storedId(s);
    const kpiId = id ?? s.kpiId;
    const at = indexOf.get(kpiId);
    if (at !== undefined) {
      if (s.updatedAt > assignments[at].updatedAt) assignments[at] = toAssignment(s, kpiId);
      continue;
    }
    indexOf.set(kpiId, assignments.length);
    assignments.push(toAssignment(s, kpiId));
    if (id === null) deletedKeys.push(s.kpiId);
  }
  return { assignments, deletedKeys };
}

/** A key-only reference (not yet migrated, or a deleted KPI) to the KPI whose key is `key`. */
const isKeyOnlyRefTo = (a: Assignment, key: string | undefined): boolean =>
  key !== undefined && !isKpiIssueId(a.kpiId) && a.kpiId.trim().toUpperCase() === key.trim().toUpperCase();

/**
 * `assignment` (by KPI id) written onto an issue's targets: it replaces the
 * target on the same KPI, which before the `kpi-target-refs-to-ids` migration
 * may still be held by the KPI's current `key` only (the same target, the one
 * being edited). The new one takes the first match's place; other matches are
 * dropped. Added at the end when there's none.
 */
export function withTarget(existing: Assignment[], assignment: Assignment, key: string): Assignment[] {
  const matches = (a: Assignment) => a.kpiId === assignment.kpiId || isKeyOnlyRefTo(a, key);
  const at = existing.findIndex(matches);
  if (at < 0) return [...existing, assignment];
  return existing.flatMap((a, i) => (i === at ? [assignment] : matches(a) ? [] : [a]));
}

/**
 * An issue's targets without the one on `kpiId`. For an id, a key-only
 * reference to the same KPI (its key from `keyOfId`, e.g. `storedKeysById`)
 * goes too, so no stale copy is left to reappear after the migration.
 */
export function withoutTarget(existing: Assignment[], kpiId: string, keyOfId: ReadonlyMap<string, string>): Assignment[] {
  const key = isKpiIssueId(kpiId) ? keyOfId.get(kpiId) : undefined;
  return existing.filter((a) => a.kpiId !== kpiId && !isKeyOnlyRefTo(a, key));
}

/** The `kpiIssueId` → stored key pairs of a stored property: the keys last written for each id. */
export function storedKeysById(stored: StoredAssignments | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of stored?.assignments ?? []) {
    const id = storedId(s);
    if (id !== null && parseKpiRef(s.kpiId).kind === 'key') out.set(id, s.kpiId);
  }
  return out;
}

/**
 * Should an app write stamp `refsVersion`? Yes when the stored property was
 * already stamped, or held no key-only references (including no property at
 * all): every reference the app writes has an id, so nothing is left to migrate.
 */
export function shouldStampRefs(stored: StoredAssignments | null): boolean {
  if (!stored) return true;
  return stored.refsVersion === REFS_VERSION || readStoredAssignments(stored).deletedKeys.length === 0;
}

function indexed(assignments: StoredAssignment[], stamp: boolean): StoredAssignments {
  return {
    assignments,
    kpiIssueIds: unique(assignments.flatMap((a) => (a.kpiIssueId !== undefined ? [a.kpiIssueId] : []))),
    kpiIds: unique(assignments.map((a) => a.kpiId)),
    ...(stamp ? { refsVersion: REFS_VERSION } : {}),
  };
}

/**
 * Domain → stored, for app writes. Every id reference gets `kpiIssueId` plus
 * `kpiId` = its key from `keyOfId` (the id itself when no key is known);
 * key-only references are kept as they are. Fills both index arrays, and
 * `refsVersion` when `stamp` is true (see `shouldStampRefs`).
 */
export function toStoredAssignments(
  assignments: Assignment[],
  keyOfId: ReadonlyMap<string, string>,
  stamp: boolean,
): StoredAssignments {
  const stored = assignments.map((a): StoredAssignment => {
    const ref = parseKpiRef(a.kpiId);
    if (ref.kind !== 'id') return { ...a };
    return { ...a, kpiIssueId: ref.id, kpiId: keyOfId.get(ref.id) ?? ref.id };
  });
  return indexed(stored, stamp);
}

export type KpiRefMigrationOutcome = 'migrated' | 'alreadyDone' | 'skipped';

/**
 * The `kpi-target-refs-to-ids` migration's planner for one work item. Each
 * key-only reference is resolved through `idOfKey` (keys missing from it are
 * deleted KPIs: kept as they are and listed in `deletedKeys`); `kpiId` becomes
 * the KPI's current key from `keyOfId` when known. The result is always stamped
 * `refsVersion`. Outcome: `migrated` when a reference gained an id, else
 * `skipped` when a key was unresolved, else `alreadyDone`.
 */
export function migrateStoredAssignments(
  stored: StoredAssignments,
  idOfKey: ReadonlyMap<string, string>,
  keyOfId: ReadonlyMap<string, string>,
): { outcome: KpiRefMigrationOutcome; stored: StoredAssignments; deletedKeys: string[] } {
  const deletedKeys: string[] = [];
  let gained = false;
  const assignments = stored.assignments.map((s): StoredAssignment => {
    let id = s.kpiIssueId !== undefined && isKpiIssueId(s.kpiIssueId) ? s.kpiIssueId : null;
    if (id === null) {
      const ref = parseKpiRef(s.kpiId);
      id = ref.kind === 'id' ? ref.id : ref.kind === 'key' ? (idOfKey.get(ref.key) ?? null) : null;
      if (id === null) {
        deletedKeys.push(s.kpiId);
        return s;
      }
      gained = true;
    }
    const keyNow = keyOfId.get(id) ?? (parseKpiRef(s.kpiId).kind === 'key' ? s.kpiId : id);
    return { ...s, kpiIssueId: id, kpiId: keyNow };
  });
  const outcome: KpiRefMigrationOutcome = gained ? 'migrated' : deletedKeys.length > 0 ? 'skipped' : 'alreadyDone';
  return { outcome, stored: indexed(assignments, true), deletedKeys };
}
