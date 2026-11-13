# 10 — Respect KPI-space permissions (`asApp` → `asUser`)

## Problem

KPIs are Jira issues in a dedicated KPI project ([storage-model.md](../01-initial-build/storage-model.md)).
Part of the reason for that choice was that KPIs become **permissioned** like
any other issue. But almost every KPI-space call in
[jira.ts](../../app/src/backend/jira.ts) runs `asApp()`, so the KPI project's
permission scheme is never applied:

| Call (jira.ts) | Reached from | Effect today |
|---|---|---|
| `fetchKpiSpaceIssues` | Timeline, issue panel | Every user sees every KPI (names, tree, unit/direction), even without **Browse Projects** on the KPI project or with issue-security restrictions |
| `fetchReadingChangelog` | Timeline, issue panel | Every user sees every KPI's readings |
| `writeReading` (id lookup + write) | `recordValue` | Any user can record a value on any KPI. **The KPI isn't checked to be in the KPI space**, so any issue key on the site gets the reading field written |
| `createKpiIssue`, `linkKpiParent` | `createKpi` | Any user can create and nest KPIs without **Create Issues** / **Link Issues** |

Anyone who can open the KPI Timeline (a `jira:globalPage`) or an issue panel can
do all of the above.

Calls on work issues (issue reads, `kpi-assignments` writes, the issue picker,
icons) already run `asUser()`, so this spec only covers the KPI space.

## Decision

Use the **user's** Jira identity wherever Jira can enforce the KPI project's
permissions. Keep `asApp()` only where the app identity is required or where a
user-identity call would give the wrong answer. Each `asApp()` that stays has a
reason recorded next to it.

### Moves to `asUser()`

| Call | Enforces |
|---|---|
| `fetchKpiSpaceIssues` (JQL search of the KPI project) | Browse Projects + issue security levels |
| `createKpiIssue` (`POST /issue`) | Create Issues |
| `linkKpiParent` (`POST /issueLink`) | Link Issues |
| `writeReading`'s id lookup (`GET /issue/{id}`) | Browse (the user must be able to see the KPI) |
| **Path A only:** recording a reading (`PUT /issue/{id}`) and loading reading history (`changelog/bulkfetch`) | Edit Issues to record; Browse to read |
| **new** `fetchKpiSpaceAccess` (`GET /mypermissions`) | Reports what the user may do, for guards and UI |
| Settings provisioning **writes**: `createKpiProject` (`POST /project`), creating the `KPI` issue type (`POST /issuetype`), adding it to the project's scheme (`PUT /issuetypescheme/{id}/issuetype`), and creating the `KPI Hierarchy` link type (`POST /issueLinkType`) | Administer Jira (see *Settings: admin-only, enforced by Jira*) |
| **new** `fetchIsJiraAdmin` (`GET /mypermissions?permissions=ADMINISTER`) | Guards every Settings write, including ones that only touch app storage |

### Stays `asApp()` (with a comment saying why)

| Call | Why |
|---|---|
| `writeReading`'s `PUT /app/field/{id}/value` | **Path B only** (see *Readings: who writes them*). Only the app that owns the field can call this API. It is guarded by an `asUser` permission check first (Step 4) |
| `fetchReadingChangelog` | **Path B only.** Reads the history of the app-owned field. (Step 0 found that reading it `asUser` also works, so Path B may move this to `asUser` as well.) It is safe because it only ever gets ids from the `asUser` search |
| `deleteIssue` (rollback in `createKpiIssue`) | Delete Issues is usually admin-only. An `asUser` rollback would fail and leave the orphan KPI it exists to prevent. It only ever deletes the key the user's own create just returned |
| `fetchDeletedIssueKeys` → `classifyUnlistedKpis` (app half) | `asUser` alone returns 404 for both "deleted" and "can't see". The app lookup tells them apart, and the paired `asUser` lookup decides "no permission" (see *Reads*) |
| `/field`, `/issuetype`, `/issueLinkType`, `findProjectByKey`, `GET /issuetypescheme/project` | Site-wide settings, read-only, nothing per-user. `getFieldIds` caches `/field` in a module-level variable shared across users, which is only correct for an app-identity result |

The app's `manage:jira-project` and `manage:jira-configuration` scopes stay.
`asUser` calls are still limited to the app's scopes, so one-click setup needs
them either way. Adding or dropping any scope means `forge install --upgrade`
and an admin re-approving.

### Consent

Shared installs don't prompt individual users: the admin's approval at install
or upgrade covers everyone. So these moves add no "Allow access" prompts. (An
app still set to **Not sharing** can prompt other users whichever identity a
call runs as. See *Decisions → App distribution*.) The comments in
`createKpiSpace` / `createKpiProject` that say provisioning stays `asApp` to
avoid an `asUser` consent prompt are out of date; Step 4b replaces them.
Neither path adds a manifest scope.

### Readings: who writes them

Readings can't simply switch from `asApp` to `asUser`. The KPI Reading field is
an app-owned, `readOnly` custom field
([manifest.yml](../../app/manifest.yml)), and both reading calls depend on that:

- **Recording** uses `PUT /rest/api/3/app/field/{id}/value`, which only the
  owning app can call. As the user it fails.
- **Loading history** (`changelog/bulkfetch`) reportedly comes back empty as
  the user (per the comment in `fetchReadingChangelog`).

Two ways to make readings permission-aware:

| | **Path A — make the field editable, read and write as the user** | **Path B — keep it read-only, check the user first, write as the app** |
|---|---|---|
| Change | Remove `readOnly: true`. Record with the normal `PUT /rest/api/3/issue/{id}` `asUser`. Load history `asUser` | Keep the field. `recordValue` runs the `asUser` checks in *Writes*, then the existing `asApp` write. History stays `asApp`, limited to KPIs from the `asUser` search |
| Who enforces "may record" | **Jira** (Edit Issues on the KPI issue, plus issue security and workflow restrictions) | **Our code** (the `mypermissions` check). A bug in the check is a hole |
| Who recorded it (changelog author → `ReadingPoint.recordedBy`) | **The person** | **The app**, for every reading. `recordedBy` becomes meaningless |
| CascadeMCP writing readings over standard REST ([storage-model.md](../01-initial-build/storage-model.md) constraint 1) | Works | Doesn't work. A read-only app field can't be written over standard REST (a gap that already exists today) |
| Hand-edits in Jira's issue view | Possible for anyone with Edit. Unparseable values are ignored by `decodeReadingValue`; valid ones count as readings. That's the same people Path A lets record anyway | Not possible |
| Field must be on the KPI project's **edit screen** | **No** (Step 0: the user's `PUT /issue` succeeds with the field on no screen). It stays off every screen, so it isn't shown in Jira. If an admin adds it to a screen, its raw JSON value can be typed over by anyone with Edit Issues. **Accepted** (decided) | No |
| Scopes | No change needed now. `write:app-data:jira` could be dropped later (dropping it also means `--upgrade`) | No change |
| Data migration | None: same field, same encoding, same changelog | None |
| Unknowns | Resolved by Step 0 (see *Step 0 findings*). Only "does Forge `asUser` behave like the API token" remains, checked in Step 7 | None |

**Option rejected:** storing readings somewhere else the user can write, such
as an entity property on the KPI issue. That is storage-model.md's Option A,
already rejected for its 32 KB (~800-point) limit and read-modify-write race.

**Approach:** Path A fits the goal better, because Jira enforces permissions
and keeps a true author in the history. But it has unknowns, so **Step 0
tests it on the dev site first**. If Step 0 passes, build Path A. If it fails,
build Path B. Everything else in this spec (KPI reads, Add KPI, nesting,
targets, UI) is the same on both paths.

## Design

### `KpiSpaceAccess` (domain contract)

Add to [contracts.ts](../../app/src/domain/contracts.ts):

```ts
/** What the current user may do in the KPI space (Jira project permissions). */
export interface KpiSpaceAccess {
  browse: boolean; // BROWSE_PROJECTS: see KPIs and their readings
  create: boolean; // CREATE_ISSUES: Add KPI
  edit: boolean;   // EDIT_ISSUES: record / delete a value
  link: boolean;   // LINK_ISSUES: nest a new KPI under a parent
}
```

`fetchKpiSpaceAccess(projectKey)` makes one `asUser` call:
`GET /rest/api/3/mypermissions?projectKey={key}&permissions=BROWSE_PROJECTS,CREATE_ISSUES,EDIT_ISSUES,LINK_ISSUES`.
It runs at the same time as the existing config reads, so it adds no step to
the critical path. If the call fails (rate limit, outage, missing project) it
throws `PermissionLookupError` rather than returning all-`false`: a failed
lookup says nothing about the user's permissions. Reads then leave `access`
unknown (omitted from the payload, so the UI disables nothing up front and
Jira's own 403s explain refusals). `createKpi` still refuses, with a "couldn't
check, try again" message rather than a permission message.

### Reads

- `buildTimelineSkeleton` and the issue panel's `kpiIssues` stage fetch access
  at the same time as the space config. When `!access.browse` they **skip the
  search**. JQL that names a project the user can't browse is rejected with a
  400 rather than returning no issues, so searching anyway would turn into a
  thrown error.
- When `access.browse` is true, `fetchKpiSpaceIssues` runs `asUser`. Issues
  hidden by a security level simply drop out of the results. Readings are then
  fetched only for the ids that came back: `asUser` on Path A, where Jira
  filters them anyway, and `asApp` on Path B.
- `TimelineData` and `PanelBasis` gain an optional `access?: KpiSpaceAccess`.
  Optional keeps the harness, fixtures and older callers working. If it's
  missing, the UI behaves as it does today.
- **Hidden KPIs on the issue panel:** a work issue can target a KPI the user
  can't see. That KPI isn't in the catalog. Today a KPI missing from the
  catalog is either deleted or too new for the search index;
  `fetchDeletedIssueKeys` (`asApp`) tells those apart. Now there's a third
  case, "exists but you can't see it". So that check becomes
  `classifyUnlistedKpis(keys)`, which runs only for the rare unlisted keys:
  - `asApp` 404 → **deleted** (existing `deletedKpiIds`, unchanged)
  - `asApp` 200 and `asUser` 404 → **no permission** (new `noAccessKpiIds` on
    `PanelBasis`)
  - both 200 → just too new for the index; shown as today

  If `access.browse` is false, every unlisted key that still exists is
  **no permission**, and the `asUser` lookups are skipped.
- **How a no-permission row looks (decided):** the name shows the KPI key
  (`KPI-7`), followed by *"You don't have permission to view this KPI"*. A
  tooltip says why and who can fix it: *"Viewing KPI-7 needs Browse
  permission on the KPIs (KPI) project. Ask a Jira admin."* Edit and record
  are disabled with the same tooltip. **Remove stays enabled** (decided): the
  target lives on the work issue, so removing it needs only Edit on the work
  issue (as today) and reveals nothing about the KPI. The row reveals only the
  KPI key and that a target exists, nothing from inside the KPI project.
- **Hidden KPIs on the timeline:** targets on KPIs the user can't see have no
  node to attach to, so they don't show. No change needed.

### Writes

| Resolver | Guard (before any write) | Then |
|---|---|---|
| `createKpi` | `access.create`; plus `access.link` when `parentKpiId` is set | `createKpiIssue` / `linkKpiParent` `asUser`. Jira still enforces permissions itself, so the guard only gives a clear message up front |
| `recordValue` | `asUser` `GET /issue/{kpiId}?fields=project`: 404 → "You don't have permission to view KPI-3"; project ≠ KPI space key → reject (only KPIs have readings) | **Path A:** `asUser` `PUT /issue/{id}` with the encoded reading. Jira enforces Edit Issues; a 403 becomes the permission message below. **Path B:** `asUser` `GET /mypermissions?issueId={id}&permissions=EDIT_ISSUES` → reject if not granted, then the existing `asApp` `PUT /app/field/{id}/value` |
| `addTarget` (decided: the user must be able to see the KPI) | `asUser` `GET /issue/{kpiId}?fields=project`: 404 → "You don't have permission to view KPI-7"; project ≠ KPI space key → reject (only KPIs can be targeted) | Existing `asUser` `kpi-assignments` write on the work issue (needs Edit on the work issue, as today). Runs at the same time as `fetchTargetSourceIssue`, so it adds no wait |

**Who may record a value:** whoever has **Edit Issues** on that KPI issue. In
Jira, a reading is a change to the KPI issue, so the permission that already
means "may change this issue" is the natural fit. That leaves the decision
with the KPI project's admins: by default everyone in the project can record,
and an admin who wants only some people to can grant Edit Issues to just a
group or role (for example a "KPI Recorders" role). On Path A Jira applies this
itself. On Path B our `mypermissions` check has to match it. The check is on
the **issue**, not the project, so issue security and workflow-status
restrictions also apply.

Error messages follow the existing `jiraError` style and name the permission,
for example: *"You don't have permission to record values on KPI-3. It needs
Edit Issues on the KPIs (KPI) project. Ask a Jira admin."*

### Settings: admin-only, enforced by Jira

Today two things keep non-admins out of Settings. Jira only shows the
`jira:adminPage` to people with **Administer Jira**, and `requireSettingsPage`
rejects writes that didn't come from that page. Both are a *which page was
this* check; the work then runs `asApp`, so Jira never checks the person. If
the page check ever had a bug, a non-admin could create projects, issue types
or link types.

Two changes put Jira in charge of every Settings write:

1. **Every `defineSettingsWrite` handler also requires Administer Jira.**
   After the module check, `requireJiraAdmin()` calls `fetchIsJiraAdmin()`
   (`asUser` `GET /rest/api/3/mypermissions?permissions=ADMINISTER`). If that
   isn't granted, it throws *"Only Jira admins can change KPI settings."*
   before the handler runs. If the call fails, the write is still refused, but
   with *"Couldn't check whether you're a Jira admin… Try again."* so an admin
   isn't told they aren't one. This also covers the writes that
   only touch app storage and never call Jira: `saveRollupConfig`,
   `saveKpiSpaceKey`, `saveKpiHierarchy`.
2. **Provisioning writes run `asUser`** (the table under *Moves to
   `asUser()`*). Jira then requires Administer Jira for each one itself, so a
   bug in step 1 would still be refused. The reads around them (looking up the
   project, listing issue types and link types, reading the issue-type scheme)
   stay `asApp`, as in the table above.

Who can use Settings doesn't change: the page's audience was already Jira
admins. The Settings **reads** (`getKpiSpace`, `getKpiHierarchy`,
`getRollupConfig`, `getDateFields`, `getHierarchyLevels`) stay unguarded. The
timeline and issue panel use some of them, and they reveal no more than those
surfaces already show.

`createKpiSpace` still passes the invoking user's `accountId` as the new
project's lead. Running as that user makes this the natural owner anyway.

### UI

Decided: controls the user can't use are **disabled, with a tooltip giving the
reason** (not hidden). The tooltip names the missing Jira permission and the
KPI project, and says to ask a Jira admin. For example: *"Adding a KPI needs
Create Issues permission on the KPIs (KPI) project. Ask a Jira admin."*

| Surface | No `browse` | No `create` | No `edit` |
|---|---|---|---|
| Timeline | Replaces "No KPIs yet": *"You don't have permission to view the KPI space (KPI). Ask a Jira admin for Browse permission on that project."* | **Add KPI** disabled + tooltip | Record / delete value actions disabled + tooltip |
| Issue panel | Replaces "KPIs are not defined yet…": same no-permission message, no "define a KPI" button. Targets on KPIs show as no-permission rows (see *Reads*) | — | KPI view (issue *is* a KPI): record value disabled + tooltip |
| Issue panel, Add target | — | — | The KPI picker only lists KPIs the user can see (it already uses the catalog) |

The server-side guards are what enforce access. The UI only gives a clear
explanation up front.

### Test infrastructure

- `createMockJira` ([scaleFixture.ts](../../app/src/backend/testing/scaleFixture.ts))
  gets an optional **user view**: `userAccess` (per-project `KpiSpaceAccess`,
  default all `true`) and `hiddenFromUser` (issue ids, standing in for issue
  security). `requestJira` takes the principal. App requests see everything;
  user requests are filtered and permission-checked like Jira would:
  - search: skip hidden issues; 400 for a project the user can't browse
  - `GET /issue`: 404 for hidden issues
  - `POST /issue`: 403 without create
  - `POST /issueLink`: 403 without link
  - add a `GET /mypermissions` handler (project permissions from
    `userAccess`; the global `ADMINISTER` from a new `userIsAdmin` flag,
    default `true`)
  - `POST /project`, `POST /issuetype`, `PUT /issuetypescheme/…`,
    `POST /issueLinkType` → 403 for `user` when `userIsAdmin` is false
  - Path A: `PUT /issue/{id}` with the reading field → 403 without edit,
    otherwise append a reading change whose author is the calling user
    (`app` for the app). Bulkfetch returns `author.accountId`
- The `@forge/api` mocks in `mutations.test.ts`, `panel.test.ts` and
  `timelinePerf.test.ts` pass `'user'` / `'app'` through instead of sharing one
  requester.
- Tests check **which identity** made a call through the existing request
  trace (`RequestRecord.as` in [requestLog.ts](../../app/src/backend/requestLog.ts),
  captured with `setTraceSink`). A test can say "the KPI-space search ran as
  `user`" without re-deriving it from mocks.
- Harness ([mock-bridge.ts](../../app/test-harness/mock-bridge.ts)):
  `?access=none` (no browse) and `?access=readonly` (browse only) set the
  `access` the mock resolvers return, and make the mock `createKpi` /
  `recordValue` reject the same way the server would.

## Implementation steps

Each step leaves `npm test`, `npm run lint` and `npm run build` green.

### Step 0 — Test Path A on the dev site (decides A or B)

A throwaway check on `bitovi-training`, not merged. Use the `redeploy-forge`
skill to deploy a branch with `readOnly: true` removed from `kpi-reading`.
Use an existing KPI that already has readings.

1. **Flipping `readOnly` keeps the data.** The deploy is accepted (note
   whether it asks for `--upgrade`). The existing KPI's readings still load
   on the timeline, from the old changelog entries.
2. **Writing as the user works.** Add the field to the KPI project's edit
   screen. Then, from a temporary resolver or the E2E shim (which already
   calls as the token's user), `PUT /rest/api/3/issue/{id}` with an encoded
   reading. Expect 204, and a changelog entry whose author is the user.
3. **Reading history as the user works.** `asUser` `changelog/bulkfetch`
   returns both the old app-written entries and the new user-written one.
   This also settles the existing comment saying `asUser` comes back empty:
   re-test it with the field still `readOnly` and record the result in that
   comment.
4. **Permissions apply.** A second user without Edit Issues on the KPI project
   gets 403 on the same `PUT`.
5. **The field can stay out of sight.** Find a way to keep the KPI Reading
   field out of Jira's issue view while check 2's `asUser` `PUT` still works.
   Try a screen scheme whose View screen leaves it off while the Edit screen
   has it. Then try hiding it in the field configuration (that may block
   REST writes too). Record which works and use it in provisioning (Step 4).
   If none works, the field stays visible: the risk is accepted. Also confirm
   that a hand-edit to garbage is ignored by the timeline, and a valid one
   counts as a reading.

**Verify / decide:** 1–4 pass → **Path A**. Any of 1–3 fails → **Path B**,
with the reason written into the *Readings: who writes them* section. 5 only
decides how provisioning places the field. Restore the dev site's manifest
afterwards if the outcome is Path B.

#### Step 0 findings (2026-11-12) — **Path A chosen**

Run against `bitovi-training`, development install (field
`customfield_10837`), calling the REST API as the token's user (the same
permissions `asUser` carries):

| Check | Result |
|---|---|
| Before the flip: reading history `asUser` (`changelog/bulkfetch`) | **Works.** All entries come back. The old comment ("empty as the user") is wrong. Every existing entry's author is *Measure of Success* (the app) |
| Before the flip: `PUT /issue` as the user | 400 *"Field does not support update"*, as expected |
| 1. Deploy with `readOnly: false` | Accepted (version 8.27.0), no `--upgrade` needed. Existing values and history intact |
| 2. `PUT /issue/KPI-11` as the user | **204.** The changelog entry's author is the user (*Justin Meyer*) |
| 2a. Field on the edit screen? | **Not needed.** It isn't in `editmeta` or on any KPI screen, and the write still succeeds. Provisioning needs **no** screen changes and there is no new `misconfigured` state |
| 3. History `asUser` after the user's write | Returns both the app-written entries and the user-written one |
| 4. 403 for a user without Edit Issues | Needs a second user: moved to Step 7 check 2/3. `PUT /issue` always requires Edit Issues in Jira |
| 5. Hidden from the issue view | The field is on no screen, so it isn't shown. Visually confirming in Jira's issue view is moved to Step 7 |

Side effect: KPI-11 ("Test KPI") now has one user-written delete marker for
1999-01-01. A delete marker for a date with no reading changes nothing in the
series.

Remaining risk: these calls used an API token. Forge's `asUser` goes through
the app's scopes (`read:jira-work` / `write:jira-work` cover both calls). Step
7 confirms it inside Forge. If `asUser` is refused there, fall back to Path B.

### Step 1 — Identity-aware mock Jira

Change `createMockJira` and the three test `@forge/api` mocks as described
under *Test infrastructure*. Defaults (everything visible and allowed) keep
every existing test unchanged.

**Verify:** the existing suite passes with no assertion changes. A new
scaleFixture test shows that an issue in `hiddenFromUser` is 404 for `user`
and 200 for `app`, and that `mypermissions` reflects `userAccess`.

### Step 2 — `fetchKpiSpaceAccess` + contract

Add `KpiSpaceAccess` to contracts and `fetchKpiSpaceAccess` to jira.ts
(`asUser`, throws `PermissionLookupError` on failure).

**Verify:** jira.test.ts covers the parsed response, the non-OK → throws
case, and the request running as `user`. Add a live check to
`test-e2e/jira-api.e2e.ts`: the token user has browse on the KPI project it
just created.

### Step 3 — Reads as the user

- `fetchKpiSpaceIssues` → `asUser`.
- `buildTimelineSkeleton`, `buildPanelList` and `buildPanelValues` fetch
  access at the same time as the config, skip the search when `!browse`, and
  include `access` in `TimelineData` / `PanelBasis`.
- Replace `fetchDeletedIssueKeys` with `classifyUnlistedKpis` and add
  `noAccessKpiIds` to `PanelBasis`. `assemblePanel` marks those rows
  `kpiNoAccess: true` (alongside the existing `kpiMissing`).
- Add a comment to `fetchReadingChangelog` saying which identity it uses and
  why (per the path chosen in Step 0). On Path A it becomes `asUser`.

**Verify (resolver and domain tests against the mock):**
- No browse → timeline `roots: []`, `access.browse === false`, **no**
  bulkfetch request made. (As built: the KPI search runs alongside the
  permission lookup, to avoid adding a round trip. A successful search ran as
  the user, so it's already filtered by Jira and is trusted as-is. Jira
  refuses a search naming a project the user can't browse; with
  `access.browse === false` that refusal becomes the no-access state.)
- Lookup fails, search succeeds → KPIs shown, `access` omitted (unknown).
  Lookup and search both fail → the search error is thrown (retryable), not
  the no-access state.
- One KPI in `hiddenFromUser` → it's missing from the timeline and the panel
  catalog, and its id is **not** in the bulkfetch request body.
- A work issue targeting a hidden KPI → `noAccessKpiIds` contains it, and the
  `assemblePanel` row has `kpiNoAccess: true`, not `kpiMissing`, and no
  readings.
- A work issue targeting a KPI that exists but isn't indexed yet (visible to
  both) → neither list contains it (today's behaviour).
- A work issue targeting a deleted KPI → `deletedKpiIds`, as today.
- The trace shows `GET /rest/api/3/search/jql` as `user`, and `POST
  /changelog/bulkfetch` as `user` (Path A) or `app` (Path B).
- `timelinePerf.test.ts` request counts change only by the one added
  `mypermissions` call.

### Step 4 — Writes as the user (or user-guarded)

- `createKpi`: guard on `access.create` / `access.link`. `createKpiIssue` and
  `linkKpiParent` → `asUser`. `deleteIssue` stays `asApp` with its comment.
- `recordValue` / `writeReading`: the `asUser` lookup with `fields=project`
  and the KPI-space project check, then:
  - **Path A:** `asUser` `PUT /issue/{id}` with `{ fields: { [readingFieldId]:
    encoded } }`. Map a 403 to the permission message. Remove the
    `app/field` write.
  - **Path B:** the issue-level `EDIT_ISSUES` check, then the existing `asApp`
    write.
- Path A: keep `readOnly: false` on `kpi-reading` in manifest.yml (Step 0
  already deployed it to development). No screen or provisioning changes are
  needed. Drop the now-unused `app/field/{id}/value` write.
- `addTarget`: the `asUser` KPI lookup + KPI-space check, alongside
  `fetchTargetSourceIssue`.

**Verify (mutations.test.ts):**
- `createKpi` without create → clear error, **no** `POST /issue` in
  `jira.writes`.
- `createKpi` with a parent, without link → error **before** the create (no
  orphan).
- Link fails after a successful create → the rollback `DELETE` runs as `app`
  and the KPI is gone.
- `recordValue` on a work issue (outside the KPI space) → rejected, no
  reading write.
- `recordValue` on a hidden KPI → "You don't have permission to view…", no
  write.
- `recordValue` without edit → permission error, no reading change.
- `addTarget` with a hidden KPI → "You don't have permission to view KPI-…",
  no `kpi-assignments` `PUT`.
- `addTarget` with a non-KPI issue key as the KPI → rejected, no write.
- `removeAssignment` of a target on a hidden KPI → succeeds (needs only Edit
  on the work issue).
- Happy path, Path A: the trace shows the lookup and `PUT /issue/{id}` as
  `user`, and **no** `app/field` call. The mock records the changelog author
  as the user's account, and `readingsFromChangelog` returns it as
  `recordedBy`.
- Happy path, Path B: the trace shows the lookup and `mypermissions` as
  `user`, and the field `PUT` as `app`.

### Step 4b — Settings writes enforced by Jira

- Add `fetchIsJiraAdmin()` to jira.ts (`asUser`, throws on failure) and
  `requireJiraAdmin()` to `defineSettingsWrite` in resolver.ts, after
  `requireSettingsPage`.
- Switch the provisioning writes to `asUser`: `createKpiProject`, the
  `POST /issuetype` in `ensureKpiIssueType`, the scheme `PUT` in
  `ensureKpiIssueTypeOnProject`, the `POST /issueLinkType` in
  `ensureKpiHierarchyLinkType`. Their reads stay `asApp`.
- Replace the out-of-date "pure `asApp` flow with no consent prompt" comments
  in `createKpiSpace` and `createKpiProject` with the reason they now run
  `asUser`.

**Verify (mutations.test.ts):**
- Each Settings write (`saveRollupConfig`, `saveKpiSpaceKey`,
  `createKpiSpace`, `saveKpiHierarchy`, `createKpiHierarchyLinkType`) with
  `userIsAdmin: false` → *"Only Jira admins can change KPI settings."*, and
  nothing written to Jira **or** app storage.
- With the module check passing but the admin check failing (Settings context,
  non-admin) → rejected. With the admin check passing but the wrong module →
  rejected, as today.
- Happy path `createKpiSpace`: the trace shows `POST /project`,
  `POST /issuetype` (on a fresh fixture), the scheme `PUT` and
  `POST /issueLinkType` as `user`, and the project/scheme/type **reads** as
  `app`.
- The existing Settings tests still pass, with the default `userIsAdmin: true`.
- e2e (`jira-api.e2e.ts`): `fetchIsJiraAdmin` is `true` for the token user,
  who provisions the test space.

### Step 5 — UI for restricted users

- Timeline: no-permission empty state; Add KPI and record/delete disabled with
  tooltips from `access`.
- Issue panel: no-permission message replaces "define a KPI"; KPI view record
  disabled with a tooltip; `kpiNoAccess` rows show the permission message,
  with edit and record disabled + tooltip and remove enabled.
- Stories for each state (`NoAccess`, `ReadOnly`, `TargetOnHiddenKpi`) on
  Timeline, IssuePanel, TargetCard and KpiView. Add harness `?access=` modes
  (`none`, `readonly`, `hiddenKpi` — one targeted KPI hidden).

**Verify:** the story tests pass, including that each disabled control has
the expected tooltip text. In the harness, every `?access=` mode on the
timeline and issue surfaces looks right in light and dark with a clean
console. `access` missing from the data → today's UI, unchanged (existing
stories untouched).


### Step 6 — Docs and comments

- Check that the consent comments replaced in Step 4b leave no stale "pure
  `asApp`" wording anywhere in resolver.ts or jira.ts.
- Add a short "Permissions" section to
  [storage-model.md](../01-initial-build/storage-model.md): the KPI project's
  permission scheme controls who can see, create, nest and record. Admins
  manage it in Jira, and the app follows it. List the `asApp` exceptions.
- Path A only: update storage-model.md's Option B. The field is no longer
  app-only. Readings are written as the user, so the changelog author is the
  person who recorded it. The field is on no screen, so Jira doesn't show it.
  Anyone with Edit Issues could still write it over REST, or by hand if an
  admin adds it to a screen; unparseable values are ignored. CascadeMCP can
  now write readings over standard REST.
- Path A only: update the `kpi-reading` description in
  [manifest.yml](../../app/manifest.yml), which still calls it app-managed.
- Update the `requestLog.ts` header if it describes which calls run as the
  app.

**Verify:** docs only.

### Step 7 — Live check on the dev site

**Status (2026-11-12):** deployed to development as version 8.28.0 (no
`--upgrade` needed). The live API e2e (`npm run test:e2e`, 19 tests) passes
against `bitovi-training`. It runs as the token's user and covers the new
permission lookups, admin-run provisioning, and recording a value as the user
(the changelog names them). The in-Jira checks below need a logged-in browser
and a second, non-admin user, so they're still to do:
Use the `redeploy-forge` skill. Path B adds no scopes, so no `--upgrade`
should be needed; Path A's manifest change may need it (Step 0 finds out). Use
a **second user who isn't a Jira admin** on `bitovi-training`:

1. Default permission scheme → timeline, panel, Add KPI and record value work
   as before.
2. Remove that user's Browse on the KPI project → no-permission message on the
   timeline and panel. Calling `recordValue` / `createKpi` / `addTarget` from
   devtools is rejected.
3. Browse only (no Create/Edit) → KPIs visible; Add KPI and record disabled
   with tooltips.
4. Put one KPI under an issue security level the user isn't in → it's gone
   from their timeline and catalog, and a work issue targeting it shows the
   no-permission row.
5. Path A: a reading the second user records shows **them** as the author in
   the KPI issue's History tab in Jira. Recording goes through Forge's
   `asUser` without error. If Forge refuses it, fall back to Path B. The KPI
   Reading field doesn't appear in the KPI issue's view.
6. As the admin, **Create space** on a fresh key in Settings still works in
   one click (project, `KPI` issue type, scheme, `KPI Hierarchy` link type).
   The Forge logs show those writes as `user`.
7. Forge logs: the request trace shows the expected `user` / `app` split.
8. If the second user gets an "Allow access" pop-up, they click **Allow
   access** once (see *Decisions → App distribution*). It isn't a failure.

## Implementation notes (as built)

- **Messages are shared.** `src/domain/resolve/kpiAccess.ts` holds the
  wording for every permission refusal (`kpiPermissionMessage`,
  `kpiNotVisibleMessage`, `kpiSpaceNoAccessMessage`). The backend throws the
  same text the UI shows in its tooltips. `src/ui/components/DisabledReason`
  is the "disabled, with a tooltip for a reason" wrapper.
- **The permission lookup doesn't add a round trip.** The timeline and panel
  fetch `mypermissions` alongside the KPI search. The search (as the user) is
  the authority for what's shown; the lookup only explains a refused search
  and pre-disables controls (see the Step 3 check).
- **Targets are guarded on both write paths.** `addTarget` (timeline) and
  `saveAssignment` (issue panel) both require the KPI to be visible to the
  user and in the KPI space. `removeAssignment` is unguarded (decided).
- **A related fix: each install finds its own reading field.** Each Forge
  environment installed on a site gets its own KPI Reading field
  (`…__DEVELOPMENT__kpi-reading`, `…__STAGING__kpi-reading`). The lookup used
  to take the first match. Now that readings are written as the user, a
  staging install on the dev site would have recorded silently into the dev
  field. `pickReadingField` now prefers the running environment's field
  (`getAppContext().environmentType`).
- **Harness:** `?access=none|readonly|hiddenKpi` (`test-harness/access-modes.ts`).

## Follow-ups

- **Recording now sends Jira notifications.** It's an ordinary issue edit by
  the user, so Jira sends "issue updated" emails to the KPI's watchers.
  `notifyUsers=false` needs admin rights, so the app can't turn that off per
  call. If it's unwanted, give the KPI project a notification scheme without
  *Issue Updated* (or make provisioning do it).
- **Settings reads are unguarded.** The KPI space status and link-type lists
  are readable from any module. They reveal no more than the timeline and
  panel already do.

## Out of scope

- Managing the KPI project's permission scheme from Settings. Admins use
  Jira's own project settings.
- A custom editor for the reading field in Jira's issue view (Path A). The raw
  value is edited as text. Revisit only if check 5 in Step 0 shows it causes real problems.
- Dropping `write:app-data:jira` after Path A. Leave it until a deploy that
  needs `--upgrade` anyway.

## Decisions

- **Adding a target requires being able to see the KPI** (was Q3): yes. See
  the `addTarget` guard in *Writes*.
- **Re-test reading history as the user** (was Q4): yes. Folded into Step 0,
  which also decides between Paths A and B.
- **Controls the user can't use** (was Q6): disabled, with a tooltip giving
  the reason. See *UI*.
- **A target on a KPI the user can't see** (was Q2): the wording talks about
  permission rather than "restricted". See *Reads*.
- **Readings use Path A** (Step 0 findings): the field is editable and is
  read and written `asUser`. Writes no longer go through the app-only field
  API.
- **Path A's visible field:** the field is on no screen, so Jira doesn't show
  it. If an admin adds it to a screen, people with Edit Issues could type over
  the raw value. That risk is accepted.
- **Removing a target on a KPI the user can't see:** stays enabled. Only edit
  and record are disabled on those rows.
- **Settings writes are enforced by Jira:** every Settings write requires
  Administer Jira (checked as the user), and provisioning writes run
  `asUser`. See *Settings: admin-only, enforced by Jira* and Step 4b.
- **Who may record a value:** whoever has **Edit Issues** on that KPI issue.
  See *Who may record a value* under *Writes*.
- **App distribution:** the app is probably still **Not sharing**, the
  developer-only setting in Atlassian's developer console. No change for this
  spec. In Step 7, if the second user sees an "Allow access" pop-up, they
  click **Allow access** once and carry on. The pop-up comes from that
  setting, not from this change. Moving to **Sharing within organization**
  before a wider rollout is a separate task.
