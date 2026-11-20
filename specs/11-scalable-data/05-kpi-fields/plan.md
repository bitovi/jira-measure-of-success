# 05 — Unit and direction in Jira fields

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft** · Depends on: 02, 04.

## Problem

Opening a KPI work item in Jira shows its summary and status, but not its **unit** (`%`, `$`,
`count`, …) or **direction** (higher or lower is better). Both live in the `kpi-meta` issue entity
property ([kpiMeta.ts](../../../app/src/domain/models/kpiMeta.ts)). Jira never renders entity
properties. They also can't be used in JQL, CSV export, Jira's own edit controls, or the History tab.

## Decision

- Unit and direction live in **Jira fields**: the ones chosen or created in 04 (`KpiSiteConfig.fields`).
  The app never looks fields up by name.
- **`kpi-meta` keeps being written** on every KPI write until the cleanup release, for the customer's
  report and older installs (overview, *Compatibility*).
- **`kpi-meta` keeps being read**, because older installs may write it after the migration. Which value
  wins is decided per KPI (below), not by a site-wide "migration done" switch.
- The domain shape is unchanged: `{ unit: string; direction: 'increase' | 'decrease' | null }`. Only the
  storage behind it changes, so the Timeline, panel, KPI View and the DTOs don't change.
- With **`fields: null`** (an upgraded install where nobody has chosen fields yet), everything behaves
  exactly as today: `kpi-meta` only.

What stays the same: the KPI **name** is the summary; **readings** stay in the `kpi-reading` field's
changelog; **targets** stay in `kpi-assignments` (03).

## Design

### Field value codec (`@domain`, pure)

```ts
encodeKpiMetaFields(cfg: KpiSiteConfig['fields'], meta: KpiMeta): Record<string, unknown>;
decodeKpiMetaFields(cfg: KpiSiteConfig['fields'], raw: Record<string, unknown>): Partial<KpiMeta>;
```

- Unit: a text value. `''` is written as `null` (empty field) and read back as `''`.
- Direction `kind: 'text'`: `'increase'` / `'decrease'`. `kind: 'select'`: the option id from
  `optionIds` (write format from 01 A5). An unknown option or string reads as `null`, as an
  unparseable `kpi-meta` does today.

### Which value wins (`resolveKpiMeta`, `@domain`, pure)

The app marks the `kpi-meta` it writes: `{ unit, direction, fields: true }`. Older installs write
`{ unit, direction }` and replace the whole property, which removes the marker. The customer's report
reads `unit` and `direction` and ignores the extra key (overview Q1 confirms).

| `kpi-meta` | Fields | Result | When it happens |
|---|---|---|---|
| marked `fields: true` | any | **fields**, even when empty | Written or migrated by this version. A field cleared in Jira stays cleared |
| unmarked | any | **`kpi-meta`** | Not migrated yet, **or** an older install edited the KPI since. That edit is the newest |
| absent | any | **fields** | A KPI created in Jira directly, or after the cleanup release |

Unit and direction are resolved **separately** within those rules. The unmarked-wins rule has one
gap, an edit made in Jira's own field UI on a KPI that's still unmarked (Q2).

### Reads

All in [jira.ts](../../../app/src/backend/jira.ts) (06 renames `fetchKpiSpaceIssues` to `fetchKpis`):

| Function | Change |
|---|---|
| `fetchKpiSpaceIssues` / `fetchKpis` | Add the configured field ids to `fields=`. Keep `properties=kpi-meta` |
| `fetchKpiIssueForEdit` | Same |
| `fetchKpiMeta` | One `GET /issue/{id}?fields=…&properties=kpi-meta` |

`KpiSpaceIssue.meta` and `KpiIssueForEdit.meta` keep their type.

### Writes

| Function | Today | After |
|---|---|---|
| `createKpiIssue` | `POST /issue` with `properties: [kpi-meta]` | `POST /issue` with the encoded fields **and** marked `kpi-meta` |
| `updateKpiDefinition` | `PUT /issue/{id}` (summary) + `PUT /issue/{id}/properties/kpi-meta` | **One** `PUT /issue/{id}` with summary, fields and `properties: [marked kpi-meta]`, if 01 A6 allows; otherwise the same two requests as today, fields first |

- Writes stay **as the user** (spec 10): Jira requires Edit or Create Issues, and History names them.
- Only changed parts are sent, as `updateKpi` already does (commit `ee28014`). A unit-only edit still
  rewrites the whole (marked) `kpi-meta`, since the property is one value.
- With `fields: null`: `kpi-meta` only, **unmarked**, as today.
- [mutations.test.ts](../../../app/src/backend/mutations.test.ts) expectations change accordingly.

### Keeping `kpi-meta` in step with edits made in Jira (Q3)

Once the fields are on screens, people edit unit and direction in Jira's own UI. That doesn't touch
`kpi-meta`, so the customer's report and older installs would show the old value. The draft proposes
a Forge **trigger** on `avi:jira:updated:issue`: when the changelog shows a change to the unit or
direction field on a KPI, rewrite the marked `kpi-meta` **as the app**. It's removed in the cleanup
release. 01 A9 checks that the event fires for those edits, and that the app's own property writes
don't fire it (no loop).

### Migration: `kpi-meta-to-fields`

Registered on 02's framework. `applicable: false` while `fields` is `null` ("Choose the KPI fields in
Settings first").

- **Which issues:** every KPI on the site, in every space: `issuetype = {workTypeId} AND id > {cursor}
  ORDER BY id ASC`. Not `project = KEY`, because 06 lets KPIs live anywhere.
- **Pure planner** `planKpiMetaToFields({ legacy, fields })`, per KPI:

  | `kpi-meta` | Plan |
  |---|---|
  | absent | nothing to do |
  | marked | **already done** |
  | unmarked, fields already equal | **mark only** (rewrite `kpi-meta` with the marker) |
  | unmarked, fields empty or different | **copy** `kpi-meta` into the fields, and mark |

  This follows the read rule (an unmarked `kpi-meta` wins), so the migration never changes what the app
  shows. Fields overwritten with a different value are counted separately and listed, so an admin can
  see whether anything edited directly in Jira was overwritten (Q2).
- One `PUT /issue/{id}` per KPI (fields + property, per 01 A6), `writeAs: 'user'` (02 Q2). One History
  entry per KPI.
- `status().pending` = KPIs with an unmarked `kpi-meta`, counted as the app.

### Test infrastructure

- **Mock Jira** ([scaleFixture.ts](../../../app/src/backend/testing/scaleFixture.ts)): configurable
  unit/direction field ids (text and select direction), field values on issues, `PUT` and `POST`
  accepting fields + properties. Fixture shapes: **not configured**, **pre-migration**, **migrated**,
  **mixed**, and **older install wrote after migration** (unmarked `kpi-meta` differing from the fields).
- **Harness** ([mock-resolvers.ts](../../../app/test-harness/fixtures/mock-resolvers.ts)): nothing
  visible changes; fixtures gain the marked property shape.
- **Live E2E** ([jira-api.e2e.ts](../../../app/test-e2e/jira-api.e2e.ts)): create a KPI with unit and
  direction, read the fields back, edit it, check History.

## Implementation steps

### Step 1 — Codec and `resolveKpiMeta`

- **Verify:** table tests for the codec (text and select direction, empty unit, unknown option) and for
  every row of *Which value wins*, unit and direction resolved separately.

### Step 2 — Reads

- The three reads request the fields and resolve.
- **Verify:** backend tests on every fixture shape produce the **same** Timeline and panel DTOs as the
  pre-migration snapshot, except the "older install wrote after" fixture, which shows the older
  install's values. Timeline request count unchanged
  ([timelinePerf.test.ts](../../../app/src/backend/timelinePerf.test.ts)).

### Step 3 — Writes

- `createKpiIssue` and `updateKpiDefinition` as above.
- **Verify:** mutation tests for create, unit-only, direction-only, rename-only (no field or property
  writes), and `fields: null` (unmarked `kpi-meta` only). The written `kpi-meta` still parses with
  **today's** `KpiMetaProperty` schema (an older install can read it).

### Step 4 — Sync trigger (if Q3 says yes)

- Manifest `trigger` module + handler; pure `kpiMetaFromChangelog(changelog, cfg)` decides whether to
  write.
- **Verify:** unit tests: a unit edit on a KPI rewrites `kpi-meta`; an edit to another field, or on a
  non-KPI, does nothing; an edit with no changelog item for our fields does nothing.

### Step 5 — Migration

- `planKpiMetaToFields` + table tests; register the migration.
- **Verify:** on the pre-migration fixture, run to completion: every KPI's fields hold its values,
  `kpi-meta` is marked and unchanged otherwise, DTOs are unchanged, `pending` is `0`, and a second run
  changes nothing. KPIs in **two projects** both migrate. A KPI the admin can't edit is a failure naming
  its space, and the migration isn't `done`. After the migration, an older-format write to one KPI
  shows as one new pending item, and the app shows that write's values.

### Step 6 — Live check (dev)

- Deploy the branch to dev; choose (or create) the fields in 04's Settings; run the migration.
- **Verify** on `bitovi-training`:
  - a KPI shows **KPI Unit** and **KPI Direction** in Details (when 04's screens are set up);
  - editing the unit in Jira shows in dev's Timeline, and (with the trigger) in staging's Timeline;
  - editing the unit in **staging** (older install) shows in dev's Timeline;
  - JQL on the unit field finds the right KPIs;
  - the History tab names the person for app edits.

### Step 7 — Docs

- [storage-model.md](../../01-initial-build/storage-model.md): "Revised by spec 11": unit and direction
  are fields; `kpi-meta` is a marked compatibility copy until cleanup.
- [kpiMeta.ts](../../../app/src/domain/models/kpiMeta.ts) and `createKpiIssue` comments.

## Questions

1. **Rename `KpiMetaProperty` → `KpiMeta`** now that it isn't only a property? A mechanical rename
   across domain and backend.
2. **"Unmarked `kpi-meta` wins."** That's right when an older install edited the KPI after the
   migration. It's wrong when someone edited the field in Jira's own UI on a KPI that hasn't been
   migrated yet (it only happens if the fields are on screens before the migration runs). The migration
   lists every field it overwrote. Is that acceptable? Or should 04 only put the fields on screens
   **after** this migration is done (the earlier draft's ordering)?
3. **Sync trigger.** Add the `avi:jira:updated:issue` trigger so `kpi-meta` follows edits made in
   Jira's UI (for the customer's report and older installs) until the cleanup release? Without it, the
   customer's report can show an old unit or direction after a Jira-side edit.
4. **Migrating as the admin**: History names the admin for every migrated KPI. Fine, or migrate as the
   app (02 Q2)?
