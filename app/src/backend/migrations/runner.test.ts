import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScaleFixture, createMockJira, type MockJira } from '../testing/scaleFixture';
import { createTestMigration, TEST_COPY_PROPERTY, type TestMigrationSwitches } from '../testing/testMigration';
import type { MigrationRecord, MigrationsData } from '../../domain/index';
import type { Migration } from './index';

/**
 * The migration runner (spec 11 · 02) through the REAL resolver, against the
 * scale fixture's in-memory Jira and KVS, with a test-only migration.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('../testing/scaleFixture');
  return { default: mockForgeApi(() => h.jira!), ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.jira!.fixture.kvs.get(key),
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, structuredClone(value));
    },
  },
}));

// 60 target-carrying epics: three batches of 25, 25 and 10.
const FIXTURE = { kpis: 10, initiatives: 3, epicsPerInitiative: 20, storiesPerEpic: 0, subtasksPerStory: 0 };
const SETTINGS = { moduleKey: 'kpi-settings-page' };

type Handler = (req: unknown, runtime: unknown) => Promise<unknown>;
let handler: Handler;
let jira: MockJira;
let test: { migration: Migration; switches: TestMigrationSwitches };

async function load(migrations: (m: Migration) => Migration[] = (m) => [m]) {
  vi.resetModules();
  jira = createMockJira(buildScaleFixture(FIXTURE));
  h.jira = jira;
  test = createTestMigration();
  (await import('./index')).setMigrationRegistryForTests(migrations(test.migration));
  handler = (await import('../resolver')).handler as Handler;
}

async function call<T>(key: string, payload: unknown = {}, context: Record<string, unknown> = SETTINGS, accountId = 'acc-1') {
  return (await handler({ call: { functionKey: key, payload }, context }, { principal: { accountId } })) as T;
}

const runBatch = (id = 'test-copy', accountId?: string) =>
  call<MigrationRecord>('runMigrationBatch', { id }, SETTINGS, accountId);

/** Loop batches like the client does, until the cursor is null. */
async function runToEnd(id = 'test-copy', accountId?: string): Promise<MigrationRecord> {
  for (let i = 0; i < 20; i += 1) {
    const record = await runBatch(id, accountId);
    if (record.cursor === null) return record;
  }
  throw new Error('migration never finished');
}

const copied = () =>
  jira.fixture.contributorIds.filter((id) => jira.fixture.issues.get(id)!.properties[TEST_COPY_PROPERTY] !== undefined);
const record = () => jira.fixture.kvs.get('kpi:migration:test-copy') as MigrationRecord | undefined;

beforeEach(async () => {
  await load();
});

describe('runMigrationBatch', () => {
  it('runs batch by batch, saving the cursor, and ends done when nothing is pending', async () => {
    const first = await runBatch();
    expect(first).toMatchObject({ state: 'running', counts: { migrated: 25, alreadyDone: 0, skipped: 0, failed: 0 }, runBy: 'acc-1' });
    expect(first.cursor).not.toBeNull();
    expect(record()).toEqual(first);
    expect(copied()).toHaveLength(25);

    const second = await runBatch();
    expect(second.counts.migrated).toBe(50);
    const last = await runBatch();
    expect(last).toMatchObject({ state: 'done', cursor: null, counts: { migrated: 60, failed: 0 } });
    expect(last.finishedAt).not.toBeNull();
    expect(copied()).toHaveLength(60);
    expect(jira.unhandled).toEqual([]);
  });

  it('writes as the user for a writeAs: user migration', async () => {
    await runBatch();
    expect(jira.writes.filter((w) => w.includes(TEST_COPY_PROPERTY))).toHaveLength(25);
    // The mock only refuses user writes; prove the writes went as the user by denying edit.
    await load();
    jira.fixture.userView.access.APP = { browse: true, create: true, edit: false, link: true };
    const r = await runBatch();
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures[0].message).toMatch(/permission to edit APP-/);
  });

  it('resumes after a thrown batch, and the redone items are already done', async () => {
    test.switches.throwMidBatch = true;
    await expect(runBatch()).rejects.toThrow('Simulated batch failure');
    expect(record()).toBeUndefined();
    expect(copied()).toHaveLength(5);

    const first = await runBatch();
    expect(first.counts).toEqual({ migrated: 20, alreadyDone: 5, skipped: 0, failed: 0 });
    const second = await runBatch();
    test.switches.throwMidBatch = true;
    await expect(runBatch()).rejects.toThrow('Simulated batch failure');
    expect(record()).toEqual(second);
    expect((await runToEnd()).state).toBe('done');
  });

  it('counts per-item failures without stopping, then ends failed with the list; retry finishes it', async () => {
    const [a, b] = jira.fixture.contributorIds;
    test.switches.failIds = new Set([a, b]);
    const end = await runToEnd();
    expect(end).toMatchObject({ state: 'failed', counts: { migrated: 58, failed: 2 } });
    expect(end.failures.map((f) => f.issueId)).toEqual([a, b]);
    expect(end.failures[0]).toMatchObject({ issueKey: jira.fixture.issues.get(a)!.key, message: expect.stringMatching(/permission/) });
    expect(copied()).toHaveLength(58);

    await expect(runBatch()).rejects.toThrow(/Retry it/);

    test.switches.failIds.clear();
    const reset = await call<MigrationRecord>('retryMigration', { id: 'test-copy' }, SETTINGS, 'acc-2');
    expect(reset).toMatchObject({ state: 'pending', cursor: null, failures: [], counts: { migrated: 0, failed: 0 }, runBy: 'acc-1' });
    const retried = await runToEnd('test-copy', 'acc-2');
    expect(retried).toMatchObject({ state: 'done', counts: { migrated: 2, alreadyDone: 58, failed: 0 }, runBy: 'acc-2' });
  });

  it('is idempotent: re-running a finished migration from the start changes nothing', async () => {
    await runToEnd();
    const snapshot = structuredClone(jira.fixture.contributorIds.map((id) => jira.fixture.issues.get(id)!.properties));
    const writesBefore = jira.writes.length;
    // Done is final: another batch returns the record as is.
    expect((await runBatch()).state).toBe('done');
    // Running the batches again from the start (as a retry would) writes nothing.
    jira.fixture.kvs.delete('kpi:migration:test-copy');
    const again = await runToEnd();
    expect(again.counts).toEqual({ migrated: 0, alreadyDone: 60, skipped: 0, failed: 0 });
    expect(jira.writes.length).toBe(writesBefore);
    expect(jira.fixture.contributorIds.map((id) => jira.fixture.issues.get(id)!.properties)).toEqual(snapshot);
  });

  it('only ends done when the app counts nothing left: items hidden from the admin keep it failed', async () => {
    const hidden = jira.fixture.contributorIds.slice(0, 3);
    for (const id of hidden) jira.fixture.userView.hidden.add(id);
    const end = await runToEnd();
    expect(end).toMatchObject({ state: 'failed', counts: { migrated: 57, failed: 0 }, failures: [] });
    const { migrations } = await call<MigrationsData>('getMigrations');
    expect(migrations[0].status).toEqual({ applicable: true, pending: 3 });
  });

  it("doesn't count skipped items as pending", async () => {
    test.switches.skipIds = new Set(jira.fixture.contributorIds.slice(0, 4));
    const end = await runToEnd();
    expect(end).toMatchObject({ state: 'done', counts: { migrated: 56, skipped: 4, failed: 0 } });
  });

  it('two interleaved runs end with the same data as one run', async () => {
    await runToEnd();
    const single = jira.fixture.contributorIds.map((id) => jira.fixture.issues.get(id)!.properties);
    await load();
    const [a, b] = await Promise.all([runToEnd('test-copy', 'acc-1'), runToEnd('test-copy', 'acc-2')]);
    expect(a.state).toBe('done');
    expect(b.state).toBe('done');
    expect(jira.fixture.contributorIds.map((id) => jira.fixture.issues.get(id)!.properties)).toEqual(single);
  });

  it('refuses to run before its dependencies are done (including a failed one)', async () => {
    await load((m) => [
      { ...createTestMigration({ id: 'first', title: 'First step' }).migration },
      { ...m, dependsOn: ['first'] },
    ]);
    await expect(runBatch()).rejects.toThrow("Test copy can't run until First step is done.");
    jira.fixture.kvs.set('kpi:migration:first', { ...(await runBatch('first')), state: 'failed', cursor: null });
    await expect(runBatch()).rejects.toThrow("can't run until First step is done");
    expect(copied()).toHaveLength(25); // only the first migration's batch (same fixture issues)
    expect(test.switches.batchCalls).toBe(0);
  });

  it('refuses a migration that does not apply to this site', async () => {
    test.switches.applicable = false;
    await expect(runBatch()).rejects.toThrow('Nothing to copy on this site.');
    expect(test.switches.batchCalls).toBe(0);
  });

  it('refuses an unknown migration', async () => {
    await expect(runBatch('nope')).rejects.toThrow('There\'s no data migration called "nope".');
  });

  it('refuses a non-admin and a call from outside Settings', async () => {
    await expect(call('runMigrationBatch', { id: 'test-copy' }, {})).rejects.toThrow(/KPI Settings admin page/);
    await expect(call('retryMigration', { id: 'test-copy' }, {})).rejects.toThrow(/KPI Settings admin page/);
    await expect(call('getMigrations', {}, { moduleKey: 'kpi-timeline-page' })).rejects.toThrow(/KPI Settings admin page/);
    jira.fixture.userView.isAdmin = false;
    await expect(runBatch()).rejects.toThrow('Only Jira admins can change KPI settings.');
    await expect(call('retryMigration', { id: 'test-copy' })).rejects.toThrow('Only Jira admins');
    expect(test.switches.batchCalls).toBe(0);
    expect(record()).toBeUndefined();
  });
});

describe('retryMigration', () => {
  it('refuses a done migration (done is final)', async () => {
    await runToEnd();
    await expect(call('retryMigration', { id: 'test-copy' })).rejects.toThrow('Test copy is already done.');
  });
});

describe('getMigrations', () => {
  it('lists each migration with a fresh pending record, readiness and status', async () => {
    await load((m) => [m, { ...createTestMigration({ id: 'second', title: 'Second' }).migration, dependsOn: ['test-copy'] }]);
    const { migrations } = await call<MigrationsData>('getMigrations');
    expect(migrations.map((m) => m.id)).toEqual(['test-copy', 'second']);
    expect(migrations[0]).toMatchObject({
      title: 'Test copy',
      writeAs: 'user',
      dependsOn: [],
      ready: true,
      blockedBy: [],
      record: { id: 'test-copy', state: 'pending', cursor: null },
      status: { applicable: true, pending: 60 },
    });
    expect(migrations[1]).toMatchObject({ ready: false, blockedBy: ['test-copy'], dependsOn: ['test-copy'] });
  });

  it("doesn't call status() for a done migration", async () => {
    await runToEnd();
    test.switches.statusCalls = 0;
    const { migrations } = await call<MigrationsData>('getMigrations');
    expect(migrations[0]).toMatchObject({ record: { state: 'done' }, status: null });
    expect(test.switches.statusCalls).toBe(0);
  });

  it('reports a status() that throws without failing the list', async () => {
    test.migration.status = async () => {
      throw new Error('Jira 500');
    };
    const { migrations } = await call<MigrationsData>('getMigrations');
    expect(migrations[0]).toMatchObject({ status: null, statusError: 'Jira 500' });
  });

  it('is an empty list with the real (empty) registry', async () => {
    (await import('./index')).setMigrationRegistryForTests(null);
    expect(await call<MigrationsData>('getMigrations')).toEqual({ migrations: [] });
  });
});
