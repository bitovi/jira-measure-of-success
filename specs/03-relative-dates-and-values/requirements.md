# Requirements — Relative Dates & Relative Values

Status: **Draft for design review** · Scope: feature increment on top of the initial build
Sources: [build brief §4.2/§6.1](../kpi-forge-app-build-brief.md) · [initial requirements](../01-initial-build/requirements.md) · [best KPI-tree mock](../02-kpi-more-space/kpi-timeline-proposed.html)
Mocks (this folder): [issue-panel.html](./issue-panel.html) · [kpi-tree.html](./kpi-tree.html)

> This document describes **what** the feature must do and **why** — not how. Architecture (`architecture.md`) and the build plan (`plan.md`) follow once these requirements are agreed. Open design decisions are collected in [§9](#9-open-questions).

---

## 1. Overview

Today a KPI target is authored as a **fixed value on a fixed (or rolled-up) date**: "Revenue = 1,500,000 by 2026-11-30." That forces the author to know two things they usually don't: the exact number the metric will reach, and the exact calendar date the delivery will be due.

This feature lets an author express a target **relative to a delivery issue's due date**, along two independent axes:

1. **Relative timing** — the target date is measured from the contributing issue's **rolled-up due date** (its effective due date), e.g. *"3 months after INIT-48's due date"*. The due date can move as the plan changes; the target date moves with it. (The timing half already exists in the domain as `DueTiming` with a `relative` anchor + `effectiveTiming` rollup — see [§8](#8-what-already-exists).) **Terminology:** the user-facing word is **“due date”** (“rolled-up due date” when it comes from descendants) — an earlier draft called this “release”; that word is retired everywhere in the UI.
2. **Relative value** — the target amount is a **percent change applied to the KPI's value at the due date**, e.g. *"…revenue should be **1% higher** than it is at the due date."* The baseline is **not** captured now; it is the **baselined** (or **provisional**) value **at the due date**. *(v1 scope: **Absolute value** or **Percent change** only — no absolute-amount delta, no configurable baseline. See [§2](#2-goals--non-goals).)*

**Worked example (the motivating case):**
> "3 months after this initiative's due date, revenue should go up 1%."
> INIT-48's rolled-up due date is ~6 months out (say 2027-01-15). So:
> - **Baseline date** = the due date = 2027-01-15; **baseline value** = revenue at that date.
> - **Target date** = due date + 3 months = 2027-04-15.
> - **Target value** = baseline × (1 + 1%).
>
> Because the due date is in the future, both the baseline and the target are **provisional** (shown with `≈` / `~`) until real values are recorded and the due date is reached.

The hard, novel parts this feature must get right:
- deriving a **baseline value at the due date** — **baselined** (interpolated/measured) once a reading covers it, **provisional** (last reading carried) until then,
- displaying **pending / undated** targets usefully (when there's no due date yet),
- **rolling up due dates cheaply** across potentially large subtrees, and
- **freezing** a relative target into a fixed one once the work is done.

---

## 2. Goals & non-goals

**Goals**
- Author a KPI target as *X% change, N months after {issue}'s due date*.
- Resolve the target's **date** and **value** at read time from the contributing issue's rolled-up due date and the KPI's value series.
- Show a useful, honestly-labeled **estimate** everywhere the target appears (issue panel, KPI tree) — including when the due date is not yet known.
- Keep the rollup **affordable** on big hierarchies (depth cap + progressive loading).
- **Freeze** a relative target to a concrete absolute one once its work is done and its date has passed.

**v1 scope decisions (simplifications)**
- Target value type is **Absolute value** or **Percent change** only (stored `absolute` / `delta`). **No** absolute-amount delta. The label family reserves **Amount change** and **Rate of change** as future siblings.
- The percent baseline is **fixed = value at the due date** — not a user-configurable choice (an earlier "Measured from" picker was dropped as confusing; §9-Q1).
- The baseline value uses **measured readings only** — **flat-carry / interpolate**, **no trend extrapolation**, and **other work items' future targets are ignored** (§5.3).

**Non-goals**
- Summing/aggregating child contributions into a parent (still explicitly out — see initial reqs §8-Q11; children are distinct metrics).
- Value **inheritance** down the parent chain (parked in v1; unchanged here).
- Trend / "rate of change" projection (that's a future **Rate of change** target type, not this one). No ML, seasonality, or confidence intervals.
- Sprint-derived dates (still deferred; the due date uses the existing `effectiveTiming` rollup).

---

## 3. Glossary (additions to the initial-build glossary)

| Term | Definition |
|---|---|
| **Due date** | A contributing issue's **effective due date** — the date the target anchors to. When it comes from descendants it's a **rolled-up due date**; otherwise it's the issue's **own due date**. Resolved by the existing per-level `effectiveTiming` rollup (`widestRange` = latest due date in the subtree). *(Replaces the earlier "release date" wording.)* |
| **Rolled-up due date** | A due date derived from descendants via `effectiveTiming`. The UI labels it **"Rolled up due date"**; the specific source issue is **hidden** in v1 (future: a hover/popover). |
| **Relative target** | A target whose **date** and/or **value** are computed from the due date at read time, never snapshotted. |
| **Percent change** | A target value expressed as a **percent** applied to the baseline value at the due date, rather than an absolute number. Stored as `targetType: 'delta'`; the stored number is the percent (`1` = +1%). UI label = **"Percent change"** (dropdown sibling of **"Absolute value"**). *(v1: percent only.)* |
| **Baseline date** | The date the percent is measured **from** = the **due date** (fixed, not user-chosen). |
| **Baseline value** | The KPI's value at the baseline date. **Baselined** when a reading pins it at the due date, otherwise **provisional** (§5.3). Target value = `baseline × (1 + percent)`. |
| **Baselined** | The baseline is **official**: a reading covers the due date, so the value is **measured** (exact reading on the date) or **interpolated** between the readings that bracket it. Shown as `baselined {value}` (no `≈`). Status pill: **Baselined**. |
| **Provisional baseline** | The baseline is **not yet official**: no reading covers the due date, so the value = the **last recorded reading**, flat-carried (no trend). Shown as `baseline (provisional from {last-reading date}) ≈ {value}`. Occurs in three date contexts (§5.3): **projected**, **provisional (pending)**, **needs measurement (stale)**. |
| **Resolved target** | The concrete `{ date, value }` produced by evaluating a relative target against the current due date and value series. |
| **Pending target** | A relative target whose due date can't be resolved yet (issue has no own date and no dated descendants). It has a **provisional value** but **no placed date** (§5.5). |
| **Undated projection** | The KPI-tree presentation of a pending target: a clickable chip shown outside the dated axis (§6.2). |
| **Frozen target** | A relative target snapshotted to a fixed `{ date, value }` because its work is closed and its date has passed (§5.6). |
| **Rollup depth cap** | An admin setting limiting how far down the hierarchy due-date rollup descends (e.g. stop at Epic) to bound cost (§5.7). |
| **Estimate markers `≈` / `~`** | `≈` prefixes a **provisional value**; `~` prefixes a **projected date** (a resolved date whose due date hasn't been reached yet). Official values/dates carry no marker. Dates everywhere use **`YYYY-MM-DD`**. |

---

## 4. Personas & when they hit this

| Persona | Need | Surface |
|---|---|---|
| **Strategy owner** | "Commit to *1% lift 3 months after this ships* without guessing the date or the exact number." | **Issue panel** — authors the relative target; reads the projected estimate. |
| **Delivery lead** | "See what my in-flight initiative is on the hook for, even before dates are firm." | **Issue panel** + **KPI tree** — sees pending/undated estimates. |
| **Analyst / contributor** | "Read whether we're tracking toward the (moving) target as dates and values firm up." | **KPI tree** — dated markers when known, undated chips when not. |
| **App administrator** | "Keep the tree fast on our 10k-issue hierarchy." | **Settings** — sets the rollup depth cap (§5.7). |

---

## 5. Functional requirements

### 5.1 Authoring a relative-value target (issue panel)

Mock: [issue-panel.html](./issue-panel.html).

- **FR-1 — Target type control.** Each KPI row's target offers **Absolute value** vs **Percent change**. (In the current form this is the `Target type` `<select>`; extend its labels from `absolute` / `delta` to **Absolute value** / **Percent change** — the stored values stay `absolute` / `delta`.) The label family is chosen so future behaviors slot in as siblings — **Amount change** (absolute-amount delta) and **Rate of change** (trend/growth) — with *Absolute value* as the odd-one-out. *(v1: only Absolute value + Percent change.)*
- **FR-1a — Target type must be editable, not just at creation.** Today the target-type control exists **only** in the Associate form; the inline edit path (`TrackedRow`) can't change it. The feature must expose target type (and, for **Percent change**, the value-as-percent) in the **edit** path too — ideally as a shared value/type editor sub-component mirroring `TargetDateEditor` (see §8).
- **FR-2 — Value input adapts.** With **Absolute value**, the value field is a plain number in the KPI's unit. With **Percent change**, the field becomes a percent input (suffix `%`, sign allowed, e.g. `+1`), and a note beneath the value controls states the resolved amounts in plain language ("Current value: 1,326,000 USD → targeting **1,339,000 USD**") — mirroring the due-date note beneath the timing controls. The percent stays in the input and is not repeated in the note.
- **FR-3 — Timing control.** The target date offers **Fixed date** vs **N months after due date** — where the due date = **this issue's** rolled-up (or own) due date (the existing `issueDueDate` anchor). Offset is a signed integer number of months. *(v1: only the `issueDueDate` anchor is offered; `parentDueDate`/`kpiStart` are not surfaced.)*
- **FR-4 — Baseline for a percent change.** For **Percent change**, the baseline is the KPI value at the **due date** — the same date the timing anchors to. This is **fixed**, not a user choice (v1). The baseline is **baselined** (official) once a reading covers the due date, otherwise **provisional** (§5.3).
- **FR-5 — Live resolved preview (two inline notes).** Beneath the value controls and beneath the date controls, the form shows a `↳` note stating the resolved outcome in plain language, mirroring each other:
  - **Value note:** `Current value: {current} {unit} → targeting {target} {unit}` — the resolved target is **bold**. (The percent lives in the input, so it is **not** repeated in the note.)
  - **Date note:** `Rolled up due date: {dueDate} → targeting {targetDate}` — the resolved target date is **bold**; the label reads **"Rolled up due date"** when rolled up, **"Due date"** otherwise; the rollup **source issue is hidden** (future: hover/popover).
  - Projected values carry `≈` and projected dates carry `~` (§3). When the due date is pending, the date note shows a **pending / date-TBD** state (§5.5).
- **FR-6 — Validation.** Percent accepts negatives (a "decrease" KPI legitimately targets a drop). Absolute value keeps current validation. A percent change with **zero** readings does not fabricate a number — it shows *"needs a baseline reading"* (§5.3).

### 5.2 Resolving the due date (rolled-up timing)

- **FR-7 — Due date = effective due.** A relative target's due date is the contributing issue's `effectiveTiming(...).due` under the configured per-level rollup (`widestRange` = the latest due date in the subtree — effectively "the last thing to finish"). No new date math is introduced; this feature **consumes** it. The UI labels it **"Rolled up due date"** when it comes from descendants, **"Due date"** when it's the issue's own.
- **FR-8 — Moving due date.** Because resolution is at read time, changing the issue's (or its descendants') dates moves the target date and re-derives the baseline automatically. No stored target is stale.

### 5.3 Baselining the value (baselined vs provisional)

The baseline is the KPI value **at the due date**. It has exactly **two** states, driven only by **measured readings** (other work items' future targets are **ignored**):

- **FR-9 — Baselined (official).** When a reading **covers** the due date, the baseline is official: **measured** (a reading lands on the due date) or **interpolated** between the two readings that **bracket** it. Rendered as `baselined {value}` (no `≈`), status pill **Baselined**. Target value = `baseline × (1 + percent)`.
- **FR-9a — Provisional (carried).** When **no** reading covers the due date, the baseline value = the **last recorded reading**, flat-carried (**no trend extrapolation** — that's a future *Rate of change* type). Rendered as `baseline (provisional from {last-reading date}) ≈ {value}`. This one carried value appears in **three date contexts**, distinguished by the status pill / date row, not by the value math:
  - **Projected** — due date is in the **future** (no reading after it yet). Target date shown with `~`.
  - **Provisional** — **no due date** at all (pending rollup). Target date shown as **pending / TBD**.
  - **Needs measurement** — due date **has passed but no reading exists after it**, so it can't be interpolated; the carried value is **stale**. Adds a ⚠ *"Due date passed with no measurement — baseline may be stale. Record a value."* warning.
- **FR-9b — No baseline (zero readings).** With **no readings at all**, there is no baseline: show *"needs a baseline reading"* (pill **Needs baseline**) plus a ⚠ *"A Percent change target needs at least one reading to establish the baseline."* — never a fabricated number.
- **FR-10 — Baseline then percent.** Resolved target value = `baselineAt(dueDate) × (1 + percent)`. The author supplies the sign; the KPI's direction is used only for hit/miss status classification, not for the sign.
- **FR-11 — Provisional vs official rendering.** A provisional value always carries `≈`; a projected date always carries `~`. Once a reading covers the due date (measured or interpolated), the baseline flips to **baselined** (no marker) with no other change.

### 5.4 Estimating the benefit on the issue page

- **FR-12 — Show the estimate when dated.** When the due date resolves, the issue panel shows the resolved target `{value, date}`, marked provisional (`≈`/`~`) while the baseline is provisional or the date is projected.
- **FR-13 — Provisional estimate when undated.** When the due date is **pending**, the panel still shows a provisional estimate: take the **last recorded value** (assume **due today**), apply the percent, and label it clearly (pill **Provisional**, date **TBD**). This answers "what would this look like if it were due now?"

### 5.5 Pending targets (no due date yet)

- **FR-14 — A pending target still has a value estimate.** Value resolution (§5.3) does not require a date; only the *date* is pending. So a pending target is `{ value: estimate, date: null, pending: true }`.
- **FR-15 — Never fabricate a date.** A pending target must not be placed on the dated axis or given an invented calendar date (consistent with the initial build's "Pending" rule).

### 5.6 Freezing relative → fixed

- **FR-16 — Freeze condition.** When the contributing issue is **closed** (resolved) **AND** its rolled-up due date is **in the past**, the relative target is converted to a **frozen absolute target**: the due date and the baseline value are captured from actuals, the percent is applied once, and the result is stored as a fixed `{ date, value }`.
- **FR-17 — Freeze is a snapshot, not a lock.** Freezing stops re-rollup and re-projection (stabilizing history and cutting cost) but the target remains editable. (§9-Q5: automatic on read vs. an explicit write / background job; and how a frozen target is visually distinguished.)
- **FR-18 — Pre-freeze uses live values.** Before the freeze condition holds, everything stays relative and recomputes at read time (§5.2/§5.3).

### 5.7 Performance: depth cap & progressive loading

- **FR-19 — Rollup depth cap (setting).** An admin setting limits how far due-date rollup descends — e.g. *"roll up dates from children only down to Epic."* Below the cap, an issue's own date (or nothing) is used instead of loading its subtree. Default = no cap; recommended cap surfaced in Settings copy. (§9-Q6 on default level.)
- **FR-20 — Progressive resolution.** The KPI tree must render **immediately** with everything it can compute cheaply — absolute targets, already-loaded values, static markers — and then **fill in** each relative/rolled-up target as its subtree resolves, showing a lightweight **loading state** (shimmer/spinner) on rows still resolving. A slow or huge subtree must not block first paint.
- **FR-21 — Bounded fan-out.** Rolling up one due date may require loading many descendants. Resolution must batch/cap Jira reads (reuse the initial build's bulk fetch patterns) and must not issue an unbounded number of sequential requests.

### 5.8 KPI-tree presentation

Mock: [kpi-tree.html](./kpi-tree.html) (based on the current best tree mock).

- **FR-22 — Dated relative targets = markers.** A resolved relative target with a date renders as a normal target marker on the axis (existing marker style), positioned at its resolved date, with hit/missed/upcoming status.
- **FR-23 — Provisional markers are visually distinct.** A marker whose value is **provisional** (baseline not yet baselined) is rendered as an **estimate** (e.g. hollow/dashed/`≈` in the tooltip) to separate a *baselined* target from a *provisional* one. (§9-Q7 on the exact visual language.)
- **FR-24 — Undated projections = clickable chips.** Pending targets (no date) can't sit on the axis. Show them as **chips** in a dedicated **"Undated" lane** (a parking area at the right edge of the row, outside the scrollable date range). Each chip shows the estimated value; clicking it opens the **projection modal** (§6.3).
- **FR-25 — Loading state.** Rows whose relative targets are still resolving show a shimmer/placeholder in place of the markers/chips until they resolve (FR-20).

### 5.9 Saved relative target — display states (issue panel)

Mock: [issue-panel.html](./issue-panel.html) ("Saved target — states" gallery). A saved target renders as a card with **two stacked rows mirroring the form** — a **Target value** row and a **Target date** row — each with a recap line + a `↳` resolved note; a **status pill** top-right; an optional **warning strip** placed **in the area it concerns** (value warnings in the Target value row, result warnings in the Target date row); and an **Edit / Remove** action footer bottom-right (FR-27).

- **FR-26 — The status pill encodes the combined value × date state.** Eight states (driven by §5.3 baseline state × where *today* sits relative to the due date and target date):

  | # | Pill | Condition | Value row | Date row |
  |---|---|---|---|---|
  | 1 | **Projected** | due date in the future | `baseline (provisional from {date}) ≈ v → targeting ≈ t` | `~{targetDate}` · Upcoming |
  | 2 | **Provisional** | no due date (pending) | `baseline (provisional from {date}) ≈ v → targeting ≈ t` | `pending` · Date TBD |
  | 3 | **Baselined** | due date reached, reading covers it | `baselined v → targeting t` | `{targetDate}` · Upcoming |
  | 4 | **Needs measurement** | due date passed, no reading after it | `baseline (provisional from {date}) ≈ v → targeting ≈ t` + ⚠ stale | `{targetDate}` · Upcoming |
  | 5 | **Met ✓** | target date passed, actual meets target | `baselined v → target t · actual a` | `{targetDate}` · Met on {date} |
  | 6 | **Missed ✗** | target date passed, actual misses | `baselined v → target t · actual a` | `{targetDate}` · Missed |
  | 7 | **Result unknown** | target date passed, no reading since baseline | `baselined v → target t · actual —` | `{targetDate}` · passed + ⚠ can't confirm |
  | 8 | **Needs baseline** | zero readings | *needs a baseline reading* + ⚠ | `~{targetDate}` · Upcoming |

- **FR-26a — Two warnings.** *Needs measurement* (state 4): due date passed with no measurement → baseline may be stale. *Result unknown* (state 7): target date passed with no measurement since the baseline → can't confirm hit/miss. Both prompt "Record a value."
- **FR-27 — Edit / Remove.** Every saved-target card exposes **Edit** and **Remove** as a bottom-right footer, rendered as **subtle gray** text that colors on hover (Edit → brand, Remove → danger) so secondary/destructive actions stay quiet until reached for. (Edit must reach the target-type + percent + timing controls per FR-1a.)
- **FR-28 — Display conventions.** The **user-set intent** is bold — `+10%` leads the value row (with "Percent change" de-emphasized) and **"3 months after due date"** leads the date row (with the resolved date de-emphasized). Provisional values carry `≈`; projected dates carry `~`. All dates are `YYYY-MM-DD`. Field labels use Jira's label style (14px / 500 / sentence case).

---

## 6. UX detail

### 6.1 Issue panel — relative target editor

**Authoring form** (native `<label>`-wrapped `<select>`/`<input>`, **not** segmented pills):
- **Target value type** select: **Absolute value | Percent change**. When *Percent change*, the value field shows a `%` suffix.
- **Target date type** select: **Fixed date | Relative date**. When *Relative date*, the field is **`[ N ] months after due date`** (numeric + "months" suffix).
- Two `↳` **resolved notes** beneath the respective controls (FR-5): the **value note** (`Current value: X → targeting **Y**`) and the **date note** (`Rolled up due date: D → targeting **T**`), each bolding the resolved target. The percent/offset live in the inputs and are **not** repeated. The date note's label is **"Rolled up due date"** vs **"Due date"**; the rollup source issue is hidden.

**Saved-target card** (§5.9): header (KPI name · unit · direction · **status pill** top-right); **Target value** row (recap + `↳` note + any value warning); divider; **Target date** row (recap + `↳` note + any result warning); **Edit / Remove** footer bottom-right. Bold the user-set intent (`+10%`, `3 months after due date`); `≈` on provisional values, `~` on projected dates.

### 6.2 KPI tree — dated + undated
- The dated axis is unchanged (scrollable quarters). Relative targets that resolve to a date appear as markers there (FR-22), estimated ones visually distinct (FR-23).
- A fixed-width **"Undated"** lane pinned to the right of each row holds chips for that KPI's pending targets (FR-24). If a row has none, the lane is empty.
- Rows still resolving show a shimmer (FR-25).

### 6.3 Projection modal
Opened from an undated chip (or an estimated marker). Shows, for that one target:
- the sentence form ("+1% revenue, 3 months after INIT-48's due date — due date TBD"),
- the **provisional baseline** (value + which reading it was carried from),
- the **estimated target value**,
- the **provisional date** (if any, from FR-13) clearly labeled provisional,
- a link to the contributing issue.

---

## 7. Acceptance criteria (testable slices)

Each is a pure-domain unit test unless noted.

1. **Percent change against a baselined value.** Due date covered by a reading (on it, or bracketed) → baseline is measured/interpolated; resolved value = baseline × (1 + percent). *(pure)*
2. **Percent change against a provisional baseline.** No reading covers the due date → baseline = last reading (flat-carried, **no trend**); resolved value = last × (1 + percent), marked `≈`. *(pure)*
3. **Interpolation at the due date.** Due date bracketed by two readings → baseline is the linear interpolation between them (not last-on-or-before). *(pure)*
4. **Due date drives the target date.** Changing the contributing issue's rolled-up due moves the resolved target date. *(pure, via effectiveTiming)*
5. **Measured-only baseline.** Another work item's future target on the same KPI does **not** change this baseline. *(pure)*
6. **Pending date, present value.** No due date → `{ value: provisional, date: null, pending: true }`; never a fabricated date. *(pure)*
7. **Provisional issue-page estimate.** Pending due date → panel shows last-value × (1+percent), assume **due today**, pill *Provisional*, date *TBD*. *(pure + panel story)*
8. **Zero vs one reading.** Zero readings → *"needs a baseline reading"* (pill *Needs baseline*, no number). One reading → flat-carried provisional. *(pure)*
9. **Display-state classification.** The eight states of FR-26 map to the right pill from `{baseline state, today vs due date, today vs target date}`. *(pure + panel story)*
10. **Two warnings fire correctly.** *Needs measurement* when due date passed with no reading after it; *Result unknown* when target date passed with no reading since baseline. *(pure + panel story)*
11. **Freeze.** Closed issue + past due date → frozen `{date, value}` from actuals; further upstream date/value changes don't move it. *(pure; write path is §9-Q5)*
12. **Depth cap** stops rollup at the configured level. *(pure, via effectiveTiming config)*
13. **Tree renders before slow subtrees resolve** and fills in markers/chips afterward. *(Timeline story)*
14. **Undated chip opens the projection modal**; **estimated markers are visually distinct** from committed ones. *(Timeline story)*

---

## 8. What already exists (reuse, don't rebuild)

Verified against the code (`app/src/ui/surfaces/IssuePanel/IssuePanel.tsx`, `app/src/domain/**`), not just the mocks.

**Domain**
- **`DueTiming`** (`models/assignment.ts`) already models `mode: 'absolute' | 'relative'`, a fixed 3-value `DueAnchor` enum (`issueDueDate | parentDueDate | kpiStart`), and `offsetMonths`. Relative **timing** is authored today; this feature keeps the `issueDueDate` anchor and labels it **"due date"** (UI copy only — **not** a new enum value) and completes the UX.
- **`effectiveTiming` / `resolveConfig`** already roll up `{start, due}` per level (widestRange etc.) — this is the **due date**. The depth cap (FR-19) is a new option on this rollup.
- **`resolveRelativeTargetDate`** already turns a `DueTiming` + context into `{ date, pending, source }`. Relative **value** is the new sibling: a `resolveRelativeTargetValue` that projects a baseline and applies a delta.
- **`targetStatus` / `valueAt`** classify hit/missed/upcoming and read the value in effect at a date — reused for status and as the **baselined** value path (interpolation is the new sibling).
- **`readingSeries`** reconstructs the reading timeline — the input to projection (§5.3).
- **`TargetType`** is `'absolute' | 'delta'` today; the delta value is a plain number (an **amount**, e.g. `+250`). This feature adds the **percent** flavor and the **relative baseline** (see §9-Q8 on the model change).

**Issue-panel form structure (important, and partly a gap)**
- The form is **native `<label>`-wrapped `<select>`/`<input>`** controls (not segmented pills). New UI must match this.
- Timing is a **single shared `TargetDateEditor`** sub-component reused by both the Associate form and the inline edit path — so the "due date" copy and any timing change land in **one place**.
- **Gap:** `targetType` (the `absolute`/`delta` select) currently lives **only in the `AssociateForm`**. The inline **edit** path (`TrackedRow`) has **no target-type control** and no baseline field — it only edits value + date. To edit a relative-value target (change %/amount or baseline), the feature must **add a target-type + delta-kind + "Measured from" control to `TrackedRow`** (or extract a shared value/type editor, mirroring `TargetDateEditor`). *(New requirement — see FR-1a.)*
- The value field is a single free-text input (`e.g. 250`) parsed with `Number(...)`; a percent flavor changes how it is parsed, formatted (suffix), and validated (sign allowed).

---

## 9. Open questions

> These block or shape `architecture.md`. Recommended answers noted; please confirm or override.

- **Q1 — Baseline choice. RESOLVED (v1): fixed = value at the due date.** The percent is always measured from the KPI's value at the due date; no user-configurable baseline.
- **Q2 — Provisional anchor for undated targets. RESOLVED (v1): today.** The "no due date yet" estimate assumes **due today** (last value × (1+percent)), labeled *Provisional* / date *TBD*.
- **Q3 — Baseline model. RESOLVED (v1): flat-carry + interpolate, no trend.** Baseline = value at the due date: **measured** if a reading lands on it, **interpolated** if bracketed, else the **last reading flat-carried** (`≈`). **No** slope/trend extrapolation — a trend model is a future *Rate of change* target type. Measured readings only; other work items' targets ignored.
- **Q4 — Offset units.** Keep **months** only, or also weeks/quarters? *Recommend: months only (matches existing `offsetMonths`).*
- **Q5 — Freeze mechanics.** Freeze **lazily on read** (pure, no write) vs. an **explicit write / background reconciliation** (durable, but needs a job + write path)? And how is a frozen target shown? *Recommend: compute-on-read semantics in v1 (a target *presents* as frozen when the condition holds) — no new write path; mark "final" in the UI.*
- **Q6 — Depth-cap default.** Default to **no cap** (correct but potentially slow) or cap at **Epic** out of the box? *Recommend: no cap by default, with a prominent Settings recommendation to cap on large sites.*
- **Q7 — Estimated-marker visual.** How to distinguish a **projected** target from a **committed** one on the axis — hollow marker, dashed outline, `≈` in tooltip only, opacity? *Recommend: hollow/outlined marker + `≈` in tooltip; confirm in mock review.*
- **Q8 — Data-model shape for relative value. RESOLVED (v1): keep `targetType: 'absolute' | 'delta'`, treat `delta` as a percent.** No `deltaKind`/`baselineAnchor` field — `delta` means "percent of the value at the due date"; the stored `target` number is the percent (`1` = +1%). UI label = **Percent change**. Add `deltaKind`/amount later only if **Amount change** / **Rate of change** siblings ship.
- **Q9 — Storage of frozen snapshots.** If freeze becomes a write (rejecting Q5's read-only recommendation), where does the snapshot live — the assignment property, or a reading? *Deferred until Q5 is decided.*
- **Q10 — KPI-tree "Undated" lane placement.** A right-pinned lane per row (mock's approach) vs. a single grouped "Undated projections" section below the tree? *Recommend: right-pinned lane; revisit if it crowds narrow screens.*

---

## 10. Out of scope (this increment)

- Child→parent value aggregation / coverage (still out; initial reqs §8-Q11).
- Value inheritance down the parent chain (parked).
- Sprint-derived due dates (deferred; uses `duedate` rollup).
- Multi-metric or blended projections, seasonality, confidence intervals.
