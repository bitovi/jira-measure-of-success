# Bug fix: recording a value did nothing (reading never persisted)

## Symptom
On the deployed app, recording a value on the KPI Timeline appeared to do
nothing: the modal closed, but no value showed up, no sparkline change, and **no
error** surfaced. The action looked like a no-op.

## Live evidence (read-only Jira API inspection)
- The KPI issues' `KPI Reading` custom field (`customfield_10837`) was **EMPTY**
  on every KPI issue.
- The reading-field changelog (`POST /rest/api/3/changelog/bulkfetch`, filtered to
  `customfield_10837`) had **ZERO entries**.

So the recorded value was not landing where the app reads it — and nothing
complained.

## Root causes (two, both in `app/src/backend/jira.ts`)

### 1. `writeReading` never checked the write response
`writeReading` issued `PUT /rest/api/3/issue/{id}` with the encoded reading and
returned without inspecting `res.ok`. A 4xx/5xx write was therefore **swallowed
silently**: the resolver's `recordValue` then returned a freshly-built
`buildTimelineData()` (unchanged), so the UI showed no change **and** no error.

### 2. Read/write auth mismatch (`asApp` write vs `asUser` read)
- `writeReading` writes the app-managed read-only `KPI Reading` field with
  `api.asApp()`.
- `fetchReadingChangelog` read that field's changelog with `api.asUser()`.

Values/changelog of an app-managed read-only custom field are generally **not
visible to `asUser`**. So even a *successful* write would read back empty — which
matches the live evidence (empty field, empty changelog).

## Fixes applied (`app/src/backend/jira.ts`)

1. **`writeReading` now checks `res.ok`.** On failure it reads the response body
   text and throws `Failed to write reading (${res.status}): ${body}`. The
   Timeline already renders a mutation-error banner from a prior fix, so a thrown
   error now surfaces to the UI (and to Forge logs) instead of being swallowed.

2. **`fetchReadingChangelog` now reads with `api.asApp()`** (was `asUser`) to
   match the write, so it can see the app-managed field's changelog. Nearby reads
   were reviewed: `fetchKpiSpaceIssues` and `getReadingFieldId` already use
   `asApp`; `fetchIssueMeta`/`fetchAssignments`/`fetchChildren` read ordinary
   user-visible Jira data (issue meta, issue property, JQL children) — none read
   the app-managed reading field — so they were left as `asUser` (unchanged,
   minimal-diff).

3. **Failed changelog fetch is now observable.** `fetchReadingChangelog` still
   returns an empty map (non-throwing) on a failed bulkfetch so an empty series
   never crashes the timeline on initial load, but it now also emits a permanent
   `console.warn` with the status. (This is intentional diagnostic logging, not
   temporary debug output.)

## Verified locally
- `npx vitest run` — 90 passed (13 files), incl. new `src/backend/jira.test.ts`.
- `npx vitest run --config vitest.stories.config.ts` — 28 passed (3 files); no UI
  regressions.
- `npx tsc --noEmit` — clean.
- Harness record flow (Vite dev, `?surface=timeline`): opened the Record modal on
  three KPIs, submitted values; each appended in-memory and re-rendered the
  sparkline; browser console clean (0 log/warn/error). The harness mocks the
  bridge and does **not** exercise `jira.ts`, so this only proves the UI record
  path still works — the live fixes cannot be exercised by the harness.

## Remaining verification (requires a redeploy — out of local scope)
After `npm run build:forge` + `forge deploy` + `forge install --upgrade`:
1. Record a value on a KPI and confirm the **reading field / changelog now
   populates** (`customfield_10837` is no longer empty; a changelog entry
   appears). Because the field is app-managed and may be invisible even to an
   `asUser` PAT, confirm via the app's own `asApp` read (the timeline series) or
   via an `asApp`-authenticated inspection rather than a plain user token.
2. Confirm the **sparkline updates** on the Timeline after recording.

Open possibility: the `PUT` write itself may still fail for a *different* reason
(e.g. the app-managed read-only field may not be writable via a plain issue
`PUT`). If so, the newly-added `res.ok` check will now reveal Jira's exact error
message in the Timeline mutation-error banner and in Forge logs — turning a silent
no-op into an actionable error.

---

## 2026-07-14 — the `res.ok` check paid off: 400 "Field does not support update"

The predicted "open possibility" above was confirmed. With the `res.ok` guard in
place, recording a value now surfaces a real error in the UI banner / Forge logs:

```
Failed to write reading (400): {"errors":{"customfield_10837":"Field does not support update 'customfield_10837'"}}
```

### Root cause
The app-managed `KPI Reading` field (`kpi-reading` → `customfield_10837`) is
`readOnly` and **cannot be written via the standard issue-edit
`PUT /rest/api/3/issue/{id}`** — Jira rejects it with 400 "Field does not support
update". App-managed read-only fields must be written through the dedicated **app
custom field value API**, which only the owning app may call.

### Fix applied (`app/src/backend/jira.ts`, `writeReading` ~L101)
Rewrote `writeReading` to use the app field value API:
1. **Resolve the NUMERIC issue id.** The resolver passes the issue KEY on live
   (`buildTimelineData().toNode` sets `kpiId: issue.key`), but the app/field/value
   API requires the numeric id. So `writeReading` first does
   `GET /rest/api/3/issue/${kpiIssueId}?fields=` (`asApp`; the GET accepts key or
   id) and reads the numeric `.id`. A `!res.ok` GET throws a descriptive error.
2. **Write via the app field value API:**
   `PUT /rest/api/3/app/field/${fieldId}/value?generateChangelog=true` (`asApp`)
   with body `{ updates: [ { issueIds: [Number(numericId)], value: encoded } ] }`.
   Success is **204 No Content**.
   - `generateChangelog=true` is **required** for our Option-B design: readings
     are reconstructed from this field's CHANGELOG, so every write must emit a
     changelog entry. (`generateAppEvents` left off.)
   - The `value=null` tombstone path is unchanged — `encodeReadingValue(date, null)`
     still returns a valid encoded string, sent as the field value.
3. **Non-2xx still throws** `Failed to write reading (${res.status}): ${body}`,
   preserving the surfacing behavior (UI banner + Forge logs).

### Manifest scope added (`app/manifest.yml`)
Added `write:app-data:jira` to `permissions.scopes`. Docs list it as currently
optional but recommended and eventually mandatory for the app field value API.
**Adding a scope REQUIRES `forge install --upgrade` on the next deploy.**

### Verified locally
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 91 passed (13 files); `src/backend/jira.test.ts` updated to
  the new flow (GET → numeric id, then app/field/value PUT): asserts the 400
  failure path rejects with `Failed to write reading (400): boom`, and a 204
  success path resolves while calling
  `/app/field/customfield_10837/value?generateChangelog=true` with
  `issueIds:[10001]`.
- `npx vitest run --config vitest.stories.config.ts` — 28 passed (3 files); no UI
  regressions.
- Harness (`?surface=timeline`): recorded `1,300,000` on Revenue → appended as
  `1,300,000 · 2026-07-10` and re-rendered the sparkline; console clean. (Harness
  mocks the bridge and does not exercise `jira.ts`, so this only proves the UI
  path; the API change is live-only.)

### Remaining live verification (requires redeploy — out of local scope)
After `npm run build:forge` + `forge deploy` + `forge install --upgrade`:
1. Record a value → confirm the PUT returns **204**.
2. Confirm `customfield_10837` / its changelog now populates and the sparkline
   updates on the Timeline.
3. **Residual risk to watch:** confirm `generateChangelog=true` actually produces
   a changelog entry that `fetchReadingChangelog` (`asApp`, filtered to the field)
   returns. If the app field value API does NOT emit a changelog entry visible to
   bulkfetch, Option B (reconstruct-from-changelog) is unworkable and we must fall
   back to **Option A**: store readings as an entity-property array on the KPI
   issue.
