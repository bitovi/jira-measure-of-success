# 09 — Stacked targets (cumulative projections within a hierarchy level)

Status: **Draft** · Scope: changes how a relative target's provisional baseline is projected. Revises
[03 requirements](../03-relative-dates-and-values/requirements.md) §2, FR-9a and Q3.

## Problem

Say a feature ships every quarter, and each one targets **+1%, one month after its due date**. Today
every one of those targets sits at the **same height** in the KPI tree and the issue panel.

That's because a relative target's baseline is the KPI's value at the target's due date. When no
reading covers the due date yet, the baseline is the **last reading, carried flat**
([baseline.ts](../../app/src/domain/resolve/baseline.ts)). Spec 03 chose this on purpose: "other work
items' future targets are ignored" (03 §2, Q3). So the Q3 feature is measured from today's value, not
from the value after the Q1 and Q2 features have landed.

What a plan means is that the improvements **add up**: Q2's +1% lands on top of Q1's.

But this can't simply apply across the hierarchy. An **Outcome** may set +5%, and its **Initiatives**
are the bets that are meant to get there. If the Outcome's goal also stacked under its Initiatives (or
the other way round), the same improvement would be counted twice.

## Rule (decided)

**Targets add up within a hierarchy level, never across levels.**

- A **chain** is all the targets on one KPI whose source issues are at the same Jira
  `issuetype.hierarchyLevel`. That covers every issue type at that level (e.g. Milestone and Increment)
  and the **whole KPI**, whatever their parent.
- A target's baseline is the KPI's value at its due date, as today. Then, **only while that baseline is
  provisional (carried)**, the earlier targets in its chain are stacked on top:
  - Start from the **last reading** (value `v`, date `L`).
  - Take every other target in the chain whose **target date** `T` is resolved and falls in
    **(`L`, due date]**.
  - Apply them in `T` order: a **percent** target multiplies (`v × (1 + p/100)`), an **amount**
    (`relative`) target adds (`v + a`), and an **absolute** target resets (`v = X`).
  - The result is the stacked baseline. The target's own change is applied on top of it, as today
    (`applyTargetChange`).
- **Targets at or before the last reading are skipped.** Their effect should already be in the
  readings, so applying them again would count them twice. (This is also why they don't need to be
  loaded at all; see Step 7.)
- **Measured values win.** When a reading covers the due date (measured or interpolated), the baseline
  is official and nothing is stacked. That's the same moment the `≈` marker disappears today.
- **Other levels are ignored.** An Outcome's +5% is measured from the readings plus earlier Outcomes
  only. It never includes its Initiatives, and they never include it.
- **What's skipped from a chain:**
  - The target itself.
  - Targets with a pending (undated) target date. They can't be placed in time.
- **Undated targets don't stack.** A target whose own due date is pending keeps today's behavior:
  the last reading, carried flat ("assume due today", 03 FR-13), with nothing stacked (Question 3).
  - Targets on a source issue with an unknown level (`hierarchyLevel` is `null`). Such a target doesn't
    stack and isn't stacked on. In practice Jira always sends a level, so this is only a guard against
    missing data.
- **Each KPI is separate.** A chain never crosses KPIs, including parent and child KPIs in the KPI tree.
- **No trend.** Trend extrapolation stays out (03 Q3). The dashed "Projected trend" line is unchanged.

Stacking uses each earlier target's **change**, not its resolved marker value. So the projected path
is simply "the last reading, with every earlier step applied in date order". It doesn't depend on the
other targets' own baselines, and it can't loop.

### Worked example

KPI readings are flat at **1,000**, with the last reading on **Jan 1, 2027**. Initiatives target +1%,
one month after their due date:

| Initiative | Due | Target date | Earlier steps in (Jan 1, due] | Baseline | Target |
|---|---|---|---|---|---|
| A | Mar 31 | Apr 30 | — | 1,000 | 1,010 |
| B | Jun 30 | Jul 31 | A (Apr 30) | 1,010 | 1,020.1 |
| C | Sep 30 | Oct 31 | A, B | 1,020.1 | 1,030.3 |
| D | Dec 31 | Jan 31 '28 | A, B, C | 1,030.3 | 1,040.6 |

Their Outcome targets **+5% by Jan 31, 2028** (due Dec 31). Its chain is Outcomes only, so its
baseline is 1,000 and its target is **1,050**. On the KPI tree you can see that the Initiatives
(ending at 1,040.6) fall short of the Outcome (1,050). That makes the gap visible without summing
anything across levels (01 Q11 still holds).

Once a reading lands after Apr 30, A's real effect is in the readings, A drops out of every chain, and
B, C and D stack on that new reading instead.

## Design

### Domain (pure, shared by every surface)

- **`StackStep`** — one earlier target in a chain, with its date already resolved:
  `{ issueKey, level, date, targetType, change }`, where `level` is `number | null`.
- **`stackedBaselineAt(readings, dueDate, steps)`** (new, next to `baselineAt`). It calls
  `baselineAt`. If the result is `carried`, it applies the steps that fall in (`L`, due date], in date
  order. It returns the baseline plus `stackedFrom`, the steps it applied.
  - For a **pending due date** (`null`), it returns `baselineAt`'s "assume due today" carry
    unchanged (03 FR-13), with no steps applied (Question 3).
- **`resolveRelativeTargetValue`** gets an optional `steps` in its context. With no steps it behaves
  exactly as today. `ResolvedTargetValue` gets `stackedFrom` (empty when nothing was stacked).
- **`resolveStackSteps(contributions)`** (new) resolves each contribution's target date with the same
  `resolveRelativeTargetDate` that markers use, and drops pending dates and unknown levels. Both
  surfaces build their chains with it, so a step's date can't differ between the tree and the panel.
- **Chain selection** happens inside the pure layer (same KPI, same level, not the target itself). The
  "after the last reading" filter is applied there too, because the client adds its own recorded values
  on top (`withEdits`), which can move the last reading.

### KPI tree (Timeline) and KPI View

- [buildKpiTargets](../../app/src/domain/resolve/timelineTargets.ts) already receives **all** of a KPI's
  contributions. It works in two passes: first `resolveStackSteps`, then each target's value with its
  chain. **No new requests.**
- [TargetSourceIssue](../../app/src/domain/resolve/timelineTargets.ts) gets `hierarchyLevel`. The
  backend reads it from `issuetype.hierarchyLevel` in the existing contributions search
  ([fetchTargetContributions](../../app/src/backend/jira.ts)). The field is already requested.
- `TimelineTargetDto` gets `stackedFrom?: { issue, targetType, change, date }[]` for the display.
- KPI View (a KPI issue's panel) uses `buildKpiTargets` too, so it gets stacking for free. That includes
  rebuilding the markers after recording a value.

### Issue panel

The panel only loads its own issue today. To stack, Phase 2
([buildPanelValues](../../app/src/backend/resolver.ts)) needs the same-level targets on the issue's
KPIs, with their target dates.

- **`PanelBasis`** gets the issue's `hierarchyLevel` (from the issue GET it already makes).
- **`PanelValuesData`** gets `steps: Record<kpiId, StackStep[]>`: the same-level, dated targets on each
  of this issue's KPIs, excluding the issue itself.
- **New Phase 2 stage `peerTargets`**:
  1. **Skip the whole stage** when none of the issue's targets is a percent or amount change, or when
     the issue has no known level. Most issues have no targets, so most panel loads cost nothing extra.
  2. Run the existing contributions search ([fetchTargetContributions](../../app/src/backend/jira.ts),
     the whole site, as the timeline does). It starts at t=0, in parallel with the issue's own walk
     and the readings.
  3. Keep the contributions on this issue's baseline-relative KPIs, at the same level, from other
     issues.
  4. **Collect the work items once, across all KPIs.** One issue often targets several of this
     issue's KPIs, and same-level peers usually share parents. Build **one set of roots** from every
     kept contribution: each peer issue, plus its parent when one of its targets anchors to
     `parentDueDate`. Each issue is loaded once, however many targets point at it.
  5. Walk that set in **one** shared
     [fetchSubtreeTimingNodesForRoots](../../app/src/backend/jira.ts) call, **seeded with the nodes
     Phase 2 already has**: the issue's own subtree and, when loaded, its parent's. A peer's parent is
     often this issue's parent, so its subtree includes this issue's subtree. Seeding means those
     nodes aren't fetched again. This needs a new optional `known` map parameter; today the function
     always starts from an empty map.
  6. Resolve each root's rolled-up due date **once**, from the merged node map with **one shared
     `effectiveTiming` memo**. A subtree that appears under several roots is rolled up once. Then
     build every KPI's steps with `resolveStackSteps` from those dates.
- **[assemblePanel](../../app/src/domain/resolve/panelLoad.ts)** passes each row's chain to
  `resolvePanelTarget` → `resolveRelativeTargetValue`. Status, freeze and warnings read the stacked
  value with no other change.
- **Draft preview** (`applyDraft` in the "Set a KPI target" form) uses the loaded steps for that KPI
  when there are any. On a KPI the issue doesn't target yet, it shows the flat value until saved; the
  save response brings the steps (Question 5).
- **Mutations** return `PanelParts`, which include the new `steps`, so a saved target shows its stacked
  value without a reload.

### Display

Stacked values are still estimates, so they keep the `≈` marker and the *Projected* pill. The only
addition is saying where the baseline came from.

- **The estimate line is unchanged**, except that "now" stays the **latest reading**, not the
  stacked baseline: `Estimated target 1,030.3 by Oct 31, 2027 · from 1,000 now`.
- **A "stacked on" line** goes under the estimate line, only when something stacked (Question 7):
  `Stacked on 2 earlier Initiative targets` (singular: `Stacked on 1 earlier Initiative target`).
  - It names the issue type when every stacked target has the same type. When they mix types (e.g.
    Milestone and Increment) it says `Stacked on 2 earlier targets at this level`. So `StackStep`
    carries the step's issue type name (`issueType`).
  - It's its own line, not a `· +2 earlier targets` suffix: the suffix pushed the tooltip to its 400px
    max and wrapped, leaving a dangling `·`.
- **Issue panel** ([TargetCard](../../app/src/ui/surfaces/IssuePanel/components/TargetCard/TargetCard.tsx)):
  the "stacked on" line has a hover listing each step: `INIT-12 +1% on Apr 30, 2027`.
- **KPI tree marker tooltip** ([targetTooltip.tsx](../../app/src/ui/plot/targetTooltip.tsx)): the
  same line, text only (a tooltip can't be hovered). No list: the earlier targets are the markers to
  the left on the same row (Question 4). The line covers the two cases where that isn't obvious:
  - Markers from other levels share the row but aren't in the chain.
  - The project filter can hide a target that still stacks. The filter runs after values are
    computed, so a marker's value doesn't change when you filter.
- **Projection modal:** no change. It only opens from the Undated lane, and undated targets don't
  stack (Question 3).
- **Key bar:** no change. The marker is drawn the same way; only its height moves.

### Mock harness

- Fixture contributions get `hierarchyLevel`.
- Add a scenario KPI with flat readings, four quarterly Initiatives at +1%, and their Outcome at +5%.
  It's the worked example above.
- [mock-resolvers.ts](../../app/test-harness/fixtures/mock-resolvers.ts) `getPanelValues` builds
  `steps` from the fixture contributions with the same `resolveStackSteps`.

## Implementation steps

Each step ships on its own and leaves the app working.

### Step 1 — Domain: stacked baseline

- Add `StackStep`, `stackedBaselineAt` and `resolveStackSteps`. Add the `steps` option and
  `stackedFrom` to `resolveRelativeTargetValue`.
- **Verify** (Vitest, pure):
  - No steps → identical to `baselineAt` (all existing baseline/value tests still pass unchanged).
  - The worked example table, exactly.
  - Percent compounds; amount adds; absolute resets and later steps apply on top of it.
  - Steps at or before the last reading are ignored; steps after the due date are ignored; a step
    exactly on the due date is included.
  - A measured or interpolated baseline ignores all steps.
  - Pending due date → no steps applied, even when some fall between the last reading and today.
  - Zero readings → still `needsBaseline`, no number.
  - Steps from another level, the target itself, pending dates and `null` levels are excluded.
  - Order: same-date steps give the same result in any input order.

### Step 2 — KPI tree and KPI View

- Add `hierarchyLevel` to `TargetSourceIssue`. Fill it in `fetchTargetContributions` and in the
  harness fixtures. Make `buildKpiTargets` two-pass, and add `stackedFrom` to `TimelineTargetDto`.
- **Verify:**
  - `timelineTargets.test.ts`: quarterly Initiatives step up; the Outcome doesn't move; a recorded
    reading after A drops A from the chains.
  - The timeline parity test (merged client result byte-identical to `buildTimelineData`) still passes.
  - `timelinePerf.test.ts`: request count and waves unchanged.
  - Harness (`?surface=timeline`): the scenario KPI shows a staircase of Initiative markers below the
    Outcome marker. Console clean.

### Step 3 — Display in the tree

- Keep "from … now" on the latest reading. Add the "stacked on" line to the marker tooltip (fed by
  `stackedFrom` on the row from `rowForTarget`), and the issue type to `StackStep`.
- **Verify:**
  - A TargetTooltipBody (or Timeline) story: hovering a stacked marker shows
    `Stacked on 2 earlier Initiative targets` and `from 1,000 now`; an unstacked marker shows no
    "stacked on" line.
  - Filtering the harness timeline to one project leaves every marker's value unchanged.

### Step 4 — Issue panel

> **Status: deferred on purpose.** Stacking ships in the KPI tree and KPI View only for now. Until this
> step lands, the issue panel shows the flat (unstacked) value for a target whose tree marker and
> tooltip show the stacked one. The shared pieces this step needs already exist: `stackSteps.ts`,
> `StackStep`, and the `StackedLine` component and `stackedNote` wording (in `app/src/ui/`).

- Contracts (`PanelBasis.hierarchyLevel`, `PanelValuesData.steps`). Add the `peerTargets` stage,
  `assemblePanel` stacking, the draft preview, the harness `getPanelValues`, and the TargetCard
  estimate line.
- **Verify:**
  - `panelPhases.test.ts`: progressive and one-shot panels are still identical.
  - `panel.test.ts` (backend, mocked Jira):
    - An issue with only absolute targets makes **no** contributions search.
    - An issue with a percent target gets the same-level steps and none from other levels.
    - **No duplicate loads.** A peer that targets two of this issue's KPIs, and a peer whose parent is
      this issue's parent, are each fetched **once**. The request log shows no issue id requested
      twice across the own walk, the parent walk and the peer walk.
  - IssuePanel / TargetCard stories: the "stacked on" line with its hover list; no line when nothing
    stacks.
  - Harness (`?surface=issue` on INIT-63): `Estimated target 1,030 … · from 1,000 now` and
    `Stacked on 2 earlier Initiative targets`.
    The same number appears on C's marker in the KPI tree.

### Step 5 — Docs

> **Status: done** (03 requirements §2, §5.3, FR-9a and Q3, and the `baseline.ts` header), noting that
> the issue panel stays flat until Step 4.

- Update 03 requirements §2, FR-9a and Q3, and the `baseline.ts` header comment: other targets at the
  **same level** are stacked, other levels are ignored, and there's still no trend extrapolation.
- **Verify:** no reference to "other work items' targets are ignored" remains without the
  same-level qualifier.

### Step 6 — Measure the panel

- Extend the panel case in the scale fixture (07's harness) with same-level peers on one KPI. Record
  the panel's request count and waves with and without a percent target.
- **Verify:** the numbers are written into this spec under "Measured". That gives Step 7 a baseline to
  beat.

### Step 7 — Load less (performance, after it works)

Ideas, in rough order of payoff. Each one is a separate change that is checked against Step 6's numbers,
and the output must not change.

- **Don't load what can't count.** A step only counts if its target date is after the last reading
  `L` and on or before this target's due date `D`. Readings and the issue's own walk already arrive in
  Phase 2, so `L` and `D` are known before any peer is walked. Peers can be dropped **before** their
  walk when their target date can be bounded without one:
  - **Fixed-date timing** (`mode: 'absolute'`): the target date is known. Drop it if it's ≤ `L` or > `D`.
  - **Own date wins** (level method `parentOnly`, or `parentFirstThenChildren` with the own due date
    set): the effective due date is the own due date, so the target date is known.
  - **`widestRange`** (the default): the rolled-up due date is never earlier than the issue's own due
    date. So if own due + offset is already > `D`, the target can't count. Drop it.
  - Anything left needs its walk. See Question 6 for bounding "already finished before `L`".
- **Search only this KPI and level.** Swap the whole-site search for a per-KPI query
  (`kpiIds ~ "<KPI>"`, filtered exactly), plus `issuetype in (<types at this level>)`. This depends on
  the 07 K1 spike (the `kpiIds` index is `text`, so it only supports `~`).
- **Load in two steps on screen.** Show the flat `≈` value first, and swap in the stacked value when
  `peerTargets` returns, like 07 O4. Only worth it if Step 6 shows the stage on the critical path.
- **Share the rollup memo in the timeline too.**
  [buildTargetContributionsByKpi](../../app/src/backend/resolver.ts) calls `effectiveTiming` with a
  `new Map()` for every root, so a subtree under several roots is rolled up again each time. It's CPU
  time, not requests, but it's the same fix as the panel's: use one memo.
- **Later: copy the inputs.** An app-owned `kpi-rollup` property per issue (rolled-up due date and
  level, indexed for JQL) would remove the peer walk entirely. Out of scope until measuring says it's
  needed.

## Out of scope

- Trend or slope extrapolation of the baseline (still a future *Rate of change* type, 03 Q3).
- Summing across levels, or "coverage" of a parent by its children (01 Q11).
- Caching or denormalizing rolled-up dates (Step 7's last idea is only a note; see Follow-up F1 for
  the narrower "save it once the work is done" version).
- Stacking across KPIs (parent and child KPIs in the KPI tree).

## Follow-ups

### F1 — Frozen targets: save finished work, skip it in stacking and rollup

**Not built. Today nothing is frozen.** "Freeze" in 03 FR-16 has only been implemented as a
compute-on-read flag (`freezeIfDone` → `PanelRowDto.frozen`). Nothing is saved, nothing reads the
flag, and stacking ignores closed status entirely. A done issue's dates are recalculated on every load,
so they still move if a child's date changes. Don't assume anything is "frozen" until F1 lands.

**Proposal.** When a contributing issue is **Done** (status category `done`) **and** its effective
(rolled-up) due date is **in the past**, save a snapshot for that issue and treat it as settled:

- **Save the frozen end date**: the effective due date at the moment it froze. Saving the
  resolved target date and value for each of its targets is probably worth it too (Question F1-2).
- **Stacking.** A frozen target uses its saved date. If that date is at or before the last reading
  `L`, it never stacks (its effect is in the readings). This closes the gap Question 6 describes: a Done
  issue whose leftover child dates push its rolled-up date past `L` stops stacking.
- **Rollup: only walk active items.** A frozen issue's end date is known, so its subtree is never
  walked. This applies to the timeline's
  [buildTargetContributionsByKpi](../../app/src/backend/resolver.ts), the panel's own/parent walks,
  and Step 7's peer walks. This is the main performance payoff. Most of a mature KPI's targets sit on
  finished work.
- **Unfreeze.** Reopening the issue (status leaves `done`) drops the snapshot, and it is
  recalculated live again. Editing the target stays allowed (03 FR-17); the edit wins over the snapshot.

**Where it plugs in (code is marked with `Follow-up F1` comments):**

- [freeze.ts](../../app/src/domain/resolve/freeze.ts): the freeze condition. Keep it the single rule.
- [stackSteps.ts](../../app/src/domain/resolve/stackSteps.ts) `resolveStackSteps`: skip frozen
  steps dated ≤ `L` and use the frozen date for the rest. This is shared code, so the panel and the
  tree agree.
- [timelineTargets.ts](../../app/src/domain/resolve/timelineTargets.ts): passes `closed: false` today.
  The timeline's contribution source needs the issue's done status.
- [resolver.ts](../../app/src/backend/resolver.ts) / [jira.ts](../../app/src/backend/jira.ts):
  `IssueParentInfo.closed` is already read from Jira. Stop the rollup walk at frozen issues.
- [contracts.ts](../../app/src/domain/contracts.ts) `PanelRowDto.frozen`: currently unused by the UI.

**Questions**

- **F1-1. When is the snapshot written?** Options: (a) a Forge issue-updated trigger when the
  status moves to Done; (b) lazily on read; (c) a scheduled job. Writing during reads has the same
  race and retry problems the code review flagged for the rollup-config migration. *Recommend: (a),
  plus (b) only as a one-time backfill.*
- **F1-2. What is saved, and where?** At least the frozen end date. Possibly each target's resolved
  date and value. Options: an app-owned issue property (readable in JQL if indexed) or KVS keyed by
  issue. *Recommend: an issue property, so a search can return it with the issue.*
- **F1-3. "In the past" relative to what?** Today, or the last reading `L`? For stacking, `L` is what
  matters. For skipping the walk, "Done and past today" is enough.
- **F1-4. Name.** "Frozen" reads as "can't change", but FR-17 keeps it editable and reopen undoes it.
  Keep the word but define it as "saved because the work is finished", or rename it (e.g. "settled").
- **F1-5. UI.** Does a frozen target look different (03 Q5)? Nothing shows it today.

## Questions

1. **Absolute targets in a chain.** Should an earlier same-level **absolute** target ("reach 1,000 by
   Jun 30") reset the chain, with later changes applied on top of it? *Recommend: yes. It's the
   planned value at that date. The alternative is to ignore absolute targets in chains entirely.*


   YES


2. **Overlapping benefit windows.** When B ships while A's benefit is still landing (between A's due
   date and target date), does B's baseline include A's change?
   - (a) **Not until A's target date.** Cautious; the estimate won't jump back when the next reading
     comes in.
   - (b) **As soon as A ships.** Matches the plan's staircase, but overstates B's baseline.
   - (c) **Ramp:** part of it, by how far into A's window B ships.

   No overlap (e.g. quarterly releases, 1-month offset) → all three agree.
   *Recommend: (a) for v1.*

   (a) — an earlier target counts only once its target date is on or before this target's due date.

3. **Undated targets.** A target with a pending due date is shown as "assume due today" (03 FR-13).
   Should it stack the steps up to today, or not stack at all? *Recommend: up to today. In practice
   that's only steps between the last reading and today.*

   Don't stack. An undated target keeps the flat "assume due today" baseline.

4. **Where to show stacking in the KPI tree.** ~~Projection modal~~ — that modal only opens from the
   Undated lane, which never stacks (Q3). Dated markers show a hover tooltip that reuses the panel's
   estimate line, so the `+2 earlier targets` suffix appears there for free. Should the tooltip also
   list the steps inline (`Includes INIT-12 +1% (Apr 30), …`)? *Recommend: yes, at most 3 then
   `+N more`.*

   No inline list. The earlier targets are visible on the chart. The "stacked on" line (Question 7)
   covers the cases where they aren't (other levels on the same row, project filter).

5. **Draft preview on a KPI the issue doesn't target yet.** Phase 2 only loads steps for KPIs the
   issue already targets. When drafting a target on a **new** KPI, should the preview (a) show the
   flat value until saved (the save response brings the steps), or (b) load that KPI's steps when the
   KPI is picked? *Recommend: (a) for now.*

   (a).

6. **Bounding "finished before the last reading" for walked peers (Step 7).** For peers whose date
   comes from their children, nothing short of the walk gives the exact target date. Is a cheap
   approximation acceptable? For example, skip the walk for a peer that is **done** and whose own
   due date + offset is ≤ `L`. That's not exact: a child's later date could still push the rolled-up
   date past `L`. *Recommend: exact only (the bounds in Step 7) unless Step 6 shows walks dominate.*

   Exact for now. Walk anything Step 7's exact bounds can't rule out. A possible later rule, applied
   in the shared pure code so the panel and the tree agree: "a Done issue whose own target date is
   before the last reading never stacks". It's meant for leftover child due dates on finished work.
   Revisit if Step 6 shows the walks are slow. Planned as **Follow-up F1** (frozen targets).

7. **How to show stacking without widening the estimate line.** A `· +2 earlier targets` suffix
   pushed the marker tooltip to its 400px max and wrapped, leaving a dangling `·`. Put it on its own
   line instead? Wording: "Includes…" reads as if this target contains them.

   Own line: `Stacked on 2 earlier Initiative targets`. "From … now" stays the latest reading.
