import type { MigrationDto } from '../contracts';
import {
  EMPTY_MIGRATION_COUNTS,
  MAX_MIGRATION_FAILURES,
  type MigrationBatchResult,
  type MigrationRecord,
} from '../models/migration';

/**
 * The migration runner's bookkeeping (spec 11 · 02), kept pure so the state
 * transitions are table-tested. The backend only does the I/O around them.
 */

export interface ApplyBatchOptions {
  /** accountId of the admin running this batch */
  runBy?: string | null;
  /**
   * `status().pending` counted as the app after the final batch (rule 6). Only
   * read when `result.cursor` is null: the run ends `done` only when it's 0.
   */
  pendingAtEnd?: number | null;
}

/**
 * Fold one batch into the record: add the counts, keep the last 50 failures and
 * move the state. A batch with a cursor leaves the run `running`; the final one
 * ends it `done` when nothing is pending, else `failed`. A `done` record is
 * final and comes back unchanged.
 */
export function applyBatchResult(
  record: MigrationRecord,
  result: MigrationBatchResult,
  now: string,
  { runBy, pendingAtEnd }: ApplyBatchOptions = {},
): MigrationRecord {
  if (record.state === 'done') return record;
  const starting = record.state !== 'running';
  const counts = {
    migrated: record.counts.migrated + result.migrated,
    alreadyDone: record.counts.alreadyDone + result.alreadyDone,
    skipped: record.counts.skipped + result.skipped,
    failed: record.counts.failed + result.failures.length,
  };
  const failures = [...record.failures, ...result.failures].slice(-MAX_MIGRATION_FAILURES);
  const finished = result.cursor === null;
  return {
    ...record,
    state: finished ? (pendingAtEnd === 0 ? 'done' : 'failed') : 'running',
    cursor: result.cursor,
    counts,
    failures,
    startedAt: starting ? now : (record.startedAt ?? now),
    finishedAt: finished ? now : null,
    runBy: runBy ?? record.runBy,
  };
}

/** Retry: start the whole migration again from the beginning (idempotency makes the redo cheap). Keeps `runBy`. */
export function resetMigrationForRetry(record: MigrationRecord): MigrationRecord {
  return {
    ...record,
    state: 'pending',
    cursor: null,
    counts: { ...EMPTY_MIGRATION_COUNTS },
    failures: [],
    startedAt: null,
    finishedAt: null,
  };
}

export interface MigrationReadiness {
  ready: boolean;
  /** `dependsOn` ids that aren't `done` yet (a `failed` or unknown one blocks too) */
  blockedBy: string[];
}

/** Which migrations may run: every `dependsOn` must be `done`. */
export function migrationReadiness(
  registry: ReadonlyArray<{ id: string; dependsOn?: readonly string[] }>,
  records: Readonly<Record<string, MigrationRecord | null | undefined>>,
): Record<string, MigrationReadiness> {
  const out: Record<string, MigrationReadiness> = {};
  for (const migration of registry) {
    const blockedBy = (migration.dependsOn ?? []).filter((dep) => records[dep]?.state !== 'done');
    out[migration.id] = { ready: blockedBy.length === 0, blockedBy };
  }
  return out;
}

/**
 * How Settings → Upgrade data shows a migration (spec 11 · 04): its record's
 * state, or `blocked` (a dependency isn't done) / `notApplicable` (its
 * `status()` says it doesn't apply yet) when it can't run.
 */
export type MigrationRowState = 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'notApplicable';

export function migrationRowState(m: MigrationDto): MigrationRowState {
  const { state } = m.record;
  if (state === 'done' || state === 'failed') return state;
  if (!m.ready) return 'blocked';
  if (state === 'pending' && m.status?.applicable === false) return 'notApplicable';
  return state;
}

/** The first migration (in registry order) the Upgrade button runs next: pending or part-way, and able to run. */
export function nextMigrationToRun(migrations: readonly MigrationDto[], skip: ReadonlySet<string> = new Set()): MigrationDto | null {
  return (
    migrations.find((m) => {
      const row = migrationRowState(m);
      return (row === 'pending' || row === 'running') && !skip.has(m.id);
    }) ?? null
  );
}
