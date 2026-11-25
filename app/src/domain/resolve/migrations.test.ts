import { describe, expect, it } from 'vitest';
import {
  MAX_MIGRATION_FAILURES,
  MigrationRecord,
  newMigrationRecord,
  type MigrationBatchResult,
  type MigrationFailure,
} from '../models/migration';
import type { MigrationDto } from '../contracts';
import { applyBatchResult, migrationReadiness, migrationRowState, nextMigrationToRun, resetMigrationForRetry } from './migrations';

const T1 = '2026-11-24T10:00:00.000Z';
const T2 = '2026-11-24T10:00:05.000Z';
const T3 = '2026-11-24T10:00:10.000Z';

const failure = (n: number): MigrationFailure => ({ issueId: String(n), issueKey: `APP-${n}`, message: `boom ${n}` });

const batch = (over: Partial<MigrationBatchResult> = {}): MigrationBatchResult => ({
  cursor: 'page-2',
  migrated: 20,
  alreadyDone: 3,
  skipped: 2,
  failures: [],
  ...over,
});

describe('MigrationRecord', () => {
  it('accepts a fresh record and refuses a bad state or negative count', () => {
    expect(MigrationRecord.parse(newMigrationRecord('m1'))).toEqual(newMigrationRecord('m1'));
    expect(MigrationRecord.safeParse({ ...newMigrationRecord('m1'), state: 'paused' }).success).toBe(false);
    const counts = { migrated: -1, alreadyDone: 0, skipped: 0, failed: 0 };
    expect(MigrationRecord.safeParse({ ...newMigrationRecord('m1'), counts }).success).toBe(false);
  });
});

describe('applyBatchResult', () => {
  it('first batch: starts the run and records who ran it', () => {
    const next = applyBatchResult(newMigrationRecord('m1'), batch(), T1, { runBy: 'acc-1' });
    expect(next).toEqual({
      id: 'm1',
      state: 'running',
      cursor: 'page-2',
      counts: { migrated: 20, alreadyDone: 3, skipped: 2, failed: 0 },
      failures: [],
      startedAt: T1,
      finishedAt: null,
      runBy: 'acc-1',
    });
  });

  it('middle batch: adds the counts and keeps the start time', () => {
    const first = applyBatchResult(newMigrationRecord('m1'), batch(), T1, { runBy: 'acc-1' });
    const next = applyBatchResult(first, batch({ cursor: 'page-3', migrated: 25, alreadyDone: 0, skipped: 0 }), T2);
    expect(next).toMatchObject({
      state: 'running',
      cursor: 'page-3',
      counts: { migrated: 45, alreadyDone: 3, skipped: 2, failed: 0 },
      startedAt: T1,
      finishedAt: null,
      runBy: 'acc-1',
    });
  });

  it('final batch with nothing pending: done', () => {
    const first = applyBatchResult(newMigrationRecord('m1'), batch(), T1, { runBy: 'acc-1' });
    const next = applyBatchResult(first, batch({ cursor: null, migrated: 5 }), T2, { pendingAtEnd: 0 });
    expect(next).toMatchObject({ state: 'done', cursor: null, startedAt: T1, finishedAt: T2 });
    expect(next.counts.migrated).toBe(25);
  });

  it('a single batch that is also the last: starts and finishes', () => {
    const next = applyBatchResult(newMigrationRecord('m1'), batch({ cursor: null }), T1, {
      runBy: 'acc-1',
      pendingAtEnd: 0,
    });
    expect(next).toMatchObject({ state: 'done', startedAt: T1, finishedAt: T1 });
  });

  it('a batch with failures: counts and lists them, and carries on', () => {
    const next = applyBatchResult(newMigrationRecord('m1'), batch({ failures: [failure(1), failure(2)] }), T1);
    expect(next.state).toBe('running');
    expect(next.counts.failed).toBe(2);
    expect(next.failures).toEqual([failure(1), failure(2)]);
  });

  it('final batch after failures: failed, with the failure list', () => {
    const first = applyBatchResult(newMigrationRecord('m1'), batch({ failures: [failure(1)] }), T1);
    const next = applyBatchResult(first, batch({ cursor: null }), T2, { pendingAtEnd: 1 });
    expect(next).toMatchObject({ state: 'failed', cursor: null, finishedAt: T2 });
    expect(next.failures).toEqual([failure(1)]);
  });

  it('final batch with an unknown pending count: failed', () => {
    const next = applyBatchResult(newMigrationRecord('m1'), batch({ cursor: null }), T1, { pendingAtEnd: null });
    expect(next.state).toBe('failed');
    expect(applyBatchResult(newMigrationRecord('m1'), batch({ cursor: null }), T1).state).toBe('failed');
  });

  it('final batch with items left (e.g. hidden from the admin) but no failures: failed', () => {
    const next = applyBatchResult(newMigrationRecord('m1'), batch({ cursor: null }), T1, { pendingAtEnd: 4 });
    expect(next.state).toBe('failed');
    expect(next.failures).toEqual([]);
  });

  it('retry after failures: done once nothing is left pending', () => {
    const failed = applyBatchResult(newMigrationRecord('m1'), batch({ cursor: null, failures: [failure(1)] }), T1, {
      runBy: 'acc-1',
      pendingAtEnd: 1,
    });
    const retried = resetMigrationForRetry(failed);
    const next = applyBatchResult(retried, batch({ cursor: null, migrated: 1, alreadyDone: 24, skipped: 0 }), T3, {
      runBy: 'acc-2',
      pendingAtEnd: 0,
    });
    expect(next).toMatchObject({
      state: 'done',
      counts: { migrated: 1, alreadyDone: 24, skipped: 0, failed: 0 },
      failures: [],
      startedAt: T3,
      finishedAt: T3,
      runBy: 'acc-2',
    });
  });

  it('keeps only the last 50 failures', () => {
    const first = applyBatchResult(
      newMigrationRecord('m1'),
      batch({ failures: Array.from({ length: 30 }, (_, i) => failure(i)) }),
      T1,
    );
    const next = applyBatchResult(first, batch({ failures: Array.from({ length: 30 }, (_, i) => failure(100 + i)) }), T2);
    expect(next.counts.failed).toBe(60);
    expect(next.failures).toHaveLength(MAX_MIGRATION_FAILURES);
    expect(next.failures[0]).toEqual(failure(10));
    expect(next.failures.at(-1)).toEqual(failure(129));
  });

  it('leaves a done record alone', () => {
    const done = applyBatchResult(newMigrationRecord('m1'), batch({ cursor: null }), T1, { pendingAtEnd: 0 });
    expect(applyBatchResult(done, batch(), T2, { runBy: 'acc-2' })).toBe(done);
  });
});

describe('resetMigrationForRetry', () => {
  it('resets the cursor, counts, failures and times, and keeps runBy', () => {
    const running = applyBatchResult(newMigrationRecord('m1'), batch({ failures: [failure(1)] }), T1, { runBy: 'acc-1' });
    expect(resetMigrationForRetry(running)).toEqual({ ...newMigrationRecord('m1'), runBy: 'acc-1' });
  });
});

describe('migrationReadiness', () => {
  const registry = [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a', 'b'] }, { id: 'd', dependsOn: ['gone'] }];
  const withState = (state: MigrationRecord['state']) => ({ ...newMigrationRecord('x'), state });

  it('is ready without dependencies, and blocked until each dependency is done', () => {
    expect(migrationReadiness(registry, {})).toEqual({
      a: { ready: true, blockedBy: [] },
      b: { ready: false, blockedBy: ['a'] },
      c: { ready: false, blockedBy: ['a', 'b'] },
      d: { ready: false, blockedBy: ['gone'] },
    });
  });

  it('unblocks once a dependency is done', () => {
    const r = migrationReadiness(registry, { a: withState('done'), b: withState('running') });
    expect(r.b).toEqual({ ready: true, blockedBy: [] });
    expect(r.c).toEqual({ ready: false, blockedBy: ['b'] });
  });

  it('stays blocked by a failed dependency', () => {
    expect(migrationReadiness(registry, { a: withState('failed') }).b).toEqual({ ready: false, blockedBy: ['a'] });
  });
});

describe('migrationRowState / nextMigrationToRun (Settings → Upgrade data)', () => {
  const dto = (id: string, over: Partial<MigrationDto> = {}, record: Partial<MigrationRecord> = {}): MigrationDto => ({
    id,
    title: id,
    description: '',
    writeAs: 'app',
    dependsOn: [],
    record: { ...newMigrationRecord(id), ...record },
    ready: true,
    blockedBy: [],
    status: { applicable: true, pending: 3 },
    ...over,
  });

  it.each([
    ['pending', dto('a'), 'pending'],
    ['part-way', dto('a', {}, { state: 'running' }), 'running'],
    ['done', dto('a', { status: null }, { state: 'done' }), 'done'],
    ['failed', dto('a', {}, { state: 'failed' }), 'failed'],
    ['waiting for a dependency', dto('a', { ready: false, blockedBy: ['b'] }), 'blocked'],
    ['not applicable yet', dto('a', { status: { applicable: false, reason: 'no fields', pending: null } }), 'notApplicable'],
    ['counted without status (status() failed)', dto('a', { status: null, statusError: 'x' }), 'pending'],
  ] as const)('%s', (_name, m, expected) => {
    expect(migrationRowState(m)).toBe(expected);
  });

  it('runs the first runnable one in order, skipping done, failed, blocked and not applicable', () => {
    const list = [
      dto('done', { status: null }, { state: 'done' }),
      dto('failed', {}, { state: 'failed' }),
      dto('blocked', { ready: false, blockedBy: ['failed'] }),
      dto('na', { status: { applicable: false, pending: null } }),
      dto('paused', {}, { state: 'running' }),
      dto('next'),
    ];
    expect(nextMigrationToRun(list)?.id).toBe('paused');
    expect(nextMigrationToRun(list, new Set(['paused']))?.id).toBe('next');
    expect(nextMigrationToRun(list.slice(0, 4))).toBeNull();
  });
});
