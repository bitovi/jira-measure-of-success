# Feature 04 — KPI View (single-KPI chart on the KPI issue)

> Status: **IMPLEMENTED** (2026-07-23). All 5 open questions resolved and built.
> Mock: [kpi-view.html](./kpi-view.html) (open in a browser).

## 1. The idea

Today the **Issue panel** always renders the "on-issue KPI editor" — the list of
KPIs associated with the current issue plus the *Set a KPI target* form
(`IssuePanel.tsx`). That is exactly right when you are standing on a **normal
work issue** (an epic/story that *contributes* a target to some KPI).

But a **KPI is itself a Jira issue** — it lives as an issue of type `KPI` in the
dedicated **KPI space** project (see repo storage-model). When you open *that*
issue, the associate-a-target form makes no sense: this issue *is* the metric.
What you actually want to see there is the **same graph the KPI Timeline draws
for this KPI**, but promoted to a full, readable chart.

So: **when the panel is mounted on an issue that lives in the KPI space (i.e. the
issue is a KPI), swap the associate/editor UI for a single-KPI chart** that looks
like one KPI Timeline row, except:

1. It is **much taller — ~600px** (vs. the timeline's `ROW_H = 60`).
2. It has a **vertical value axis** with tick lines + labels, so you can actually
   read the numbers off the chart (the timeline has none — each row auto-fits
   its values into 20–80% of the row and shows values only on hover).

Everything else — the quarter-based horizontal date axis, the today line, the
green recorded-value sparkline, the target markers (issue type-icon silhouettes
tinted hit/missed/upcoming), the hover crosshair + value tooltip, and the
*record a value* action — stays visually identical to the timeline.

## 2. Shared code inventory (reuse, don't rebuild)

**The whole point of this plan: the KPI View and the KPI Timeline draw the same
plot, so the plot code must be shared, not copied.** The good news — verified by
reading `Timeline.tsx` — is that every plotting piece is **already fully
parameterized** by the axis, a `yOf(value)` scale function, and pre-computed
`y`/`x` positions. Nothing reaches into timeline-only layout (`ROW_H`,
`LABEL_W`, the tree walk). So sharing is a **mechanical extract-and-export**,
not a rewrite.

### 2a. New shared module: `app/src/ui/plot/`

Move these out of `Timeline.tsx` verbatim and export them; `Timeline.tsx` then
imports them (behavior identical → its 19 stories stay green). `KpiView.tsx`
imports the same module.

| Symbol (today: private in Timeline.tsx) | Signature | Coupling verdict |
| --- | --- | --- |
| `Axis` interface | `{ quarters, domainStart, domainEnd, plotWidth, xOf, todayMs }` | Pure data — move as-is. |
| `buildAxis(dataDates, todayIso, opts?)` | → `Axis` (extracted from the `axis` useMemo, now **fit-to-range** — §4a) | Domain derived from data range, not a fixed 9-quarter window. Shared by both surfaces. |
| `useCenterOnCurrentQuarter(ref, axis)` | scrolls to current quarter on load | **Removed / no-op** once the domain brackets the data (§4a). |
| `Sparkline` | `({ readings, axis, yOf, plotH })` | **Zero coupling** — already takes `yOf`+`plotH`. Reuse as-is. |
| `ReadingDot` | `({ reading, node, axis, y, onEdit })` | Uses `node.unit` + `fmtVal` only. Reuse as-is. |
| `TargetMarker` | `({ target, node, axis, y, onOpenIssueNewTab, siteUrl })` | Fully parameterized (icon-mask tint, tooltip). Reuse as-is. |
| `UndatedLane` / `ProjectionModal` | per-KPI undated chips + modal | `ProjectionModal` reused directly; the panel renders undated chips as a **list below the chart** (§5), not the timeline's right-pinned `UndatedLane`. |
| `RecordModal` / `EditReadingModal` | record / edit-delete a reading | Reused for the *Record a value* action. |
| pure helpers `ms`, `fmtVal`, `valueDetailAt`, `domainFor` | numeric | Pure — move to `plot/scale.ts`. |
| hover crosshair + tooltip (`HoverState`, `onTrackMove`) | per-track hover → value | Extract into a `usePlotHover(axis, node)` hook so both surfaces get the identical tooltip. |

### 2b. The one thing that must stay pluggable — `yOf`

The **only** real difference between the two surfaces is the vertical scale:

- Timeline: `domainFor(node)` → `yOf` squeezes values into 20–80% of a 60px row,
  **no ticks, no labels**.
- KPI View: a "nice" tick scale over ~600px **with** gridlines + labels (§4).

That difference is already isolated: `Sparkline` takes `yOf` as a prop, and
`ReadingDot`/`TargetMarker` take an already-computed `y`. So each surface builds
its own `yOf` and passes it in — **no shared component needs a branch**. The
shared module exports *both* scale builders:

```ts
// app/src/ui/plot/scale.ts
export function bandScale(node, plotH): (v: number) => number;      // timeline (20–80%)
export function niceScale(node, plotH, tickCount): {               // KPI View (§4)
  yOf: (v: number) => number;
  ticks: { value: number; y: number; label: string }[];
}
```

### 2c. Data is already single-KPI shaped

A `TimelineNodeDto` (`app/src/domain/contracts.ts`) carries `readings`,
`targets`, `undated`, `unit`, `direction`, `issueKey` — exactly one KPI's
series. The KPI View renders **one node**; it does not touch the tree walk,
collapse state, label column, or project filter. Those stay timeline-only in
`Timeline.tsx`.

## 3. Detecting "this issue is a KPI"

The panel entry (`app/src/ui/entries/issue-panel.tsx`) already reads the issue id
from `view.getContext()`. We extend the backend panel load to tell the UI whether
this issue is a KPI and, if so, hand back that KPI's series:

1. Backend `getPanelData(issueId)` (resolver) already fetches the issue meta. Add
   the issue's **project key** to that fetch and compare it to the configured
   **KPI space key** (already stored — see `getKpiSpace` / storage-model). If they
   match (and the issue type is `KPI`), this issue is a KPI.
2. When it is a KPI, resolve the KPI id from the issue and build a **single
   `TimelineNodeDto`** for it (same builder the timeline uses, scoped to one KPI:
   its readings via `fetchReadingChangelog` + `readingsFromChangelog`, and its
   contributing targets). Return it on a new `PanelData` field.

New contract shape (additive, no breaking change):

```ts
export interface PanelData {
  issueKey: string;
  rows: PanelRowDto[];
  catalog: CatalogEntryDto[];
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
  /** NEW — set only when THIS issue is a KPI in the KPI space (Feature 04). */
  kpiView?: {
    node: TimelineNodeDto; // this KPI's own series (readings + targets)
    today: string;         // ISO "today" for the axis + status classification
  } | null;
}
```

The UI branches on it: `if (data.kpiView) render <KpiView …/> else render the
existing associate/editor panel`.

## 4. The vertical value axis (the one genuinely new bit)

The timeline has no Y axis because each 60px row can't hold labels. At 600px we
add a real linear value scale:

- Compute the value domain from `node.readings ∪ node.targets` (same inputs as
  `domainFor`), then **expand to "nice" round bounds** and generate ~5–6 evenly
  spaced ticks (a small `niceTicks(min, max, count)` pure helper — 1/2/5×10ⁿ
  step selection, the standard D3-style algorithm; fully unit-testable in the
  domain layer).
- `yOf(value)` maps a value to a pixel within the plot height using the nice
  bounds (top padding for the max tick, bottom padding for the axis line).
- Render each tick as a faint full-width horizontal gridline with a right-aligned
  label in a fixed **left gutter (~64px)**. Labels use the KPI `unit` formatting
  (e.g. `1.6M`, `0.8M`, `0`).
- The gutter is **sticky/pinned** (like the timeline's label column) so it stays
  visible while the plot scrolls horizontally through quarters.

`niceTicks` is the only new pure-domain function. Everything else is layout.

## 4a. Fit the horizontal axis to the data range (BOTH surfaces — DECIDED)

> **This changes the KPI Timeline too, not just the new view.** Today
> `Timeline.tsx` uses a **fixed 9-quarter domain centered on today** with the
> plot always scrolling. Decision: **fit the horizontal axis to the actual data
> range** on both surfaces.

- Compute the date domain from the plotted data: the min/max of all dated
  `readings` ∪ dated `targets`, **always including `today`** so the today line
  stays on-canvas. On the Timeline that's the **union across every visible KPI**
  (so all rows keep sharing one axis); in the KPI View it's just the one KPI.
- **Snap outward to quarter boundaries** — `domainStart` = quarter start of the
  min date, `domainEnd` = quarter end of the max date — so the quarter gridlines
  and labels stay whole. Add a small pad quarter on each side for breathing room
  (tune during build).
- **No data** (a KPI/tree with no readings or dated targets) → fall back to a
  sensible default window around today (e.g. previous → next quarter), matching
  today's centered behavior for the empty case.
- Width = `quarterCount × QUARTER_PX`. When it fits the viewport there's **no
  horizontal scroll**; when the range is genuinely wide, the plot still scrolls
  (scroll stays as an overflow fallback, it's just no longer the default).
- This logic lives in the shared `buildAxis(...)` (§2a) — both surfaces get the
  identical fit-to-range behavior from one place, reinforcing the code-sharing
  seam. The Timeline's "land centered on the current quarter" effect becomes a
  no-op / is removed once the domain already brackets the data.

## 5. Layout / interaction spec (see the mock)

- **Header row:** KPI name (links to the KPI issue), `unit · direction` glyph,
  and a *Record a value* button (same action + modal as the timeline). Optional
  small stat chips ("Latest value", "Next target").
- **Chart:** ~600px tall. Left 64px sticky value-axis gutter; the rest is the
  quarter plot. The horizontal domain **fits the KPI's data range** (§4a), not a
  fixed 9-quarter window — `QUARTER_PX = 220`, scroll only when the range is wider
  than the viewport.
  - Horizontal nice-tick gridlines + Y labels (§4).
  - Vertical quarter gridlines + quarter labels along the bottom.
  - Dashed **today** line (danger), same as timeline.
  - Green recorded-value **sparkline** + dots (`Sparkline`, `ReadingDot`).
  - **Target markers** (type-icon silhouettes tinted hit/missed/upcoming), plus
    a dashed **target-trajectory** line from the current value to the target
    (matches the old `measurement-detail.html` full-page chart).
  - Hover crosshair + floating value tooltip (measured / interpolated), same as
    the timeline.
- **Undated targets:** if this KPI has pending/undated targets, render them as a
  **compact list below the chart** (chips → `ProjectionModal`) — NOT the
  timeline's right-pinned Undated lane (the panel is narrower and the extra tall
  lane would waste space). The chips still reuse the shared `ProjectionModal`.
- **Empty states:** no readings yet → "No values recorded yet — click a past date
  to add"; no targets → chart still renders the recorded line.
- **Legend:** recorded value / target trajectory / issue target / today (like the
  measurement-detail mock's legend).

## 6. Where the component lives

- **Shared plot module `app/src/ui/plot/`** (§2a) — the extracted primitives,
  imported by BOTH `Timeline.tsx` and `KpiView.tsx`. This is the code-sharing
  seam. It owns the axis, scales, sparkline, markers, reading dots, hover, and
  the record/edit/projection modals. No surface duplicates them.
- New modlet `app/src/ui/surfaces/KpiView/` (`KpiView.tsx` + `index.ts` +
  `*.stories.tsx` + `*.test.tsx`) following the injectable-loader-hook +
  portable-stories conventions (create-react-modlet skill). It composes the
  shared module at 600px height with the `niceScale` (§4).
- `IssuePanel.tsx` stays the router: it keeps its existing behavior and, when
  `data.kpiView` is present, renders `<KpiView node=… today=… onRecord=…/>`
  instead of the group list + associate form.
- `Timeline.tsx` shrinks: after extraction it keeps only the tree-specific shell
  (row walk, collapse, sticky label column, project filter, add-KPI) and imports
  the plot primitives. The extraction is **mechanical (no behavior change)** so
  the timeline's existing 19 stories stay green — that green suite is the
  regression guard that the shared module is a faithful move.

## 7. Phases

1. **Domain:** `niceTicks(min, max, count)` pure helper + tests (TDD).
   `kpiView` addition to `PanelData` contract.
2. **Extract shared plot module** `app/src/ui/plot/` from `Timeline.tsx` (§2a):
   move `Axis`/`buildAxis`, `Sparkline`, `ReadingDot`, `TargetMarker`,
   `UndatedLane`, `ProjectionModal`, `RecordModal`, `EditReadingModal`, the pure
   helpers, and the hover hook out and export them; rewire `Timeline.tsx` to
   import them. **No behavior change — timeline's 19 stories must stay green**
   (the regression guard). Add `bandScale`/`niceScale` to `plot/scale.ts`
   (band = today's `domainFor`+`yOf`; nice = §4, built on the domain `niceTicks`).
3. **`KpiView` surface:** 600px chart composing the shared module with
   `niceScale`, sticky Y-axis gutter + tick labels, reuse
   sparkline/markers/hover/record modal. Stories: WithReadings, WithTarget,
   Empty, Undated, single-vs-many quarters.
4. **Panel routing + loader:** `usePanelData` surfaces `kpiView`; `IssuePanel`
   branches. Harness `getPanelData` returns a `kpiView` node when the fixture
   issue is a KPI (add a KPI-issue fixture); backend `getPanelData` computes
   `isKpiIssue` via project-key vs. KPI-space-key + builds the single node.
5. **Verify:** browser (harness `?surface=issue&issueId=<a KPI issue>`), story +
   domain tests, tsc/lint/build (ready-to-push gate).

## 8. Open questions

1. ~~**Detection:** issue project key === KPI space key enough?~~ **RESOLVED —
   project-key is enough** (the space only holds KPI issues; no issue-type check).
2. ~~**Undated targets:** right-pinned lane or a list?~~ **RESOLVED — a compact
   list below the chart** (chips → `ProjectionModal`), not the timeline's
   right-pinned lane.
3. ~~**Target trajectory line:** include the dashed baseline→target projection?~~
   **RESOLVED — yes**, draw the dashed current-value→target trajectory line
   (as in `measurement-detail.html`).
4. ~~**Horizontal scroll vs. fit:**~~ **RESOLVED — fit to the KPI's data range on
   BOTH surfaces** (§4a). The Timeline drops its fixed 9-quarter centered window.
5. ~~**Does this replace the associate form entirely** on a KPI issue?~~
   **RESOLVED — yes, the associate/target-editor form is fully hidden on a KPI
   issue.** When `data.kpiView` is present, `IssuePanel` renders ONLY `<KpiView/>`
   — no group list, no *Set a KPI target* form. (Authoring nested KPIs happens on
   the Timeline's add-child, not here.)
