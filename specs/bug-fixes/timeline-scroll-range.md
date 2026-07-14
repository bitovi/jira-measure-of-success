# Timeline initial scroll & scroll-range design

## Issue
On the KPI Timeline surface the horizontal scrollbar loaded pinned to the far
**right**, showing the future quarters (e.g. Q3 2026 → Q3 2027 with today =
2026-07-13 in Q3 2026) instead of landing on/near the **current** quarter. The
spec default (repo memory Q5, `src/domain/resolve/timelineAxis.ts`) is to show
**previous + current + next** quarter, with horizontal scroll to pan.

## Current behavior (how the boundaries are computed)

The Timeline surface builds its own axis inline in
[app/src/ui/surfaces/Timeline/Timeline.tsx](../../app/src/ui/surfaces/Timeline/Timeline.tsx)
(the pure `timelineWindow()` in `timelineAxis.ts` models a 3-quarter window but
is **not** used by this surface). The inline `axis` `useMemo`:

- `firstQ = addQuarters(quarterStartMs(today), -4)` — domain starts **4 quarters
  before** the current quarter.
- `quarters` = 9 entries (`length: 9`), so the domain spans **9 quarters**:
  4 before + current + 4 after.
- `domainStart = firstQ`, `domainEnd = addQuarters(firstQ, 9)`.
- `plotWidth = 9 * QUARTER_PX` (9 × 220 = 1980px).
- `xOf(iso) = ((ms - domainStart) / (domainEnd - domainStart)) * plotWidth`.

So the **domain is a fixed, bounded 9-quarter window** (~4 quarters of history +
current + ~4 quarters of future), and only ~3 quarters are visible at once; the
plot area scrolls horizontally to pan. A sticky 300px label column sits on the
left.

### Why it loaded far-right (the bug)

The old initial-scroll `useEffect` set:

```
scrollLeft = xOf(previousQuarterStart)   // = 3/9 of plotWidth ≈ 660px
```

i.e. it placed the **previous** quarter at the left edge of the 1980px plot.
That is a fine target on narrow viewports, but the browser clamps `scrollLeft`
to `scrollWidth - clientWidth` (the max scroll). On a **wide** viewport the total
content (label 300 + plot 1980 + pad 16 = 2296px) barely exceeds the viewport, so
the max scroll shrinks toward ~660px. When the 660px target meets or exceeds the
max scroll it **clamps to the far right**, revealing the future quarters and
pinning the scrollbar to the end. The narrower harness window (~751px) hid the
bug because there the max scroll (~1545px) is far larger than 660px.

### What the fix changed

Minimal, UI-only change in the initial-scroll `useEffect` (kept the domain layer
pure — no `@forge` imports, no change to `timelineAxis.ts` or its tests). Instead
of pinning the *previous* quarter to the left edge, it now **centers the current
quarter within the visible plot region** (excluding the sticky label column) and
clamps to `[0, maxScroll]`:

```ts
const currentMidX = LABEL_W + (plotX(currentQuarterStart) + plotX(nextQuarterStart)) / 2;
const plotViewportCenter = (LABEL_W + node.clientWidth) / 2;
node.scrollLeft = clamp(currentMidX - plotViewportCenter, 0, maxScroll);
```

Result (verified in the harness at 900/1000/1440/1680px viewports): the current
quarter is in view, the previous quarter sits to its left, current + next are
visible, and the scrollbar is **no longer pinned to the far right** (~51% from
the right at every width). The 9-quarter bounded domain is unchanged.

## Open question — finite window vs. infinite scroll

Should the timeline stay a **finite, bounded window** (the current ~9-quarter
domain, 3 visible, pan within a fixed range) or become an **infinite / forever
bidirectional scroll** where the user can keep scrolling left/right to reveal
arbitrarily many past/future quarters? This is a **product decision** — not
implemented here.

### Option A — Finite bounded window (current)

Fixed domain (e.g. today ±4 quarters, 9 total), scroll pans within it.

- **Pros:** Simple, deterministic geometry (`xOf` is a closed-form map over a
  known domain); all data for the window can be fetched in one pass; predictable
  performance and layout; easy to reason about target diamonds and gridlines;
  no virtualization needed.
- **Cons:** Targets or readings dated **outside** the ±4-quarter window are
  invisible/unreachable (a long-dated target diamond simply falls off the
  domain); the bound is arbitrary; users planning far ahead or reviewing old
  history can't pan there; "empty" future quarters still render as blank plot.

### Option B — Infinite bidirectional scroll

Domain grows (or virtualizes) as the user scrolls; quarters are generated on
demand in both directions.

- **Pros:** No data is unreachable — any dated target/reading can be scrolled to;
  matches a "plan as far out / review as far back as you like" mental model;
  removes the arbitrary ±4 bound.
- **Cons / implementation implications:**
  - **Data fetching per quarter:** readings/targets must be fetched lazily by
    date range as new quarters scroll into view (the reading changelog is
    `bulkfetch`-based and KPI-global; targets live on issues) — needs windowed
    queries and caching, plus loading states for freshly revealed quarters.
  - **Performance:** the plot can't be a single fixed-width element; needs
    windowing/virtualization of quarters and rows, and re-anchoring `scrollLeft`
    when prepending past quarters on the left (to avoid content jump).
  - **Empty future quarters:** infinite empty quarters look aimless without a
    "no data beyond here" affordance or a soft bound.
  - **Target diamonds beyond the window:** need an off-window indicator (e.g. an
    edge chevron / "next target →") so users know to scroll to reach them.
  - Geometry becomes relative (offset-based) rather than the current absolute
    `xOf` over a fixed domain.

### Recommendation

Keep the **finite bounded window (Option A)** for v1 — it's shipping, simple, and
covers the common near-term planning horizon — but make the bound **data-aware**
rather than a hard ±4: expand `domainStart`/`domainEnd` to also encompass the
earliest/latest dated reading or target across the visible KPI tree (clamped to a
sane max), so long-dated targets are never stranded. That captures most of
Option B's benefit (nothing unreachable) without the lazy-fetch/virtualization
cost. Revisit true infinite scroll only if users demand open-ended long-range
planning.
