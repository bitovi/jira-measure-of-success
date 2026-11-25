import { z } from 'zod';

/**
 * Data migrations (spec 11 · 02): one record per migration, kept in Forge KVS
 * under `kpi:migration:{id}`. The runner moves it through
 * pending → running → done | failed; `done` is final.
 */
export const MigrationState = z.enum(['pending', 'running', 'done', 'failed']);
export type MigrationState = z.infer<typeof MigrationState>;

/** A work item a batch couldn't migrate, with Jira's (or the planner's) message. */
export const MigrationFailure = z.object({
  issueId: z.string(),
  issueKey: z.string(),
  message: z.string(),
});
export type MigrationFailure = z.infer<typeof MigrationFailure>;

const count = z.number().int().nonnegative();

export const MigrationCounts = z.object({
  migrated: count,
  alreadyDone: count,
  skipped: count,
  failed: count,
});
export type MigrationCounts = z.infer<typeof MigrationCounts>;

/** How many failures a record keeps (the most recent ones). */
export const MAX_MIGRATION_FAILURES = 50;

export const MigrationRecord = z.object({
  id: z.string().min(1),
  state: MigrationState,
  /** resume point: search/jql's `nextPageToken`; null = start (or finished) */
  cursor: z.string().nullable(),
  counts: MigrationCounts,
  /** the last MAX_MIGRATION_FAILURES failures */
  failures: z.array(MigrationFailure),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** accountId of the admin who last ran it */
  runBy: z.string().nullable(),
});
export type MigrationRecord = z.infer<typeof MigrationRecord>;

/** What one `runBatch` reports. `cursor: null` = the migration has nothing left to page through. */
export interface MigrationBatchResult {
  cursor: string | null;
  migrated: number;
  alreadyDone: number;
  skipped: number;
  failures: MigrationFailure[];
}

/** A migration's own view of the install, counted as the app (`pending: null` = couldn't count). */
export interface MigrationStatus {
  applicable: boolean;
  reason?: string;
  pending: number | null;
}

export const EMPTY_MIGRATION_COUNTS: MigrationCounts = { migrated: 0, alreadyDone: 0, skipped: 0, failed: 0 };

/** The record of a migration that has never run. */
export function newMigrationRecord(id: string): MigrationRecord {
  return {
    id,
    state: 'pending',
    cursor: null,
    counts: { ...EMPTY_MIGRATION_COUNTS },
    failures: [],
    startedAt: null,
    finishedAt: null,
    runBy: null,
  };
}
