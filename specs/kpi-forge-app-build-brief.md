# Build Brief: Hierarchy-Native KPI Tracker (Jira Forge App)

This document is a build specification for a coding agent. Build a **Forge app for Jira Cloud** that lets people define, inherit, and report on KPIs directly on issues within a custom issue hierarchy — without the KPIs living in a separate object model outside the hierarchy.

Read the whole brief before writing code. The two "Locked design decisions" below are settled; do not relitigate them, but do surface any place where they conflict with a platform constraint you discover.

---

## 1. Problem & motivation

Existing marketplace tools (Oboard OKR Board, Tability, OKR for Jira, Jira Align) all implement OKRs/KPIs as a **separate strategic layer** that issues are *linked* to. That is exactly what we are avoiding. We want the KPI target data (baseline, target, timing, result) to live **on the issue itself** and **inherit down the native parent chain**.

### Target issue hierarchy

```
Outcome  →  Initiative  →  Increment  →  Epic  →  Story
```

- The three custom levels above Epic (Outcome, Initiative, Increment) require **Jira Premium** (Jira Plans / Advanced Roadmaps) to configure. Assume the customer's site already has this hierarchy configured. The app must **not** hardcode issue type names; discover the hierarchy at runtime via the `parent` field and issue-type metadata.
- All parent/child relationships across levels use the unified `parent` field. Walking "up" means following `parent → parent → parent`.

### What a user must be able to do

1. Open an **Outcome**, pick one or more KPIs it contributes to, and for each set: **baseline**, **target**, **target type** (absolute or delta), and **timing** (start + due).
2. Open an **Initiative** (or Increment) below it and do the same, **inheriting** the parent's settings for a KPI it shares, with the option to **override** locally.
3. **Add new KPI definitions** to a shared catalog on the fly (name, unit, direction).
4. Open a **reporting page** that shows contributions to each KPI across all levels of the hierarchy.

---

## 2. Locked design decisions

### 2.1 Inheritance = live reference with local override

When an issue assigns a KPI with `inheritFromParent: true`, its baseline/timing are **resolved at read time** by walking up the parent chain to the nearest ancestor that assigns the **same KPI**, and using that ancestor's values. A local value, when set, overrides the inherited one for that field.

- Rationale: no stale snapshots; changing an Outcome's target propagates to descendants automatically.
- Cost: each panel render does a few REST calls up the chain. **Cache** resolved ancestor lookups per issue for the lifetime of the render.
- If no ancestor assigns the KPI, inheritance yields nothing and the field is treated as locally unset.

### 2.2 Rollup = independent parent targets + coverage indicator

Parent targets are authored **independently**. Child contributions are shown as contributors *toward* a parent's target, **not summed into it**. This avoids double-counting the same KPI delta across five levels.

- The reporting page shows, per KPI per parent: the parent's own target, and a **coverage** figure = sum of direct children's targets vs. the parent target, so gaps and over-commitments are visible without conflating them.
- Do **not** auto-populate a parent's target from its children.

---

## 3. Architecture

**Platform:** Atlassian Forge (native, serverless, hosted storage). Use the current runtime and `@forge/kvs` for storage (not the legacy `@forge/api` storage module).

**UI framework:** UI Kit (latest) is preferred for speed; use Custom UI (React) only for the reporting page if the visualization needs exceed UI Kit components. State the choice in the README.

### Storage split (important)

| Data | Where | Why |
|------|-------|-----|
| **Per-issue KPI assignments** | Jira **issue entity property** (one property key per issue holding an array) | Travels with the issue, does not consume metered Forge storage, indexable for JQL |
| **KPI catalog** (definitions) | Forge **KVS**, one key per definition | Shared app-level registry; one-key-per-def avoids write clobbering |
| **Reporting index** (issue → kpiIds) | Forge **Custom Entity Store**, indexed on `kpiId` | Lets the reporting page query "all issues contributing to KPI X" without scanning |

Do not store all assignments or the whole catalog in a single blob — see storage limits in §7.

---

## 4. Data models

### 4.1 KPI definition (catalog entry) — Forge KVS

Key: `kpi:def:{kpiId}` (kpiId is a slug, e.g. `revenue`, `nps`, `cycle-time`).

```json
{
  "id": "revenue",
  "name": "Revenue",
  "unit": "USD",
  "direction": "increase",        // "increase" | "decrease"
  "description": "Total booked revenue",
  "createdBy": "<accountId>",
  "createdAt": 1730000000000
}
```

- Anyone with app access may add a definition. Slug must be unique; generate from name, collision-suffix if needed.
- Deleting a definition should be soft (mark `archived: true`) so existing assignments don't break.

### 4.2 KPI assignment on an issue — Jira issue entity property

Property key: the UUID component of your `app.id` (Forge convention) or a fixed key such as `kpi-assignments`. Value:

```json
{
  "assignments": [
    {
      "kpiId": "revenue",
      "inheritFromParent": true,
      "baseline": 1000000,          // null when inherited/unset
      "target": 1500000,            // null when inherited/unset
      "targetType": "absolute",     // "absolute" | "delta"
      "timing": {
        "start": "2026-01-01",
        "due": {
          "mode": "relative",       // "absolute" | "relative"
          "absolute": null,         // ISO date; used only when mode === "absolute"
          "anchor": "issueDueDate", // "issueDueDate" | "parentDueDate" | "kpiStart"
          "offsetMonths": 3         // added to the resolved anchor date
        }
      },
      "current": 1200000,           // latest recorded result, optional
      "updatedBy": "<accountId>",
      "updatedAt": 1730000000000
    }
  ]
}
```

- `inheritFromParent: true` + a `null` field means "resolve from ancestor at read time."
- A non-null local field always wins over inheritance.
- **Target date can be absolute or relative.** `timing.due.mode === "absolute"` stores a fixed ISO date in `absolute`. `mode === "relative"` computes the effective target date as `resolve(anchor) + offsetMonths` **at read time** (never snapshotted), so a moving anchor moves the KPI target date automatically. See §6.1 for how the `issueDueDate`/`parentDueDate` anchor is itself resolved via the configurable due-date rollup.
- Keep `kpiId`s used on an issue mirrored into a flat, indexable property (e.g. a space-joined string) if you index via `jira:entityProperty` for JQL — see §6.

### 4.3 Reporting index entry — Forge Custom Entity Store

One entity, e.g. `kpiContribution`, keyed by `{issueId}:{kpiId}`, indexed on `kpiId`:

```json
{
  "issueId": "10042",
  "issueKey": "OUT-12",
  "kpiId": "revenue",
  "issueTypeName": "Outcome",
  "hierarchyLevel": 4,
  "target": 1500000,
  "targetType": "absolute",
  "resolvedBaseline": 1000000,
  "current": 1200000,
  "parentIssueId": "10001"
}
```

- Rebuilt/updated whenever an assignment is saved (write path) and lazily reconciled by the reporting page.

### 4.4 App configuration — Forge KVS

Key: `kpi:config:rollup` (single app-level config document).

```json
{
  "dueDateRollup": {
    "Outcome":    "childrenFirstThenParent",
    "Initiative": "childrenFirstThenParent",
    "Increment":  "childrenOnly",
    "Epic":       "childrenFirstThenParent",
    "Story":      "parentOnly"
  }
}
```

- Keyed by **issue-type name discovered at runtime** — do not hardcode. The settings form is populated from the discovered hierarchy.
- One method per level, from the fixed set in §6.1. Missing level → default `childrenFirstThenParent` (leaf level → `parentOnly`).
- Single low-write-frequency document; safe as one key (unlike the catalog/index, which must be one-key-per-record).

---

## 5. Modules & UI surfaces

Declare these in `manifest.yml`:

1. **`jira:issuePanel`** (or `jira:issueContext` for the collapsible right-rail variant) — the on-issue KPI editor. Shows assigned KPIs, inherited vs. local values (clearly differentiated), and controls to add/edit/remove an assignment and to add a brand-new KPI definition inline. The target-date control offers **Absolute date** vs. **N months after {anchor}**; the row displays the *resolved* date plus its source (e.g. "2027-03-31 · 3 mo after INIT-48 due, rolled up from children").
2. **Reporting page** — a **`jira:projectPage`** and/or a global page. Group by KPI; under each KPI show the contributing issues arranged by hierarchy level with baseline/target/current and the coverage indicator (§2.2). Support filtering by KPI and by top-level ancestor.
3. **Settings page** — a **`jira:projectPage`** (or global admin page). Hosts the **Due Date Rollup** form: one dropdown per discovered hierarchy level choosing how that level's due date is resolved between parent and children (§6.1). Writes `kpi:config:rollup`. Mirrors the Bitovi Timeline Report's "Timing Calculation" settings. See `specs/00-mocks/settings.html`.
4. **`jira:entityProperty`** (optional but recommended) — index the flat `kpiIds` string so JQL can find issues touching a KPI.

### On-issue editor behavior

- Reads the issue's own assignment property, then resolves inheritance by walking `parent`.
- Renders each KPI row showing: value in effect, its **source** (Local / Inherited from `<ISSUE-KEY>`), and an override toggle.
- "Add KPI" opens a picker over the catalog + an "Add new…" affordance that writes a new `kpi:def:` and immediately selects it.
- On save: write the issue entity property, then upsert the reporting-index entity for each `(issueId, kpiId)` and remove entries for de-assigned KPIs. Batch these writes.

---

## 6. Key implementation notes

- **Parent walk:** fetch issue with `fields=parent`, follow `parent.id` upward. Stop at the top of the hierarchy or when an ancestor assigning the same `kpiId` is found. Guard against cycles and cap depth (hierarchy is ≤5, but cap at, say, 10).
- **Inheritance resolution** is a pure function: `(localAssignment, ancestorAssignments[]) → resolvedAssignment`. Unit-test it thoroughly with these cases: no ancestor; ancestor with same KPI; multiple ancestors (nearest wins); local override of one field but not others.
- **JQL indexing:** `jira:entityProperty` can index a `number`, `text`, `string`, or `date`. Index a top-level `kpiIds` string (space-joined) as `text` so `"KPI[Short text]" ~ revenue`-style JQL works. Nested arrays are not deeply indexable — that's what the flat mirror is for.
- **Batch writes** to KVS/Custom Entity Store (transactions, max 25 ops / 4 MB). Ten individual 1 KB writes cost ~100 KB of rate limit due to 10 KB rounding; the same in one batch costs ~10 KB.
- **Never** put the whole catalog or index in one key (per-key write limit is 1 MB/s and writes are last-write-wins → concurrent adds clobber).
- **Permissions:** assignments are stored as issue entity properties, which are readable/writable by any user with edit permission on the issue and via REST. Do not store anything sensitive there.

### 6.1 Due-date resolution & relative KPI target dates

A KPI target date set with `timing.due.mode === "relative"` (§4.2) is computed at read time as `effectiveDueDate(anchorIssue) + offsetMonths`. The anchor's **effective due date** is itself resolved through a configurable, per-level **rollup** — the same mechanism the Bitovi Timeline Report exposes as "Timing Calculation." Configuration lives in `kpi:config:rollup` (§4.4) and is edited on the Settings page (§5).

**`effectiveDueDate(issue)`** is a pure, recursive, memoized function. For the issue's hierarchy level, read its configured method and apply:

| Method | Behavior |
|--------|----------|
| `childrenFirstThenParent` | **Default.** Use merged children's effective dates; if no children, fall back to the issue's own due date. |
| `childrenOnly` | Always `max(child.effectiveDue)`; ignore the issue's own date. |
| `parentFirstThenChildren` | The issue's own date wins per-field; children fill only the gaps. |
| `parentOnly` | Never roll up; use the issue's own due date (leaf-level default). |
| `widestRange` | Latest due across the issue's own date and all children. |

- **Rollup aggregation for due date = latest child** (a parent finishes when its last child finishes). Resolve bottom-up.
- **Memoize** `effectiveDueDate(issueId)` for the render's lifetime and reuse the same parent-walk cache and depth cap (≤10) as inheritance. Guard against cycles.
- **Anchors:** `issueDueDate` → the assignment's own issue; `parentDueDate` → its parent; `kpiStart` → the assignment's `timing.start` (no rollup needed).
- **Unresolvable anchor** (no own date and no dated descendants) → surface the target date as **pending**, not a computed-from-nothing date. Unit-test: explicit date present; no date but dated children (rolls up); mixed explicit + later children under each method; no dates anywhere (pending); offset of 0.
- **Reporting index (§4.3):** prefer **lazy** resolution — store the rule (`anchor` + `offsetMonths`), compute `targetDate` when the reporting page renders (consistent with "resolve at read time" and the write-minimizing bias of §7). Eager recomputation of ancestors on every child date change is possible but fans out writes; avoid for v1.

---

## 7. Storage limits to respect (Forge KVS / Custom Entity Store, per installation)

- Max value size: **240 KiB** per stored value.
- Max key length: **500 chars**; max object depth: **31**.
- Per-key throughput: **12 MB/s read, 1 MB/s write**.
- Custom Entity Store: max **20 entities** per app, **7 indexes** and **50 attributes** per entity.
- Transactions: max **25 operations**, **4 MB** payload.
- Jira **issue entity property** value cap is much smaller (~32 KB) — fine, since an assignment record is ~200 bytes and even 20 KPIs on one issue is ~5 KB.
- Forge uses **consumption-based pricing** (free monthly allowance per app, billed above it). An internal instance will stay in free tier; writes cost more than reads, so favor caching and batching.

---

## 8. `manifest.yml` sketch

Adjust module keys/resources to match the scaffold. Scopes shown are the minimum expected.

```yaml
modules:
  jira:issuePanel:
    - key: kpi-issue-panel
      resource: main
      resolver:
        function: resolver
      render: native
      title: KPIs
      icon: resource:icons;kpi.svg
  jira:projectPage:
    - key: kpi-reporting-page
      resource: reporting
      resolver:
        function: resolver
      render: native
      title: KPI Reporting
    - key: kpi-settings-page
      resource: settings
      resolver:
        function: resolver
      render: native
      title: KPI Settings
  jira:entityProperty:
    - key: kpi-index
      entityType: issue
      values:
        - path: kpiIds
          type: text
      keyConfigurations:
        - key: kpi-assignments
          extractions:
            - objectName: kpiIds
              type: text
  function:
    - key: resolver
      handler: index.handler

resources:
  - key: main
    path: static/panel/build
  - key: reporting
    path: static/reporting/build
  - key: settings
    path: static/settings/build
  - key: icons
    path: static/icons

permissions:
  scopes:
    - read:jira-work        # read issues, parent field, issue types
    - write:jira-work       # write issue entity properties
    - storage:app           # KVS + Custom Entity Store
app:
  runtime:
    name: nodejs22.x
```

---

## 9. Suggested build phases (each with acceptance criteria)

**Phase 0 — Scaffold & install.** App created, deployed, installed on a dev site, panel renders "hello" on an issue.
- AC: panel appears on an Outcome issue; `forge tunnel` hot-reloads.

**Phase 1 — Catalog CRUD.** Add/list/archive KPI definitions in KVS (one key per def).
- AC: can add "Revenue (USD, increase)"; it appears in the picker; duplicate slugs are disambiguated.

**Phase 2 — Assignments on an issue.** Assign KPIs on an issue with baseline/target/type/timing/current, stored as an issue entity property.
- AC: values persist across reloads; removing an assignment deletes it from the property.

**Phase 3 — Inheritance.** Walk parent chain, resolve inherited values, show Local vs. Inherited source, support per-field override.
- AC: setting Revenue target on an Outcome makes it appear as "Inherited from OUT-12" on a child Initiative; overriding the Initiative's target detaches only that field.

**Phase 4 — Reporting index.** On save, upsert `kpiContribution` entities; index on `kpiId`.
- AC: querying by `kpiId` returns all contributing issues.

**Phase 5 — Reporting page.** Group by KPI, arrange contributors by hierarchy level, show coverage indicator; filter by KPI and top ancestor.
- AC: a KPI with an Outcome target and three Initiative targets shows each and a coverage figure; no double-counting.

**Phase 6 — Due-date rollup & relative target dates.** Add the Settings page writing `kpi:config:rollup`; implement the memoized `effectiveDueDate` resolver (§6.1); support `timing.due.mode === "relative"` in the on-issue editor and resolve it on the panel and reporting page.
- AC: an Outcome with no own due date but three dated Initiatives shows a rolled-up due date under `childrenOnly`; a KPI set to "+3 months after due" shows the resolved date and updates when a child's date changes; an unresolvable anchor shows "pending."

**Phase 7 — Polish.** JQL indexing, empty/error states, caching of ancestor lookups, loading indicators, README documenting choices.

---

## 10. Out of scope (for now)

- Check-in reminders / notifications.
- Time-series history of `current` values (v1 stores latest only; note where a history model would attach).
- Cross-project rollups beyond the parent chain.
- Non-Jira surfaces.

---

## 11. Setup: get this running on a playground (dev) instance

The customer/dev must do the following once. (These are current Atlassian Forge steps; verify against the getting-started guide if anything has moved.)

### Prerequisites

- **Node.js LTS — version 22.x or 24.x.** On macOS, install via `nvm` (the macOS `.pkg` installer causes permission errors with the Forge CLI). Do **not** run Node/npm as root.
- A code editor.

### One-time account/site setup

1. **Create a free Atlassian Cloud developer site** (this is your "playground"): go to `http://go.atlassian.com/cloud-dev` and create a site using the email on your Atlassian account. Complete the setup wizard. Add **Jira** to the site.
2. **Configure the issue hierarchy** on that site (requires Jira Premium features / Jira Plans): create the custom levels **Outcome, Initiative, Increment** above Epic, mapped to matching issue types. Create a couple of test issues at each level with real parent links so inheritance can be exercised.
3. **Create an Atlassian API token with scopes** at `https://id.atlassian.com/manage-profile/security/api-tokens` → **Create API token with scopes**. Copy it (shown once).

### Install the CLI and log in

```bash
npm install -g @forge/cli      # installs the Forge CLI globally (as your user, not root)
forge --version                # confirm it installed
forge login                    # enter your Atlassian account email + the API token
forge whoami                   # confirm you're authenticated
```

### Create / register / deploy / install

If starting the scaffold yourself:

```bash
forge create                   # choose a UI Kit Jira template; cd into the new dir
```

If the agent generated the code in an existing directory that wasn't created by your account, register it so you can run commands against it:

```bash
forge register                 # associates the app with your developer account (writes app id to manifest)
```

Then, from the app directory:

```bash
npm install                    # install the app's dependencies
forge lint                     # catch common manifest/code errors
forge deploy                   # deploy code to the default (development) environment
forge install                  # install onto a site; follow prompts, or:
forge install -s YOUR-SITE.atlassian.net -p Jira
```

`forge deploy` pushes code; `forge install` puts the app on a specific site. After the first install, re-running `forge deploy` updates the running app automatically. If you change **scopes or modules** in the manifest, re-run `forge install --upgrade` to accept the new permissions.

### Develop with live reload

```bash
forge tunnel                   # streams logs and hot-reloads local code changes on the dev site
```

Keep `forge tunnel` running while iterating so changes appear on the site without redeploying. Use `forge logs` to inspect invocations when not tunneling.

### Verify

- Open one of your test **Outcome** issues → the **KPIs** panel should render.
- Assign a KPI with a target; open a child **Initiative** → it should show the inherited value.
- Open the project's **KPI Reporting** page → the contribution should appear under that KPI.

### Notes

- The dev/`development` environment is your playground; there are also `staging` and `production` environments (`forge deploy -e <env>`), and Forge exempts a number of sandboxes from billing — the dev environment on a free developer site is the right place to iterate.
- Each CLI version is supported for ~6 months; if you hit odd errors, fully remove and reinstall `@forge/cli` to upgrade.
