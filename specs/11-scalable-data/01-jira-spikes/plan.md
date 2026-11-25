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

## Findings

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
