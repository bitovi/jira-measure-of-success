# 06 — KPIs by work type, in many spaces

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft** · Depends on: 03, 04.

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
- **The central space** (04) is where Settings puts company-wide KPIs and where Add KPI defaults (08).
  On existing installs, it's the current KPI project. **No data moves**, so the customer's
  `project = KPI` report keeps finding the KPIs it knows.
- **KPIs are ordinary work items in their space.** They can show up on that team's boards and
  backlogs; teams that want them hidden add `AND issuetype != KPI` to their board filter (04's guide).
  The app doesn't force a hierarchy level.
- **Nesting across spaces works.** The KPI hierarchy link type is site-wide, so a KPI can sit under a
  parent KPI in another space.
- **Partly set-up spaces work.** Reads and writes never depend on the fields being on a space's
  screens (01 B5).

## Design

### What changes because there's no longer one KPI space

| Today | After |
|---|---|
| `kpi:space` decides what a KPI is | `KpiSiteConfig.workType.id` decides. `centralSpace` is only the default home for new KPIs |
| `fetchKpiSpaceIssues(projectKey)` | `fetchKpis({ projects?, ids?, text?, limit? })`, always `issuetype = {workTypeId}` (+ 05's fields and `kpi-meta`) |
| `isKpiIssue(issueKey, spaceKey)` compares project keys | Compares the issue's type id with `workTypeId` |
| `requireTargetableKpi`, `recordValue`, `updateKpi`: "…isn't a KPI: only KPIs in the KPI space…" | "…isn't a KPI" when its type isn't the KPI type. The message doesn't name a space |
| Spec 10 `fetchKpiSpaceAccess(spaceKey)` | `fetchKpiAccess(projectKey)`, asked for **the KPI's own project**. Cached per project per invocation |
| Nesting (`linkKpiParent`) requires both KPIs in the KPI space | Both must be KPIs; they may be in different spaces. Link Issues is checked on the child's project (Q2) |
| Timeline: `project = KPI` | `issuetype = {workTypeId}`: every KPI the user can browse. The Space filter is 08 |
| Panel catalog: every KPI in the space | **Temporarily** every KPI the user can browse (capped), until 07 replaces it with suggestions (Q1) |
| `createKpi` creates in the KPI project | Takes an optional `projectId`, defaulting to the central space. Fails with a clear message when there's neither. The space choice UI is 08 |
| `createKpiIssue` uses `issuetype: { name: 'KPI' }` | `issuetype: { id: workTypeId }` |

### Where the spaces come from (derived, never stored)

| Need | Source | Extra requests |
|---|---|---|
| A KPI's space (labels, access checks) | The KPI's own `project` field, returned with it | none |
| Spaces on the Timeline | The projects of the KPIs it loaded (like today's `collectContributingProjects`) | none |
| Spaces you can add a KPI to (08) | `GET /project/search?action=create&expand=issueTypes` as the user, keeping projects whose types include `workTypeId` (01 B6) | one, only when the Add KPI form opens |

### Permissions

Spec 10's `KpiSpaceAccess` becomes **per project**: `fetchKpiAccess(projectKey)` returns the same shape
(`edit`, `create`, `link`, …) for one project. Every check asks about **the KPI's own project**:
recording a value on a KPI in space B needs Edit Issues in B, whatever the user can do in A. The
Timeline's per-KPI controls (record, edit, add child) use the access of that KPI's project. Projects
are looked up once per invocation and only for projects that have KPIs on screen.

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

### Step 3 — Per-project access

- `fetchKpiAccess(projectKey)` and every check that used `fetchKpiSpaceAccess`.
- **Verify:** Edit in space A doesn't allow recording on a KPI in space B; a user without Browse on one
  space never sees its KPIs in the Timeline or panel; request-log tests show one permissions lookup per
  project with KPIs on screen, not per KPI.

### Step 4 — Timeline, panel catalog and create across spaces

- Timeline by type; panel catalog by type (temporary, capped); `createKpi` with optional `projectId`;
  cross-space nesting.
- **Verify:** the cross-space KPI tree renders as one tree in the harness Timeline; targets, readings
  and nesting across spaces work in backend tests; creating with no central space and no `projectId`
  fails with the message; a KPI created in a second space has its fields and marked `kpi-meta` (05).

### Step 5 — Live check (dev)

- On `bitovi-training`, enable KPIs in a second company-managed project **by hand in Jira**, following
  04's guide, as a space admin would. Leave its fields off its screens at first (a partly set-up space).
- **Verify:** a KPI created there in Jira shows in dev's Timeline with its unit and direction; it can be
  targeted from a work item in a third project; a user without access to that project never sees it;
  the customer-style search `project = KPI` still returns exactly the central space's KPIs; staging
  (on `main`) still works on the central space.

## Questions

1. **Temporary panel catalog.** Between 06 and 07 (on the branch only, never released), the panel's
   "Set a KPI target" list is every KPI the user can browse, capped (e.g. 500). OK, or should 06 and 07
   be one stage?
2. **Nesting permission across spaces.** Creating a hierarchy link needs Link Issues. Check it on the
   **child's** project only (draft), or on both?
3. **KPIs above story level.** The earlier multi-space draft let admins put the KPI type at another hierarchy level (e.g.
   Epic level). Anything in the app that assumes KPIs are story-level (e.g. the parent-chain walk in
   07, or Timeline rollups) that we should guard against?
