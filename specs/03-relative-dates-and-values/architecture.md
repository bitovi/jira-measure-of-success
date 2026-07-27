# Architecture — Relative Dates & Relative Values

Status: **Draft for build** · Scope: feature increment on top of the initial build
Reads with: [requirements.md](./requirements.md) (the WHAT/WHY) · [plan.md](./plan.md) (the sequenced build)
Prior art: [01-initial-build/plan.md §2](../01-initial-build/plan.md) · existing domain in `app/src/domain/**`

This is the **HOW it fits together** — the layering, data flow, module design, and the contracts each layer exposes. It sits between the requirements (agreed) and the plan (tasks). It changes **no stored schema**; the feature is almost entirely **new pure-domain resolution** plus **read-time DTO fields** and **UI**.

---

## 1. Design principles (carried from the initial build)

1. **Pure domain, zero `@forge/*`.** All new math (baseline, relative value, display-state, freeze) lives in `app/src/domain/resolve/**` as pure, Zod-guarded, exhaustively-tested TS. It never imports Forge or React.
2. **Resolve at read time, never snapshot.** A relative target's date and value are *derived* every read from the current rolled-up due date and reading series. Nothing durable goes stale (§5.2/FR-8). Freeze is a **computed display state**, not a write (§7).
3. **Two mocked seams.** The `invoke` (our resolver) and `requestJira` (Jira REST) boundaries are identical in the harness and in Forge, so every scenario renders locally.
4. **Stored schema unchanged.** `Assignment` (`targetType: 'absolute' | 'delta'`, `target: number`, `timing: DueTiming`) is untouched. `delta` is reinterpreted as a **percent of the value at the due date** (Q8). The only config-adjacent addition is an **optional rollup depth cap**.
5. **Injectable loader hooks.** Surfaces take a `usePanel`/`useTimeline` hook defaulted to the real-bridge hook, so stories inject canned scenarios for every state.

---

## 2. Layering & where each concern lives

```
app/src/
  domain/                 pure TS + Zod — NEW resolution modules (this feature's core)
    models/assignment.ts    (unchanged; delta = percent, read-time reinterpretation)
    resolve/
      effectiveTiming.ts    (extend: depth-cap option → the DUE DATE)
      relativeTargetDate.ts (existing; the DATE half)          ── unchanged
      readingSeries.ts      (existing; ReadingPoint[])          ── input
      targetStatus.ts       (existing; valueAt, hit/miss)       ── reused
      baseline.ts           ★NEW  baselineAt(readings, dueDate)
      relativeTargetValue.ts★NEW  baseline × (1 + percent) → ResolvedTargetValue
      displayState.ts       ★NEW  the 8 FR-26 states + warnings
      freeze.ts             ★NEW  compute-on-read frozen {date,value}
  contracts.ts            EXTEND: ResolvedTargetValueDto, BaselineState, displayState, undated lane
  backend/                Forge resolver + Jira REST — assembles inputs, calls domain
    resolver.ts             getPanelData / getTimelineData now attach resolved value + state
    jira.ts                 bounded subtree fan-out (FR-21)
  ui/                     Custom UI (React) — renders DTOs, no math
    surfaces/IssuePanel/    TargetValueEditor (NEW, shared), SavedTargetCard (NEW)
    surfaces/Timeline/      provisional markers, Undated lane, ProjectionModal (NEW)
    surfaces/Settings/      depth-cap control (NEW)
    data/                   loader hooks (the invoke seam)
  test-harness/           mock-resolvers.ts mirrors the resolver's new outputs
```

**Rule of thumb:** if it's a *number or a state*, the **domain** computes it; the **backend** only gathers inputs (due date, readings, closed-flag) and forwards the DTO; the **UI** only formats (`≈`, `~`, bold, pills). No arithmetic in React.

---

## 3. The resolution pipeline (read path)

For one relative target on one contributing issue:

```mermaid
flowchart TD
  A[Assignment: targetType=delta, target=percent, timing] --> R
  B[Issue subtree TimingNodes] --> ET[effectiveTiming + depth cap]
  ET --> DUE[Due date = effectiveTiming.due]
  DUE --> RD[resolveRelativeTargetDate → target DATE]
  C[Reading changelog] --> RS[readingsFromChangelog → ReadingPoint[]]
  DUE --> BL[baselineAt readings, dueDate → value + state]
  RS --> BL
  BL --> RV[resolveRelativeTargetValue → baseline × 1+percent]
  R[percent] --> RV
  RD --> DS[displayState: today vs due vs targetDate]
  RV --> DS
  RS --> DS
  DS --> FZ{closed AND due in past?}
  FZ -- yes --> FR[freeze → fixed date,value snapshot]
  FZ -- no --> OUT[ResolvedTargetValueDto + displayState]
  FR --> OUT
```

**Ordering matters:** the **due date** is resolved first (it's the anchor for *both* the target date and the baseline). Then baseline → value, and date → status, converge in `displayState`, which finally decides pill + warning. Freeze is a terminal check that, when it fires, replaces the live numbers with a snapshot from actuals.

---

## 4. Domain module contracts (the new pure API)

### 4.1 `baseline.ts`
```ts
type BaselineState =
  | 'baselined'      // reading covers the due date (measured or interpolated)
  | 'provisional'    // no reading covers it → last reading flat-carried
  | 'needsBaseline'; // zero readings → no number

interface Baseline {
  value: number | null;   // null only when needsBaseline
  state: BaselineState;
  from: IsoDate | null;    // which reading date the value came from
  kind: 'measured' | 'interpolated' | 'carried' | 'none';
}

baselineAt(readings: readonly ReadingPoint[], dueDate: IsoDate | null): Baseline
```
- **measured** — a reading lands exactly on `dueDate`.
- **interpolated** — `dueDate` is bracketed by two readings → linear interpolation.
- **carried** — no reading covers it → `valueAt(readings, last)` flat-carried, `state: provisional`. **No trend.** Measured readings only (other work items' future targets ignored, §5.3/FR-9a).
- **none** — zero readings → `state: needsBaseline`, `value: null` (FR-9b).
- `dueDate === null` (pending) → carried from the **last** reading (the "assume due today" provisional, FR-13/Q2).

### 4.2 `relativeTargetValue.ts`
```ts
interface ResolvedTargetValue {
  value: number | null;      // baseline × (1 + percent/100), or absolute passthrough
  baseline: number | null;
  baselineDate: IsoDate | null;
  baselineFrom: IsoDate | null;
  state: BaselineState;
  provisional: boolean;      // true unless state === 'baselined'
}

resolveRelativeTargetValue(
  assignment: Assignment,
  ctx: { dueDate: IsoDate | null; readings: readonly ReadingPoint[] },
): ResolvedTargetValue
```
- `targetType === 'absolute'` → `{ value: assignment.target, state: 'baselined', provisional: false }` (passthrough).
- `targetType === 'delta'` → `baselineAt(...)` then `baseline × (1 + target/100)`. The author's sign carries; KPI direction is only for hit/miss (FR-10).

### 4.3 `displayState.ts`
```ts
type DisplayState =
  | 'projected' | 'provisional' | 'baselined' | 'needsMeasurement'
  | 'met' | 'missed' | 'resultUnknown' | 'needsBaseline';

type TargetWarning = 'staleBaseline' | 'unconfirmedResult' | 'needsBaseline' | null;

displayState(input: {
  valueState: BaselineState;
  today: IsoDate;
  dueDate: IsoDate | null;
  targetDate: IsoDate | null;
  readings: readonly ReadingPoint[];
  direction: KpiDirection | null;
  target: number | null;      // resolved target value, for met/missed
}): { state: DisplayState; warning: TargetWarning }
```
The single source of truth for the **8 states** of FR-26 (pill) and the **two warnings** of FR-26a. Pure function of `{baseline state, today vs due date, today vs target date}` — testable in isolation (§7-#9, #10).

### 4.4 `freeze.ts`
```ts
freezeIfDone(
  assignment: Assignment,
  ctx: { closed: boolean; dueDate: IsoDate | null; today: IsoDate; readings: readonly ReadingPoint[] },
): { date: IsoDate; value: number } | null
```
Returns a snapshot **only** when `closed && dueDate !== null && dueDate < today` (FR-16). **Compute-on-read**: pure, no write, no job. When it returns non-null, the resolver uses the snapshot instead of the live value; the assignment stays `delta`+relative in storage (§7-#11, Q5).

### 4.5 `effectiveTiming.ts` (extend)
Add an optional **depth cap** to the rollup config: below the configured level, an issue's own date (or nothing) is used instead of descending into its subtree (FR-19). Default = no cap. This is the only change to an existing domain module.

---

## 5. Contracts (the `invoke` seam) — additive to `contracts.ts`

```ts
// read-time resolution attached to each row/target
interface ResolvedTargetValueDto {
  value: number | null;
  baseline: number | null;
  baselineDate: string | null;
  baselineFrom: string | null;
  state: 'baselined' | 'provisional' | 'needsBaseline';
  provisional: boolean;
}

interface PanelRowDto {
  // …existing…
  resolvedValue: ResolvedTargetValueDto | null;   // NEW
  displayState: DisplayState | null;              // NEW (8 states)
  warning: TargetWarning;                         // NEW
  frozen: boolean;                                // NEW (compute-on-read)
}

interface TimelineTargetDto {
  date: string | null;      // CHANGED: null = pending/undated
  value: number;
  status: TargetStatus;
  provisional: boolean;     // NEW — estimate marker (FR-23)
  source: { issue: string; type: string; title: string; iconUrl?: string | null };
}

interface TimelineNodeDto {
  // …existing…
  undated: TimelineTargetDto[];   // NEW — right-pinned lane (FR-24)
  resolving?: boolean;            // NEW — progressive-load shimmer (FR-20/25)
}
```
Both the Forge resolver and the harness `mock-resolvers.ts` must produce these exact shapes (contract parity), so surfaces behave identically.

---

## 6. Backend responsibilities (no math, just assembly)

- **`getPanelData(issueId)`** — for each assignment: resolve due date (`effectiveTiming`), target date (`resolveRelativeTargetDate`), fetch readings (`fetchReadingChangelog` → `readingsFromChangelog`), then call `resolveRelativeTargetValue` + `displayState` + `freezeIfDone`, and attach the DTO fields. The `closed` flag comes from the issue's status category.
- **`getTimelineData()`** — same per-node resolution across the tree; **pending** targets (`date === null`) are routed into `node.undated`; dated ones become markers with `provisional`.
- **Bounded fan-out (FR-21)** — rolling up a due date may need many descendants. Reuse the initial build's **bulk** patterns (`fetchSubtreeTimingNodes`, changelog `bulkfetch`), cap/batch reads, and never issue unbounded sequential requests. Depth cap (FR-19) bounds how deep the subtree load goes.
- **Progressive resolution (FR-20)** — the resolver returns cheap data first (absolute targets, loaded values) with `resolving: true` on nodes whose relative/rolled-up targets are still being computed; a follow-up resolve fills them in. First paint never blocks on a slow subtree.

---

## 7. UI responsibilities (format only)

- **`TargetValueEditor` (NEW, shared)** — type select `Absolute value | Percent change` + adaptive input (`%` suffix, sign) — mirrors `TargetDateEditor`, used by **both** `AssociateForm` and `TrackedRow` (closes the FR-1a gap where edit had no type control).
- **`SavedTargetCard` (NEW)** — two stacked rows (value + date) with `↳` resolved notes, the **status pill** (reads `displayState`), warning strip in the concerned row, subtle **Edit/Remove** footer. Bolds user intent; renders `≈` for `provisional`, `~` for projected dates.
- **Timeline** — provisional markers rendered distinct (hollow/dashed + `≈` tooltip, Q7); the **Undated lane** (right-pinned) renders `node.undated` chips; the **ProjectionModal** opens from a chip; rows with `resolving` show a shimmer.
- **Settings** — a depth-cap control writing the new rollup option.

All formatting glyphs (`≈`, `~`, bold intent, `YYYY-MM-DD`) are UI concerns; the state that drives them comes pre-computed from the domain.

---

## 8. Freeze: compute-on-read (why, and the boundary)

Freezing stabilizes a finished target so it stops moving and stops costing re-rollup. Two implementations were considered:

| | **Compute-on-read (v1)** | **Write-based (deferred)** |
|---|---|---|
| Mechanism | `freezeIfDone` returns a snapshot when `closed && past-due`; resolver substitutes it | A job/action writes an absolute `{date,value}` back to the assignment |
| Stored data | **Unchanged** (`delta` + relative) — frozen is *derived* | Assignment mutated to `absolute` |
| Cost / risk | No write path, no migration, no race; re-derived each read | Durable + cheaper reads, but needs a trigger + snapshot storage (Q9) |

v1 chooses compute-on-read: the target *presents* as frozen (a `frozen: true` DTO flag + a "final" affordance) without any new write path (Q5). The write-based path (Q5/Q9) is explicit future work.

---

## 9. Testing strategy (mirrors the layering)

- **Domain (Vitest, exhaustive):** `baseline` (measured/interpolated/carried/none), `relativeTargetValue` (absolute passthrough + percent), `displayState` (8-state × 2-warning matrix), `freeze` (fires only when closed+past-due), depth cap. All pure — §7-#1…#12.
- **Panel (portable stories, jsdom):** the 8 saved states, both authoring modes, the provisional-when-pending estimate — §7-#7, #9, #10.
- **Timeline (portable stories):** dated + provisional + undated + loading; chip → modal — §7-#13, #14.
- **Contract parity:** harness `mock-resolvers.ts` outputs the same DTOs as the resolver; fixtures validated against the Zod schemas.
- **Browser verification:** Copilot browser tools against the two mocks (semantic/regression, native Atlaskit look).

---

## 10. Open questions that shape this doc (from requirements §9)

- **Q7** — provisional marker visual (hollow/dashed + `≈` tooltip). Affects §7 only; no domain impact.
- **Q10** — Undated lane placement (right-pinned per row). Affects `TimelineNodeDto.undated` rendering only.
- **Q5/Q9** — if freeze later becomes a write, §5 gains a mutation contract and §8's right column ships; the domain `freeze.ts` stays the same (its output just gets persisted).

All other §9 questions are **resolved** for v1 (Q1 baseline=due date, Q2 assume-today, Q3 flat-carry+interpolate, Q4 months only, Q6 no default cap, Q8 delta=percent) and are baked into §2 and §4.
