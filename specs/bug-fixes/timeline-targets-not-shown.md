# Timeline doesn't show targets set on issues

## Symptom
A user set a target value (Revenue = 250, target date 2026-07-31) on an issue
(KPI-1) via the **Issue panel**, but the **KPI Timeline** shows no target diamond
for that KPI — the row's target list stays empty ("No targets set on issues for
this KPI.").

## Current behavior (root cause)
The timeline UI is fully built: `Timeline.tsx` renders a target diamond for every
`TimelineNodeDto.targets[]` entry and lists the contributing issues behind them.
The gap is entirely in the **backend aggregation**.

- Targets are authored on contributing issues and stored as the
  `kpi-assignments` issue **entity property** (`fetchAssignments` /
  `writeAssignments` in [app/src/backend/jira.ts](../../app/src/backend/jira.ts)).
- The timeline is built by `buildTimelineData()` in
  [app/src/backend/resolver.ts](../../app/src/backend/resolver.ts), whose `toNode`
  hard-codes **`targets: []`** with the comment *"Targets (authored on
  contributing issues) are a follow-up; the list + readings render today."*
- So the backend **never gathers** any issue's assignments onto the matching KPI
  timeline row. Only the mock harness bakes targets in (via fixtures), which is
  why it "works" locally but not on the deployed app.

Secondary latent bug found while diagnosing:
- The manifest declares a search index `kpi-assignments → kpiIds`
  (`searchAlias: kpiIds`, [app/manifest.yml](../../app/manifest.yml)) precisely so
  the app can JQL-find which issues target a given KPI. But `writeAssignments`
  only ever stored `{ assignments }` — it **never wrote the `kpiIds` field**, so
  the index was always empty. Even a fully-built discovery step would find
  nothing. **Fixed in this change** (see below).

## The design decision (needs a call before the full fix)
To populate `TimelineNodeDto.targets`, the backend must, for each KPI issue,
discover every contributing issue that set a target for it and turn each into a
`TimelineTargetDto { date, value, status, source:{issue,type,title} }`. Open
questions:

1. **Discovery mechanism**
   - **(A) JQL on the `kpiIds` search index.** Instead of one query *per KPI*
     (`kpiIds = "<kpiId>"` → N queries), use a **single** query for every issue
     with any KPI target — `issue.property[kpi-assignments].kpiIds IS NOT EMPTY` —
     then read each issue's assignments and **group by `kpiId` in memory**. Same
     index, one round-trip + N property reads, no per-KPI fan-out.
     Pros: cheap, scales, one query. Cons: only finds issues **saved after** the
     index is populated (this change) — pre-existing assignments (like KPI-1)
     must be re-saved or backfilled once.
   - (B) Enumerate/read assignments for a known issue set. Not viable
     instance-wide without the index.
   - **Chosen: (A), single `IS NOT EMPTY` query + in-memory grouping.**
     (`kpiIds` is still required either way — JQL can't filter "has KPI data"
     without a declared, populated indexed path.)

2. **Relative target dates on the timeline.** Assignments can use relative timing
   (`anchor + offsetMonths`). `resolveRelativeTargetDate` needs a
   `RelativeTargetContext` (the contributing issue's due, and its parent's due).
   - **(A) Resolve using the contributing issue's own due/parent due** (one
     `fetchIssueMeta` per contributing issue). Simpler, matches what the panel
     shows for that issue. Absolute-dated targets need no lookup.
   - (B) Full `effectiveTiming` subtree rollup per contributing issue. Most
     accurate but many extra Jira calls.
   - **Recommendation: (A)**; skip (pending) any target whose relative anchor
     can't be resolved, exactly like the panel.

3. **Delta targets.** `targetType: 'delta'` stores a *delta*, not an absolute
   value. The timeline diamond plots an absolute y-value. Plot deltas as absolute
   (wrong), skip them, or convert against a baseline?
   - **Recommendation:** v1 renders `targetType: 'absolute'` targets only; skip
     `delta` (document it) until baselines are modeled.

4. **Status classification** uses `targetStatus(target, readings, direction, today)`
   — already pure and available; the timeline node already has `readings`. No
   open question, just wiring.

## What was shipped
**Foundation (first change):**
- `writeAssignments` now writes a denormalized `kpiIds` array alongside
  `assignments`, so the declared search index actually populates. This fixes the
  manifest/code mismatch and is the prerequisite for discovery option (A).
  `AssignmentProperty` gained an optional `kpiIds` field (optional so
  assignments saved before this still parse on read).

**Aggregation (this change):**
- New pure domain helper `buildKpiTargets` (`app/src/domain/resolve/timelineTargets.ts`,
  unit-tested): maps a KPI's contributions → `TimelineTargetDto[]`, resolving
  relative dates (issue/parent own due, option (A)), skipping `delta`/null/
  pending targets, classifying status, sorting chronologically.
- New `fetchTargetContributions()` (`app/src/backend/jira.ts`): one
  `IS NOT EMPTY` JQL query + in-memory grouping (decision above), reading each
  contributing issue's assignments and resolving parents' own due dates.
- `buildTimelineData`/`toNode` (`app/src/backend/resolver.ts`) now fills
  `targets` from the aggregated contributions instead of `[]`.
- **Live-verified:** `npm run test:e2e` now covers `fetchTargetContributions`
  end-to-end against bitovi-training — it writes an assignment, then confirms the
  `kpiIds IS NOT EMPTY` search surfaces that issue with its target. The final
  timeline *rendering* (with parent-due resolution) is still best confirmed via
  `forge tunnel` on a deployed build.

## Note for the user with existing data
KPI-1's target was saved before the index existed, so it won't be discoverable
until the assignment is re-saved (open the Issue panel and Save again) or a
one-time backfill re-writes existing `kpi-assignments` properties.
