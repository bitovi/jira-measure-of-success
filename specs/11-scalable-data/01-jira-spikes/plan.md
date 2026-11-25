# 01 — Jira spikes

Part of [11 — Scalable KPI data](../plan.md). Status: **Done** (G1 review pending).

## Goal

Check, on the dev site (`bitovi-training`), every Jira behaviour that later stages depend on, **before**
the design is settled. Each item names the stage and question it feeds. The findings go into
*Findings* below, and Justin reviews them (**gate G1**) before stage 04's prototype review.

No product code changes in this stage. Anything temporary (a spike resolver, a throwaway project, an
extra issue type) is listed in *Clean-up* and removed or recorded at the end.

## How to check

- **REST as an API-token user** (curl) for config and admin behaviour.
- **Through Forge** for anything that depends on `requestJira` `asUser` / `asApp`: a temporary
  `spike*` resolver on the branch, deployed to **dev** only and deleted at the end of the stage.
- **A second test user** who is *not* a Jira admin, for the permission items.
- Throwaway projects are named `SPIKE…` so they're easy to find and delete.

## What to check

### A. Fields: who owns them, how they behave (feeds 04 and 05)

| # | Check | Feeds |
|---|---|---|
| A1 | ~~**Forge-owned fields** with two installs on one site~~ **Skipped (2026-11-24, Q3).** The app's Forge-owned **KPI Reading** field already shows the answer on bitovi-training: Jira makes one field per install ("KPI Reading (dev)", "KPI Reading (staging)"), each with its own values. 04 Q1 is decided from that | 04 Q1 |
| A2 | **Admin-created fields over REST** (`POST /rest/api/3/field`, short text and single-select): can the app create them with the scopes it already has (`manage:jira-configuration`)? Can it add select options and read them back (`/field/{id}/context/{ctx}/option`)? | 04 Q1, Q2 |
| A3 | **Field context by issue type**, for both kinds of field: can the context be limited to the KPI issue type **in all projects**? Does a second company-managed project that adds the KPI type pick up the fields without another context change? | 04, 06 |
| A4 | **Writes off-screen**: can `POST /issue` and `PUT /issue/{id}` (as the user) set the unit and direction fields when they're **not** on the create or edit screen? (This already works for `kpi-reading`.) | 05 |
| A5 | **Select field write and read format**: what does `PUT /issue` accept for a single-select (`{ id }`, `{ value }`)? What does `search/jql` return with `fields=customfield_…`? | 05 |
| A6 | **One-request dual write**: `PUT /issue/{id}` with `fields` (summary) **and** `properties` (`kpi-meta`) in one body, as the user, is **already in production** (`updateKpiDefinition`, R11). Left to check: the unit and direction **custom fields** in that same body, and in `POST /issue` (already used with `properties`) | 05 |
| A7 | **Validation and formatter** (Forge-owned fields only): does a `validation.expression` reject `"up"` sent over REST? Does a `view.formatter` render in the issue view and in CSV export? | 04 Q1 |
| A8 | **History**: does a field write made as the user show in the issue's History, naming them? | 05 |
| A9 | **Sync trigger**: does a Forge `avi:jira:updated:issue` trigger fire when the unit or direction field is edited in Jira's UI, with a changelog naming the field? Does the app's own write of the `kpi-meta` **property** stay silent (so there's no loop)? With the manifest filter: does `filter.expression` on the `kpi-meta` property's `fields` marker (entity-property filtering) pass only marked KPIs? Does `filter.ignoreSelf: true` drop the app's **own** field writes, including ones made with `asUser` (R12, R25)? | 05 Q3 |

### B. Screens, schemes and spaces (feeds 04 and 06)

| # | Check | Feeds |
|---|---|---|
| B1 | Which screen scheme, field configuration and **work type scheme** does a project made by today's `createKpiProject` use? Is any of them shared with other projects? On bitovi-training, does `issuetype = KPI AND project != KPI` return anything? (If the KPI project's work type scheme is shared, other projects already offer the KPI type, and 06's "a KPI is an issue of the KPI work type" would pick up their KPI-typed issues.) | 04, 06 (overview *Sites this affects*) |
| B2 | **Field schemes**: the v3 prototype assumes Jira's newer *field schemes*. On the dev site, do we have field schemes or the older *field configuration schemes*? Which REST API creates them, adds a field for one work type, and assigns one to a project? (Jira marks the field schemes API, `/rest/api/3/config/fieldschemes`, **experimental**.) | 04 Q3 |
| B3 | Over REST: create a **work type scheme**, **screens**, a **screen scheme** and a **work type screen scheme**, and assign them to a project. Which calls need Jira admin (`asUser` from Settings), and which work `asApp`? Every one should work with the app's **current** scopes (`manage:jira-configuration`, `manage:jira-project`; overview Q11). Flag any that doesn't, since a new scope makes the release a major version | 04 |
| B4 | **Who can enable KPIs in a space?** As a **project admin who isn't a Jira admin**, on a company-managed project: can they add the KPI work type to their project? Can they add KPI Unit / KPI Direction to its layout, with and without *extended project administration*? With a project created from a **shared configuration** of a KPI-enabled project, do the type and screens come along automatically? | 04 (the "other spaces" guide) |
| B5 | **Partly set-up space**: KPI type added, fields on **no** screen. Can the app still create a KPI there with unit and direction, record readings (`kpi-reading`), and read them all back? | 05, 06 |
| B6 | `GET /project/search?action=create&expand=issueTypes` as the user: does it list the KPI type only for KPI-enabled projects? How many pages does the dev site need? | 08 |
| B7 | **Work type avatar**: can Settings upload an SVG or PNG avatar for a work type (`POST /rest/api/3/universal_avatar/type/issuetype/owner/{typeId}`) and select it (`PUT /rest/api/3/issuetype/{id}` with `avatarId`), as the admin, with the app's scopes? Does `issuetype.iconUrl` then return it, and does `inlineIssueTypeIcons` load it? | 04 Q11 |
| B8 | **Recording a value in another space**: in a space whose **field configuration** doesn't include the **KPI Reading** field (or hides it), can the app still record a reading (`writeReading`, as the user) and read it back from the changelog? KPI Reading is Forge-owned, so each install (dev, staging, prod) has its own: does a space need each one added? (R5) | 04 Q1, Q9; 06 |

### C. Finding KPIs across spaces (feeds 06 and 07)

| # | Check | Feeds |
|---|---|---|
| C1 | `issuetype = {id}` returns KPIs from two company-managed projects. (The team-managed half, that a team-managed space's own "KPI" type never matches, isn't spiked (Q2): team-managed work types are private to their space with their own ids, as Jira documents, and 06's mock fixture covers it.) | 06 |
| C2 | KPI hierarchy links between KPIs in **different** projects: created as the user, returned in `issuelinks`, same as same-project links. And for a user **without Browse** on the parent's project: is the link left out of the child's `issuelinks` (as the user), so the child reads as top-level without revealing the parent? (overview Q8) | 06 |
| C3 | Cost of `issuetype = {id} AND summary ~ "text*"` on the dev site with 1, 5 and 20 projects of KPIs (the scale fixture simulates the size; this checks live latency) | 07 |
| C4 | `issuetype = {id} AND id in (…)` with 50 ids: one request, all returned? | 07 |

### D. Ids, keys and the targets index (feeds 03)

| # | Check | Feeds |
|---|---|---|
| D1 | Move a KPI to another project. Does `GET /issue/{oldKey}` through Forge `requestJira` (as the user **and** as the app) return the moved issue, with its **new** key and the **same** id? | 03 |
| D2 | **Adding** index paths to the `kpi-assignments` entity property (`kpiIssueIds`, `type: string`; `refsVersion`, `type: number`): are properties **already written** indexed under the new paths after deploy, or only properties written afterwards? | 03 Q2 |
| D3 | On a `string` index, does `issue.property[kpi-assignments].kpiIssueIds = "10234"` match exactly, with no tokenising? Does `IS NOT EMPTY` work as it does on the `text` path? | 03 |
| D4 | Does the existing `text` path (`kpiIds`) keep working, unchanged, after D2's deploy? (The customer's app searches with it.) | 03 |
| D5 | On the `number` path, does `kpiIds IS NOT EMPTY AND refsVersion IS EMPTY` return exactly the issues without the marker (including ones written before the path existed)? | 03 |

### E. Migrations at scale (feeds 02)

| # | Check | Feeds |
|---|---|---|
| E1 | In one resolver invocation (as the user): how many `PUT /issue/{id}` fit comfortably inside the time limit? Try 25 and 50 | 02 Q1 |
| E2 | `issuetype = {id} AND id > {n} ORDER BY id ASC` paginates stably while issues are being edited | 02 |
| E3 | An `asApp` JQL count (`search/approximate-count` or paging `search/jql` with `fields=id`) for "KPIs still to migrate" sees issues the admin can't browse | 02 |

### F. Space pages (`jira:projectPage`, feeds 08)

Started early (2026-11-21), ahead of the rest of 01, so 08's space-page prototype rests on real
behaviour. The spike (module `kpi-space-page`, "KPIs (dev)" in each space, with a read-only
`probeSpacePage` resolver) ran on **dev** as v9.0.0 and was **removed** in v10.0.0 once 08 deferred space
pages (2026-11-21). F2–F4 are left for when space pages are picked up.

| # | Check | Feeds |
|---|---|---|
| F1 | What a project page's context carries (in the browser and in the resolver), whether it knows the space's **board** and that board's **JQL**, and whether we need a KPI-only board | 08 |
| F2 | **Which board** the context names in a space with several boards (the last one visited? the first?), and with none | 08 |
| F3 | As a **non-admin** user: can they read the board configuration (`read:board-scope.admin`), or only as the app? Does the page appear for them, and in team-managed spaces? | 08 |
| F4 | **Where the tab appears** in the new navigation (horizontal tabs, "More", the sidebar) and whether a space admin can pin or hide it. Can `displayConditions` hide it in spaces without the KPI type (e.g. `jiraExpression` on the project's issue types)? | 08 |

## Implementation steps

### Step 1 — Fields (A1–A9)

- A1 is skipped (Q3). A7 only matters if G2 picks Forge-owned fields (04 Q1); if it does, check A7
  then, with a throwaway Forge-owned field on **dev only**. Create a pair of admin-style fields over REST
  for A2–A6, A8 and A9 (A9 uses a temporary trigger module that only logs).
- **Verify:** every A item has a finding with the exact request and response shape used.

### Step 2 — Screens, schemes, spaces (B1–B8)

- Use a `SPIKE` company-managed project and the second (non-admin)
  user.
- **Verify:** every B item has a finding. B4 has a clear "space admin can / needs a Jira admin" answer
  for each action.

### Step 3 — Search and ids (C1–C4, D1–D5)

- Move one throwaway KPI between `SPIKE` projects for D1. Deploy the extra index paths for D2–D5.
- **Verify:** every C and D item has a finding. D2 says whether stage 03's migration must rewrite
  every property just to get it indexed.

### Step 4 — Migration limits (E1–E3)

- A temporary `spikeBatch` resolver writing to throwaway KPIs.
- **Verify:** E1 gives a recommended batch size. E2 and E3 are confirmed or have a workaround.

### Step 5 — Clean up and review (G1)

- Remove the temporary resolvers, the throwaway field from the manifest, and the spike projects.
  Record anything that can't be removed (e.g. custom fields that only go to the trash) under
  *Clean-up*.
- Update the *Questions* sections of stages 02–08 with what the findings answer.
- **🔍 Gate G1: stop and ask Justin to review *Findings*.** Record his comments here.
- **Status (2026-11-24):** Steps 1–5 done; Clean-up complete. Findings are **ready for Justin's
  review**. Justin asked the implementer to keep going ("continue as far as you can"), so later stages
  proceed on these findings; any G1 comments are folded in afterwards.

## Findings

Run 2026-11-24 on bitovi-training, as Justin (Jira admin), with REST from the logged-in browser and,
for `asUser` / `asApp` and triggers, a temporary `spike.ts` resolver and triggers deployed to dev as
**v10.2.0** (a minor version: no scope change). **Non-admin checks are deferred** (Justin, 2026-11-24:
"make it work for me first; check individual users later"): B4, C2's hidden-parent half, and E3's
"admin can't browse" half are marked *deferred* below.

Throwaway objects: fields `customfield_10907` *SPIKE KPI Unit* (short text) and `customfield_10908`
*SPIKE KPI Direction* (single select, options `10650` Increase / `10651` Decrease); projects `SPIKE`
(11032) and `SPIKEB` (11033); field scheme `102`; issues `SPIKE-1`… (see *Clean-up*).

### A. Fields

- **A2 — yes, admin-style fields over REST work.** `POST /rest/api/3/field`
  `{ name, description, type: '…customfieldtypes:textfield', searcherKey: '…:textsearcher' }` → 201
  `{ id: 'customfield_10907', schema: { type: 'string' } }`; the select uses `type: '…:select'`,
  `searcherKey: '…:multiselectsearcher'` → `schema.type: 'option'`. Jira creates a **default context**
  (`isGlobalContext: true, isAnyIssueType: true`) for each. `POST /field/{id}/context/{ctx}/option`
  `{ options: [{ value: 'Increase' }, …] }` → 200 with option ids; `GET` the same path reads them back.
  Scope: every call is `manage:jira-configuration` (Jira's OpenAPI), which the app has.
- **A3 — contexts no longer restrict a field; field schemes do.** Narrowing the global context to the KPI
  type → 400 *"The global context cannot be made non-global"* (CHANGE-3019); deleting it → 400; adding a
  second global context → 400 *"Only one global context is allowed per field"*. Jira now gives every
  custom field one undeletable global context, used only for **options and defaults**. **Where a field
  is available is set by the space's field scheme** (B2), per work type. So: one context per field
  (the default) holds the direction options for every space, and 04 restricts the fields to the KPI
  type in **field schemes**, not contexts.
- **A4 — off-screen writes work once the field is in the space's field scheme.** Before it was (field in
  no scheme): `POST /issue` and `PUT /issue/{id}` → 400 `errors: { customfield_10907: "Field … cannot be
  set. It is not on the appropriate screen, or unknown." }`. After adding it to the SPIKE field scheme
  for the KPI type only, both work with the field on **no screen** (`editmeta` doesn't list it). The
  same field on a non-KPI type in the same space → the same 400, so the work type restriction holds.
  **The space's field scheme is the switch; screens aren't needed for the app's writes.**
- **A5 — select format.** `PUT` accepts both `{ id: '10650' }` and `{ value: 'Decrease' }`; `null`
  clears the text field. `search/jql` with `fields=[cf…]` returns the select as
  `{ self, value: 'Increase', id: '10650' }` and text as a plain string. JQL: `cf[10908] = "Increase"`,
  `cf[10908] = 10651` (option id) and `"SPIKE KPI Direction" = Decrease` all work; text `cf[10907] ~
  "users"` works, but **`~ "%"` finds nothing** (Jira's text search drops symbols). 05: write the
  option by `{ id }`, read `.id`.
- **A6 — one-request dual write works for custom fields too.** `PUT /issue/{id}`
  `{ fields: { summary, customfield_10907, customfield_10908: { id } }, properties: [{ key: 'kpi-meta',
  value }] }` → 204, and `POST /issue` with `fields` (both custom fields) + `properties` → 201; the
  property reads back in both cases.
- **A7 — not run** (only needed if G2 picks Forge-owned fields).
- **A8 — yes.** Each `PUT` (as the user) is one changelog entry naming the user, with items
  `{ field: 'SPIKE KPI Unit', fieldId, fromString, toString }`; the select also carries option ids in
  `from` / `to`. Clearing the text shows `to: ''`. **Property writes don't appear in History.**
- **A9 — the trigger design works as 05 planned.** Two triggers on `avi:jira:updated:issue`: one
  unfiltered, one with `filter: { ignoreSelf: true, expression: "event.runtime.issue.properties['kpi-meta'].fields == true" }`.
  Results (Forge logs and a KVS log agree):

  | Write | Unfiltered | Filtered |
  |---|---|---|
  | `kpi-meta` property only (by a person, and by the app as the user) | not fired | not fired |
  | Unit edited by a person (REST outside the app) on a **marked** KPI | fired | **fired** |
  | Unit edited by a person on an **unmarked** KPI | fired | not fired |
  | Unit edited **by the app `asUser`** on a marked KPI | fired, `atlassianId` = the user | **not fired** |
  | Unit edited **by the app `asApp`** on a marked KPI | fired, `atlassianId` = the app's account | **not fired** |

  The event's `changelog.items` name the field (`field`, `fieldId`, `fromString`, `toString`). So:
  property writes never trigger (no loop), `ignoreSelf` covers `asUser` writes (an `asUser` event
  otherwise looks exactly like the person's own edit), and entity-property filtering works. Entity-
  property filtering is a Forge **preview** feature.

### B. Screens, schemes and spaces (partial: Step 2 continues)

- **B1 — the KPI project's work type scheme isn't shared.** Project `KPI` (10900) uses its own
  *"KPI: Simple Issue Tracking Issue Type Scheme"* (11723: types 10005, 10006, KPI 10436) and its own
  work type screen scheme (10816), both used by KPI only. `issuetype = 10436 AND project != KPI` → 0
  issues; 14 KPIs in all. A project made like `createKpiProject` (`POST /project` with
  `projectTypeKey: 'software'`, no template) gets its own *"{KEY}: Simple Issue Tracking …"* schemes.
  **But its field scheme is the shared *Default Field Scheme* (5)**, used by ~50 projects.
- **B2 — the dev site uses field schemes.** `GET /rest/api/3/config/fieldschemes` lists 7 (the
  *Default Field Scheme* plus per-space ones migrated from field configurations);
  `fieldconfigurationscheme/project?projectId=10900` returns nothing. Calls that worked (all
  `manage:jira-configuration`, Jira admin):
  - create: `POST /config/fieldschemes { name, description }` → `{ id: 102 }`. **A new scheme starts
    with ~81 fields**, the system fields plus **every Forge-owned field (KPI Reading dev and
    staging)**; admin-created fields are not added;
  - assign: `PUT /config/fieldschemes/projects { "102": { projectIds: [11032, 11033] } }` → per-project
    `success: true`;
  - add a field for one work type: `PUT /config/fieldschemes/fields { customfield_10907: [{ schemeIds:
    [102], restrictedToWorkTypes: [10436] }] }` → `success: true`; `GET
    /config/fieldschemes/102/fields?fieldId=…` shows `restrictedToWorkTypes: ['10436']`;
  - read: `GET /config/fieldschemes/{id}/fields` pages at `maxResults` ≤ 50 (200 → 400).
  KPI Reading (dev and staging) is in the *Default Field Scheme* for **every** work type.
- **B3 — every config call works `asApp`** with the current scopes (no `asUser` needed), on `SPIKEB`:
  `POST /issuetypescheme { name, issueTypeIds: ['10436','10005'], defaultIssueTypeId }` → 201
  `{ issueTypeSchemeId }`; `POST /screens { name }` → 201; `POST /screens/{id}/tabs { name }` → 200;
  `POST /screens/{id}/tabs/{tab}/fields { fieldId }` (summary, unit, direction) → 200;
  `POST /screenscheme { name, screens: { default: screenId } }` → 201; `POST /issuetypescreenscheme
  { name, issueTypeMappings: [{ issueTypeId: 'default', screenSchemeId: <the project's current default> },
  { issueTypeId: '10436', screenSchemeId }] }` → 201; `PUT /issuetypescreenscheme/project` and
  `PUT /issuetypescheme/project { …SchemeId, projectId }` → 204; the field scheme calls (B2) → 204 as the
  app; and `POST /field` → 201 as the app. **No new scope is needed** (overview Q11). 04 may still run
  these as the admin (spec 10's "writes as the user") for the audit trail; both work.
- **B4 — deferred** (non-admin).
- **B5 — yes.** In `SPIKE` (KPI type added; unit, direction and KPI Reading in the space's field scheme,
  on **no** screen), the app as the user created a KPI with unit, direction and `kpi-meta` in one
  `POST`, recorded two readings with `PUT { fields: { customfield_10837: '{"d":…,"v":…}' } }`, and read
  them back from `POST /changelog/bulkfetch { issueIdsOrKeys, fieldIds: [readingField] }` (as the app),
  each naming the user. What a space needs: the **KPI type in its work type scheme** and **unit and
  direction in its field scheme** for that type. Screens are only for people editing in Jira.
- **B6 — yes.** `GET /project/search?action=create&expand=issueTypes&maxResults=100` as the user: 79
  projects in **one page** (`isLast: true`, ~0.5 s); the KPI type (`10436`) appears only in `KPI`,
  `SPIKE` and `SPIKEB`.
- **B7 — PNG yes, SVG no.** `POST /universal_avatar/type/issuetype/owner/{typeId}?size=16` with
  `Content-Type: image/svg+xml` → 400 *"not a supported image format. Please try a JPEG, GIF or PNG"*;
  with `image/png` → 201 `{ id }`. `PUT /issuetype/{id} { avatarId }` → 200, and `iconUrl` becomes
  `/rest/api/2/universal_avatar/view/type/issuetype/avatar/{id}?size=medium`, which serves the PNG (the
  path the app already loads with `read:avatar:jira`). 04 ships the KPI icon as a **PNG**. (Run from
  the browser as the admin; through Forge the body is binary, which `requestJira` accepts.)
- **B8 — not possible, so not a risk.** Jira **won't remove a Forge-owned field from a field scheme**:
  `DELETE /config/fieldschemes/fields { customfield_10837: { schemeIds: [102] } }` → *"Field ID
  customfield_10837 cannot have associations removed"* (`allowedOperations: ['ADD','CHANGE_REQUIRED']`),
  restricting it to another work type is ignored, and new schemes include it automatically. So **every
  space has KPI Reading** (each install's) for every work type; recording a reading works anywhere the
  user can edit the KPI. (R5)

### C. Finding KPIs across spaces

- **C1 — yes.** `issuetype = 10436` returns KPIs from `KPI` (14), `SPIKE` and `SPIKEB`.
- **C2 — cross-space links work (admin half).** A *KPI Hierarchy* link from `SPIKE-1` to `SPIKEB-1`
  (and a *Relates* one), created as the user → 201, and `SPIKEB-1`'s `issuelinks` lists both, the same
  as a same-space link. The hidden-parent half is **deferred** (non-admin).
- **C3 — fast at this size.** `issuetype = 10436 AND summary ~ "spike*"` / `"rev*"` / `"a*"`: 217–246 ms
  each through Forge (68 KPIs in 3 spaces). The scale fixture covers size; nothing here suggests a problem.
- **C4 — yes.** `issuetype = 10436 AND id in (…50 ids…)` → one request, all 18 KPIs among them, `isLast:
  true`, 275 ms.


### D. Ids, keys and the targets index (partial: D1 in Step 3)

Index paths added to `kpi-index` in v10.2.0: `kpiIssueIds` (`string`) and `refsVersion` (`number`),
each with a `searchAlias`. Two work items had `kpi-assignments` written **before** the deploy:
`SPIKE-3` (`kpiIssueIds: ['14954'], refsVersion: 2`) and `SPIKE-4` (key-only, `kpiIds` only).

- **D2 — properties written before the deploy are indexed under the new paths.** Right after the deploy,
  `kpiIssueIds IS NOT EMPTY` (alias and `issue.property[kpi-assignments].kpiIssueIds`) → `SPIKE-3`.
  **03's migration doesn't need to rewrite properties just to index them.**
- **D3 — yes.** `kpiIssueIds = "14954"` → `SPIKE-3`; `= "1495"` → nothing (no tokenising).
- **D4 — yes, unchanged.** `kpiIds IS NOT EMPTY` still finds the 14 real targets outside the spike
  projects. Note it's a `text` path: `kpiIds ~ "SPIKE-2"` matches, **`kpiIds = "SPIKE-2"` doesn't**.
- **D5 — yes.** `kpiIds IS NOT EMPTY AND refsVersion IS EMPTY` → `SPIKE-4` only, as the user and as the
  app; `refsVersion = 2` → `SPIKE-3`.
- **D1 — yes.** Moved `SPIKE-2` (id 14954) to `SPIKEB` with `POST /bulk/issues/move {
  targetToSourcesMapping: { '11033,10436': { inferFieldDefaults: true, …, issueIdsOrKeys: ['SPIKE-2'] } } }`
  → task `COMPLETE`. `GET /issue/SPIKE-2`, as the user **and** as the app → 200, `id: '14954'`, `key:
  'SPIKEB-2'`, fields and `kpi-meta` intact; `key = SPIKE-2` in JQL also finds it; `kpiIssueIds =
  "14954"` still finds its target. (Both spaces share a field scheme here; a move into a space whose
  field scheme lacks unit/direction would drop them, as Jira does for any field.)

### E. Migrations at scale

- **E1 — ~0.5 s per `PUT`; run them 5 at a time.** `spikeBatch` (one resolver invocation, `PUT
  /issue/{id}` of a text field, as the user): 25 one after another 13.0 s; **50 one after another 23.8 s
  (too close to the ~25 s limit)**; 50 five at a time 5.0 s; 50 ten at a time 3.3 s; 50 five at a time as
  the app 4.4 s. No 429s. **Recommendation (02 Q1): batches of 25, five requests in parallel** (~2.5 s
  per invocation, lots of headroom for reads and slower sites).
- **E2 — `id > n` is not a safe cursor; use `nextPageToken`.** `id > {n}` compares **issue keys within
  n's project**: `id > 10001` or `id > 14952` (issues in other spaces) returns **nothing**, silently, while
  `id > 14953` (a SPIKE issue) returns later SPIKE issues. A cursor across spaces stops early. Instead,
  `search/jql`'s **`nextPageToken`** paged `issuetype = 10436 ORDER BY id ASC` across 3 spaces (68 KPIs,
  7 per page) with edits between pages: every KPI once, no duplicates. Note `ORDER BY id` came back in
  key order, not strictly by id; that doesn't matter for coverage. 02 and 03 page with `nextPageToken` (the
  token is a ~130-character string, fine to keep in a migration record between invocations) or, where
  the query excludes finished items (`refsVersion IS EMPTY`), re-read the first page each batch.
- **E3 — counts work as the app (admin half).** `POST /search/approximate-count` as the app and as the
  user agree (52 KPIs in SPIKE) in ~150 ms, and `kpiIds IS NOT EMPTY AND refsVersion IS EMPTY` counts 15
  pending targets site-wide. Whether the app's count includes issues the admin can't browse is
  **deferred** (non-admin); the app's account has Browse on every project here.

### F1: space page context (2026-11-21, dev v9.0.0, space ECOM)

- **The context names the space and a board, in the browser and in the resolver:**
  `extension: { type: 'jira:projectPage', project: { id: '10126', key: 'ECOM', type: 'software' },
  board: { id: '117', type: 'kanban' }, jira: { isNewNavigation: true } }`. The resolver gets the same
  `extension` (without `location`), set by Forge, so the backend can trust the project and doesn't
  need it in the payload.
- **It doesn't carry the board's JQL.** We can look it up: `GET /rest/agile/1.0/board/117/configuration`
  → `filter.id` (plus `subQuery`, kanban only) → `GET /rest/api/3/filter/{id}` → `jql`. ECOM's board is
  `type = Initiative and Project = ECOM ORDER BY Rank`. Worked as the user (a Jira admin).
- **Reading boards costs new scopes:** `read:board-scope:jira-software` (list boards),
  `read:board-scope.admin:jira-software` (board configuration) and `read:project:jira`. Jira Software
  has no classic scopes. Adding them made this a **major version** (`forge deploy --approve
  MAJOR_VERSION_RULE`, then `install --upgrade`), so on the customer's site an admin has to approve
  the update.
- **No KPI board is needed.** The page knows the project id, so it finds the space's KPIs directly
  (`issuetype = KPI AND project = 10126`). The board's filter usually **excludes** KPIs anyway (ECOM's
  board shows only Initiatives: 0 KPIs), so scoping by the board would hide them. Recommendation: the
  space page ignores boards; drop the two board scopes before release unless 08 finds a use for the
  board's JQL (e.g. "work on this board that targets a KPI").
- Adding a `jira:projectPage` needed no other change: it shares the app's one resolver and its
  existing scopes for everything else (`read:jira-work`). `moduleKey` is `kpi-space-page`, so
  `requireSettingsPage` still keeps Settings writes on the admin page.
- The URL is `/jira/software/projects/{KEY}/apps/{appId}/{envId}`. It worked on a company-managed
  space. The tab didn't show among the space's visible tabs (reached by URL; possibly under "More").
- **Removing** the scopes was a major version too (v10.0.0, `--approve MAJOR_VERSION_RULE`). Every
  scope change, either way, needs an admin's approval on the customer's site.

## Clean-up

_What was created during the spikes and what happened to it._

| Object | Where | Status |
|---|---|---|
| Fields `customfield_10907` SPIKE KPI Unit, `customfield_10908` SPIKE KPI Direction, `customfield_10909` SPIKE app-created field | site | **deleted** (`DELETE /field/{id}` → 200; Jira keeps deleted fields in its trash for 60 days) |
| Projects `SPIKE` (11032), `SPIKEB` (11033) and their issues | site | **deleted** (`enableUndo=false`) |
| Their work type schemes (11829–11831), work type screen schemes (10871–10873), screen schemes (10958–10960) and screens (10989, 10990, 10992, 10993, 10995) | site | **deleted** |
| Field scheme 102 *SPIKE field scheme (temporary)* | site | **deleted** |
| Work type 10488 *SPIKE avatar type* and its avatar | site | **deleted** |
| `app/src/backend/spike.ts`, its resolvers, the `spike-trigger-*` triggers and `spike-fn-*` functions | branch, dev | **removed**; dev redeployed as v10.3.0 |
| `kpiIssueIds` / `refsVersion` index paths | manifest, dev | **kept** for 03 (it adds them anyway) |
| KVS key `spike:trigger-log` | dev install | **cleared** |

## Questions

1. **Second user.** Is there an existing non-admin test account on `bitovi-training` we can use for
   B4, or should one be created?
   - **Answered (2026-11-24): find or create one** before Step 2. The agent drives Jira through
     **Playwright MCP** in a headed browser with a persistent profile **outside the repo** (it holds
     session cookies), and Justin logs in by hand. Use one profile per user (Jira admin and non-admin),
     so the agent never handles credentials. The UI checks (B4, the "can't do this here" messages) run
     there; REST checks as the non-admin can use that user's API token (curl), kept out of the repo.
2. **Team-managed project.** OK to create (and delete) a team-managed `SPIKETM` project on
   `bitovi-training`?
   - **Answered (2026-11-24): no.** Don't create `SPIKETM`. C1 checks company-managed projects only;
     F3's team-managed part waits for space pages.
3. **Staging install.** A1 needs the throwaway field deployed to staging as well as dev, to see two
   environments side by side. OK to deploy a branch build to staging briefly, or should A1 use a
   different second environment (e.g. a personal `forge environments create`)?
   - **Answered (2026-11-24): skip A1.** KPI Reading already shows one field per install on
     bitovi-training, so no extra install is needed. Staging stays on `main` (overview Q3).
