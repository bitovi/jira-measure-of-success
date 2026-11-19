# 11 — KPI unit and direction as native Jira fields (+ data migrations)

Status: **Draft** · Scope: moves a KPI's **unit** and **direction** from the `kpi-meta` issue entity
property to two app-owned Jira custom fields, and adds a **reusable migration capability** to move
existing data. Revises [storage-model.md](../01-initial-build/storage-model.md) (where KPI metadata
lives). Pairs with [spec 12](../12-kpi-issue-context/plan.md), which can ship before or after this one.

## Problem

Opening a KPI work item (e.g. `KPI-11`) in Jira shows its summary, status and so on, but not its
**unit** (`%`, `$`, `count`, …) or **direction** (higher or lower is better). Both live in the
`kpi-meta` issue entity property ([kpiMeta.ts](../../app/src/domain/models/kpiMeta.ts)). Jira never
renders entity properties, so the only places these values appear are the app's own surfaces: the
Timeline, and the issue panel once someone has opened it.

Entity properties also aren't usable in JQL (`kpi-meta` has no `jira:entityProperty` index), CSV
export, Jira's own edit controls, or the issue's History tab.

## Decision

Make unit and direction **real Jira custom fields**, owned by the app (`jira:customField`, the same
mechanism as the existing `kpi-reading` field), and **placed on the KPI project's screens** so Jira
shows them in the issue's **Details** section.

| | `kpi-meta` property (today) | Custom fields (this spec) |
|---|---|---|
| Shown on the KPI's issue page | ❌ | ✅ Details section |
| Editable with Jira's own controls | ❌ | ✅ inline edit, bulk edit |
| JQL (`"KPI Unit" = "%"`) | ❌ | ✅ |
| CSV export | ❌ | ✅ |
| History tab shows who changed it | ❌ | ✅ changelog |
| CascadeMCP / standard REST | ✅ | ✅ (`fields.customfield_…`) |
| Field ids differ per site and per Forge environment | n/a | yes (looked up, like `kpi-reading`) |

Because fields need existing KPIs to be **migrated**, this spec also adds a general **migration
capability**. It's built so that later storage changes can reuse it (see *Migration capability*).

### What stays the same

- The KPI **name** stays the issue **summary**.
- **Readings** stay in the `kpi-reading` field's changelog (Option B, spec 10 Path A).
- **Targets** stay in the `kpi-assignments` property on contributing issues.
- The domain shape stays `KpiMetaProperty` `{ unit: string; direction: 'increase' | 'decrease' | null }`
  (renamed to `KpiMeta` if Q8 says so). Only the **storage** behind it changes, so the Timeline, issue
  panel, KPI View and contracts ([contracts.ts](../../app/src/domain/contracts.ts)) don't change.

## Design

### The two fields (manifest)

```yaml
jira:customField:
  - key: kpi-reading            # unchanged
    ...
  - key: kpi-unit
    name: KPI Unit${TITLE_SUFFIX}
    description: The unit a KPI is measured in (%, $, count, …). Managed by Measure of Success.
    type: string
  - key: kpi-direction
    name: KPI Direction${TITLE_SUFFIX}
    description: Whether higher or lower values are better for this KPI. Managed by Measure of Success.
    type: string
    view:
      formatter:
        expression: >-
          value == 'increase' ? '↑ Higher is better' : value == 'decrease' ? '↓ Lower is better' : null
        export: true
    edit:
      resource: kpi-direction-edit        # small Custom UI select (Q3)
      experience: [issue-view, issue-create, issue-transition, issue-bulk-edit]
      validation:
        expression: "value == null || value == 'increase' || value == 'decrease'"
        errorMessage: Direction must be "increase" or "decrease".
```

- **Unit** is a plain `string` field. Jira's default text editor is fine, and an empty value means
  "no unit" (today's `''`).
- **Direction** is stored as the same `increase` / `decrease` strings the domain uses
  ([kpiDefinition.ts](../../app/src/domain/models/kpiDefinition.ts)), so values from CascadeMCP and the
  app line up. The **formatter** makes it read as "↑ Higher is better" in the issue view and CSV. The
  **validation** expression keeps typos (from REST or bulk edit) out. Step 0 confirms it applies to
  REST writes.
- Both are `readOnly: false`. People are meant to edit them in Jira, unlike `kpi-reading`.
- Adding fields changes the manifest but **adds no scope**. `forge deploy` installs the fields. Step 0
  confirms whether `forge install --upgrade` is also needed.

### Finding the field ids

Field ids (`customfield_10xxx`) differ per site and per Forge environment. Each environment installed
on a site gets its own field (`<appId>__<ENV>__kpi-unit`). So generalize the existing lookup in
[jira.ts](../../app/src/backend/jira.ts):

- `pickReadingField(fields, env)` becomes `pickAppField(fields, moduleKey, fallbackName, env)`. It
  keeps the same preference order: the running environment, then untagged, then any match.
  `pickReadingField` stays as a thin wrapper so its tests still read naturally.
- `FieldIds` gains `unit` and `direction`. They come from the **same single cached `/field` call**
  (spec 06 P7), so this adds no requests.
- A missing unit or direction field, before the first deploy, is **not** an error the way a missing
  reading field is. Reads fall back to `kpi-meta` (see *Reading*) and writes keep using `kpi-meta`, so
  the app still works on an install whose fields haven't appeared yet.

### Reading unit and direction

One pure rule in `@domain` (`resolveKpiMeta`), used by every read path:

```ts
resolveKpiMeta({ unitField, directionField, legacy, legacyTrusted }): KpiMetaProperty
```

| Field value | `kpi-meta` property | Result |
|---|---|---|
| set | any | **field** wins |
| empty | present and `legacyTrusted` | `kpi-meta` value (KPI not migrated yet) |
| empty | absent, or not trusted | empty: `unit: ''`, `direction: null` |

- Unit and direction are resolved **separately**, so a KPI whose unit was migrated but whose direction
  was never set still reads correctly.
- `legacyTrusted` is **true until the `kpi-meta-to-fields` migration is done** on this install (see
  *Migrations*), then false. Without it, clearing a field in Jira would bring back the old `kpi-meta`
  value. After migration, the fields are the only source.
- Invalid direction strings (only possible if validation is bypassed) read as `null`, as an unparseable
  `kpi-meta` does today (`parseKpiMeta`).

Where the reads happen (all in [jira.ts](../../app/src/backend/jira.ts)):

| Function | Change |
|---|---|
| `fetchKpiSpaceIssues` | Add the unit and direction field ids to `fields=`. Keep `properties=kpi-meta` while legacy is trusted, then drop it (smaller response) |
| `fetchKpiIssueForEdit` | Same: fields, plus the property while legacy is trusted |
| `fetchKpiMeta` | Same, as one `GET /issue/{id}?fields=…&properties=…` |

`KpiSpaceIssue.meta` and `KpiIssueForEdit.meta` keep their type, so the resolver and domain don't
change.

### Writing unit and direction

| Function | Today | After |
|---|---|---|
| `createKpiIssue` | `POST /issue` with `properties: [kpi-meta]` | `POST /issue` with `fields: { [unitId]: unit \|\| null, [directionId]: direction }` (Step 0: allowed off the create screen?) |
| `updateKpiDefinition` | `PUT /issue/{id}/properties/kpi-meta` | Folded into the **same** `PUT /issue/{id}` as the summary. One write, one changelog entry |

- Writes stay **as the user** (spec 10), so Jira requires Edit Issues or Create Issues, and the
  History tab names the person.
- **Also write `kpi-meta`** while the transition lasts (Q1). Other installs pointing at the same KPI
  space (dev and staging on `bitovi-training`) and CascadeMCP still read the property. A later
  **cleanup migration** (Follow-up F1) stops writing it and removes it.
- If the fields aren't installed yet (ids are `null`), write `kpi-meta` only, as today.
- [mutations.test.ts](../../app/src/backend/mutations.test.ts) currently expects exactly
  `['PUT /issue/1001', 'PUT /issue/1001/properties/kpi-meta']`. That changes to one `PUT /issue/1001`
  that carries summary + fields, plus the transitional property write.

### Showing the fields on the KPI's page (screens)

A custom field shows in the issue view only if it's on a **screen** the issue's project and issue type
use. Fields don't render without that.

- **New KPI spaces:** `createKpiSpace` adds the fields to the screens as part of setup, after
  `ensureKpiIssueTypeOnProject`.
- **Existing KPI spaces** (created earlier, or connected with `saveKpiSpaceKey`): handled by the
  `kpi-fields-on-screens` **config migration** (below).

How to find the screens: project → issue type screen scheme
(`GET /issuetypescreenscheme/project?projectId=`) → the screen scheme mapped to the `KPI` issue type
(or the default mapping) → its **view**, **edit** and **create** screens → add both fields to the first
tab (`POST /screens/{id}/tabs/{tabId}/fields`). Adding a field that's already there (a `400`/`409`) is
fine.

**Shared screens are a risk.** `createKpiProject` makes a project without a template, so it most likely
uses Jira's **Default Screen Scheme**, which other projects share. Adding the fields there would offer
"KPI Unit" on every project's issues. Two mitigations (Q2):

- **A. Restrict the fields' context** to the KPI project and `KPI` issue type
  (`/field/{id}/context`). The field can sit on a shared screen but only applies to KPIs. Step 0 checks
  that Forge-owned fields allow this.
- **B. Give the KPI project its own screens:** a "KPI" screen, screen scheme and issue type screen
  scheme. Clean, but much more configuration to create and to reason about.

The draft assumes **A**, falling back to **B** if Step 0 finds Forge field contexts can't be
restricted.

Screen and context changes run **as the user** (the admin, via Settings), matching spec 10's
provisioning rule. Reads of screens and schemes stay `asApp`, like the other site-wide config reads.
Both are covered by the existing `manage:jira-configuration` scope.

### Migration capability

A small, general framework, so this and later storage changes share one tested runner and one
Settings UI.

**Model** (`@domain`, pure + Zod, in `domain/models/migration.ts`):

```ts
MigrationRecord = {
  id: string;                          // e.g. 'kpi-meta-to-fields'
  state: 'pending' | 'running' | 'done' | 'failed';
  cursor: string | null;               // resume point (last KPI key processed)
  counts: { migrated: number; alreadyDone: number; conflicts: number; failed: number };
  failures: Array<{ issueKey: string; message: string }>;   // last N
  startedAt: string | null;
  finishedAt: string | null;
  runBy: string | null;                // accountId of the admin who ran it
};
```

Stored in Forge KVS under one key, `kpi:migrations`, as `{ [id]: MigrationRecord }`. That's app-internal
bookkeeping like `kpi:space`, not domain data, so KVS is the right place
([storage.ts](../../app/src/backend/storage.ts)).

**Registry** (`backend/migrations/index.ts`): an **ordered** list of migrations. Each one has:

```ts
interface Migration {
  id: string;
  title: string;                       // shown in Settings
  description: string;
  dependsOn?: string[];                // e.g. screens after data
  /** How much is left; cheap enough to call on every Settings load. */
  status(ctx): Promise<{ applicable: boolean; pending: number | null }>;
  /** Do at most one batch from `cursor`; must be idempotent. */
  runBatch(ctx, cursor: string | null): Promise<{
    cursor: string | null;             // null = finished
    migrated: number; alreadyDone: number; conflicts: number;
    failures: Array<{ issueKey: string; message: string }>;
  }>;
}
```

**Rules every migration follows:**

1. **Idempotent per item.** Running a batch twice, or two admins running it at once, produces the same
   result. Each item is checked before it's written.
2. **Batched and resumable.** A batch fits well inside one resolver invocation's time limit
   (Q5 sets the size). The cursor is saved to KVS after every batch, so closing the tab, or a failed
   batch, resumes where it stopped.
3. **Never destructive in the same migration that copies.** Copy migrations leave the source in
   place. Removing old data is its own migration (F1), run later.
4. **Per-item failures don't stop the run.** They're counted and listed (last 50), and the run ends as
   `done` with failures. **Retry failed** resets the cursor and runs the whole migration again.
   Idempotency turns the already-migrated KPIs into no-ops, so only the failed ones are written.
5. **Pure planning.** The per-item decision ("copy", "already done", "conflict") is a pure `@domain`
   function with table tests. The backend only does the I/O.

**Running** (Q4). The admin runs migrations from **Settings**. The client loops
`runMigrationBatch` until `cursor` is `null`:

- `getMigrations` (Settings page only): every registered migration with its `MigrationRecord`
  (or `pending` if never run), `status()`, and whether its `dependsOn` are done.
- `runMigrationBatch({ id })` (`defineSettingsWrite`: Settings page + Jira admin): loads the record,
  runs one batch from its cursor, saves the record, and returns it.

There are no new manifest modules (no queue consumer, no lifecycle trigger), and writes run as the
admin, so Jira's permissions and the History tab stay accurate. Q4 covers running it automatically.

**Settings UI** (`DataMigrationsCard`, a new modlet in
[Settings/components](../../app/src/ui/surfaces/Settings/components/)):

- Hidden when every migration is `done`, or shown collapsed as "All data is up to date" (Q6).
- One row per migration: title, description, state lozenge, and "N of M KPIs" progress while it runs.
- Buttons: **Run**, **Pause** (stops the client loop after the current batch), **Retry failed**, and
  a disabled-reason tooltip when a `dependsOn` isn't done yet (reuse
  [DisabledReason](../../app/src/ui/components/DisabledReason/)).
- Failures list: issue key (linked) and message.
- A one-line banner at the top of Settings when any migration is pending.

### The two migrations this spec registers

**1. `kpi-meta-to-fields`** (data)

For each KPI in the KPI space, ordered by key, in batches. Cursor = last key; the JQL is
`project = KEY AND key > "KPI-123" ORDER BY key ASC`. The pure planner
`planKpiMetaToFields({ legacy, unitField, directionField })` decides, separately for unit and for
direction:

| `kpi-meta` | Field | Plan |
|---|---|---|
| has a value | empty | **copy** into the field |
| has a value | same value | **already done** |
| has a value | different value | **conflict**: keep the field (someone edited it in Jira), count it |
| absent / empty | any | nothing to do |

- All of a KPI's writes go in one `PUT /issue/{id}` as the admin, so there's one changelog entry per
  KPI.
- `status().pending` = KPIs with a `kpi-meta` value whose field is empty. It's computed from the same
  search the Timeline uses, which is fine for KPI-space sizes (spec 06 fixture: 50 KPIs).
- When it's `done`, `legacyTrusted` becomes `false` (see *Reading*). That's read from the
  `kpi:migrations` record, which is cached per invocation next to the space config.
- `applicable: false` while the fields aren't installed (ids are `null`). The row says "Deploy the app
  first".

**2. `kpi-fields-on-screens`** (config, `dependsOn: ['kpi-meta-to-fields']`)

- One "batch": find the KPI project's view, edit and create screens, add whatever fields are missing,
  and restrict the field contexts (Q2 A). `status().pending` = how many of (screen × field) are still
  missing.
- It runs **after** the data migration, so a field never shows empty in Jira while its value is still
  only in `kpi-meta`.
- `createKpiSpace` calls the same function, so new spaces never need it. Connecting a different space
  with `saveKpiSpaceKey` resets its record to `pending`.

### Test infrastructure

- **Mock Jira** ([scaleFixture.ts](../../app/src/backend/testing/scaleFixture.ts)): `/field` returns
  `kpi-unit` and `kpi-direction` fields (with env-tagged keys, to test the picker). Issues gain field
  values. `PUT /issue` accepts them. Add minimal screen, tab and context endpoints, and a flag to
  build the fixture **pre-migration** (only `kpi-meta`), **migrated** (only fields) or **mixed**.
- **Mock harness** ([mock-resolvers.ts](../../app/test-harness/fixtures/mock-resolvers.ts)):
  `getMigrations` and `runMigrationBatch` over an in-memory record with a fake batch delay, so the
  card's progress, pause and failure states can be seen at `?surface=settings`. A `?migrations=pending|done|failed`
  query param picks the starting state.
- **Live E2E** ([jira-api.e2e.ts](../../app/test-e2e/jira-api.e2e.ts)): create a KPI with unit and
  direction and read the fields back. Edit it and confirm one changelog entry.

## Implementation steps

Each step leaves the app working on **every** data shape (pre-migration, mixed, migrated) and ends with
`npm run test:all`, `npm run typecheck` and `npm run lint` passing.

### Step 0 — Check the Jira behaviour on the dev site (decides Q2 and parts of Q3)

Deploy just the two manifest fields (no code reads them yet) to the dev environment and check by hand
with REST (as an API-token user, then `asUser` through a temporary resolver if needed):

1. Do the fields appear in `/field` with keys `…__DEVELOPMENT__kpi-unit` / `…kpi-direction`? Was
   `forge install --upgrade` needed?
2. Can `POST /issue` set them when they're **not** on the create screen? Can `PUT /issue` set them when
   they're not on the edit screen (it works for `kpi-reading`)?
3. Does the direction **validation** expression reject `"up"` sent over REST?
4. Does the **formatter** render in the issue view once the field is on the view screen?
5. Which screen scheme does a project made by `createKpiProject` use? Is it shared?
6. Can a Forge field's **context** be restricted to one project and issue type over REST?
7. Does `search/jql` return the field values with `fields=customfield_…`?

Record the findings in this spec under *Step 0 findings*, and settle Q2.

### Step 1 — Fields in the manifest + id lookup

- Add `kpi-unit` and `kpi-direction` (and the `kpi-direction-edit` resource, if Q3 says so) to
  [manifest.yml](../../app/manifest.yml).
- `pickAppField` + `FieldIds.unit/direction` in [jira.ts](../../app/src/backend/jira.ts).
- **Verify:** unit tests for `pickAppField` (env-tagged, untagged, missing). The existing
  `pickReadingField` tests still pass. `requestLog` tests show still **one** `/field` call per load.

### Step 2 — `resolveKpiMeta` + reads with fallback

- Pure `resolveKpiMeta` in `@domain`, with the table above as tests.
- `fetchKpiSpaceIssues`, `fetchKpiIssueForEdit` and `fetchKpiMeta` request the fields (+ property)
  and resolve. For now `legacyTrusted` is always `true` (no migration record yet).
- **Verify:** backend tests on the pre-migration, mixed and migrated fixtures produce the **same**
  Timeline and panel output (snapshot the DTOs). Timeline request count unchanged
  ([timelinePerf.test.ts](../../app/src/backend/timelinePerf.test.ts)).

### Step 3 — Writes go to the fields (+ transitional `kpi-meta`)

- `createKpiIssue` and `updateKpiDefinition` write the fields, plus `kpi-meta` (Q1).
- **Verify:** mutation tests for create, edit-unit-only, edit-direction-only and rename-only (no field
  writes). A fixture with no fields installed still writes `kpi-meta` only. Live: create a KPI on the
  dev site and see its History tab show "KPI Unit" set by you.

### Step 4 — Migration framework (no migrations yet)

- `MigrationRecord` model, `kpi:migrations` KVS helpers, registry, and the `getMigrations` /
  `runMigrationBatch` resolvers (Settings-guarded).
- A **test-only** migration in the tests exercises: resume from cursor, idempotent re-run, per-item
  failure counted without stopping, `dependsOn` blocking, the admin guard, and concurrent batches
  giving the same result.
- **Verify:** those backend tests. A non-admin and a non-Settings context are both refused.

### Step 5 — `kpi-meta-to-fields`

- Pure `planKpiMetaToFields` + table tests (copy, already done, conflict, nothing, for unit and
  direction separately).
- Register the migration. When it's `done`, reads switch `legacyTrusted` to `false`.
- **Verify:** on the pre-migration fixture, run batches to completion. Then every KPI has field
  values, `kpi-meta` is still present, the Timeline DTO is unchanged, and `status().pending` is `0`. A
  second full run changes nothing. A mixed fixture with conflicting values keeps the field values and
  counts the conflicts.

### Step 6 — `kpi-fields-on-screens` + provisioning

- The screen and context function, called from `createKpiSpace` and registered as a migration.
  `saveKpiSpaceKey` resets its record.
- **Verify:** mock-Jira tests: a new space gets the fields on its view, edit and create screens; an
  existing space is fixed by the migration; running it again is a no-op. A shared screen is left alone
  and only the context is restricted, if Step 0 chose A.

### Step 7 — Settings `DataMigrationsCard`

- Follow the [create-react-modlet](../../.claude/skills/create-react-modlet/SKILL.md) pattern:
  component + stories (pending, running, paused, done, failed with list, blocked by `dependsOn`, not
  applicable) + portable-stories tests.
- Wire it into [Settings.tsx](../../app/src/ui/surfaces/Settings/Settings.tsx) and the mock harness.
- **Verify:** in the browser at `?surface=settings&migrations=pending`, run, pause, resume and retry
  in light and dark themes, with a clean console. Story tests pass.

### Step 8 — Live run on the dev site

- `npm run deploy:dev` (+ `forge install --upgrade` if Step 0 said so).
- In Settings (dev), run both migrations against the existing KPI space.
- **Verify:**
  - Open `KPI-11`: **KPI Unit** and **KPI Direction** show in Details, and direction reads
    "↑ Higher is better".
  - Edit the unit inline in Jira, then reload the Timeline: it shows the new unit.
  - JQL `"KPI Unit" = "%"` finds the right KPIs.
  - The **staging** install pointing at the same space still shows units (it reads `kpi-meta`).
  - A non-KPI issue in another project shows no KPI fields.

### Step 9 — Docs

- [storage-model.md](../01-initial-build/storage-model.md): a "Revised by spec 11" note saying unit
  and direction are fields, and `kpi-meta` is transitional.
- [kpiMeta.ts](../../app/src/domain/models/kpiMeta.ts) and `createKpiIssue` comments ("unit/direction
  … entity property (not a field)") updated.
- README: a short "Upgrading: run data migrations in Settings" section.

## Out of scope

- Moving the KPI **name** or **readings**.
- A `jira:entityProperty` JQL index on `kpi-meta` (the fields replace the need).
- Running migrations automatically with no admin (see Q4).
- Restyling how the Timeline or panel show unit and direction.

## Follow-ups

- **F1 — `kpi-meta-cleanup` migration.** Once every install on the site has run
  `kpi-meta-to-fields`, stop writing `kpi-meta` and register a migration that deletes it (as the
  admin). Then remove the read fallback code. This is a separate release, because other installs
  may still read the property.
- **F2 — Direction as an option-list field**, if Jira ever lets Forge own a select-type field. That
  would give a native dropdown instead of the custom edit resource.

## Questions

1. **Keep writing `kpi-meta` during the transition?** Recommended **yes**, so other installs on the
   same site (dev and staging) and CascadeMCP keep working until the F1 cleanup. The alternative is to
   write fields only, and accept that older installs show blank units.
2. **Shared screens: restrict the field context (A), or give the KPI project its own screen scheme
   (B)?** The draft assumes A, with B as the fallback if Step 0 shows Forge field contexts can't be
   restricted.
3. **Direction editing in Jira:** a small Custom UI select (`kpi-direction-edit`, consistent with our
   other surfaces), a UI Kit native select (lighter, but a second UI technology), or no custom editor
   (plain text guarded by validation)? Recommended: Custom UI select.
4. **How migrations run:** admin-driven from Settings only (draft), or also automatically after an
   upgrade (`avi:forge:upgraded:app` trigger + a Forge async-events queue, running **as the app**, so
   History would show the app instead of the admin)?
5. **Batch size:** 25 KPIs per `runMigrationBatch` is the draft value (one search page + 25 `PUT`s,
   well inside the resolver time limit). OK, or tune it after Step 8?
6. **When everything is done:** hide the Data migrations card entirely, or keep a collapsed "All data
   is up to date" row (useful for support)?
7. **Who may run migrations:** Jira admins on the Settings page (same as other Settings writes). The
   admin also needs **Edit Issues** on the KPI project. Should a missing Edit Issues permission stop
   the run up front with a clear message (recommended), or show up as per-KPI failures?
8. **Rename `KpiMetaProperty` → `KpiMeta`** now that it's no longer only a property? It's a mechanical
   rename across domain and backend; skipping it keeps the diff smaller.
9. **Field names:** "KPI Unit" / "KPI Direction" (draft), or "Unit" / "Direction"? Shorter, but they
   could clash with other apps' fields in JQL autocomplete.
