# 01 — Jira spikes

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft**.

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
| A1 | **Forge-owned fields** (`jira:customField`): with two environments of the app installed on one site (dev + staging), how many "KPI Unit" fields exist, what are they called, and what does a user see on an issue and in JQL autocomplete? Is `forge install --upgrade` needed after adding a field? | 04 Q1 |
| A2 | **Admin-created fields over REST** (`POST /rest/api/3/field`, short text and single-select): can the app create them with the scopes it already has (`manage:jira-configuration`)? Can it add select options and read them back (`/field/{id}/context/{ctx}/option`)? | 04 Q1, Q2 |
| A3 | **Field context by issue type**, for both kinds of field: can the context be limited to the KPI issue type **in all projects**? Does a second company-managed project that adds the KPI type pick up the fields without another context change? | 04, 06 |
| A4 | **Writes off-screen**: can `POST /issue` and `PUT /issue/{id}` (as the user) set the unit and direction fields when they're **not** on the create or edit screen? (This already works for `kpi-reading`.) | 05 |
| A5 | **Select field write and read format**: what does `PUT /issue` accept for a single-select (`{ id }`, `{ value }`)? What does `search/jql` return with `fields=customfield_…`? | 05 |
| A6 | **One-request dual write**: does `PUT /issue/{id}` accept `fields` **and** `properties` (the `kpi-meta` property) in one body, as the user? Does `POST /issue` (already used with `properties`) also accept the custom fields? | 05 |
| A7 | **Validation and formatter** (Forge-owned fields only): does a `validation.expression` reject `"up"` sent over REST? Does a `view.formatter` render in the issue view and in CSV export? | 04 Q1 |
| A8 | **History**: does a field write made as the user show in the issue's History, naming them? | 05 |
| A9 | **Sync trigger**: does a Forge `avi:jira:updated:issue` trigger fire when the unit or direction field is edited in Jira's UI, with a changelog naming the field? Does the app's own write of the `kpi-meta` **property** stay silent (so there's no loop)? | 05 Q3 |

### B. Screens, schemes and spaces (feeds 04 and 06)

| # | Check | Feeds |
|---|---|---|
| B1 | Which screen scheme and field configuration does a project made by today's `createKpiProject` use? Is it shared with other projects? | 04 |
| B2 | **Field schemes**: the v3 prototype assumes Jira's newer *field schemes*. On the dev site, do we have field schemes or the older *field configuration schemes*? Which REST API creates them, adds a field for one work type, and assigns one to a project? | 04 Q3 |
| B3 | Over REST: create a **work type scheme**, **screens**, a **screen scheme** and a **work type screen scheme**, and assign them to a project. Which calls need Jira admin (`asUser` from Settings), and which work `asApp`? | 04 |
| B4 | **Who can enable KPIs in a space?** As a **project admin who isn't a Jira admin**, on a company-managed project: can they add the KPI work type to their project? Can they add KPI Unit / KPI Direction to its layout, with and without *extended project administration*? With a project created from a **shared configuration** of a KPI-enabled project, do the type and screens come along automatically? | 04 (the "other spaces" guide) |
| B5 | **Partly set-up space**: KPI type added, fields on **no** screen. Can the app still create a KPI there with unit and direction, record readings (`kpi-reading`), and read them all back? | 05, 06 |
| B6 | `GET /project/search?action=create&expand=issueTypes` as the user: does it list the KPI type only for KPI-enabled projects? How many pages does the dev site need? | 08 |

### C. Finding KPIs across spaces (feeds 06 and 07)

| # | Check | Feeds |
|---|---|---|
| C1 | `issuetype = {id}` returns KPIs from two company-managed projects, and **none** from a team-managed project that has its own "KPI" type | 06 |
| C2 | KPI hierarchy links between KPIs in **different** projects: created as the user, returned in `issuelinks`, same as same-project links | 06 |
| C3 | Cost of `issuetype = {id} AND summary ~ "text*"` on the dev site with 1, 5 and 20 projects of KPIs (the scale fixture simulates the size; this checks live latency) | 07 |
| C4 | `issuetype = {id} AND id in (…)` with 50 ids: one request, all returned? | 07 |

### D. Ids, keys and the targets index (feeds 03)

| # | Check | Feeds |
|---|---|---|
| D1 | Move a KPI to another project. Does `GET /issue/{oldKey}` through Forge `requestJira` (as the user) return the moved issue, with its **new** key and the **same** id? | 03 |
| D2 | **Adding** a second index path to the `kpi-assignments` entity property (e.g. `kpiIssueIds`, `type: string`): are properties **already written** indexed under the new path after deploy, or only properties written afterwards? | 03 Q2 |
| D3 | On a `string` index, does `issue.property[kpi-assignments].kpiIssueIds = "10234"` match exactly, with no tokenising? Does `IS NOT EMPTY` work as it does on the `text` path? | 03 |
| D4 | Does the existing `text` path (`kpiIds`) keep working, unchanged, after D2's deploy? (Older installs and the customer's app search with it.) | 03 |

### E. Migrations at scale (feeds 02)

| # | Check | Feeds |
|---|---|---|
| E1 | In one resolver invocation (as the user): how many `PUT /issue/{id}` fit comfortably inside the time limit? Try 25 and 50 | 02 Q1 |
| E2 | `issuetype = {id} AND id > {n} ORDER BY id ASC` paginates stably while issues are being edited | 02 |
| E3 | An `asApp` JQL count (`search/approximate-count` or paging `search/jql` with `fields=id`) for "KPIs still to migrate" sees issues the admin can't browse | 02 |

## Implementation steps

### Step 1 — Fields (A1–A9)

- Add a throwaway Forge-owned field to the dev manifest **on the branch only**, deploy dev and
  staging, and check A1 and A7. Then create a pair of admin-style fields over REST for A2–A6, A8 and
  A9 (A9 uses a temporary trigger module that only logs).
- **Verify:** every A item has a finding with the exact request and response shape used.

### Step 2 — Screens, schemes, spaces (B1–B6)

- Use a `SPIKE` company-managed project, a `SPIKETM` team-managed project and the second (non-admin)
  user.
- **Verify:** every B item has a finding. B4 has a clear "space admin can / needs a Jira admin" answer
  for each action.

### Step 3 — Search and ids (C1–C4, D1–D4)

- Move one throwaway KPI between `SPIKE` projects for D1. Deploy the extra index path for D2–D4.
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

## Findings

_To be filled in during this stage._

## Clean-up

_What was created during the spikes and what happened to it._

## Questions

1. **Second user.** Is there an existing non-admin test account on `bitovi-training` we can use for
   B4, or should one be created?
2. **Team-managed project.** OK to create (and delete) a team-managed `SPIKETM` project on
   `bitovi-training`?
3. **Staging install.** A1 needs the throwaway field deployed to staging as well as dev, to see two
   environments side by side. OK to deploy a branch build to staging briefly, or should A1 use a
   different second environment (e.g. a personal `forge environments create`)?
