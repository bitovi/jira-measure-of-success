# 05 — Unit and direction in Jira fields

Part of [11 — Scalable KPI data](../plan.md). Status: **Done** · Depends on: 02, 04.

## Problem

Opening a KPI work item in Jira shows its summary and status, but not its **unit** (`%`, `$`,
`count`, …) or **direction** (higher or lower is better). Both live in the `kpi-meta` issue entity
property ([kpiMeta.ts](../../../app/src/domain/models/kpiMeta.ts)). Jira never renders entity
properties. They also can't be used in JQL, CSV export, Jira's own edit controls, or the History tab.

## Decision

- Unit and direction live in **Jira fields**: the ones chosen or created in 04 (`KpiSiteConfig.fields`).
  The app never looks fields up by name.
- **`kpi-meta` keeps being written** on every KPI write until the cleanup release, for the customer's
  report (overview, *Compatibility*).
- **Once fields are chosen, the app reads the fields only.** `kpi-meta` isn't read as a fallback: a
  Jira admin runs the migration right after choosing the fields, and until then units and directions
  may show empty (accepted, overview).
- The domain shape is unchanged: `{ unit: string; direction: 'increase' | 'decrease' | null }`. Only the
  storage behind it changes, so the Timeline, panel, KPI View and the DTOs don't change.
- With **`fields: null`** (an upgraded install where nobody has chosen fields yet), everything behaves
  exactly as today: `kpi-meta` only, since there are no fields to read.

What stays the same: the KPI **name** is the summary; **readings** stay in the `kpi-reading` field's
changelog; **targets** stay in `kpi-assignments` (03).

## Design

### Field value codec (`@domain`, pure)

```ts
encodeKpiMetaFields(cfg: NonNullable<KpiSiteConfig['fields']>, meta: KpiMeta): Record<string, unknown>;
decodeKpiMetaFields(cfg: NonNullable<KpiSiteConfig['fields']>, raw: Record<string, unknown>): Partial<KpiMeta>;
```

- Unit: a text value. `''` is written as `null` (empty field) and read back as `''`.
- Direction `kind: 'text'`: `'increase'` / `'decrease'`. `kind: 'select'`: the option id from
  `optionIds` (write format from 01 A5). An unknown option or string reads as `null`, as an
  unparseable `kpi-meta` does today.

### Where the value comes from (`resolveKpiMeta`, `@domain`, pure)

| `fields` config | Result |
|---|---|
| `null` (not chosen yet) | `kpi-meta`, as today |
| set | **the fields**, even when empty. `kpi-meta` is ignored |

**The `fields: true` marker.** `kpi-meta` gains a marker, `{ unit, direction, fields: true }`, meaning
"this KPI's fields hold its values" (migrated, or created after the fields were chosen). Reads ignore
it; it exists for the migration's pending count (*Migration*, below). `kpi-meta` isn't indexed, so it
can't be a JQL search like 03's `refsVersion`. The customer's report reads `unit` and `direction` and
ignores the extra key (overview Q1 confirms).

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
| `updateKpiDefinition` | **One** `PUT /issue/{id}` with the summary and `properties: [kpi-meta]` (Jira already accepts both in one edit) | The same one `PUT`, with the encoded **fields** added next to the summary and the marked `kpi-meta` in `properties`. 01 A4/A6 confirm the custom fields are accepted off-screen in that body |

- Writes stay **as the user** (spec 10): Jira requires Edit or Create Issues, and History names them.
- Only changed parts are sent, as `updateKpi` already does (commit `ee28014`). A unit-only edit still
  rewrites the whole `kpi-meta`, since the property is one value: it starts from the **stored**
  `kpi-meta` and changes only what the edit changed, so a not-yet-migrated KPI's direction isn't lost.
  The marker is **carried over**: a created KPI is marked; an edit keeps whatever the KPI had, so an
  unmigrated KPI stays pending for the migration.
- With `fields: null`: `kpi-meta` only, **unmarked**, as today.
- [mutations.test.ts](../../../app/src/backend/mutations.test.ts) expectations change accordingly.

### Keeping `kpi-meta` in step with edits made in Jira (Q3)

Once the fields are on screens, people edit unit and direction in Jira's own UI. That doesn't touch
`kpi-meta`, so the customer's report would show the old value. The draft proposes a Forge
**trigger** on `avi:jira:updated:issue`: when the changelog shows a change to the unit or direction
field on a **marked** KPI, rewrite `kpi-meta` from the fields **as the app**. An unmarked KPI is left
to the migration (it reconciles both values, below). It's removed in the cleanup release.

- **Filtered in the manifest**, so it isn't invoked for every issue edit on the site:
  - `filter.expression` passes only issues whose `kpi-meta` carries the `fields: true` marker, using
    Forge's entity-property filtering. The KPI work type id lives in KVS, so the manifest can't name it,
    and the marker is what the trigger cares about anyway.
  - `filter.ignoreSelf: true` drops events caused by the app's own writes: KPI edits made through the
    app (which already write `kpi-meta`) and the `kpi-meta-to-fields` migration (one event per migrated
    KPI otherwise).
- **The handler still checks**: it does nothing when `kpi-meta` already matches the fields, in case an
  event gets through the filter.
- **01 A9 confirmed this (2026-11-24):** the event fires for a person's edit of a marked KPI, with
  `changelog.items` naming the field; the expression drops unmarked KPIs; `ignoreSelf` drops the app's
  own field writes made `asUser` **and** `asApp`; property writes never fire it. Entity-property
  filtering is a Forge *preview* feature.
- A trigger module adds no scope, so it doesn't make the release a major version (overview Q11).

### Migration: `kpi-meta-to-fields`

Registered on 02's framework. `applicable: false` while `fields` is `null` ("Choose the KPI fields in
Settings first").

- **Which issues:** every KPI on the site, in every space: `issuetype = {workTypeId} ORDER BY id ASC`,
  paged with `nextPageToken` (01 E2: `id > {cursor}` only works within one project). Not
  `project = KEY`, because 06 lets KPIs live anywhere.
- **Pure planner** `planKpiMetaToFields({ legacy, fields })`, per KPI:

  | `kpi-meta` | Plan |
  |---|---|
  | absent | nothing to do |
  | marked | **already done** |
  | unmarked | reconcile unit and direction **separately**, then write the fields that changed and the marked `kpi-meta` |

  Per value: field **empty** → copy it from `kpi-meta`; field **equal** → nothing; field holds a
  **different** value → **the field wins** (it was set in Jira after the fields were chosen, and it's
  what the app already shows) and `kpi-meta` is rewritten to match. Those are counted separately and
  listed, so an admin can review them (Q2).
- One `PUT /issue/{id}` per KPI (fields + property, per 01 A6), `writeAs: 'user'` (02 Q2). One History
  entry per KPI.
- `status().pending` = KPIs with an unmarked `kpi-meta`, counted as the app by paging the KPIs (their
  number is small next to the targets 03 migrates).

### Test infrastructure

- **Mock Jira** ([scaleFixture.ts](../../../app/src/backend/testing/scaleFixture.ts)): configurable
  unit/direction field ids (text and select direction), field values on issues, `PUT` and `POST`
  accepting fields + properties. Fixture shapes: **not configured**, **pre-migration**, **migrated**,
  **mixed**, and **field edited in Jira before migration** (unmarked `kpi-meta` differing from a
  non-empty field).
- **Harness** ([mock-resolvers.ts](../../../app/test-harness/fixtures/mock-resolvers.ts)): nothing
  visible changes; fixtures gain the marked property shape.
- **Live E2E** ([jira-api.e2e.ts](../../../app/test-e2e/jira-api.e2e.ts)): create a KPI with unit and
  direction, read the fields back, edit it, check History.

## Implementation steps

### Step 1 — Codec and `resolveKpiMeta`

- **Verify:** table tests for the codec (text and select direction, empty unit, unknown option) and for
  `resolveKpiMeta` (`fields: null` reads `kpi-meta`; set fields are read even when empty, whatever
  `kpi-meta` holds).

### Step 2 — Reads

- The three reads request the fields and resolve.
- **Verify:** backend tests: the **migrated** and **not configured** shapes produce the **same**
  Timeline and panel DTOs as the pre-migration snapshot of today's code; the **pre-migration** shape
  with fields chosen shows empty units and directions (the accepted gap). Timeline request count
  unchanged
  ([timelinePerf.test.ts](../../../app/src/backend/timelinePerf.test.ts)).

### Step 3 — Writes

- `createKpiIssue` and `updateKpiDefinition` as above.
- **Verify:** mutation tests for create (marked), unit-only, direction-only, rename-only (no field or
  property writes), and `fields: null` (unmarked `kpi-meta` only). A unit-only edit on an **unmarked**
  KPI keeps `kpi-meta`'s direction and stays unmarked. The written `kpi-meta` still parses with
  **today's** `KpiMetaProperty` schema and holds the same `unit` / `direction` (what the customer's app
  reads).

### Step 4 — Sync trigger (if Q3 says yes)

- Manifest `trigger` module (with `filter.expression` and `filter.ignoreSelf`, above) + handler; pure
  `kpiMetaFromChangelog(changelog, cfg, storedMeta)` decides whether to write.
- **Verify:** unit tests: a unit edit on a marked KPI rewrites `kpi-meta`; on an unmarked KPI it does
  nothing; an edit to another field, or on a non-KPI, does nothing; an edit with no changelog item for
  our fields does nothing; an edit whose new values already match `kpi-meta` does nothing.

### Step 5 — Migration

- `planKpiMetaToFields` + table tests; register the migration.
- **Verify:** on the pre-migration fixture, run to completion: every KPI's fields hold its values,
  `kpi-meta` is marked and unchanged otherwise, DTOs are unchanged, `pending` is `0`, and a second run
  changes nothing. A KPI the admin can't edit is a failure naming its space, and the migration ends
  `failed`. (KPIs in **two projects** are checked in 06, which builds the multi-space fixture.) The "field edited in Jira" fixture keeps the field's
  value, rewrites `kpi-meta` to match, and lists it.

### Step 6 — Live check (dev)

- Deploy the branch to dev; choose (or create) the fields in 04's Settings; run the migration.
- **Verify** on `bitovi-training`:
  - a KPI shows **KPI Unit** and **KPI Direction** in Details (when 04's screens are set up);
  - editing the unit in Jira shows in dev's Timeline, and (with the trigger) in the legacy reader
    report (09);
  - JQL on the unit field finds the right KPIs;
  - the History tab names the person for app edits.

### Step 7 — Docs

- [storage-model.md](../../01-initial-build/storage-model.md): "Revised by spec 11": unit and direction
  are fields; `kpi-meta` is a compatibility copy for the customer's app until cleanup.
- [kpiMeta.ts](../../../app/src/domain/models/kpiMeta.ts) and `createKpiIssue` comments.

## Questions

1. **Rename `KpiMetaProperty` → `KpiMeta`** now that it isn't only a property? A mechanical rename
   across domain and backend.
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** no rename now (churn without a behaviour change); the cleanup release can do it.
2. **A field that already differs wins.** If a field was edited in Jira's own UI before the migration
   ran (only possible when the fields are on screens first), or a "use existing" field already held
   values, the migration keeps the field and rewrites `kpi-meta` to match, listing each one. OK? Or
   should `kpi-meta` win, or should 04 only put the fields on screens **after** this migration is
   done (the earlier draft's ordering)?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** the field wins, as drafted, listed for review.
3. **Sync trigger.** (01 A9: the filtered trigger works as designed, so this is only a product
   decision now.) Add the `avi:jira:updated:issue` trigger so `kpi-meta` follows edits made in
   Jira's UI (for the customer's report) until the cleanup release? Without it, the
   customer's report can show an old unit or direction after a Jira-side edit.
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** yes, add the trigger (Step 4).
4. **Migrating as the admin**: History names the admin for every migrated KPI. Fine, or migrate as the
   app (02 Q2)?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** as the admin, as drafted (02 Q2).

## Live check (2026-11-24, dev v10.5.0)

- Upgrade data → *Move unit and direction into fields*: **13 upgraded, 1 already up to date** (KPI-18
  has no `kpi-meta`), `done`. Every KPI's KPI Unit / KPI Direction match its `kpi-meta`, now marked
  `fields: true`; History shows one change by the admin.
- JQL: `"KPI Direction" = Decrease` → KPI-5, KPI-14; `cf[10910] ~ "USD"` → KPI-1, 5, 8, 9.
- **Sync trigger:** a unit edit made outside the app (KPI-10 → `pts`, then cleared) rewrote `kpi-meta`
  within 20 s each time.
- The legacy reader report is unchanged; dev's Timeline shows the same units as before.

## Implementation notes

Done 2026-11-25 on `feat/11-scalable-data`, Steps 1–5 and 7. Step 6 (live check on dev) is pending.

**Files added**

- `app/src/domain/resolve/kpiMetaFields.ts` (+ test): `kpiMetaFieldIds(cfg)`, `encodeKpiMetaFields(cfg, partialMeta)`
  (only the parts given; `''` / no direction → `null`; a select by `{ id }`), `decodeKpiDirection`,
  `decodeKpiMetaFields(cfg, rawFields)` (only the fields present in the response), `parseKpiMeta` (moved from
  `jira.ts`), `resolveKpiMeta(cfg, { legacy, fields })`, `isMarkedKpiMeta`, `kpiMetaToStore(stored, meta, mark)`,
  `kpiMetaCreate(cfg, meta)` / `kpiMetaWrite(cfg, storedRaw, current, change)` (what a create / an edit writes),
  `kpiMetaFromChangelog(changelog, cfg, storedMeta)` (the trigger's decision) and
  `planKpiMetaToFields(cfg, { legacy, fields })` (the migration planner).
- `app/src/backend/kpiMetaSync.ts`: the trigger handler (`kpiMetaSync`, exported from `src/index.ts`) and
  `syncKpiMetaFromFields(event, jira?)`, which tests call directly.
- `app/src/backend/migrations/kpiMetaToFields.ts` (+ test): the `kpi-meta-to-fields` migration, registered
  after 03's.
- `app/src/backend/kpiFields.test.ts`: reads, writes and the trigger through the real resolver on the
  mock Jira, in every fixture shape.

**Files changed**

- `jira.ts`: `fetchKpiSpaceIssues(projectKey, hierarchy, kpiFields = null)`,
  `fetchKpiIssueForEdit(idOrKey, kpiFields = null)` (also returns `storedMeta`, the raw `kpi-meta`),
  `fetchKpiMeta(id, kpiFields = null)` (one `GET /issue/{id}?fields=…&properties=kpi-meta` when chosen; the
  property GET otherwise; still unused by the app), `createKpiIssue(…, workType, kpiFields = null)`,
  `updateKpiDefinition(id, { name?, fields?, meta? })` (`meta` is now the whole raw `kpi-meta` to store).
- `kpiConfig.ts`: `readKpiFieldsConfig()`, the fields from the saved record only (a KVS read, no Jira
  request), used by the Timeline/panel search and `updateKpi`; `createKpi` uses `readKpiSiteConfig().fields`.
- `resolver.ts` (`visibleKpiSpaceIssues`, `createKpi`, `updateKpi`), `migrations/index.ts` (registry),
  `index.ts`, `manifest.yml` (the `kpi-meta-sync` trigger + `kpi-meta-sync-fn` function, filter exactly as
  01 A9), `kpiMeta.ts` and `createKpiIssue` comments, `storage-model.md` ("Revised by spec 11 · 05").
- `testing/scaleFixture.ts`: `chooseKpiFields(fixture, shape, { direction: 'select' | 'text' })` with
  shapes `pre-migration`, `migrated`, `mixed`, `field-edited` (not calling it = **not configured**), field
  ids/options as on dev (`customfield_10910`, `customfield_10911`, `10652` / `10653`), `kpiFieldValues`,
  `FixtureIssue.fieldValues`; the mock returns requested custom fields (null when empty), takes them in
  `PUT /issue/{id}` and `POST /issue` (rejecting, like Jira, a field not in the space's field scheme for the
  work type, 01 A4, and an unknown option), and answers `issuetype = {id} ORDER BY id ASC`.
- Tests: `kpiSetup.test.ts` (04's "choosing fields changes nothing" now expects empty units/directions
  until migrated), `runner.test.ts` (the real registry lists both migrations), `test-e2e/jira-api.e2e.ts`
  (an env-gated step: `E2E_KPI_UNIT_FIELD`, `E2E_KPI_DIRECTION_FIELD`, `E2E_KPI_DIRECTION_OPTIONS`).
- Harness: only a comment. It doesn't model the `kpi-meta` property, so there's no property shape to
  mark; its `kpi-meta-to-fields` stand-in already had the real id, title, `writeAs` and reason.

**Decisions made while implementing**

- **Changed parts only.** `updateKpi` works out which of unit/direction changed against what the app
  shows (the fields), sends only those fields, and rebuilds `kpi-meta` from the stored raw value with only
  those parts replaced (unknown keys and the marker kept). A KPI with **no readable** `kpi-meta` gets one
  built from its field values, **marked** when the fields are chosen (its values do come from the fields).
  With `fields: null` the marker is dropped, so that path writes exactly today's `{ unit, direction }`.
- **Create** sends only non-empty field values (an empty unit / no direction is simply not set) and always
  a full `kpi-meta`, marked when the fields are chosen.
- **Direction decoding**: text is matched case-insensitively after trimming (`Increase` typed in Jira
  reads as `increase`); a select matches `{ id }` or a bare option id. Anything else reads as no
  direction. The migration treats an unmapped option like an empty field (overwritten from `kpi-meta`).
- **Trigger**: decided from the event alone first (no request unless the changelog names one of our
  fields), then one `GET` of the property and, only if it differs, one `PUT`, both as the app. Values come
  from the changelog's `toString` (text) / `to` (select option id), as the spec's signature says; the
  other value stays as stored. Errors are logged, not thrown.
- **Migration**:
  - KPIs are listed **as the app** (`issuetype = {workTypeId} ORDER BY id ASC`, `fields=project`,
    `properties=kpi-meta`, 25 per page, `nextPageToken`), so a KPI the admin can't see is a listed failure
    rather than silently left out; each pending KPI is **re-read** (fields + `kpi-meta`, as the app) right
    before its write and planned from that read, so a value set in Jira meanwhile is kept (field wins).
    The `PUT` (fields + marked raw `kpi-meta`, one request) runs as the admin.
  - Absent or marked `kpi-meta` → `alreadyDone`; written → `migrated`. A KPI whose field already
    differed is counted as `migrated` and **logged** (`console.info`, Forge logs: key, field value,
    `kpi-meta` value): 02's record has no separate count or list for it, so Settings doesn't show them
    (deviation from Q2's "counted separately"). A 403/404 on the write is a failure naming the space
    ("…you need Edit Issues in space KPI"); other Jira errors also name the space.
  - An unparseable but present `kpi-meta` is treated as empty: the fields are kept and `kpi-meta` is
    rewritten from them, marked (otherwise the migration could never finish).
  - Not applicable while `fields` (or the work type) is null, with the harness's wording: "Choose the
    KPI fields in Settings first (KPI building blocks)." No `dependsOn` 03 (the harness keeps its
    harness-only dependency).
  - `status().pending` pages every KPI as the app, 100 per page (up to 100 pages, else `null`).
- **Request budgets unchanged**: the field config is read from KVS only; the field ids ride in the
  existing KPI-space search, so `timelinePerf.test.ts` and the new budget test show the same requests.

**API later stages use** (06 renames `fetchKpiSpaceIssues` → `fetchKpis`): pass the config's `fields` as
the `kpiFields` argument of `fetchKpis` / `fetchKpiIssueForEdit` / `createKpiIssue`; edits go through
`kpiMetaWrite(cfg, kpi.storedMeta, kpi.meta, change)` → `updateKpiDefinition`. `KpiSpaceIssue.meta` /
`KpiIssueForEdit.meta` keep their type. The migration's site-wide `issuetype =` query is already what 06
needs; 06's multi-space fixture should add a second space to the field scheme check.

**Verification**: 776 unit tests (was 698) and 187 story tests pass; `typecheck` and `lint` clean;
`forge lint` passes (only the existing `images` egress warning); the manifest parses and the trigger key
(`kpi-meta-sync`) differs from its function key (`kpi-meta-sync-fn`).

**Live check (Step 6) should verify** on bitovi-training (fields `customfield_10910` / `customfield_10911`,
options `10652` Increase / `10653` Decrease, 14 KPIs, work type 10436): deploy (the trigger module is new:
`forge deploy` + `forge install --upgrade`); before migrating, the Timeline shows empty units/directions;
Upgrade data → *Move unit and direction into fields* runs to Done with 14 migrated (or fewer plus already
done), each KPI's History shows one change by the admin, and `kpi-meta` reads `{ unit, direction, fields:
true }`; the Timeline then matches the pre-deploy units/directions; creating and editing a KPI in the app
sets the fields (History names the user) and keeps `kpi-meta` in step; editing *KPI Unit* in Jira's own UI
on a migrated KPI rewrites `kpi-meta` within a few seconds (Forge logs show `[kpi-meta-sync]`), while the
same edit on an unmigrated KPI and the app's own edits don't invoke it; JQL `cf[10910] ~ "…"` /
`"KPI Direction" = Decrease` finds the right KPIs; the env-gated E2E step passes with
`E2E_KPI_UNIT_FIELD=customfield_10910 E2E_KPI_DIRECTION_FIELD=customfield_10911
E2E_KPI_DIRECTION_OPTIONS=10652,10653`.
