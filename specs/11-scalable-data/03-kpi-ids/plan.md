# 03 — KPI ids, not keys

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft** · Depends on: 02.

## Problem

A KPI's identity in this app is its Jira issue **key**. It's what `buildKpiCatalog` returns as `id`
([resolver.ts](../../../app/src/backend/resolver.ts)), what every target stores as `Assignment.kpiId`
in the `kpi-assignments` property ([assignment.ts](../../../app/src/domain/models/assignment.ts)),
what the `kpiIds` search index holds, and what the readings map, Timeline nodes and panel rows are
keyed by.

**Keys change when an issue moves to another project.** `KPI-5` moved to `PORT` becomes `PORT-20`.
After that:

- every target that stored `KPI-5` matches no KPI in the catalog: the panel calls it "unlisted" and the
  Timeline drops it;
- `classifyUnlistedKpis` asks Jira for `KPI-5`, Jira follows the old key to the moved issue, so the
  target is neither "deleted" nor "no access" and gets stuck;
- the `kpiIds` index still says `KPI-5`.

With KPIs in many spaces (06), moves happen whenever teams reorganise. Issue **ids** never change.

## Decision

- **Inside the app, a KPI's identity is its issue id** (a numeric string, `"10234"`): every `kpiId` in
  [contracts.ts](../../../app/src/domain/contracts.ts), the readings map, `createKpi`'s `parentKpiId`,
  and `Assignment.kpiId` in the domain model.
- **The key is display-only.** DTOs carry it next to the id (`kpiKey` / `key`) for labels and
  `/browse/{key}` links. It always comes fresh from Jira.
- **Stored targets carry both**, so the customer's app keeps working (overview, *Compatibility*). The
  id is stored in a **new** field, and `kpiId` keeps meaning "the KPI's key".
- **Reads use the id only.** A reference without a `kpiIssueId` is read as a **deleted KPI**: after
  the migration, those are the only key-only references left. Before an admin runs the migration,
  every target reads that way; that's accepted (overview).
- **Writes** store the id and the KPI's current key for every reference that has an id. They never
  resolve key-only references: the migration (on 02's framework) does that, once, as the app.

## Design

### Stored format

`kpi-assignments` keeps its shape and gains two fields:

```jsonc
// today's data (before the migration)
{ "assignments": [{ "kpiId": "KPI-5", ... }], "kpiIds": ["KPI-5"] }

// written from this stage on
{ "assignments": [{ "kpiIssueId": "10234", "kpiId": "KPI-5", ... }],
  "kpiIssueIds": ["10234"],     // new index path, exact-match (string): discovery + lookups
  "kpiIds": ["KPI-5"],          // unchanged meaning: keys, for the customer's app
  "refsVersion": 2 }            // new index path: "migrated"
```

- `kpiId` is the KPI's **current key at the time of the write**. If the KPI moves later, it goes stale
  until the issue's targets are next saved. Jira still resolves the old key, and the customer's report
  only covers the original KPI project, so that's acceptable during the transition (Q3).
- **Why both `kpiIssueId` and `kpiIssueIds`:** the per-assignment field is the data; the top-level
  array is a deduped copy for the index. A `jira:entityProperty` path can index an array of plain
  values but not a field inside an array of objects (the same reason `kpiIds` exists today, see
  `writeAssignments`). Discovery searches it (below), and exact "who targets KPI X" lookups will too.
- **`refsVersion: 2`** marks an issue as migrated. The migration writes it once every reference on the
  issue has a `kpiIssueId`, **except** keys that resolve to no issue as the app (deleted KPIs, which
  stay key-only by design), so an issue whose only references are deleted KPIs is stamped too. App
  writes **stamp** an issue when it was already stamped, **or** when its stored property had **no
  key-only references** before the write (including an issue with no property yet, getting its first
  target). Every reference the app adds has an id, so either way nothing is left to migrate. An issue
  that still holds key-only references stays unstamped until the migration reaches it. Without the
  second rule, a work item that gets its first target after the release would never be stamped. It
  would count as pending forever, since the migration is `done` and never re-runs (02 rule 7), and
  block the cleanup release (09).
  `refsVersion` exists only for the migration's pending count (*Migration*, below).
- After the cleanup release, `kpiId` / `kpiIds` stop being written (09).

**Index** ([manifest.yml](../../../app/manifest.yml)): keep the `kpiIds` `text` path as it is (the
customer's app searches it), and **add** a `kpiIssueIds` path with `type: string` (discovery and exact
lookups) and a `refsVersion` path with `type: number` (the migration's pending count). 01 D2–D5
confirm that adding the paths is safe and that `IS EMPTY` works on the number path.

**Discovery** (the Timeline's `fetchTargetContributions`) searches `kpiIssueIds IS NOT EMPTY` from this
stage on, so the cleanup release's removal of `kpiIds` (09) doesn't affect it. Before the migration it
only finds issues this version has written; that's accepted. An issue whose only references are
deleted KPIs has no `kpiIssueIds` and isn't discovered, which is right: those targets have no KPI to
show under. The central Timeline keeps searching every targeted work item, because it shows every KPI
(overview Q5); searching only the shown KPIs' targets (R3) waits for space pages. A KPI's own panel
searches the exact `kpiIssueIds = {id}` instead (06, KPI View).

### Domain (`@domain`, pure: `domain/resolve/kpiRef.ts`)

```ts
type KpiRef = { kind: 'id'; id: string } | { kind: 'key'; key: string } | { kind: 'invalid' };

/** Ids are digits; keys are PROJECT-123. */
function parseKpiRef(raw: string): KpiRef;

/** Stored → domain, for reads. Uses kpiIssueId only; a reference without one is a deleted KPI,
 *  kept by its key. */
function readStoredAssignments(stored: StoredAssignments): { assignments: Assignment[]; deletedKeys: string[] };

/** Domain → stored, for app writes. kpiIssueId + current key for every id reference, key-only ones
 *  kept as they are, both index arrays, and `refsVersion: 2` when `stamp` is true. The caller passes
 *  `stamp` = the stored property was stamped, or held no key-only references (Stored format). */
function toStoredAssignments(
  assignments: Assignment[],
  keyOfId: ReadonlyMap<string, string>,
  stamp: boolean,
): StoredAssignments;

/** The migration's planner: resolves key-only references via `idOfKey` (keys missing from it are
 *  deleted), and stamps `refsVersion: 2`. */
function migrateStoredAssignments(
  stored: StoredAssignments,
  idOfKey: ReadonlyMap<string, string>,
  keyOfId: ReadonlyMap<string, string>,
): { outcome: 'migrated' | 'alreadyDone' | 'skipped'; stored: StoredAssignments; deletedKeys: string[] };
```

- `Assignment.kpiId` (domain) **is the issue id**. These functions are the only code that knows about
  the stored `kpiIssueId` / `kpiId` split.
- A key-only reference (a deleted KPI, after the migration) is kept **as is**, with `kpiId` = that
  key, so it still shows as "deleted" instead of vanishing.
- `updatedBy` / `updatedAt` are **not** changed by rewriting a reference: the target itself didn't
  change.

### Backend

**Resolving keys to ids** (`jira.ts`, `resolveKpiKeys(keys) → Map<key, id>`, cached per invocation)
is used **only by the migration**:

1. `GET /issue/{key}?fields=issuetype` **as the app**, once per distinct key in the batch. Jira follows
   a moved issue's old key (01 D1). As the app, so a KPI in a project the admin can't see still gets
   its id stored (the id is only written, never shown).
2. A key that's still unresolved (404 as the app) is a deleted KPI: it stays a key.

**Reads** make no key-resolution requests:

| Read | Change |
|---|---|
| `fetchTargetSourceIssue` / panel `fetchAssignments` (own + parent) | `readStoredAssignments` before grouping rows |
| `fetchTargetContributions` (Timeline discovery) | Searches `kpiIssueIds IS NOT EMPTY` (was `kpiIds`), then `readStoredAssignments`, grouping `byKpi[a.kpiId]` by id |
| `classifyUnlistedKpis` | Takes ids. `GET /issue/{id}` 404 as the app = deleted. A key-only reference is deleted without a request. No more old-key limbo |

**Writes** (`writeAssignments`): build `keyOfId` for **every** id reference on the issue: the KPIs
already loaded, plus one `id in (…)` search **as the app** for any others. As the app, so a KPI the user
can't see still gets its current key written for the customer's app. Only keys are written, never shown.
An id whose KPI no longer exists (missing from that search) keeps the `kpiId` key already stored with
it. Then `toStoredAssignments`, stamping per *Stored format*. `requireTargetableKpi` takes an id.

**Ids everywhere else:** `buildKpiCatalog` returns `id: issue.id, key: issue.key`. The readings map is
keyed by id. `createKpi` / `updateKpi` take `parentKpiId` as an id. `recordValue` already fetches
`GET /issue/{id}`; only its error messages change (they show the key).

### Contract changes (`@domain/contracts.ts`)

| DTO | Change |
|---|---|
| `CatalogEntryDto` | `id` = issue id; **add** `key` |
| `PanelRowDto` | `kpiId` = issue id; **add** `kpiKey` |
| `TimelineNodeDto` | `kpiId` = issue id (`issueKey` already exists) |
| `CreateKpiInput` / `UpdateKpiInput` | `parentKpiId` is an id |
| `RecordValueInput`, target save/remove inputs | `kpiId` is an id |
| `PanelBasis.kpiDeleted` / `kpiNoAccess` | ids |

### UI

Only the places that **show or link** a KPI change:

| File | Change |
|---|---|
| [IssuePanel.tsx](../../../app/src/ui/surfaces/IssuePanel/IssuePanel.tsx) | `kpiHref` and `onOpenIssue` use `row.kpiKey` |
| [TargetCard](../../../app/src/ui/surfaces/IssuePanel/components/TargetCard/) | The "Open {name} ({key})" tooltip uses `kpiKey` |
| Timeline, KpiView, plot markers | Already use `issueKey`. Only their test fixtures switch to ids |

### Migration: `kpi-target-refs-to-ids`

Registered on 02's framework.

- **Which issues:** `issue.property[kpi-assignments].kpiIds IS NOT EMPTY ORDER BY id ASC`, paged with
  `nextPageToken` (the cursor). The query is **stable**: it doesn't filter on `refsVersion`, because a
  token over a set that shrinks as items are migrated could skip items, and `id > {cursor}` only works
  within one project (01 E2). Issues already stamped `refsVersion: 2` are counted `alreadyDone` without
  a write.
- **Pending** (`status().pending`, as the app, 02 rule 6): the count (`search/approximate-count`) of
  that search **plus** `AND issue.property[kpi-assignments].refsVersion IS EMPTY` (01 D5, E3). One exact
  request, whatever the data size. It's exact because the marker is per issue and means "nothing left
  to resolve": every key is resolved as the app (Backend), and deleted KPIs don't hold the marker back,
  so they never count as pending (02 rule 6, skipped items).
- **Pure planner:** `migrateStoredAssignments` decides each issue's outcome:
  - **migrated**: at least one assignment gained a `kpiIssueId`;
  - **already done**: every assignment has one (the issue is only re-stamped);
  - **skipped (unresolved)**: a key matches no issue (a deleted KPI). The key is left as is, counted
    and listed, and the issue is still stamped once its other references have ids.
- **Writes** one `PUT /issue/{id}/properties/kpi-assignments` per changed issue, `writeAs: 'app'`
  (02 Q2). The `PUT` replaces the whole property, so to avoid overwriting a target saved since the
  batch read, it re-reads the property **immediately** before writing (nothing else awaited in between)
  and skips the issue if it changed, counting it as "changed during the run". An app save doesn't stamp
  an issue that still held key-only references (*Stored format*), so the skipped issue is still
  unstamped and pending: the run ends `failed`, and **Retry failed** picks it up (02 rules 4 and 6).
- **Known race (accepted).** Jira's single-issue property `PUT` has no conditional write, so a save
  that lands between that re-read and the `PUT` (one request's round trip) is overwritten. It's the
  same race every target save already has today when two people save targets on the same work item at
  once (each save is read-modify-write). The upgrade runbook (09) says to run the migration when nobody
  is editing targets.

### Test infrastructure

- **Scale fixture:** a **pre-migration** shape (keys only, as today) and a **migrated** shape (ids +
  keys, stamped), with a **moved** KPI (old key resolves to the new issue), a deleted KPI (next to live
  ones on one issue, and alone on another), and a KPI the user can't see (the app can).
- **Harness fixtures** ([mock-resolvers.ts](../../../app/test-harness/fixtures/mock-resolvers.ts)): the
  migrated shape (numeric ids with separate keys), plus one deleted KPI's key-only reference.

## Implementation steps

### Step 1 — Domain: `parseKpiRef`, `readStoredAssignments`, `toStoredAssignments`, `migrateStoredAssignments`

- **Verify:** table tests. Reads: ids only; a key-only reference read as deleted (kept by key); an
  invalid value; duplicates; a digits-only `kpiId` (someone wrote an id there) read as an id. Writes:
  `updatedBy`/`updatedAt` untouched; key-only references kept as they are; `refsVersion: 2` written
  when `stamp` is true and not otherwise; round trip (`read(to(x)) == x`). Migration:
  keys only, ids only (already done), a mix; a key missing from `idOfKey` (deleted, kept, reported);
  `refsVersion: 2` written when every reference has an id or the only key-only ones are deleted
  (including an issue with nothing but deleted KPIs).

### Step 2 — Contracts and backend reads by id

- The three reads, discovery on `kpiIssueIds`, catalog / readings / Timeline keyed by id, `kpiKey` in
  DTOs, `classifyUnlistedKpis` by id.
- **Verify:** backend tests on the **migrated** fixture: the panel and Timeline show the same rows and
  markers as today's code on the matching pre-migration data (compare against snapshots taken before
  the change). A target pointing at a **moved** KPI shows under it. A deleted KPI is still reported
  deleted, with no request. A target on a KPI the user can't see shows as "no access". Request-log
  tests: reads make **no** key-resolution requests. On the **pre-migration** fixture, the documented
  degraded behaviour (targets read as deleted, Timeline discovers nothing) is pinned by a test.

### Step 3 — Writes store ids and keys (+ index path)

- `writeAssignments` via `toStoredAssignments`. Add the `kpiIssueIds` and `refsVersion` index paths.
- **Verify:** saving one target on a migrated issue writes `kpiIssueId` + current key for **all** its
  id references (including a KPI the user can't see, looked up as the app), fills both `kpiIssueIds` and
  `kpiIds`, and keeps `refsVersion: 2`. An id reference to a deleted KPI keeps its stored key. On an
  unstamped issue with key-only references, those are kept as they are and the issue stays unstamped.
  An issue with **no** property, or with only id references, is stamped by its first app write, and the
  migration's pending count doesn't include it. Other targets keep `updatedBy`/`updatedAt`. The written
  `kpiId` / `kpiIds` are exactly what the customer's app reads (the current keys).

### Step 4 — UI uses `kpiKey`

- The IssuePanel and TargetCard changes; harness fixtures switch to ids.
- **Verify:** in the harness (`?surface=issue`), light and dark: KPI names link to `/browse/{key}`,
  never `/browse/{numeric id}`; the deleted KPI's key-only reference renders as deleted. Clean console.
  Story tests pass.

### Step 5 — Migration

- Register `kpi-target-refs-to-ids`.
- **Verify:** mock-Jira tests: mixed data migrates; a second run is all "already done"; an issue
  changed between read and write is skipped and counted; a deleted KPI's key is reported unresolved;
  an issue whose only targets are deleted KPIs is stamped and **not** pending, so the run reaches
  `done`; the cursor resumes after a failed batch; an issue the admin can't see is still migrated
  (written as the app); `pending` is the one `refsVersion IS EMPTY` search and is `0` at the end; an
  issue saved between the batch read and the write stays pending, the run ends `failed`, and a retry
  ends `done`.

### Step 6 — Live check (dev)

- Deploy the branch to dev. Run the migration through the `runMigrationBatch` resolver (no UI until
  04; use the harness-style loop from a temporary script or wait for 04).
- **Verify** on `bitovi-training`: after the migration, dev's Timeline and panels match screenshots of
  `main` taken before it, and the legacy reader report (09) is unchanged. Move one throwaway KPI to
  another project: dev keeps all its targets in both surfaces, and the panel link opens the new key.

## Questions

1. **Field names.** `kpiIssueId` (per assignment) and `kpiIssueIds` (index), OK? After cleanup, these
   become the only reference, so the names are permanent.
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): yes**, `kpiIssueId` / `kpiIssueIds`.
2. **Key-only references read as deleted.** After the migration, the only key-only references are
   deleted KPIs, so reads treat any key-only reference as deleted, without asking Jira. Before an admin
   runs the migration, every target reads that way. OK? Saving a target still refreshes the stored keys
   of the issue's other references (for the customer's app); values and authorship don't change.
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): yes**, as drafted.
3. **Stale keys for old readers.** After a KPI moves, `kpiId` keeps its old key until that issue's
   targets are saved again. Fine for the customer (they only report on the original KPI project, and
   Jira resolves old keys), or should moving be detected and the keys refreshed in bulk?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): fine as drafted**; no bulk refresh.
4. **Live run before 04.** Step 6 runs the migration without the Settings UI. OK to use a temporary
   script for that, or should the live check wait until 04's card exists?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review): wait for 04's card.** Step 6 runs as part of 04 Step 7 (R7).
