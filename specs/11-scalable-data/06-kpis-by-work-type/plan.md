# 06 — KPIs by work type, in many spaces

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft** · Depends on: 03, 04, 05.

## Problem

Today every KPI lives in **one** project (`kpi:space`), and "is a KPI" means "is in that project".
That doesn't scale across many teams:

- **Ownership.** One project means one permission scheme, one admin, and one place everyone's KPIs
  pile up. Teams can't own their KPIs the way they own their work.
- **Load size.** The panel and Timeline load every KPI in the project. That's tolerable for one team's
  KPIs, not for a company's.

## Decision

- **Any company-managed space can hold KPIs.** A space "has KPIs" when its work type scheme includes
  the **KPI work type** (`KpiSiteConfig.workType`, 04). The app keeps **no list** of KPI spaces. It
  works them out from the KPIs it loads.
- **A KPI is an issue of the KPI work type.** Searches use the type's **id** (`issuetype = 10050`):
  - this spans every company-managed space that uses the type;
  - it never matches a team-managed space (their types are private and have their own ids, 01 C1);
  - Jira filters the results to what the user may browse (searches run `asUser`, spec 10).
- **The central space** (04) is where Settings puts company-wide KPIs. Add KPI doesn't default to it:
  the user picks a space (08).
  On existing installs, it's the current KPI project. **No data moves**, so the customer's
  `project = KPI` report keeps finding the KPIs it knows.
- **KPIs are ordinary work items in their space.** They can show up on that team's boards and
  backlogs; teams that want them hidden add `AND issuetype != KPI` to their board filter (04's guide).
  The app doesn't force a hierarchy level.
- **Nesting across spaces works.** The KPI hierarchy link type is site-wide, so a KPI can sit under a
  parent KPI in another space.
- **A KPI has at most one parent KPI (decided 2026-11-21).** The KPI hierarchy stays a **tree**, not a
  graph: supporting several parents would complicate the tree, rollups and every surface that draws it.
  Jira's own link UI can still add a second hierarchy link, so:
  - **reads pick one parent deterministically**: the hierarchy link with the **lowest link id** (the
    oldest), not link order, so every surface and invocation agrees;
  - **writes keep it single**: nesting (`updateKpi` / `linkKpiParent`) replaces every existing parent
    link, as today;
  - a KPI with extra parent links is **flagged** (e.g. in the KPI view: "Linked under 2 KPIs in Jira;
    showing PORT-12. Remove the other link in Jira."), never silently shown twice.
- **A parent KPI the user can't see makes its child top-level** (decided 2026-11-24, overview Q8).
  Reads run as the user, and Jira most likely leaves out links to issues the user can't browse (01 C2
  confirms). So the app doesn't know the parent exists, and asking as the app would reveal a hidden KPI.
  This is already what happens today when a parent isn't loaded.
- **Partly set-up spaces work.** Reads and writes never depend on the fields being on a space's
  screens (01 B5).

## Design

### What changes because there's no longer one KPI space

| Today | After |
|---|---|
| `kpi:space` decides what a KPI is | `KpiSiteConfig.workType.id` decides. `centralSpace` is where Settings puts company-wide KPIs, nothing more |
| `fetchKpiSpaceIssues(projectKey)` | `fetchKpis({ projects?, ids?, text?, limit? })`, always `issuetype = {workTypeId}` (+ 05's fields and `kpi-meta`). Keeps today's 50-page (5,000 KPI) cap; paging the KPI tree comes later (overview Q6) |
| `isKpiIssue(issueKey, spaceKey)` compares project keys | Compares the issue's type id with `workTypeId` |
| `requireTargetableKpi`, `recordValue`, `updateKpi`: "…isn't a KPI: only KPIs in the KPI space…" | "…isn't a KPI" when its type isn't the KPI type. The message doesn't name a space |
| Spec 10 `fetchKpiSpaceAccess(spaceKey)`, fetched with every Timeline and panel load | `fetchKpiAccess(projectKey)`, asked for **the KPI's own project**, and only **when it's needed** (*Permissions*, below). No permission lookup on load |
| Nesting (`linkKpiParent`) requires both KPIs in the KPI space | Both must be KPIs; they may be in different spaces. Link Issues is checked on the child's project (Q2). Still one parent per KPI |
| `parentFromIssueLinks` takes the **first** hierarchy link whose parent is in the loaded set | Takes the **lowest-id** hierarchy link to a KPI, and reports any extra parent links (one-parent rule, above). A parent that isn't loaded (not returned, or one the user can't browse) leaves the KPI **top-level** (Q8, above) |
| Timeline: `project = KPI` | `issuetype = {workTypeId}`: every KPI the user can browse. The central page shows them all (overview Q5); the KPI space filter is 08 |
| A KPI's own issue panel (KPI View) builds the **whole** Timeline (`buildTimelineParts()`: every KPI, reading and target) and keeps one node | Loads **only this KPI**: its readings, the work items that target it (`kpiIssueIds = {id}`, 03) and their rollup (Step 5) |
| UI text about "the KPI space" (not set up, no permission, "moved out of the KPI space") | Reworded for KPIs in many spaces (Step 6) |
| Panel catalog: every KPI in the space | **Temporarily** every KPI the user can browse (capped), until 07's KPI browser replaces it (Q1) |
| `createKpi` creates in the KPI project | Takes a required `projectId`; the UI fills it only when there's one possible space (08). Fails with a clear message without one |
| `createKpiIssue` uses `issuetype: { name: 'KPI' }` | `issuetype: { id: workTypeId }` |

### Where the spaces come from (derived, never stored)

| Need | Source | Extra requests |
|---|---|---|
| A KPI's space (labels, access checks) | The KPI's own `project` field, returned with it | none |
| Spaces on the Timeline | The projects of the KPIs it loaded (like today's `collectContributingProjects`) | none |
| Spaces you can add a KPI to (08) | `GET /project/search?action=create&expand=issueTypes` as the user, keeping projects whose types include `workTypeId` (01 B6) | one, only when the Add KPI form opens |

### Permissions (looked up lazily, decided 2026-11-24, overview Q10)

Spec 10's `KpiSpaceAccess` becomes **per project**: `fetchKpiAccess(projectKey)` returns the same shape
(`browse`, `create`, `edit`, `link`) for one project, as the user (`mypermissions`). Every check asks
about **the KPI's own project**: recording a value on a KPI in space B needs Edit Issues in B, whatever
the user can do in A.

The Timeline can show KPIs from dozens of spaces, so access is **not** looked up on load. It's fetched
when it's needed, and remembered:

- **New resolver `getKpiAccess({ projectKey })`.** The Timeline and the issue panel keep a
  **per-space cache** for the page session. The first time a KPI's row action is used (the **+**, the
  **…** menu, or clicking the track to record a value), the client fetches that KPI's space access if it
  isn't cached. Every other KPI in that space then reuses it.
- **While it loads**, the action shows a short busy state. **When it's refused**, the user sees the same
  reason text spec 10 uses (now naming the KPI's space, Step 6) instead of the dialog, and the **…**
  menu's items show as disabled with their reasons.
- **When Jira can't answer** (`PermissionLookupError`), the action goes ahead and Jira's own refusal
  explains it, as today's "unknown" (`access` absent) does.
- **Add KPI** needs no lookup of its own: its dialog asks Jira for the spaces where the user can create
  KPIs (08, `getKpiCreateSpaces`), and says "You can't create KPIs in any space." when there are none.
  The Timeline's Add KPI button is always enabled.
- **A KPI's own panel (KPI View)** has one KPI in one space, so it still fetches that space's access
  with the load (one request, as today).
- **Contracts:** `TimelineData.access` and `PanelBasis.access` are removed; `PanelData.kpiView` keeps
  one `access`.
- **Later:** prefetch a space's access in the background when a row is hovered, into the same cache.

### Test infrastructure

- **Multi-space scale fixture** ([scaleFixture.ts](../../../app/src/backend/testing/scaleFixture.ts)):
  3+ company-managed projects with KPIs (one is the central space), a team-managed project with its own
  "KPI" type, KPIs nested across projects, a user without Browse on one project, and a user with Edit in
  one project but not another.
- **Harness fixtures**: KPIs in at least two spaces, so the existing Timeline and panel render
  cross-space data before 07 and 08 add their UI.

## Implementation steps

### Step 1 — Multi-space fixtures

- **Verify:** existing backend and harness tests still pass on the single-space fixture; the new
  fixture loads.

### Step 2 — "Is a KPI" by work type

- `fetchKpis`, `isKpiIssue`, `createKpiIssue` by type id, updated "isn't a KPI" checks.
- **Verify:** backend tests: KPIs from every company-managed fixture project are found; the
  team-managed "KPI" isn't; a non-KPI issue in the central space isn't a KPI; an upgraded install with
  only a derived config (04) behaves exactly as before (single-space snapshots unchanged).

### Step 3 — Per-project access, looked up lazily

- `fetchKpiAccess(projectKey)` replaces every use of `fetchKpiSpaceAccess`. Add the `getKpiAccess`
  resolver. Remove `access` from the Timeline and panel loads (KPI View keeps one). Add the client's
  per-space access cache, and the busy and refused states on row actions and target cards (*Permissions*).
- **Verify:**
  - Edit in space A doesn't allow recording on a KPI in space B.
  - A user without Browse on one space never sees its KPIs in the Timeline or panel.
  - Request-log tests: loading the Timeline or the panel makes **no** permission lookup; using actions on
    two KPIs in the same space makes **one**.
  - In the harness, light and dark: a refused action shows its reason naming the KPI's space; a failed
    lookup lets the action go ahead.

### Step 4 — Timeline, panel catalog and create across spaces

- Timeline by type; panel catalog by type (temporary, capped); `createKpi` with a **required**
  `projectId`; cross-space nesting.
- **Verify:** the cross-space KPI tree renders as one tree in the harness Timeline; targets, readings
  and nesting across spaces work in backend tests; a KPI with two hierarchy links in Jira shows once,
  under its lowest-id parent, and is flagged; a KPI whose parent KPI is in a space the user can't browse
  is top-level; creating without a `projectId` fails with the message; a KPI created in a second space
  has its fields and marked `kpi-meta` (05); 05's `kpi-meta-to-fields` migration migrates KPIs in
  **two projects**.

### Step 5 — A KPI's own panel loads only that KPI

- On a KPI (by work type, Step 2), the panel stops calling `buildTimelineParts()`. It loads this KPI
  (name, unit, direction, its own readings), the work items that target it (`kpiIssueIds = {id}`, 03)
  with the rollup their target dates need, and its space's access. Then it builds the **same**
  `TimelineNodeDto` the Timeline would, with the same pure helpers (`applyTargetContributions`), so the
  KPI View's chart doesn't change. The `catalog` it was also sent (unused by KpiView) is dropped.
- **Verify:** the node equals the one the whole-Timeline build produces for that KPI (snapshot on the
  multi-space fixture). Request-log tests: no search over all KPIs, readings fetched for this one KPI
  only, targets found with `kpiIssueIds = {id}`. The harness KPI View is unchanged, light and dark.

### Step 6 — Wording for KPIs in many spaces

Today's text assumes one KPI space. Reword it (decided 2026-11-24, overview Q9):

| Where | Today | After |
|---|---|---|
| Timeline banner (`useTimelineData`, `Timeline.tsx`) | "KPI space isn't set up" | No KPI work type configured yet (04), with the same "Open Settings" action |
| Timeline, issue panel | "You don't have permission to view the KPI space" | When the user's search finds **no** KPIs: "No KPIs to show. There may be none yet, or they're in spaces you can't access." plus **Add KPI** (Q4). A single hidden KPI is already "no access" on its target card |
| TargetCard | "This KPI was deleted or moved out of the KPI space…" | "This KPI was deleted…" (03 makes moves harmless) |
| `kpiPermissionMessage` (DisabledReason, KpiView, TargetCard) | "…permission on the KPI space project" | "…permission on the **{space name}** space" (the KPI's own space) |

- **Verify:** stories and their tests updated for every message (light and dark); a grep finds no
  "KPI space" left in user-facing UI text.

### Step 7 — Live check (dev)

- On `bitovi-training`, enable KPIs in a second company-managed project **by hand in Jira**, following
  04's guide, as a space admin would. Leave its fields off its screens at first (a partly set-up space).
- **Verify:** a KPI created there in Jira shows in dev's Timeline with its unit and direction; it can be
  targeted from a work item in a third project; a user without access to that project never sees it;
  a user with Edit in only one space is told which space they lack when recording on a KPI in the other;
  opening a KPI's own panel loads only that KPI (Forge logs: no all-KPI search); the customer-style
  search `project = KPI` still returns exactly the central space's KPIs; staging (on `main`) still works
  on the central space.

## Questions

1. **Temporary panel catalog.** Between 06 and 07 (on the branch only, never released), the panel's
   "Set a KPI target" list is every KPI the user can browse, capped (e.g. 500). OK, or should 06 and 07
   be one stage?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** the temporary capped catalog (500), as drafted.
2. **Nesting permission across spaces.** Creating a hierarchy link needs Link Issues. Check it on the
   **child's** project only (draft), or on both?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** the child's project only, as drafted.
3. **KPIs above story level.** The earlier multi-space draft let admins put the KPI type at another hierarchy level (e.g.
   Epic level). Anything in the app that assumes KPIs are story-level (e.g. the parent-chain walk in
   07, or Timeline rollups) that we should guard against?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** no guard now. KPIs stay standard work types on both sites; 07's parent walk follows the work item's parents and never assumes a KPI's level. Revisit if a site moves the KPI type.
4. **An empty Timeline: "none exist" or "you can't see them"?** With one KPI space, the app asked
   whether the user could browse it. With KPIs in many spaces, a search as the user that returns
   nothing means either no KPIs exist yet or the user can't see any, and only an `asApp` count can tell
   which. That reveals that hidden KPIs exist, but not which ones. Options:
   - **(a)** One message for both: "No KPIs to show. They may be in spaces you can't access." Plus
     **Add KPI** if they can create one (no extra request).
   - **(b)** An `asApp` count to pick between "No KPIs yet" and "You don't have access to any KPIs".
   Default: (a), which reveals nothing and costs no extra request.
   - **Answered (2026-11-24): (a).** Tell people it may be either: no KPIs yet, or none in spaces they
     can access. *Incorporated: Step 6.*
