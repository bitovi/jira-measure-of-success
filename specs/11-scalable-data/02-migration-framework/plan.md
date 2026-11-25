# 02 — Migration framework

Part of [11 — Scalable KPI data](../plan.md). Status: **Done** · Depends on: 01.

## Goal

A small, general way to move existing data to new storage, shared by every migration in this spec
(03's target references, 05's unit and direction) and the cleanup release (09). This stage builds the
**backend and the harness mocks only**. The Settings UI ("Upgrade data") is designed in 04's
prototype review (gate G2) and built in 04.

## Design

### Model (`@domain`, pure + Zod: `domain/models/migration.ts`)

```ts
MigrationRecord = {
  id: string;                          // e.g. 'kpi-target-refs-to-ids'
  state: 'pending' | 'running' | 'done' | 'failed';
  cursor: string | null;               // resume point: search/jql's nextPageToken (01 E2), null = start
  counts: { migrated: number; alreadyDone: number; skipped: number; failed: number };
  failures: Array<{ issueId: string; issueKey: string; message: string }>;  // last 50
  startedAt: string | null;
  finishedAt: string | null;
  runBy: string | null;                // accountId of the admin who ran it
};
```

- Stored in Forge KVS, **one key per migration** (`kpi:migration:{id}`), so two migrations never
  overwrite each other's record. It's app-internal bookkeeping, like `kpi:space`
  ([storage.ts](../../../app/src/backend/storage.ts)).
- KVS is **per install** (per Forge environment). On a site with several installs (dev, staging,
  prod), each keeps its own record. The second install to run a migration finds the data already
  migrated, so its run is fast and all "already done".

### Registry (`backend/migrations/index.ts`)

An **ordered** list. Each migration has:

```ts
interface Migration {
  id: string;
  title: string;                       // shown in Settings
  description: string;
  dependsOn?: string[];
  /** Who the writes run as. 'user' = the admin running it (named in Jira History). */
  writeAs: 'user' | 'app';
  /** Is it relevant on this install, and how much is left. Counted AS THE APP. */
  status(ctx): Promise<{ applicable: boolean; reason?: string; pending: number | null }>;
  /** At most one batch from `cursor`. Must be idempotent. */
  runBatch(ctx, cursor: string | null): Promise<{
    cursor: string | null;             // null = finished
    migrated: number; alreadyDone: number; skipped: number;
    failures: Array<{ issueId: string; issueKey: string; message: string }>;
  }>;
}
```

### Rules every migration follows

1. **Idempotent per item.** Running a batch twice, or two admins running it at once, gives the same
   result. Each item is re-checked just before it's written.
2. **Batched and resumable.** A batch fits well inside one resolver invocation: **25 items, written five
   at a time** (01 E1: ~0.5 s per `PUT`, 50 in a row took 24 s of the ~25 s limit). Migrations page with
   `search/jql`'s **`nextPageToken`** over a **stable** query (one that doesn't drop items as they're
   migrated) and skip finished items in code; `id > {cursor}` isn't usable, because Jira compares it as
   a key within the cursor issue's project (01 E2).
   The record and cursor are saved after every batch, so closing the tab or a failed batch resumes
   where it stopped.
3. **Copy only.** Migrations never delete the old data. Deleting it is the cleanup release's job (09).
4. **Per-item failures don't stop the run, but they stop it being `done`.** They're counted and listed
   (last 50) and batching carries on. When the last batch finishes, the run ends `done` only if
   rule 6's pending count is `0`; otherwise it ends `failed`, with the failure list. **Retry failed**
   resets the cursor and runs the whole migration again; idempotency turns everything already migrated
   into no-ops.
5. **Pure planning.** The per-item decision (migrate / already done / skip and why) is a pure
   `@domain` function with table tests. The backend only does the I/O.
6. **"Left to do" is counted as the app.** `status().pending` uses an `asApp` search, so items the
   admin can't see still count. A run is only `done` when that count is `0` at the end of it.
   Items the planner deliberately **skips** (e.g. 03's references to a deleted KPI) are not pending:
   they're reported in `counts.skipped`, and can't keep a migration from ever reaching `done`.
   `done` is what everything downstream waits for: a `dependsOn` and the cleanup release (09).
7. **`done` is final.** The app's reads assume the migrations have run (overview, *Compatibility*), and
   nothing re-checks a `done` migration for old-format data written afterwards: every install is
   upgraded and migrated right after deploying, and older installs aren't supported. Until an admin
   runs a migration, the app may show incomplete data; that's accepted.

### Resolvers

- `getMigrations` (Settings page only): every registered migration with its record (or a fresh
  `pending` one), whether its `dependsOn` are done, and, for any migration that isn't `done`, its
  `status()` (rule 7: a `done` one isn't re-counted).
- `runMigrationBatch({ id })` (`defineSettingsWrite`: Settings page + Jira admin): loads the record,
  refuses if a `dependsOn` isn't done, runs one batch from the cursor, saves the record and returns it.
- `retryMigration({ id })` (`defineSettingsWrite`): resets the cursor and counts, keeps `runBy`.

The client loops `runMigrationBatch` until `cursor` is `null`. There's no queue consumer or lifecycle
trigger (see Q3), so no new manifest modules or scopes.

### Test infrastructure

- **Mock Jira** ([scaleFixture.ts](../../../app/src/backend/testing/scaleFixture.ts)): an in-memory KVS
  for records. A **test-only** migration over fixture issues, with switches to fail a given item, to
  make a batch throw, and to hide items from the user (but not from the app).
- **Harness** ([mock-resolvers.ts](../../../app/test-harness/fixtures/mock-resolvers.ts)):
  `getMigrations`, `runMigrationBatch` and `retryMigration` over in-memory records with a fake batch
  delay. `?migrations=pending|running|done|failed` picks the starting state, so 04's UI can be built
  against it.

## Implementation steps

### Step 1 — Model and pure helpers

- `MigrationRecord` schema; pure `applyBatchResult(record, result, now)` (counts, failure list capped
  at 50, state transitions) and `migrationReadiness(registry, records)` (`dependsOn` blocking).
- **Verify:** table tests: first batch, middle batch, final batch, a batch with failures, a final
  batch after failures ending `failed` (and `done` when the retry leaves nothing pending), the failure
  list capping at 50, retry resetting the cursor, a blocked dependency (including by a `failed` one).

### Step 2 — KVS helpers, registry, resolvers

- `readMigrationRecord` / `writeMigrationRecord`, the empty registry, the three resolvers.
- **Verify:** backend tests with the test-only migration: resume after a thrown batch; idempotent
  re-run; per-item failures counted without stopping; `dependsOn` refused; a non-admin and a
  non-Settings context are refused; two interleaved runs end with the same data; `done` is only
  reached when the `asApp` count is `0`; skipped items don't count as pending; `getMigrations` doesn't
  call `status()` for a `done` migration.

### Step 3 — Harness mocks

- The mock resolvers and `?migrations=` param. No UI consumes them yet; a small harness test calls
  them and checks the state transitions.
- **Verify:** the harness test passes. `npm run test:all`, `typecheck`, `lint`.

## Questions

1. **Batch size.** The draft value is 25 items per `runMigrationBatch`. Use 01 E1's finding instead?
   - **Answered by 01 E1 (2026-11-24):** 25 items, five `PUT`s in parallel (~2.5 s per batch). Paging by
     `nextPageToken` (E2). *Incorporated: rule 2, `cursor`.*
2. **Who writes: the admin or the app?** The draft lets each migration choose (`writeAs`). 05 writes
   KPI **fields** as the admin, so History names a person. 03 writes `kpi-assignments` **as the app**,
   because targets live on work items in every project and an admin may not be able to edit them all
   (entity properties don't show in History anyway). OK? Or should 05 fall back to the app for KPIs
   the admin can't edit?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): the draft.** 05 writes as the
     admin, 03 as the app. KPIs the admin can't edit are per-item failures, listed by key.
3. **Run automatically after an upgrade?** The draft is admin-driven from Settings only. The
   alternative is an `avi:forge:upgraded:app` trigger plus an async-events queue, running **as the
   app**, so History would name the app, not the admin. It would remove a manual step from the upgrade
   runbook (09), and shorten the window where the app shows incomplete data (rule 7).
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): no**, admin-driven from Settings
     only, as drafted. No new manifest modules.
4. **Up-front permission check.** For `writeAs: 'user'` migrations, should a run first check that the
   admin has Edit Issues on every project with items to migrate, and stop with a message naming the
   spaces they're missing? Or just report per-item failures?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): report per-item failures.** The
     failure list names each work item and Jira's message.

## Implementation notes

Done 2026-11-24 on `feat/11-scalable-data`.

**Files added**

- `app/src/domain/models/migration.ts`: `MigrationRecord` (Zod), `MigrationFailure`, `MigrationCounts`,
  `MigrationBatchResult`, `MigrationStatus`, `newMigrationRecord`, `MAX_MIGRATION_FAILURES` (50).
- `app/src/domain/resolve/migrations.ts` (+ test): `applyBatchResult(record, result, now, { runBy,
  pendingAtEnd })`, `resetMigrationForRetry(record)`, `migrationReadiness(registry, records)`.
- `app/src/backend/migrations/index.ts` (+ test): the `Migration` and `MigrationContext` interfaces,
  the empty ordered registry (`migrationRegistry()`, `setMigrationRegistryForTests()`),
  `MIGRATION_BATCH_SIZE` (25), `MIGRATION_WRITE_CONCURRENCY` (5), `mapWithConcurrency` and
  `migrateItems(items, migrate)` (runs per-item writes five at a time; a thrown item becomes a failure).
- `app/src/backend/migrations/runner.ts` (+ test): `listMigrations`, `runMigrationBatch`,
  `retryMigration`, wired in `resolver.ts` as `getMigrations` (Settings page only),
  `runMigrationBatch` and `retryMigration` (`defineSettingsWrite`).
- `app/src/backend/testing/testMigration.ts`: the test-only migration (switches: fail an item, throw
  part-way through a batch, skip items; hide items with `fixture.userView.hidden`).
- `app/test-harness/fixtures/migrations.test.ts`: the harness test.

**Files changed:** `storage.ts` (`readMigrationRecord` / `writeMigrationRecord`, key
`kpi:migration:{id}`), `domain/contracts.ts` (`MigrationDto`, `MigrationsData`), `requestLog.ts`
(exports the `RequestJira` type), the domain and models indexes, `mock-resolvers.ts` and
`mock-bridge.ts`.

**How a later stage registers a migration:** implement `Migration` in `backend/migrations/` and add it
to the `MIGRATIONS` array in `backend/migrations/index.ts` (order = run order). `status(ctx)` counts
with `ctx.app` (as the app); `runBatch(ctx, cursor)` pages with `ctx.writer` (asUser for
`writeAs: 'user'`, asApp for `'app'`), at most `MIGRATION_BATCH_SIZE` items, and uses `migrateItems`
for the writes. `ctx.accountId` is the admin running it.

**Decisions made while implementing** (beyond the answered questions):

- `getMigrations` returns `{ migrations: MigrationDto[] }`: each migration's metadata, its record (or a
  fresh `pending` one), `ready` / `blockedBy`, and `status` (null for a `done` migration). A
  `status()` that throws doesn't fail the list: that row gets `status: null` and `statusError`.
- `runMigrationBatch` returns the saved record. The state machine:
  - `pending`: the first batch calls `status()` first and refuses (with its `reason`) when it isn't
    `applicable`.
  - `running`: the next batch from the saved cursor.
  - the final batch (cursor `null`) calls `status()` again and ends `done` only when `pending === 0`.
    `null` (couldn't count) ends it `failed`.
  - `done`: returned unchanged (rule 7), so a second admin's loop ends quietly.
  - `failed`: refused ("Retry it to run it again"). `retryMigration` resets it to `pending`.
- `retryMigration` also works on a `running` record (restarting from the beginning), but refuses a
  `done` one.
- A thrown batch saves nothing and the error goes to the client, so the next call redoes that batch
  from the same cursor.
- `runBy` is updated on every batch, so it names whoever ran the latest batch. Retry doesn't clear it.
- Harness: two mock migrations named after 03's and 05's. The second `dependsOn` the first **in the
  harness only**, so 04 can build the blocked state. `?migrationDelayMs=` (default 800) sets the
  fake batch delay.
- For 03/05: the pending count after the final batch runs right after the writes. If it uses a JQL
  property index (03's `refsVersion`), Jira's search index may not have caught up, so a run could
  end `failed` with nothing really left. Retry would then finish it as "already done". 03 should
  check this live, and count the last page's writes directly if the lag shows up.
