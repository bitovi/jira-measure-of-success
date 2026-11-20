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
- **Stored targets carry both**, so old readers keep working (overview, *Compatibility*). The id is
  stored in a **new** field, and `kpiId` keeps meaning "the KPI's key".
- **Reads accept key-only references** until the cleanup release (09).
- **Every target write rewrites all of that issue's references** with the id and the current key, so
  data heals as people use the app. A migration (on 02's framework) does the rest.

## Design

### Stored format

`kpi-assignments` keeps its shape and gains two fields:

```jsonc
// written by older installs (and today's data)
{ "assignments": [{ "kpiId": "KPI-5", ... }], "kpiIds": ["KPI-5"] }

// written from this stage on
{ "assignments": [{ "kpiIssueId": "10234", "kpiId": "KPI-5", ... }],
  "kpiIssueIds": ["10234"],     // new index path, exact-match (string)
  "kpiIds": ["KPI-5"] }         // unchanged meaning: keys, for old readers + today's discovery search
```

- `kpiId` is the KPI's **current key at the time of the write**. If the KPI moves later, it goes stale
  until the issue's targets are next saved. Jira still resolves the old key, and the customer's report
  only covers the original KPI project, so that's acceptable during the transition (Q3).
- After the cleanup release, `kpiId` / `kpiIds` stop being written (09).

**Index** ([manifest.yml](../../../app/manifest.yml)): keep the `kpiIds` `text` path as it is (older
installs and the Timeline's `IS NOT EMPTY` discovery use it), and **add** a `kpiIssueIds` path with
`type: string` for exact lookups. 01 D2–D4 confirm that adding the path is safe and whether existing
properties get indexed under it without being rewritten.

**Discovery during the transition** keeps using `kpiIds IS NOT EMPTY`, since both old and new writes
fill it. An exact "which work items target KPI 10234" query (`kpiIssueIds = "10234"`) only becomes
complete once the migration has run and older installs have upgraded. Nothing in this spec needs that
query. A future feature that does would have to combine it with the key during the transition.

### Domain (`@domain`, pure: `domain/resolve/kpiRef.ts`)

```ts
type KpiRef = { kind: 'id'; id: string } | { kind: 'key'; key: string } | { kind: 'invalid' };

/** Ids are digits; keys are PROJECT-123. */
function parseKpiRef(raw: string): KpiRef;

/** Stored → domain. Prefers kpiIssueId; else parses kpiId; keys resolve via the map. */
function readStoredAssignments(
  stored: StoredAssignments,
  idOfKey: ReadonlyMap<string, string>,
): { assignments: Assignment[]; unresolvedKeys: string[]; needsRewrite: boolean };

/** Domain → stored. Writes kpiIssueId + current key for every assignment, and both index arrays. */
function toStoredAssignments(
  assignments: Assignment[],
  keyOfId: ReadonlyMap<string, string>,
): StoredAssignments;
```

- `Assignment.kpiId` (domain) **is the issue id**. The two functions above are the only code that knows
  about the stored `kpiIssueId` / `kpiId` split.
- An unresolved key (a deleted KPI) is kept **as is**, with `kpiId` = that key, so it still shows as
  "deleted" instead of vanishing.
- `updatedBy` / `updatedAt` are **not** changed by rewriting a reference: the target itself didn't
  change.

### Backend

**Resolving keys to ids** (`jira.ts`, `resolveKpiKeys(keys) → Map<key, id>`, cached per invocation):

1. Look in the KPI issues the request already loaded. That covers every unmoved KPI at no cost.
2. For the rest, `GET /issue/{key}?fields=issuetype` as the user. Jira follows a moved issue's old key
   (01 D1).
3. Anything still unresolved stays a key. The existing deleted / no-access classification handles it.

**Reads that resolve before use:**

| Read | Change |
|---|---|
| `fetchTargetSourceIssue` / panel `fetchAssignments` (own + parent) | `readStoredAssignments` before grouping rows |
| `fetchTargetContributions` (Timeline discovery) | Same, then group `byKpi[a.kpiId]` by id |
| `classifyUnlistedKpis` | Takes ids. `GET /issue/{id}` 404 as the app = deleted. No more old-key limbo |

**Writes** (`writeAssignments`): build `keyOfId` for **every** assignment on the issue (the KPIs
already loaded, plus one `id in (…)` search for any others), then `toStoredAssignments`.
`requireTargetableKpi` takes an id.

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

- **Which issues:** `issue.property[kpi-assignments].kpiIds IS NOT EMPTY ORDER BY id ASC`, cursor = last
  issue id. If 01 D3 shows `kpiIssueIds IS EMPTY` works, `status().pending` uses it; otherwise it pages
  and counts from the returned properties.
- **Pure planner:** `readStoredAssignments` decides each issue's outcome:
  - **migrated**: at least one assignment gained a `kpiIssueId`;
  - **already done**: every assignment has one;
  - **skipped (unresolved)**: a key matches no issue (a deleted KPI). Left as is, counted and listed.
- **Writes** one `PUT /issue/{id}/properties/kpi-assignments` per changed issue, `writeAs: 'app'`
  (02 Q2). To avoid overwriting a concurrent save, it re-reads the property just before writing and
  skips the issue if it changed since the batch read. That save already wrote ids.

### Test infrastructure

- **Scale fixture:** targets stored three ways (keys only, as today; ids + keys; and a mix on one
  issue), a **moved** KPI (old key resolves to the new issue), and a deleted KPI.
- **Harness fixtures** ([mock-resolvers.ts](../../../app/test-harness/fixtures/mock-resolvers.ts)): numeric
  ids with separate keys, plus one issue with a key-only legacy reference.

## Implementation steps

### Step 1 — Domain: `parseKpiRef`, `readStoredAssignments`, `toStoredAssignments`

- **Verify:** table tests: ids only; keys only; a mix; a key missing from the map (kept, reported);
  an invalid value; duplicates; a digits-only `kpiId` (someone wrote an id there) read as an id;
  `updatedBy`/`updatedAt` untouched; `needsRewrite` false when nothing changed; round trip
  (`read(to(x)) == x`).

### Step 2 — Contracts and backend reads accept both

- `resolveKpiKeys`, the three reads, catalog / readings / Timeline keyed by id, `kpiKey` in DTOs,
  `classifyUnlistedKpis` by id.
- **Verify:** backend tests on the scale fixture with **key-only** targets (today's live data): the
  panel and Timeline show the same rows and markers as before (compare against snapshots taken before
  the change). A target pointing at a **moved** KPI shows under it. A deleted KPI is still reported
  deleted. Request-log tests: unmoved KPIs add **no** requests; one moved key adds exactly one
  `GET /issue/{key}`.

### Step 3 — Writes store ids and keys (+ index path)

- `writeAssignments` via `toStoredAssignments`. Add the `kpiIssueIds` index path.
- **Verify:** saving one target on an issue whose property has key-only references writes
  `kpiIssueId` + current key for **all** of them, and fills both `kpiIssueIds` and `kpiIds`. Other
  targets keep `updatedBy`/`updatedAt`. The written property still parses with **today's**
  `Assignment` schema and gives the same `kpiId` keys (an older install can read it).

### Step 4 — UI uses `kpiKey`

- The IssuePanel and TargetCard changes; harness fixtures switch to ids.
- **Verify:** in the harness (`?surface=issue`), light and dark: KPI names link to `/browse/{key}`,
  never `/browse/{numeric id}`; the legacy key-only fixture issue renders its target. Clean console.
  Story tests pass.

### Step 5 — Migration

- Register `kpi-target-refs-to-ids`.
- **Verify:** mock-Jira tests: mixed data migrates; a second run is all "already done"; an issue
  changed between read and write is skipped and counted; a deleted KPI's key is reported unresolved;
  the cursor resumes after a failed batch; an issue the admin can't see is still migrated (written as
  the app); after the migration, an **older-format write** (key only) on one issue is read correctly
  and shows up as one new pending item.

### Step 6 — Live check (dev)

- Deploy the branch to dev; staging stays on `main`. Run the migration through the `runMigrationBatch`
  resolver (no UI until 04; use the harness-style loop from a temporary script or wait for 04).
- **Verify** on `bitovi-training`: the Timeline and panels look identical in dev before and after the
  migration, and identical to **staging** (the older install). Move one throwaway KPI to another
  project: dev keeps all its targets in both surfaces, and the panel link opens the new key.

## Questions

1. **Field names.** `kpiIssueId` (per assignment) and `kpiIssueIds` (index), OK? After cleanup, these
   become the only reference, so the names are permanent.
2. **Healing on save.** Saving any target on an issue rewrites *all* of that issue's references (adds
   the id, refreshes the key). Values and authorship don't change. OK?
3. **Stale keys for old readers.** After a KPI moves, `kpiId` keeps its old key until that issue's
   targets are saved again. Fine for the customer (they only report on the original KPI project, and
   Jira resolves old keys), or should moving be detected and the keys refreshed in bulk?
4. **Live run before 04.** Step 6 runs the migration without the Settings UI. OK to use a temporary
   script for that, or should the live check wait until 04's card exists?
