import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMigrations,
  migrationsMode,
  resetMigrations,
  retryMigration,
  runMigrationBatch,
} from './mock-resolvers.js';

const FIRST = 'kpi-target-refs-to-ids';
const SECOND = 'kpi-meta-to-fields';

const byId = (id: string) => getMigrations().migrations.find((m) => m.id === id)!;

function runToEnd(id: string) {
  for (let i = 0; i < 10; i += 1) {
    const record = runMigrationBatch(id);
    if (record.cursor === null) return record;
  }
  throw new Error('never finished');
}

describe('harness data migrations (spec 11 · 02)', () => {
  beforeEach(() => resetMigrations('pending'));

  it('reads ?migrations= and defaults to pending', () => {
    expect(migrationsMode('?migrations=running')).toBe('running');
    expect(migrationsMode('?migrations=done')).toBe('done');
    expect(migrationsMode('?migrations=failed')).toBe('failed');
    expect(migrationsMode('?migrations=bogus')).toBe('pending');
    expect(migrationsMode('')).toBe('pending');
  });

  it('pending: the first is ready, the second is blocked by it', () => {
    expect(byId(FIRST)).toMatchObject({ ready: true, record: { state: 'pending' }, status: { applicable: true, pending: 59 } });
    expect(byId(SECOND)).toMatchObject({ ready: false, blockedBy: [FIRST] });
    expect(() => runMigrationBatch(SECOND)).toThrow("can't run until Point targets at KPI ids is done");
  });

  it('runs batch by batch to done, then unblocks the next', () => {
    expect(runMigrationBatch(FIRST)).toMatchObject({ state: 'running', cursor: '25', counts: { migrated: 25 } });
    const end = runToEnd(FIRST);
    expect(end).toMatchObject({ state: 'done', counts: { migrated: 59, skipped: 1, failed: 0 } });
    expect(byId(FIRST).status).toBeNull();
    expect(byId(SECOND).ready).toBe(true);
    expect(runMigrationBatch(FIRST)).toEqual(end);
    expect(() => retryMigration(FIRST)).toThrow('already done');
  });

  it('starts in each ?migrations= state', () => {
    resetMigrations('running');
    expect(byId(FIRST).record).toMatchObject({ state: 'running', cursor: '25' });
    resetMigrations('done');
    expect(getMigrations().migrations.map((m) => m.record.state)).toEqual(['done', 'done']);
    resetMigrations('failed');
    expect(byId(FIRST)).toMatchObject({ record: { state: 'failed', counts: { failed: 2 } }, status: { pending: 2 } });
    expect(byId(FIRST).record.failures.map((f) => f.issueKey)).toEqual(['APP-4', 'APP-41']);
  });

  it('failed: refuses another batch, and retry runs it to done', () => {
    resetMigrations('failed');
    expect(() => runMigrationBatch(FIRST)).toThrow(/Retry it/);
    expect(retryMigration(FIRST)).toMatchObject({ state: 'pending', cursor: null, failures: [] });
    expect(runToEnd(FIRST)).toMatchObject({ state: 'done', counts: { migrated: 2, alreadyDone: 57, failed: 0 } });
  });
});
