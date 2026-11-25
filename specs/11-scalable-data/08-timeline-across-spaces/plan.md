# 08 — Timeline and Add KPI across spaces

Part of [11 — Scalable KPI data](../plan.md). Status: **Done (live check pending)** (Steps 3–5 implemented 2026-11-25; G4 decided by the implementer, pending Justin's review) · Depends on: 06.

## Problem

After 06, the Timeline loads every KPI the user can browse, from every space, as one tree. With many
teams that's:

- **too much to look at**: there's no way to narrow it to the spaces you care about;
- **possibly too much to load**: spec 06's performance work assumed one team-sized space;
- **unclear where a new KPI goes**: **Add KPI** used to create in the one KPI project. Now it could be
  the central space, the space you're working in, or any space with the KPI type where you may create
  issues. And there may be no central space at all (04 Q5).

## Direction (decided 2026-11-21; details pending the G4 prototype)

**One Timeline, with a scope** (decided 2026-11-21, after comparing a tree-first design and space
pages against today's Timeline). Today's unified Timeline (every KPI on one time axis, with values,
projections, targets and click-to-record / click-to-add-target) is the page's value, so its rows stay
as they are. What changes is **how much of it you see**: a KPI space filter, defaulting to **all KPIs**.
A per-space page (`jira:projectPage`) comes **later**, as this same page with the KPI space preset (see
*Later: space pages*). Prototype: [timeline-scope.html](./timeline-scope.html).

- **Rows as today**: name and unit/direction on the left; recorded values, projected trend, target
  markers and the Undated lane on the shared quarter axis.
- **"KPI space" filter** (decided): picking spaces shows **their KPIs plus their ancestors**, so a
  product's KPIs always read from the global KPIs down. Ancestors outside the filter are **compact,
  faded rows with no track** (one 32px line: name and space), not full timeline rows, so context
  doesn't take the screen (decided; overview R19). Only the path up is shown, no unrelated siblings. A
  KPI whose parent KPI is in a space the user can't browse is top-level (overview Q8, 06). The list is
  searchable ("Find a space…", 07's pattern) and built from the loaded KPIs' spaces (no extra request:
  the page loads every KPI the user can browse, overview Q5). **Default: all KPIs** (decided for now).
  Readings load only for full rows in scope, so a narrow scope is cheap.
- **"Work from" filter** (decided): today's project filter (the projects of the work items that set
  targets) stays, renamed so the two aren't confused.
- **Add KPI asks which space**, offering spaces where the KPI type is available and the user has
  Create Issues (`GET /project/search?action=create&expand=issueTypes`, one request when the form
  opens, 01 B6). **The user picks the space** (decided 2026-11-22). It's filled in only when there's no
  choice to make: the user can create KPIs in just one space, or every KPI is in one space (today's
  installs). Not the central space, the filter, or the parent's space: a guess there puts KPIs in the
  wrong space. As in Jira, "Choose a space." shows only if Create is pressed without one. **Add child
  KPI** (the **+** on any row, including an ancestor) fills in the parent, and the space the same way.
  That's how a product ladders a KPI under a portfolio KPI: **+** on the portfolio KPI, pick the
  product's space.
- Each row shows its space (a key badge) when the tree spans more than one space.
- **The filters are remembered in the browser** (`localStorage`, decided 2026-11-22). If the browser
  doesn't keep it (Custom UI runs in a third-party iframe, where storage can be partitioned or
  cleared), the page simply opens on all KPIs.
- **Row actions follow Plans** (measured on bitovi-training, 2026-11-21): on row hover, two 32×32 subtle
  buttons at the right end of the KPI cell: **Create child KPI** (+) and **More actions** (…: *Edit name,
  unit, direction* · *Move under another KPI…* · *Open in Jira*). Transparent, `#0515240F` on
  hover, `#505258` icons, 6px radius, 40px rows, Atlaskit's add / show-more-horizontal glyphs, and an
  accessible name per KPI ("Create child KPI for CHK-301"). Recording a value stays as today: click the
  row's track. Plans also has a "Create a sibling work item below" strip on each row's top edge; not
  prototyped.
- **Permissions are checked when an action is used** (decided 2026-11-24, overview Q10; 06
  *Permissions*). The load makes no permission lookup. The first **+**, **…** or track click on a KPI
  fetches its space's access (a short busy state), remembered for that space for the page session. A
  refused action shows its reason, naming the space, instead of opening; the **…** menu's items show
  disabled with reasons. The Add KPI button is always enabled; its dialog lists only spaces the user
  can create KPIs in.
- **Add KPI looks like Jira's create dialog** (the modernised "Create New Work Item", measured on
  bitovi-training, 2026-11-21): 800px wide, 12px radius, near the top of the page. In the header, a
  **Space** chip (16px avatar + key; a searchable list of the spaces you can create KPIs in) and a fixed
  **Type: KPI** chip with the target icon, split by a thin divider; Close on the right. The body leads
  with the **KPI name** as a large borderless summary (20px, weight 653), then Unit, Direction (higher /
  lower is better), **Parent** and a description, labels above fields as in Jira. **Parent** works like
  Jira's: a collapsed "Parent" row until clicked (or pre-filled from a row's **+**), then a type-to-search
  select whose options are two lines (`{space avatar} {KPI icon} {key}` / name), clearable for a
  top-level KPI. Any KPI in any space can be the parent. The footer has **Create another** and **Create**, plus a
  message only when Create is disabled (no space chosen, or none you can create in). After creating, a Jira-style **flag**
  confirms it; if the KPI space filter hides the new KPI, the flag says so and offers **Show it**.

The org shape this has to serve (Justin, 2026-11-21):

| Level | Example spaces | Work types | Their KPIs sit under… |
|---|---|---|---|
| Global KPIs (central space) | `KPI` | (KPIs only) | nothing: the org's top tree, e.g. Profit → Revenue · Expenses · Opportunity Enablement |
| Portfolio | Digital Commerce, Enterprise Platform | Outcome → Theme | global KPIs |
| Product (several per portfolio) | Checkout, Mobile App | Initiative | portfolio KPIs |
| Delivery team | Payments | Epic → Story | rarely their own; their work **targets** product KPIs |

**Timeline rows show no key for KPIs (2026-11-21)**: a KPI row is `{KPI icon} {name}`, and the **name is
the link** to the KPI in Jira (dark text, underlined on hover, like summary links in Jira's List view).
**Pickers keep keys** (decided 2026-11-24, overview Q7): the Add KPI dialog's **Parent** options are
`{space avatar} {KPI icon} {key}` / name, and the created-KPI flag names the new KPI by key and name, as
Jira's own create flag does. Typing a whole key in the Parent search looks it up directly (07's
`lookupKpiRef`), since `summary ~` doesn't match keys. Work items keep their keys everywhere.

**Carry over from 07's picker review (2026-11-20)**: work items as `{type icon} {key} {summary}` in Plans
style (icon-only types with tooltips, 24px indents, no connector lines); the KPI type's **target** icon;
the central space shown as **"Global KPIs"**. Open overview review note for this stage: R4 (readings
paging). R3 (searching only the shown KPIs' targets) and R16 (the silent 5,000-KPI cap) are deferred
(overview Q5, Q6): the page shows every KPI, and the customer stays under 5,000 for at least a year.

### Later: space pages

Explored on 2026-11-21 and **deferred**: [space-pages.html](./space-pages.html) prototypes a
`jira:projectPage` per space (context rows, path bands, or child spaces beneath; a team page of "KPIs
your work targets"). Spike 01 F1 showed the page knows its space (and a board) from the Forge context,
so it can be this Timeline with the KPI space filter preset. The spike module was removed again; its
findings are in 01. Paging the all-KPIs page comes with it (overview Q5, Q6), along with searching only
the shown KPIs' targets (R3).

## Implementation steps

### Step 1 — Build the prototype (built; one addition before G4)

- [timeline-scope.html](./timeline-scope.html): today's Timeline rows with the KPI space scope, ancestor
  rows (compact or full, switchable), remembered filters, Plans-style row actions and the Jira-style
  Add KPI dialog. Supersedes [timeline-spaces.html](./timeline-spaces.html), a tree-first
  version whose row actions, dialog and key-less row names carried over; its expand-a-row chart,
  timeline-toggle column and tree-only list were dropped. That earlier prototype used
  the global → portfolio → product → team data above. Scenarios:
  - KPIs in 1 space (today) vs. 7 spaces;
  - KPI space filter: none, one, several; ancestors kept as context; "Work from" next to it;
  - rows as today: values, targets, trajectories, projection; a KPI with no readings;
  - Add KPI with a central space, without one, and from a user who can create in only one space;
  - Add child KPI (+) on a context row while filtered to one space;
  - a user who can browse no KPIs at all.
- **Before G4**, add a refused row action (a KPI in a space where the user can't edit), showing the
  lazy check's busy and refused states (overview Q10). *(Done 2026-11-24: the Parent field, the picked
  parent and the created-KPI flag show the KPI's key, overview Q7.)*
- **Verify:** every scenario works in the browser; nothing talks to Jira.

### Step 2 — 🔍 Gate G4: prototype review (decided by the implementer; see *Questions*)

- **Stop. Ask Justin to review** the prototype. Iterate on it until it's agreed.
- Write the decisions into *Questions*, then **write *Design* and rewrite Steps 3–6** before writing
  any code.

### Step 3 — Backend: readings for the KPIs in scope, spaces for Add KPI

- The Timeline load returns every KPI the user can browse (names, links, units, spaces) and their
  targets, as today, with **no** permission lookup (06), and readings **only for the KPIs shown as
  full rows** (the scope's KPIs; ancestor context rows need none). Targets are still found with one
  `kpiIssueIds IS NOT EMPTY` search (03; R3 deferred). With the default scope (all KPIs) that's every
  KPI, so readings must page past R4's 1,000-issue and 1,000-history cap. A `getKpiCreateSpaces`
  resolver for the Add KPI form.
- **Verify:** request-log tests (as in
  [timelinePerf.test.ts](../../../app/src/backend/timelinePerf.test.ts)) on the multi-space fixture: a
  one-space scope fetches readings for that space's KPIs only; all KPIs past 1,000 pages instead of
  cutting off; no `mypermissions` request on load; a space without Create Issues isn't offered; a
  project without the KPI type isn't offered; the central space isn't preselected (only a single
  possible space is).

### Step 4 — UI: KPI space filter and compact ancestor rows

- The KPI space filter (searchable, next to Work from) and compact, faded ancestor rows, in the
  existing [Timeline](../../../app/src/ui/surfaces/Timeline/Timeline.tsx). Plans-style row actions
  (+ / …) on 06's lazy access cache. Modlets with stories and tests.
- **Verify:** in the harness, light and dark, clean console: matches the reviewed prototype; ancestors
  kept as compact rows; all KPIs by default; Work from still narrows targets as today; a row action on a
  KPI in a space without Edit shows the busy, then the refused state, and a second KPI in that space
  reuses the cached answer.

### Step 5 — UI: Add KPI space choice

- The Space chip in the Add KPI dialog: filled in only when there's one possible space; otherwise the
  user picks.
- **Verify:** in the harness: no space filled in with KPIs in several spaces; filled in when the user
  can create in one space only, or all KPIs are in one space; Create without a space says "Choose a
  space." and doesn't save; creating in a second space puts the KPI under the right space.

### Step 6 — Live check (dev)

- **Verify** on `bitovi-training`: with KPIs in the central space and a hand-enabled second space, the
  Space filter shows both; adding a KPI in the second space works, and it shows its unit and direction
  in Jira (05); a user with Create Issues in only one space is offered only that one.

## Questions

_To be answered at gate G4._

1. ~~**Ancestor rows** outside the KPI space filter: compact or full?~~ **Decided: compact** (one short,
   faded line, no track), as *Direction* says. The prototype's *Ancestor rows* switch can be removed
   at G4.

### Decided at G4 (2026-11-24, implementer, autopilot; revisit at review)

- Justin asked the implementer to continue without stopping at the gates. **The design is
  [timeline-scope.html](./timeline-scope.html) as it stands, with *Direction* above as the written
  design**; Steps 3–6 stand as written. The prototype's *Ancestor rows* switch is dropped (compact only).
- The refused row-action state isn't added to the prototype first; it's built directly from 06
  *Permissions* (busy, then the refused reason naming the space; **…** items disabled with reasons), and
  Justin reviews it in the harness.
- Plans' "Create a sibling work item below" strip stays out.

### Decided (2026-11-24)

- The page keeps showing every KPI by default; paging and space pages come later (overview Q5, Q6).
- Timeline KPI rows have no key; pickers (Parent) and the created flag show keys (overview Q7).
- A KPI whose parent KPI the user can't browse is top-level (overview Q8).
- Permissions are looked up when a row action is used, not on load (overview Q10).

### Decided (2026-11-21)

- Focus on the one tree page; space pages come later, as a preset of it.
- The KPI space filter shows the chosen spaces' KPIs **plus faded ancestors** (not highlight-only, not
  child spaces beneath).
- Today's project filter stays, as **"Work from"**, next to **"KPI space"**.
- Keep today's Timeline rows; scope them with the KPI space filter (default: all KPIs). Space pages are
  the same page with the scope preset, later.
- The `jira:projectPage` spike is removed (module, page and board scopes); findings stay in 01.
- (2026-11-22) Filters remembered in `localStorage`. **No space pages now.** Add KPI never defaults to
  the central space; the user picks unless there's only one possible space.

## Implementation notes

Done 2026-11-25 on `feat/11-scalable-data`, Steps 3–5. Step 6 (live check on dev) is pending.

**Resolvers and payloads**

| Resolver | Payload | Returns | Jira (as the user) |
|---|---|---|---|
| `getTimelineSkeleton` | `TimelineSkeletonInput { readingSpaces?: string[] }` (the remembered KPI space filter; none = all) | `TimelineData`: every KPI the user can browse (as 06), `kpiTypeIconUrl`, and readings only for KPIs in `readingSpaces`; the others `readingsPending: true` with `readings: []` | as 06 (`/field`, config, one `[issuetype]` search, **no** `mypermissions`) + the bulk changelog of the in-scope KPIs only, paged (below) + one icon fetch for the KPI type (in parallel with the readings) |
| `getTimelineReadings` (new) | `GetTimelineReadingsInput { kpiIds }` (≤ 5,000 issue ids) | `TimelineReadingsData { readings: Record<kpiId, TimelineReadingDto[]> }` (a KPI Jira left out has no entry) | the paged bulk changelog of those ids |
| `getKpiCreateSpaces` (new) | `GetKpiCreateSpacesInput { kpiSpaceKeys? }` (the page's KPI spaces) | `KpiCreateSpaces { spaces: KpiSpaceRef[], preselect: projectId \| null }` | one `GET /project/search?action=create&expand=issueTypes&orderBy=name&maxResults=100` (paged past 100; dev needs one), keeping projects whose work types include the KPI type id; throws `KPI_WORK_TYPE_NOT_SET_UP` without a work type |
| `getTimelineTargets`, `getTimelineData` | unchanged | unchanged (`getTimelineData` still reads every KPI's readings) | unchanged |

- **R4 (resolved):** `fetchReadingChangelog` splits ids into batches of 1,000 (`CHANGELOG_BULK_ISSUES`), runs the
  batches together, and pages each by `nextPageToken` (`maxResults` 1,000, `CHANGELOG_BULK_PAGE`; runaway guard 100
  pages a batch). An issue's histories may span pages, so they're appended, not overwritten.
- **Preselect rule** (`kpiCreateSpacePreselect`, domain, shared by the resolver and stories): the one space the
  user can create KPIs in; else, when every KPI on the page is in one space and the user can create there, that
  space; else none. Never the central space, the filter or the parent's space just because.
- The client's skeleton request reads the remembered filter itself (`browserTimelineFilters`), so the first load
  already fetches only the in-scope readings. When a KPI becomes a full row without readings
  (`readingsPending`), the Timeline calls `loadReadings(ids)`; each KPI is asked for once; a failure shows a
  "Couldn't load values" banner with Retry.

**Files**

- Domain: `contracts.ts` (`TimelineNodeDto.readingsPending`, `TimelineData.kpiTypeIconUrl`, `TimelineSkeletonInput`,
  `GetTimelineReadingsInput`, `TimelineReadingsData`, `GetKpiCreateSpacesInput`, `KpiCreateSpaces`);
  `resolve/kpiSpaces.ts` (`kpiSpaceKeyOf`, `kpiCreateSpacePreselect`, `TimelineScope`, `scopeTimeline`,
  `fullRowKpiIds`, `scopeShowsKpi`; **removed** 06's temporary `defaultKpiCreateSpace`); `resolve/timelineLoad.ts`
  (`applyLoadedReadings`). Tests for each.
- Backend: `jira.ts` (paged `fetchReadingChangelog`, `listKpiCreateSpaces`), `resolver.ts` (skeleton scope,
  `getTimelineReadings`, `getKpiCreateSpaces`), `testing/scaleFixture.ts` (bulkfetch refuses > 1,000 ids and pages
  1,000 histories by `nextPageToken`; `project/search?action=create` keeps projects with Create Issues;
  `orderBy=name`), new `timelineScope.test.ts`, `timelinePerf.test.ts` (Phase 1 budget +1 icon fetch; the full
  build's icon count 1 → 2; digest unchanged with `kpiTypeIconUrl` left out).
- UI data: `useTimelineData` (`createKpi` resolves with the `CreatedKpi`; `loadReadings`, `readingsError`,
  `retryReadings`, `getKpiCreateSpaces`, `lookupKpiRef`; skeleton payload), `timelineView` (`loadedReadings`
  overlay, applied first), new `timelineFilters.ts` (`TimelineFilterStore`: `browserTimelineFilters`
  (localStorage key `kpi-timeline:filters`, fail-safe), `noTimelineFilters`, `memoryTimelineFilters`) + tests.
- UI surface: `Timeline.tsx` (KPI space + Work from filters, scoped tree with compact context rows, space badges,
  `{KPI icon} {name}` rows, Plans-style row actions, Add KPI dialog, created flag, Edit/Move dialogs, readings
  banner; `?projects=` URL state and `ProjectFilterControl`, the ✎/+/●/◇ glyph buttons, `CreateKpiModal` /
  `KpiParentSelect` removed), `Timeline.stories.tsx` (rewritten for track clicks and the … menu; new 08 scenarios).
- New modlets under `surfaces/Timeline/components/` (each with stories, light and dark, and a runner):
  `ScopeFilter` (searchable checkbox list, "Show all"), `RowActions` (+ and … at 32×32 / 28×28 on context rows,
  busy state, disabled items with reasons, menu in a body portal), `ParentField` (Jira's Parent field: collapsed
  row → combobox, two-line `{space} {KPI icon} {key}` / name options, clear, whole key/id/URL → `lookupKpiRef`),
  `AddKpiDialog` (+ `kpiSpaceName`: the central space reads "Global KPIs"), `CreatedFlag`,
  `ActionErrorBanner` (moved out of `Timeline.tsx`, with `SETUP_ERRORS`).
- Harness: `mock-resolvers.ts` (`getTimelineSkeleton(readingSpaces)`, `getTimelineReadings`,
  `getKpiCreateSpaces`, `kpiTypeIconUrl`), `mock-bridge.ts` (the two new resolvers; `?readingsDelayMs=` (default
  300); create spaces follow `?access=`: `none`/`readonly` offer none, `split` only KPI).

**Decisions and deviations**

- **Scope rule with both filters:** Work from narrows first, exactly as before (a KPI stays when it or a
  descendant has a matching target, its own markers narrowed); then the KPI space filter keeps the chosen spaces'
  KPIs as full rows and their ancestors outside the filter as context. The prototype made an in-space KPI kept
  only for a descendant's match a compact row; here it stays a full row, so Work from behaves as today.
- **A remembered space with no loaded KPIs is ignored** (the page doesn't open empty); Work from isn't intersected
  (as today, it waits for the targets).
- **Row actions:** the old ✎ / + / ● / ◇ buttons are gone (the prototype has only + and …). Recording and adding a
  target are track clicks (past / future date), as the tip says; editing a value is a click on its dot. Keyboard
  users lose the direct record / add-target buttons; worth a look at review (e.g. "Record a value…" in the … menu).
- **Access:** the … button looks up the KPI's space access (busy: pulsing, "Checking your permissions…"), then
  opens the menu with *Edit* (Edit Issues) and *Move* (Link Issues) disabled with the reason naming the space;
  the same space reuses the cache. A track click is guarded as in 06 (busy, then the refusal banner). **+ opens
  the dialog without a lookup** (the child's space isn't known yet); **Create** then checks the chosen space
  (Create Issues, and Link Issues with a parent) through the same cache, showing the refusal in the dialog footer.
  Add KPI's list already holds only spaces with Create Issues.
- **Add KPI dialog:** Direction offers the prototype's two choices (Higher / Lower is better; editing keeps "No
  direction"); there's **no description field** (`createKpi` doesn't take one). Create stays enabled except with
  no space available or the spaces failed to load; pressed without a space it says "Choose a space.", without a
  name "Enter a name for the KPI.". Enter in the name creates. Create another keeps space, unit, direction and
  parent, and clears the name.
- **Flag:** "{KEY} {name} created", "In {space} ({KEY}).", and when the filters hide it "It's hidden by the
  filters." with **Show it** (adds its space to the KPI space filter, clears Work from). It stays until dismissed.
- **Edit and Move** are two dialogs from the … menu (the old Edit dialog split): *Edit name, unit, direction*,
  and *Move under another KPI…* with the Parent field (any space, keys, without the KPI's own subtree).
- **KPI row names** are dark text, underlined on hover (spec text; the prototype draws them blue). The KPI type's
  real icon comes with the skeleton (`kpiTypeIconUrl`, one extra icon request in Phase 1).
- Spaces in the filter and the dialog show the SpaceKey chip instead of a project avatar (the app has no avatars).

**Verification:** 903 unit tests (was 882) and 320 story tests (was 265) pass, story tests run twice; `typecheck`
and `lint` clean. Harness (`?surface=timeline`, light and dark, 1400px): all KPIs by default with space badges; KPI
space filter to Operations shows Revenue and # of Orders as compact context rows; the filter is remembered across
a reload and opens with only those readings loaded, adding Finance shows "Loading values…" then the values; + on
# of Orders opens Add KPI with the parent filled and no space; creating in Finance shows the flag with Show it;
`?access=split&accessDelayMs=800`: … on OPS-2 is busy, then Edit/Move disabled naming Operations, OPS-3's menu
opens at once; a past-date click on FIN-1 is busy, then refused naming Finance. Console: only the harness's
missing favicon and Atlaskit modal-dialog's existing `defaultProps` dev warning (also on the existing Record dialog).

**Live check (Step 6) should verify** on bitovi-training (dev; no manifest change, so `forge deploy` alone; KPIs in
`KPI` (central, 14) and `KPI2` (`KPI2-1` under `KPI-1`)): the Timeline loads with no `mypermissions` (`[perf]`
`getTimelineSkeleton`: `/field`, `[issuetype]`, one bulkfetch, one avatar icon); rows show the KPI type's bullseye
icon, no keys, and `KPI` / `KPI2` badges; KPI space lists "Global KPIs" and KPI2's name; choosing KPI2 shows KPI-1
as a compact context row above KPI2-1, survives a reload, and the reloaded skeleton's bulkfetch holds only
KPI2-1's id (then choosing Global KPIs makes one `getTimelineReadings`); Add KPI makes one
`project/search?action=create` (`getKpiCreateSpaces`) listing KPI and KPI2 (and any spike space still offering the
type), with no space filled in; creating in KPI2 (+ on KPI-1) creates `KPI2-n` under KPI-1 with unit and direction
in Jira's fields (05), and the flag names it; Create without a space says "Choose a space."; the … menu on a KPI
gives Edit/Move/Open in Jira, and Move finds a parent by typing a whole key; a user with Create Issues in only one
space is offered only that one, filled in (deferred with 06's non-admin checks if no such user is handy); Work from
narrows targets as before.

