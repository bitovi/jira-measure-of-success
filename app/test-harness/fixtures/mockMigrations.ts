import {
  applyBatchResult,
  migrationReadiness,
  newMigrationRecord,
  resetMigrationForRetry,
  type MigrationDto,
  type MigrationFailure,
  type MigrationRecord,
  type MigrationsData,
  type MigrationStatus,
} from '@domain/index.js';

/**
 * In-memory stand-ins for 03's and 05's data migrations (spec 11 · 02), run
 * with the same pure bookkeeping as the backend (applyBatchResult etc.). The
 * second depends on the first (harness only), so the blocked state shows too.
 * Each `createMockMigrations` call is independent, so stories get their own.
 */
export type MigrationsMode = 'pending' | 'running' | 'done' | 'failed';

const MIGRATION_BATCH = 25;
const MOCK_ADMIN = 'acc-jm';

export const FIRST_MIGRATION = 'kpi-target-refs-to-ids';
export const SECOND_MIGRATION = 'kpi-meta-to-fields';

interface MockMigrationItem {
  issueId: string;
  issueKey: string;
  state: 'todo' | 'migrated' | 'skip';
  /** fails the next attempt (then succeeds, so a retry can finish) */
  failOnce: boolean;
}

interface MockMigration {
  dto: Pick<MigrationDto, 'id' | 'title' | 'description' | 'writeAs' | 'dependsOn'>;
  items: MockMigrationItem[];
  record: MigrationRecord;
}

export interface MockMigrationsOptions {
  /** whether a migration applies to the install yet (05's needs the KPI fields); default: always */
  applicability?: (id: string) => Pick<MigrationStatus, 'applicable' | 'reason'>;
  /** the second migration's work items (default 12) */
  secondItems?: number;
}

export interface MockMigrations {
  getMigrations(): MigrationsData;
  runMigrationBatch(id: string): MigrationRecord;
  retryMigration(id: string): MigrationRecord;
}

const mockItems = (prefix: string, count: number, skip: number[] = []): MockMigrationItem[] =>
  Array.from({ length: count }, (_, i) => ({
    issueId: String(70_000 + i),
    issueKey: `${prefix}-${i + 1}`,
    state: skip.includes(i) ? 'skip' : 'todo',
    failOnce: false,
  }));

export function migrationsMode(search: string = globalThis.location?.search ?? ''): MigrationsMode {
  const mode = new URLSearchParams(search).get('migrations');
  return mode === 'running' || mode === 'done' || mode === 'failed' ? mode : 'pending';
}

export function createMockMigrations(mode: MigrationsMode = 'pending', options: MockMigrationsOptions = {}): MockMigrations {
  const applicability = options.applicability ?? (() => ({ applicable: true }));
  const migrations: MockMigration[] = [
    {
      dto: {
        id: FIRST_MIGRATION,
        title: 'Point targets at KPI ids',
        description:
          "Saves each KPI's issue id next to its key on every target, so targets keep working when a KPI moves to another space.",
        writeAs: 'app',
        dependsOn: [],
      },
      items: mockItems('APP', 60, [59]),
      record: newMigrationRecord(FIRST_MIGRATION),
    },
    {
      dto: {
        id: SECOND_MIGRATION,
        title: 'Move unit and direction into fields',
        description: "Copies each KPI's unit and direction into the KPI fields chosen above.",
        writeAs: 'user',
        dependsOn: [FIRST_MIGRATION],
      },
      items: mockItems('KPI', options.secondItems ?? 12),
      record: newMigrationRecord(SECOND_MIGRATION),
    },
  ];

  const pendingCount = (m: MockMigration): number => m.items.filter((i) => i.state === 'todo').length;

  function runMockBatch(m: MockMigration, now: string): MigrationRecord {
    const start = Number(m.record.cursor ?? 0);
    const page = m.items.slice(start, start + MIGRATION_BATCH);
    const result = { migrated: 0, alreadyDone: 0, skipped: 0, failures: [] as MigrationFailure[] };
    for (const item of page) {
      if (item.state === 'skip') result.skipped += 1;
      else if (item.state === 'migrated') result.alreadyDone += 1;
      else if (item.failOnce) {
        item.failOnce = false;
        result.failures.push({
          issueId: item.issueId,
          issueKey: item.issueKey,
          message: `Jira 403: You do not have permission to edit ${item.issueKey}.`,
        });
      } else {
        item.state = 'migrated';
        result.migrated += 1;
      }
    }
    const end = start + page.length;
    const cursor = end < m.items.length ? String(end) : null;
    m.record = applyBatchResult(m.record, { cursor, ...result }, now, {
      runBy: MOCK_ADMIN,
      pendingAtEnd: cursor === null ? pendingCount(m) : undefined,
    });
    return m.record;
  }

  function find(id: string): MockMigration {
    const m = migrations.find((x) => x.dto.id === id);
    if (!m) throw new Error(`There's no data migration called "${id}".`);
    return m;
  }

  const recordsById = (): Record<string, MigrationRecord> => Object.fromEntries(migrations.map((m) => [m.dto.id, m.record]));

  const [first] = migrations;
  const start = '2026-07-10T09:00:00.000Z';
  if (mode === 'running') {
    runMockBatch(first, start);
  } else if (mode === 'done') {
    for (const m of migrations) while (m.record.state !== 'done') runMockBatch(m, start);
  } else if (mode === 'failed') {
    first.items[3].failOnce = true;
    first.items[40].failOnce = true;
    while (first.record.state === 'pending' || first.record.state === 'running') runMockBatch(first, start);
  }

  return {
    getMigrations(): MigrationsData {
      const readiness = migrationReadiness(
        migrations.map((m) => m.dto),
        recordsById(),
      );
      return {
        migrations: migrations.map((m) => {
          const applies = applicability(m.dto.id);
          return {
            ...structuredClone(m.dto),
            record: structuredClone(m.record),
            ...readiness[m.dto.id],
            status:
              m.record.state === 'done'
                ? null
                : applies.applicable
                  ? { applicable: true, pending: pendingCount(m) }
                  : { applicable: false, reason: applies.reason, pending: null },
          };
        }),
      };
    },

    runMigrationBatch(id: string): MigrationRecord {
      const m = find(id);
      if (m.record.state === 'done') return structuredClone(m.record);
      if (m.record.state === 'failed') {
        throw new Error(`${m.dto.title} finished with work items left to migrate. Retry it to run it again.`);
      }
      const { blockedBy } = migrationReadiness([m.dto], recordsById())[id];
      if (blockedBy.length > 0) {
        const names = blockedBy.map((dep) => find(dep).dto.title).join(', ');
        throw new Error(`${m.dto.title} can't run until ${names} ${blockedBy.length > 1 ? 'are' : 'is'} done.`);
      }
      const applies = applicability(id);
      if (m.record.state === 'pending' && !applies.applicable) {
        throw new Error(applies.reason ?? `${m.dto.title} doesn't apply to this install yet.`);
      }
      return structuredClone(runMockBatch(m, new Date().toISOString()));
    },

    retryMigration(id: string): MigrationRecord {
      const m = find(id);
      if (m.record.state === 'done') throw new Error(`${m.dto.title} is already done.`);
      m.record = resetMigrationForRetry(m.record);
      return structuredClone(m.record);
    },
  };
}

/** The same set behind async calls (like the bridge), each batch taking `delayMs`: for stories. */
export function mockMigrationsApi(mock: MockMigrations, delayMs = 0) {
  const later = <T>(fn: () => T, ms = 0): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      }, ms),
    );
  return {
    getMigrations: () => later(() => mock.getMigrations()),
    runMigrationBatch: (id: string) => later(() => mock.runMigrationBatch(id), delayMs),
    retryMigration: (id: string) => later(() => mock.retryMigration(id)),
  };
}
