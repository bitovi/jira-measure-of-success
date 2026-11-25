import type { MigrationBatchResult, MigrationFailure, MigrationStatus } from '../../domain/index';
import type { RequestJira } from '../requestLog';
import { kpiMetaToFields } from './kpiMetaToFields';
import { kpiTargetRefsToIds } from './kpiTargetRefsToIds';

/**
 * Data migrations (spec 11 · 02): moving existing data to new storage, run by a
 * Jira admin from Settings, one batch per `runMigrationBatch` call. See
 * specs/11-scalable-data/02-migration-framework/plan.md for the rules every
 * migration follows (idempotent per item, batched and resumable, copy only).
 */

export interface MigrationContext {
  /** the admin running it */
  accountId: string | null;
  /** Jira as whoever the migration writes as (`writeAs`) */
  writer: { requestJira: RequestJira };
  /** Jira as the app: `status()` counts with this, so items the admin can't see still count (rule 6) */
  app: { requestJira: RequestJira };
}

export interface Migration {
  id: string;
  /** shown in Settings */
  title: string;
  description: string;
  dependsOn?: string[];
  /** Who the writes run as. 'user' = the admin running it (named in Jira History). */
  writeAs: 'user' | 'app';
  /** Is it relevant on this install, and how much is left. Counted AS THE APP. */
  status(ctx: MigrationContext): Promise<MigrationStatus>;
  /** At most one batch (MIGRATION_BATCH_SIZE items) from `cursor`. Must be idempotent. */
  runBatch(ctx: MigrationContext, cursor: string | null): Promise<MigrationBatchResult>;
}

/** Items per batch: 25 writes, five at a time, fit well inside one resolver invocation (01 E1). */
export const MIGRATION_BATCH_SIZE = 25;
/** Per-item writes in flight at once. */
export const MIGRATION_WRITE_CONCURRENCY = 5;

/**
 * Every migration, in the order they run. Later stages add theirs here. A
 * function, not a constant: the migrations import this module's helpers, so the
 * list can't be built while this module is still loading.
 */
const MIGRATIONS = (): Migration[] => [kpiTargetRefsToIds, kpiMetaToFields];

let registryOverride: readonly Migration[] | null = null;

export function migrationRegistry(): readonly Migration[] {
  return registryOverride ?? MIGRATIONS();
}

/** Tests only: replace the registry (null restores the real one). */
export function setMigrationRegistryForTests(migrations: readonly Migration[] | null): void {
  registryOverride = migrations;
}

/** `fn` over `items` with at most `limit` running at once; results keep the items' order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

export type MigrationItemOutcome = 'migrated' | 'alreadyDone' | 'skipped';

export interface MigrationItem {
  issueId: string;
  issueKey: string;
}

/**
 * Migrate one batch's items, MIGRATION_WRITE_CONCURRENCY at a time, and tally the
 * outcomes. An item that throws is a failure (with its message), not the end of
 * the batch (rule 4). The caller adds the cursor.
 */
export async function migrateItems<T extends MigrationItem>(
  items: readonly T[],
  migrate: (item: T) => Promise<MigrationItemOutcome>,
): Promise<Omit<MigrationBatchResult, 'cursor'>> {
  const outcomes = await mapWithConcurrency(items, MIGRATION_WRITE_CONCURRENCY, async (item) => {
    try {
      return await migrate(item);
    } catch (error) {
      const failure: MigrationFailure = {
        issueId: item.issueId,
        issueKey: item.issueKey,
        message: error instanceof Error ? error.message : String(error),
      };
      return failure;
    }
  });
  const result: Omit<MigrationBatchResult, 'cursor'> = { migrated: 0, alreadyDone: 0, skipped: 0, failures: [] };
  for (const outcome of outcomes) {
    if (typeof outcome === 'string') result[outcome] += 1;
    else result.failures.push(outcome);
  }
  return result;
}
