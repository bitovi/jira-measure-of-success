# 08 — KPI Timeline key (legend)

Mock: [key-options.html](./key-options.html). It opens on the chosen design, **F** with error bars.
The other tabs and toggles show the alternatives that were considered.

## Problem

The key on the KPI Timeline (tree) page is one sentence under the chart
([Timeline.tsx](../../app/src/ui/surfaces/Timeline/Timeline.tsx)):

> Target markers show the source issue's icon · the red line is today · green = hit, red = missed, gray = upcoming · click a recorded value to edit or delete it.

- **No samples.** Readers have to match words to marks themselves.
- **Missing entries.** It leaves out the recorded line, the dashed projected trend, provisional
  (faded) targets, and the Undated column.
- **Colors mean two things.** Red is both "today" and "missed"; green is both "recorded value" and "hit".
- **Key mixed with instructions.** Click tips sit inside the key.
- **Easy to miss.** It sits below the whole tree, so it's off-screen on large trees.
- **Drifts from KPI View.** KPI View has its own, different legend
  ([KpiView.tsx](../../app/src/ui/surfaces/KpiView/KpiView.tsx)).

## Design (decided)

### Key bar (option F)

A compact, one-line key bar attached to the **top of the table**, above the quarter header. It is
always visible, with no hide/show.

```
—•— Recorded value   - - Projected trend │ ✓ 5 Hit   ✕ 3 Missed   ▮ 2 Upcoming (fixed)   ⌶ 8 Upcoming (relative)   ▭ 5 Undated target │ ⚡ 7 Epic   ▮ 6 Story   ☑ 5 Task
```

- **Entries:** Recorded value, Projected trend | Hit, Missed, Upcoming (fixed), Upcoming (relative),
  Undated target | one entry per **issue type**. Each entry's sample is drawn with the same
  component the chart uses.
- **Issue-type entries are built from the data.** They list the distinct source-issue types among the
  targets shown (after the project filter), sorted by count. Each shows the type's real, full-color
  Jira icon, its name and its count, e.g. "⚡ 4 Epic · ▮ 6 Story". If an icon can't be used, the
  fallback diamond is shown. They highlight like the other entries.
  - Why full color: on the chart, an issue icon is only a status-tinted *silhouette*. Most Jira
    issue-type icons are a colored rounded square with a white symbol, so every silhouette is the
    same square. The real icon in the key is what makes the type recognizable; hovering the entry
    shows which markers it covers.
- **Counts** on target entries **follow the project filter**: they count only the KPIs the filter shows.
  Collapsing a row in the tree doesn't change them.
- **Highlight:** hovering an entry dims every chart mark that doesn't match. Clicking pins the
  highlight, and a **Clear highlight** link appears. Clicking the pinned entry again also clears it.
  Rows are never hidden.
- No **Today** entry, because the line explains itself.
- Show only entries that apply. For example, hide "Undated target" when no KPI has undated targets,
  matching how the Undated column is hidden.
- The click tips move out of the key into a separate "Tip:" line under the table.

### Marks

| Mark | Change |
|---|---|
| Today line | Solid brand blue instead of red dashed. No header label. |
| Recorded line + dots, projected trend | Neutral dark gray instead of green (`--ds-icon`, about `#44546f` light / `#9fadbc` dark), so green only means "hit". |
| Hit / missed targets | Keep the green / red tint, plus a small **✓ / ✕ badge** in the bottom-right corner so status doesn't rely on color alone. |
| Relative targets that are still estimates (≈) | **Error bar**: a thin vertical bar with end caps (about 26px tall), drawn behind the issue icon. The icon sits on a small surface-colored backing. Replaces today's 50% opacity. |
| Fixed targets, and relative targets already measured | Plain issue icon (no fade, no bar). |

**Naming.** The key says **Upcoming (fixed)** and **Upcoming (relative)**, and "Provisional" is dropped
from the UI. This is accurate: a future relative target is always an estimate, and a fixed target
never is. So among upcoming targets, "relative" and "has an error bar" mean the same thing.
The ≈ sign stays in tooltips, undated chips and the projection popup.

**Edge case (accepted as is):** a past-due relative target with no value recorded on or after its due
date is still an estimate (error bar), but it's already marked hit or missed using the last value
before the due date. It shows a green or red marker with an error bar. This is rare, and the bar
correctly says "may change".

## Status

Implemented: `PlotKey` + highlight in `app/src/ui/plot/`, wired into Timeline and KPI View.

## Implementation notes

- **`PlotKey` component** in `app/src/ui/plot/`, built as a modlet with stories and tests. It draws its
  samples with the same marks as [markers.tsx](../../app/src/ui/plot/markers.tsx), so the key can't
  drift from the chart. Use it in Timeline (as the bar on top of the table) and in KPI View,
  replacing that page's own legend. KPI View counts cover its single KPI.
- **Highlight state:** the surface holds `highlight: KeyKind | null` (hover or pinned). It reaches the
  plot marks through a small context, and marks that don't match get dimmed opacity (~0.1). Each mark
  needs to know its kinds: recorded, projection, hit, missed, upcoming-fixed, upcoming-relative, undated.
- **Counts:** compute them from the project-filtered tree (`filteredRoots`), including collapsed
  descendants.
- **Error-bar room:** `bandScaleOf` in [scale.ts](../../app/src/ui/plot/scale.ts) maps values to
  20–80% of the 60px row, about 12px above and below. A 26px bar needs at least 13px, so use about
  15px. That's 25–75%, or switch to fixed pixel padding. KPI View's `niceScale` already reserves 16px
  at the top. Check the bottom too.
- **Today line:** [Timeline.tsx](../../app/src/ui/surfaces/Timeline/Timeline.tsx) and
  [KpiView.tsx](../../app/src/ui/surfaces/KpiView/KpiView.tsx) both use
  `border-dashed border-danger`. Switch them to solid `border-brand`.
- **Series color:** `Sparkline` and `ProjectionLine` hard-code `#22a06b`. Switch them to the neutral token.
- **Target markers:** in `TargetMarker`, remove the provisional `opacity-50`. Add the error bar when
  `target.provisional` and the ✓/✕ badge for hit/missed. Update the fallback diamond the same way.
  Update the tooltip text "Provisional estimate (baseline not yet baselined)" to plain wording, e.g.
  "Relative target — ≈ until the KPI's value at the due date is recorded".
- Remove the prose key paragraph from Timeline.

## Options considered (still in the mock)

| | Option | Why not chosen |
|---|---|---|
| A | Swatch strip under the chart | Off-screen on large trees |
| B | "Key" button + popover | Hidden by default |
| C | Sticky key bar under the rows | Good look; F moves it to the top and adds interaction |
| D | Interactive chips in the toolbar | Good behavior; F packs it into C's compact bar |
| E | Direct labels on every target | Busy rows, label collisions |

Target-marker styles considered: faded (current), no difference, fixed ○ / relative ◌ rings,
dashed ring, ≈ tag, ring the locked ones. **Hollow icons aren't possible:** real markers are Jira
issue-type images used as a CSS mask, a filled silhouette with no vector outline.

## Open questions

None.
