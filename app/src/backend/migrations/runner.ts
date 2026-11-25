import {
  applyBatchResult,
  migrationReadiness,
  newMigrationRecord,
  resetMigrationForRetry,
  type MigrationDto,
  type MigrationRecord,
  type MigrationsData,
} from '../../domain/index';
import { asApp, asUser } from '../requestLog';
import { readMigrationRecord, writeMigrationRecord } from '../storage';
import { migrationRegistry, type Migration, type MigrationContext } from './index';

/**
 * The migration runner behind the Settings resolvers (`getMigrations`,
 * `runMigrationBatch`, `retryMigration`). The client loops `runMigrationBatch`
 * until the record's cursor is null; the record is saved after every batch, so
 * a closed tab or a thrown batch resumes where it stopped.
 */

function contextFor(migration: Migration, accountId: string | null): MigrationContext {
  return { accountId, writer: migration.writeAs === 'user' ? asUser() : asApp(), app: asApp() };
}

function findMigration(id: string): Migration {
  const migration = migrationRegistry().find((m) => m.id === id);
  if (!migration) throw new Error(`There's no data migration called "${id}".`);
  return migration;
}

const titleOf = (id: string): string => migrationRegistry().find((m) => m.id === id)?.title ?? id;

async function readRecords(ids: readonly string[]): Promise<Record<string, MigrationRecord | null>> {
  const records = await Promise.all(ids.map((id) => readMigrationRecord(id)));
  return Object.fromEntries(ids.map((id, i) => [id, records[i]]));
}

/** Every registered migration with its record, readiness and (unless `done`, rule 7) its status. */
export async function listMigrations(accountId: string | null): Promise<MigrationsData> {
  const registry = migrationRegistry();
  const records = await readRecords(registry.map((m) => m.id));
  const readiness = migrationReadiness(registry, records);
  const migrations = await Promise.all(
    registry.map(async (migration): Promise<MigrationDto> => {
      const record = records[migration.id] ?? newMigrationRecord(migration.id);
      const dto: MigrationDto = {
        id: migration.id,
        title: migration.title,
        description: migration.description,
        writeAs: migration.writeAs,
        dependsOn: migration.dependsOn ?? [],
        record,
        ...readiness[migration.id],
        status: null,
      };
      if (record.state === 'done') return dto;
      try {
        dto.status = await migration.status(contextFor(migration, accountId));
      } catch (error) {
        dto.statusError = (error as Error)?.message ?? String(error);
      }
      return dto;
    }),
  );
  return { migrations };
}

/** Run one batch from the saved cursor and save the record. A `done` migration is returned as is. */
export async function runMigrationBatch(
  id: string,
  accountId: string | null,
  now: () => string = () => new Date().toISOString(),
): Promise<MigrationRecord> {
  const migration = findMigration(id);
  const record = (await readMigrationRecord(id)) ?? newMigrationRecord(id);
  if (record.state === 'done') return record;
  if (record.state === 'failed') {
    throw new Error(`${migration.title} finished with work items left to migrate. Retry it to run it again.`);
  }

  const dependsOn = migration.dependsOn ?? [];
  const { blockedBy } = migrationReadiness([migration], await readRecords(dependsOn))[id];
  if (blockedBy.length > 0) {
    const names = blockedBy.map(titleOf).join(', ');
    throw new Error(`${migration.title} can't run until ${names} ${blockedBy.length > 1 ? 'are' : 'is'} done.`);
  }

  const ctx = contextFor(migration, accountId);
  if (record.state === 'pending') {
    const status = await migration.status(ctx);
    if (!status.applicable) throw new Error(status.reason ?? `${migration.title} doesn't apply to this site.`);
  }
  const result = await migration.runBatch(ctx, record.cursor);
  // Rule 6: the run is only done when the app counts nothing left.
  const pendingAtEnd = result.cursor === null ? (await migration.status(ctx)).pending : undefined;
  return writeMigrationRecord(applyBatchResult(record, result, now(), { runBy: accountId, pendingAtEnd }));
}

/** Start a `failed` (or unfinished) migration again from the beginning. A `done` one is final. */
export async function retryMigration(id: string): Promise<MigrationRecord> {
  const migration = findMigration(id);
  const record = (await readMigrationRecord(id)) ?? newMigrationRecord(id);
  if (record.state === 'done') throw new Error(`${migration.title} is already done.`);
  return writeMigrationRecord(resetMigrationForRetry(record));
}
