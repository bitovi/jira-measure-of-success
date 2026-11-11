# 07 — Issue panel ("KPIs" panel) performance

## Why
The KPIs panel on a work item is the most frequently opened surface, and it is slow to load. It has two very different load paths:

- **Ordinary work item** (an Epic, Story, …): the target cards, the "Set a KPI target" form and its KPI picker.
- **KPI issue** (an issue in the KPI space, Feature 04): the single-KPI chart (`KpiView`).

Both run in one backend call, `getPanelData` → [buildPanelData](../../app/src/backend/resolver.ts). This spec applies the same approach as [06 — Timeline performance](../06-timeline-performance/plan.md): measure, then remove waits and requests in order of impact. It reuses 06's instrumentation ([requestLog.ts](../../app/src/backend/requestLog.ts)) and scale fixture ([scaleFixture.ts](../../app/src/backend/testing/scaleFixture.ts)).

## Status

**Ordinary work items: done** (O1, O2, O3, O4, F1). See "Ordinary work items — what shipped" below. The KPI-issue items (K1, K2) and the bundle split (F2) are not started. The panel performance test (step 1 of the incremental plan) was skipped in favor of measuring on a real site.

### Baseline (measured)
Measured by running the real resolver against the scale fixture (40 KPIs, 2,000 contributing epics, 12,000+ descendants) with a uniform 10 ms mock latency. A **wave** is a group of requests that start together, so the number of waves is the length of the critical path. Real Jira searches cost 100–500 ms each, so waves matter far more than the milliseconds below.

| Panel opened on | Requests | Waves | Mock time |
|---|---|---|---|
| Epic (parent = Initiative with 40 epics) | 24 | **10** | 122 ms |
| Story (parent = Epic) | 13 | 8 | 90 ms |
| KPI issue | **734** | **30** | 370 ms |

### How the ordinary panel is assembled today (Epic case)

| Wave | Requests | Why it waits |
|---|---|---|
| 1 | `GET /issue/{id}` (meta), `GET …/properties/kpi-assignments` (own), `GET /field`, plus KVS reads | – |
| 2 | KPI-space search (catalog) | needs the rank field id from `/field` |
| 3 | changelog bulk fetch (catalog's "current value") | needs the KPI issue ids |
| 4 | parent's `kpi-assignments` | the first `Promise.all` also contains `buildKpiCatalog()`, so the parent id from wave 1 is not used until the catalog finishes |
| 5–8 | rollup walk rooted at the **parent** (`id in` + `parent in` per level: Initiative → Epics → Stories → Subtasks) | waits for wave 4 |
| 9 | KPI-space search **again** | to map KPI keys to ids for readings |
| 10 | changelog bulk fetch **again** | for the assigned KPIs' reading series |

Three things stand out:

1. **Waves 9–10 repeat waves 2–3.** The catalog already read the whole KPI space and every KPI's changelog. The rows' readings can come from the same data.
2. **The parent's targets wait for the catalog** (wave 4), only because they sit after one large `Promise.all`.
3. **The walk is rooted at the parent**, so opening an Epic walks the whole Initiative (281 issues in the fixture, possibly thousands on a real site). The parent's rolled-up due date is used only for targets anchored to `parentDueDate` ([relativeTargetDate.ts](../../app/src/domain/resolve/relativeTargetDate.ts)). The panel's editor only writes `issueDueDate` anchors, so in most cases the issue's own subtree is all that is needed.

### How the KPI-issue panel is assembled today
`buildPanelData` first builds the ordinary panel data (catalog etc.). It then calls `buildTimelineData()`, which builds the **entire** timeline: every KPI, the 20-page contributions search, the icons, and the rollup walk over every contributor. It then picks out one node. `KpiView` only reads that node's name, unit, direction, readings, targets and undated targets.

Recording a value from the KPI panel ([usePanelData](../../app/src/ui/data/usePanelData/usePanelData.ts) `record`) then calls `recordValue` (full timeline rebuild, result thrown away) **and** `getPanelData` (another full rebuild): about 1,470 requests for one reading.

### The frontend
[issue-panel.tsx](../../app/src/ui/entries/issue-panel.tsx) waits for `view.theme.enable()`, mounts React, waits for `view.getContext()` to get the issue id, and only then does `usePanelData`'s effect call `getPanelData`. That is two bridge round trips and a React mount before the backend starts.

The bundle is a single 889 KB chunk (269 KB gzipped). The largest parts:

| Package | Size |
|---|---|
| react-dom | 127 KB |
| `@atlaskit/react-select` | 82 KB |
| zod | 54 KB |
| `@atlaskit/primitives` | 53 KB |
| `@atlaskit/top-layer` | 40 KB |
| `@forge/bridge` | 37 KB |
| `@atlaskit/modal-dialog` | 28 KB |
| `@atlaskit/dropdown-menu` | 23 KB |

## Prioritized improvements (most impact first)

| # | Improvement | Why it ranks here |
|---|---|---|
| 1 | **KPI-issue panel: load only that KPI, in two phases** (§K1) | Today 734 requests and 30 waves. After: about 3 requests and 2 waves for the chart, then the targets for that one KPI. |
| 2 | **Root the rollup walk at the issue, not its parent** (§O1) | Removes the parent's whole subtree from almost every load. Correctness is unchanged, because the parent's date is used only for `parentDueDate` anchors. |
| 3 | **Read the KPI space and readings once** (§O2) | Removes 2 requests and the last 2 waves, which today run strictly after the walk. |
| 4 | **Start each request as soon as its input is known** (§O3) | The walk can start at t=0 (the issue id is known), and the parent's targets right after meta, instead of after the catalog. |
| 5 | **Start the request before React mounts** (§F1) | Removes two bridge round trips and the mount from the critical path. Same as 06 P7's `prefetchTimeline`. |
| 6 | **Stop the double rebuild when recording from the KPI panel** (§K2) | About 1,470 requests per recorded value, down to a handful. |
| 7 | **Benefit from 06's walk work** (06 P2 + P6) | Config pruning and meta folded into the children query halve the walk's requests. No panel-specific work once 06 step 4 ships. |
| 8 | **Smaller first bundle** (§F2) | Lazy-load whichever of `KpiView` / the editor the issue doesn't need. A real but small gain next to the backend waves. |
| 9 | **Progressive panel** (§O4) | Only if the walk is still slow after #2 and #7. |

## O1. Root the rollup walk at the issue, not its parent

**Today:** `fetchSubtreeTimingNodes(parentId ?? issueId)`. The issue's due date and the parent's due date both resolve from one walk over the parent's subtree.

**Change:** walk the issue's own subtree. Walk the parent's subtree only when one of the issue's own targets has a `parentDueDate` anchor. The shared traversal (`fetchSubtreeTimingNodesForRoots`) should accept the nodes already loaded, so adding the parent as a root does not re-fetch the issue's subtree.

Notes:

- `onParentNotTracked` rows have no assignment and no dates, and `sharedWithParent` rows use the issue's own assignment, so neither needs the parent's date.
- The "Set a KPI target" preview ([previewRow](../../app/src/ui/surfaces/IssuePanel/targetText.ts)) uses only `issueDueDate`.
- Saving a target with a `parentDueDate` anchor (none of today's UI does) still works. The save returns `buildPanelData`, which then sees the anchor and walks the parent.

**Verify:** at the scale fixture, opening an Epic makes no `id in` / `parent in` request for the Initiative or the sibling epics. A fixture issue with a `parentDueDate` target still shows the same resolved date as today (same `PanelData`).

## O2. Read the KPI space and readings once

**Today:** `buildKpiCatalog` reads the KPI space and the changelog of every KPI. `buildPanelData` then reads the KPI space again and the changelog of the assigned KPIs.

**Change:** load the KPI space and its changelog once, for example with a `loadKpiSpace()` that returns the issues, the key → id map and the changelog. Build the catalog from it, and take the rows' reading series from the same changelog. Also read `readKpiSpaceConfig` once (today it is read twice).

**Verify:** the request log shows one `[project]` search and one changelog call per panel load, and `PanelData` is unchanged.

## O3. Start each request as soon as its input is known

**Today:** one `Promise.all` of meta, own targets, catalog and config, then the parent's targets, then the walk, then readings.

**Change:**

- **Walk from t=0.** The issue id is known at the start, so the walk's first level (`id in (issue)` and `parent in (issue)`) starts with everything else. Ask that `id in` search for `properties=kpi-assignments` as well. It then returns the issue's meta **and** its targets, which replaces both `fetchIssueMeta` and the separate `fetchAssignments` (the same "property in the search" move as 06 P1).
- **Parent's targets right after meta,** in parallel with the rest of the walk and the catalog.
- **Catalog in parallel** with all of it. Only the final row assembly waits for everything.

With O1 and O2, the Epic case should go from 10 waves to about 4, and from 24 requests to about 12:

| Wave | Requests |
|---|---|
| 1 | walk level 1 (which also returns the issue's meta and targets), `/field`, KVS reads |
| 2 | KPI-space search, the parent's targets, walk level 2 |
| 3 | changelog, walk level 3 |
| 4 | the walk's final (empty) level |

**Verify:** in the request log, the walk's first level, `/field` and the config reads start at the same time, and the parent's `kpi-assignments` request starts before the KPI-space search finishes.

## O4. Progressive panel (only if still needed)

Like 06 P4. Return the rows first (targets, catalog, readings, absolute dates), then the rolled-up due date and the relative target dates. Rows with a relative date would show the existing shimmer until Phase 2 arrives.

Decide after re-measuring O1–O3 and 06 step 4 on a real site. Once O1 is in, most issues have a shallow subtree, so this may not be worth the extra resolver and client state.

## K1. KPI-issue panel: load only that KPI, in two phases

This is 06 P5's per-KPI path (`buildKpiNode`). Apply it to the panel first, because the panel is where the full rebuild hurts most.

**Detect the KPI case without the catalog.** The issue's key (from the first request) and the KPI-space key (from KVS) are enough. Branch before loading the catalog, the assignments or the walk. `KpiView` uses none of them.

**Phase 1 — the chart** (new resolver, for example `getKpiViewSkeleton`):

- One `GET /issue/{id}?fields=summary&properties=kpi-meta`.
- One changelog bulk fetch for that issue. It needs the reading field id from `/field`, which can start at t=0.
- Returns the node with its readings and `resolving: true`.

That is 3 requests in 2 waves, against 734 requests in 30 waves today.

**Phase 2 — that KPI's targets** (`getKpiViewTargets`): search only the issues that target this KPI, walk only their roots, inline their icons, and return the raw contributions. The client merges them with the same `applyTargetContributions` the timeline uses, so the KPI view and the timeline cannot disagree.

**The per-KPI search needs a spike** (06 Question 8). The `kpiIds` index in [manifest.yml](../../app/manifest.yml) has `type: text`, and text-indexed entity properties support `~` (contains), not `=`. Options:

- `issue.property[kpi-assignments].kpiIds ~ "KPI-1"`, then keep only assignments whose `kpiId` is exactly `KPI-1`. Over-matching (for example `KPI-10`) only costs a few extra results.
- Change the index type to `string` so `kpiIds = "KPI-1"` is exact. This needs confirming that Jira re-indexes existing properties after the manifest change.

**Client:** `usePanelData` gets the same two-phase handling as `useTimelineData`: show the chart with the shimmer, merge the targets, and if Phase 2 fails keep the chart and show a retry. `KpiView` already renders from a `TimelineNodeDto`.

**Verify:**

- Node equality: the merged Phase 1 + Phase 2 node deep-equals that KPI's node from `buildTimelineData` (same fixture). Same style of test as 06 step 2's byte-identical check.
- The request log for the KPI panel has no `[project]` search, and no `[kpi-assignments index]` search other than the one for this KPI. The walk is proportional to that KPI's contributors (50 epics in the fixture, not 2,000).

## K2. Stop the double rebuild when recording from the KPI panel

**Today:** `record` calls `recordValue` (returns a full `TimelineData`, which is discarded) and then `getPanelData` (another full rebuild).

**Change:** `recordValue` returns only that KPI's readings. 06 P5 already chose this as its slim return shape. The KPI panel replaces the node's readings and re-runs `applyTargetContributions` for that KPI with the targets it already has. Recording a reading does not change any target's source issue, so the targets don't need to be reloaded.

**Verify:** the request log for a record from the KPI panel shows the write, then one changelog fetch for that KPI, and nothing else.

## F1. Start the request before React mounts

**Today:** `theme.enable()` → mount → `view.getContext()` → effect → `getPanelData`.

**Change:**

- The resolver reads the issue id from the invocation context (`context.extension.issue.id`, which Forge provides for `jira:issuePanel`) when the payload has none. This also means the panel's reads no longer depend on an issue id sent by the client.
- The entry calls a `prefetchPanel()` at module load, alongside `theme.enable()`, like `prefetchTimeline()` in [timeline.tsx](../../app/src/ui/entries/timeline.tsx). `usePanelData` uses the prefetched promise on first mount, as `useTimelineData` does.
- The harness keeps passing `issueId` in the payload, so the mock bridge does not change.

**Verify:** in a real browser on the dev site, the `getPanelData` invoke starts before the first React render. Check this in the Network panel or with a `performance.mark`.

## F2. Smaller first bundle

- `React.lazy` the `KpiView` branch (chart, modals, tooltip), so ordinary issues don't download or parse it. On a KPI issue the editor half (Select, TargetEditor, TargetCard, dropdown menu, inline edit) is never shown, so split that too.
- Check whether the client needs zod (54 KB), or whether the UI only imports types and a few pure helpers through `@domain`.

Do this after the backend items. It saves roughly tens of milliseconds of download and parse time. Each backend wave costs hundreds of milliseconds.

**Verify:** `vite build` for `issue-panel` produces separate chunks, and the entry chunk shrinks. Measure with `source-map-explorer`, as in the baseline.

## Mutations on the ordinary panel
`saveAssignment` and `removeAssignment` return `buildPanelData`, so they get O1–O3 for free. No further change is planned. The client already shows a "saving…" line.

## Instrumentation and test harness
Reuse 06's request log and scale fixture.

- Add a `GET /rest/api/3/issue/{id}` handler (fields and `properties`) to the mock Jira, so it can serve `fetchIssueMeta`. Today that request is unhandled.
- Add stages to `buildPanelData` (`meta`, `catalog`, `parentTargets`, `rollupWalk`, `readings`), so the `[perf]` line shows the critical path.
- Add a `panelPerf.test.ts` like [timelinePerf.test.ts](../../app/src/backend/timelinePerf.test.ts), with request budgets and a `PanelData` fingerprint for three cases: an Epic under an Initiative, a Story under an Epic, and a KPI issue.

| Scenario | Today | Target |
|---|---|---|
| Epic panel: requests / waves | 24 / 10 | ~12 / ~4 |
| Epic panel: walk requests for the parent's subtree | all of it | 0 (unless a `parentDueDate` target) |
| `[project]` searches + changelog calls per load | 2 + 2 | 1 + 1 |
| KPI panel: requests | 734 | ~3 (Phase 1) + that KPI's targets |
| Record from the KPI panel | ~1,470 | write + 1 changelog |

## Incremental plan
Each step is independently shippable and checked before the next. Each step also runs the project's tests, lint and build.

1. **Instrument and fixture.** Add the mock `GET /issue/{id}`, the `buildPanelData` stages, and `panelPerf.test.ts` with today's budgets and fingerprints. *Check:* it reproduces the Baseline table.
2. **O2 + O3 — read once, start early.** *Check:* fingerprints unchanged; one `[project]` search and one changelog call; the walk's first level starts at t=0.
3. **O1 — walk the issue's subtree.** *Check:* fingerprints unchanged (the fixture has `parentDueDate` targets, so both branches are covered); no parent-subtree requests for issues without that anchor.
4. **F1 — prefetch and the context issue id.** *Check:* on the dev site, the invoke starts before the first render.
5. **K1 + K2 — per-KPI panel**, after the `kpiIds` spike. *Check:* the node-equality test, the KPI-panel and record request budgets, and a story with a delayed Phase 2 showing the chart with the shimmer.
6. **F2 — lazy chunks.** *Check:* separate chunks and a smaller entry chunk.
7. **Re-measure** at the scale fixture and on a real site with `forge tunnel`. Then decide on O4.

06 step 4 (P2 + P6) is independent. Whenever it lands, the panel's walk gets cheaper with no extra work here.

## Ordinary work items — what shipped

The panel now loads in two phases, started together, and shows the list after Phase 1.

| | Phase 1 — `getPanelList` | Phase 2 — `getPanelValues` |
|---|---|---|
| Loads | The issue with its targets (one GET with `properties=kpi-assignments`), the parent's targets, the KPI-space search | The rollup walk of the issue's own subtree, the KPI-space search and changelog (every KPI's readings), and the parent's subtree only for `parentDueDate` targets |
| Returns | `PanelBasis`: targets, parent KPI ids, catalog without current values | `PanelValuesData`: the issue's rolled-up due, the parent's (when needed), readings per KPI, today |
| Shows | Every card's KPI name and bet in its final group, and the working form | The estimate lines, status pills, nudges, current values and the preview dates |

- **One assembly function.** The pure [assemblePanel](../../app/src/domain/resolve/panelLoad.ts) turns basis (+ values) into `PanelData`. The browser uses it to merge Phase 2, and the backend's one-shot `getPanelData` (and `saveAssignment` / `removeAssignment`) runs both phases and merges with it, so the paths can't drift.
- **Client.** [usePanelData](../../app/src/ui/data/usePanelData/usePanelData.ts) starts both phases at once. [derivePanelView](../../app/src/ui/data/usePanelData/panelView.ts) applies the same rules as the timeline: a mutation result always supersedes Phase 2, and a Phase 2 failure keeps the list (shimmer cleared) with a "Couldn't load estimates · Retry" banner. `TargetCard` shows a same-height shimmer in place of the estimate line and the pill while a row is `resolving`, so nothing moves when the values land.
- **Prefetch (F1).** [issue-panel.tsx](../../app/src/ui/entries/issue-panel.tsx) calls `prefetchPanel()` at module load. With no `issueId` in the payload, the resolvers use `context.extension.issue.id`. `[panel] list/values requested/received at …ms` lines in the browser console show the phase timing on a real site.
- **KPI issues are unchanged.** `getPanelList` returns their complete panel (still built from the whole timeline), and the client ignores Phase 2.
- **Harness.** The mock bridge serves both phases. `?valuesDelayMs=4000` slows Phase 2 and `?valuesFail=1` makes it reject.

Tests: [panelLoad.test.ts](../../app/src/domain/resolve/panelLoad.test.ts) (assembly), [panelView.test.ts](../../app/src/ui/data/usePanelData/panelView.test.ts) (view rules), [panel.test.ts](../../app/src/backend/panel.test.ts) (the real resolver on the scale fixture: no walk or readings in Phase 1, no parent walk without a `parentDueDate` target, the same target date as the timeline's rollup, the context fallback, the KPI-issue path), [panelPhases.test.ts](../../app/test-harness/fixtures/panelPhases.test.ts) (the merged phases equal the harness's one-shot panel for every fixture issue), and the `ValuesLoading` / `ValuesFailed` stories.

Differences from the plan above:

- The KPI-space search runs once in each phase (in parallel), not once per load, because the phases are separate resolver calls. It is no longer on the critical path twice in a row.
- Phase 1 doesn't wait for the rollup config: it reads no dates, so it uses the default date fields.

## Questions

1. Is `parentDueDate` still a supported anchor? No UI writes it today. If it is being retired, O1 can drop the parent walk entirely instead of branching on it.
2. For the per-KPI `kpiIds` query, should we use `~` with exact filtering, or change the index to `string`? (Spike in K1; same as 06 Question 8.)
3. 06 says the panel needs the rolled-up `.start` as well as `.due`, but `buildPanelData` reads only `.due` today. Is a start date planned for the panel? If so, the walk's endpoints must include it when 06 P2's pruning lands.
