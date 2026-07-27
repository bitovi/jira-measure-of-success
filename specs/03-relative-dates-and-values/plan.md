# Implementation Plan — Relative Dates & Relative Values

Status: **Ready to build** · Scope: feature increment on top of the initial build
Reads with: [requirements.md](./requirements.md) · [architecture.md](./architecture.md) · [issue-panel.html](./issue-panel.html) · [kpi-tree.html](./kpi-tree.html)
Prior art: [01-initial-build/plan.md](../01-initial-build/plan.md) · [best tree mock](../02-kpi-more-space/kpi-timeline-proposed.html)

This is the **HOW**. It sequences the feature into phases, each with concrete tasks, files, acceptance criteria (mapped to the requirements' `FR-*` and §7 slices), and verification. It reflects the resolved v1 decisions (§9-Q1…Q10) and the `Absolute value | Percent change` scope simplification.

---

## 1. What already exists (reuse, don't rebuild)

Verified against the code (`app/src/domain/**`, `app/src/ui/surfaces/IssuePanel/**`).

| Concern | Existing asset | This feature's use |
|---|---|---|
| Relative **timing** | `DueTiming` (`models/assignment.ts`) — `mode`, `anchor` (`issueDueDate\|parentDueDate\|kpiStart`), `offsetMonths` | Keep as-is; label `issueDueDate` as **"due date"** (UI copy only, no new enum) |
| Due-date **rollup** | `effectiveTiming(node) → { start, due }` + `resolveConfig` (`resolve/effectiveTiming.ts`) | Consume `.due` as the due date; add a **depth cap** option (FR-19) |
| Relative target **date** | `resolveRelativeTargetDate(timing, ctx, kpiStart) → { date, pending, source }` | Unchanged; the **date** half of resolution |
| Reading **series** | `readingsFromChangelog(...)` → `ReadingPoint[]` (`resolve/readingSeries.ts`) | Input to the new **baseline** projection |
| Value **at a date** | `valueAt(readings, iso)` (`resolve/targetStatus.ts`) — last-on-or-before | Basis for the **provisional** (flat-carry) baseline |
| Hit/miss **status** | `targetStatus(target, readings, direction, asOf)` | Status classification for resolved targets |
| Target **type** | `TargetType = 'absolute' | 'delta'` (`models/assignment.ts`); stored `target: number` | `delta` = **percent** of the value at the due date (`1` = +1%) |
| Panel **form** | native `<label>`-wrapped `<select>`/`<input>`; shared `TargetDateEditor`; `targetType` select lives **only** in `AssociateForm` | Extend both paths (FR-1a) |
| Payload **contracts** | `PanelRowDto`, `ResolvedTargetDateDto`, `TimelineNodeDto` (`contracts.ts`) | Extend with resolved value + baseline state DTOs |

**Key gap (FR-1a):** `TrackedRow` (the inline **edit** path) has **no** target-type control and no baseline field — it edits value + date only. A shared value/type editor (mirroring `TargetDateEditor`) must be extracted so target type + percent are editable, not just set at creation.

---

## 2. Data-model decisions (v1)

Per §9 resolutions — **no new schema fields**:

- `targetType` stays `'absolute' | 'delta'`. `delta` now means **"percent of the KPI value at the due date"**; the stored `target` number **is the percent** (`1` = +1%). (Q8)
- Baseline is **fixed = value at the due date** — not a stored/user-chosen anchor. (Q1)
- Baseline model = **flat-carry + interpolate, measured readings only, no trend**. (Q3)
- Freeze = **compute-on-read** (a target *presents* as frozen when closed + past-due); **no** new write path in v1. (Q5)
- Depth cap = a new **option on the rollup**, default **no cap**. (Q6)

The only schema-adjacent change is an **optional depth-cap field** on the rollup config (defaulting to unset), plus new **read-time DTO** fields (below). Nothing on the stored `Assignment` changes.

---

## 3. New/extended contracts (DTOs)

Additive to `contracts.ts` — surfaces and both resolvers must agree:

- **`BaselineState`** — `'baselined' | 'provisional' | 'needsBaseline'` plus the sub-context for provisional (`'projected' | 'pending' | 'needsMeasurement'`).
- **`ResolvedTargetValueDto`** — `{ value: number | null; baseline: number | null; baselineDate: string | null; baselineFrom: string | null; state: BaselineState; provisional: boolean }`.
- **`PanelRowDto`** — add `resolvedValue: ResolvedTargetValueDto | null` and a combined **`displayState`** (the 8 states of FR-26).
- **`TimelineTargetDto`** — add `provisional: boolean` (estimate marker, FR-23) and allow `date: null` for **pending/undated** targets (FR-24); add a per-node `undated: TimelineTargetDto[]` lane list.
- **`TimelineNodeDto`** — add `resolving?: boolean` (progressive-load shimmer, FR-20/FR-25).

---

## 4. Build sequence

De-risk the pure value logic first, then the panel (authoring + saved states), then the tree.

### Phase 1 — Baseline & relative-value domain (pure TS, TDD) — *no UI, no Jira*

The novel, riskiest logic. Sibling to `resolveRelativeTargetDate`.

| Task | Files | Verify (AC) |
|---|---|---|
| `baselineAt(readings, dueDate) → { value, state, from }` — **measured** (reading on date), **interpolated** (bracketed), else **provisional** flat-carry (last reading, `from` = its date), else `needsBaseline` (zero readings). Measured readings only. | `domain/resolve/baseline.ts` (+`.test.ts`) | §7-#1, #2, #3, #5, #8 |
| Linear **interpolation** helper for a date bracketed by two readings | `domain/resolve/baseline.ts` | §7-#3 |
| `resolveRelativeTargetValue(assignment, { dueDate, readings }) → ResolvedTargetValueDto` — `absolute` passes the value through; `delta` computes `baseline × (1 + percent/100)`, propagating baseline state + `provisional` | `domain/resolve/relativeTargetValue.ts` (+`.test.ts`) | §7-#1, #2, #6, #8; FR-9…FR-11 |
| `displayState({ valueState, today, dueDate, targetDate, readings, direction })` → one of the **8** FR-26 states + which warning (if any) | `domain/resolve/displayState.ts` (+`.test.ts`) | §7-#9, #10; FR-26/26a |
| `freezeIfDone(assignment, { closed, dueDate, today, readings })` → frozen `{ date, value }` \| null (compute-on-read; **no write**) | `domain/resolve/freeze.ts` (+`.test.ts`) | §7-#11; FR-16…FR-18 |
| Depth-cap option on rollup: `effectiveTiming` stops descending below the configured level | `domain/resolve/effectiveTiming.ts` (extend), `resolveConfig.ts` | §7-#12; FR-19 |

**Gate:** `npm test` green; the 8-state matrix and both warnings covered; interpolation vs flat-carry vs measured all distinguished; zero-reading path never fabricates a number.

### Phase 2 — Issue panel: authoring + saved states — headline

Mock: [issue-panel.html](./issue-panel.html). Native `<select>`/`<input>` — **not** pills.

| Task | Files | Verify (AC) |
|---|---|---|
| **Extract a shared `TargetValueEditor`** (type select `Absolute value | Percent change` + adaptive value input with `%` suffix + sign) mirroring `TargetDateEditor`; use in **both** `AssociateForm` and `TrackedRow` (FR-1a) | `ui/surfaces/IssuePanel/TargetValueEditor.tsx` (+ wire into `IssuePanel.tsx`) | FR-1, FR-1a, FR-2 |
| Relabel timing select to **Fixed date | Relative date** with `[ N ] months after due date`; date-note label = **"Rolled up due date"** vs **"Due date"**, source issue hidden | `ui/surfaces/IssuePanel/*` (`TargetDateEditor`) | FR-3, FR-7 |
| **Two live `↳` notes**: value note (`Current value: X {unit} → targeting **Y** {unit}`) + date note (`Rolled up due date: D → targeting **T**`); `≈` on provisional values, `~` on projected dates | `ui/surfaces/IssuePanel/*` | FR-5, FR-11 |
| **Validation**: percent allows negatives; zero readings → *"needs a baseline reading"* (no fabricated number) | `ui/surfaces/IssuePanel/*` | FR-6, FR-9b |
| **Saved-target card** — Target value row + Target date row (recap + `↳` note), **status pill** (8 states) top-right, warning strip in the concerned row, **Edit / Remove** subtle footer bottom-right; bold the user-set intent (`+10%`, `3 months after due date`) | `ui/surfaces/IssuePanel/SavedTargetCard.tsx` | FR-26…FR-28; §7-#7, #9, #10 |
| Resolver + hook: `getPanelData` returns `resolvedValue` + `displayState` per row (uses Phase 1 domain over readings + due date) | `backend/resolver.ts`, harness `mock-resolvers.ts`, `ui/data/usePanel/*` | mock-bridge parity |
| Provisional **issue-page estimate** when due date is pending (last value × (1+percent), assume due today, pill *Provisional*, date *TBD*) | domain wiring + panel | FR-13; §7-#7 |

**AC:** FR-1, FR-1a, FR-2, FR-3, FR-5, FR-6, FR-12, FR-13, FR-26…FR-28; §7-#7, #9, #10. **Gate:** green; panel stories cover the 8 saved states + both authoring modes; browser-verified against the mock.

### Phase 3 — KPI tree: dated markers + undated lane + progressive load

Mock: [kpi-tree.html](./kpi-tree.html) (based on the best tree mock).

| Task | Files | Verify (AC) |
|---|---|---|
| Resolver/`getTimelineData`: for each relative target compute resolved `{date, value}` + `provisional`; **pending** targets (`date: null`) go to the node's `undated` lane | `backend/resolver.ts`, harness `mock-resolvers.ts` | §7-#6, #13 |
| **Dated relative markers** at their resolved date with status; **provisional markers visually distinct** (hollow/dashed + `≈` in tooltip, Q7) | `ui/surfaces/Timeline/*` | FR-22, FR-23; §7-#14 |
| **"Undated" lane** pinned right of each row; chips show estimated value; empty when none | `ui/surfaces/Timeline/*` | FR-24; Q10 |
| **Projection modal** from a chip (or estimated marker): sentence form, provisional baseline + source reading, estimated value, provisional date if any, link to contributing issue | `ui/surfaces/Timeline/ProjectionModal.tsx` | FR-24, §6.3; §7-#14 |
| **Progressive loading**: first paint renders cheap markers immediately; rows still resolving show a **shimmer**; relative/rolled-up targets fill in as subtrees resolve; batch/cap Jira reads | `ui/surfaces/Timeline/*`, `backend/jira.ts` (bounded fan-out) | FR-20, FR-21, FR-25; §7-#13 |

**AC:** FR-22…FR-25, FR-19…FR-21; §7-#13, #14. **Gate:** green; timeline stories cover dated + provisional + undated + loading; browser-verified; slow subtree does not block first paint.

### Phase 4 — Settings: rollup depth cap + integration polish

| Task | Files | Verify (AC) |
|---|---|---|
| Settings control for the **depth cap** (per §5.7; default no cap, with a "cap on large sites" recommendation) | `ui/surfaces/Settings/*`, resolver save/read | FR-19 |
| End-to-end wiring review across surfaces; harness fixtures for every FR-26 state + a pending/undated case + a freeze case | fixtures, stories | §7 full |
| `ready-to-push` gate (test + lint + build) once, at the end | — | all green |

---

## 5. Per-task workflow (every task)

Same Superpowers loop as the initial build (constitution-honoring):

```
1. (UI) confirm/adjust the mock → it's the visual target
2. write the failing test (RED)            ← domain: Vitest; UI: portable-story test
3. minimal code to pass (GREEN)
4. wire Custom UI to the mock bridge / loader hook
5. screenshot via Copilot browser tools → verify vs mock
6. code-reviewer agent on non-trivial changes
7. commit with evidence (test output + screenshot)
```

**Boundaries enforced:** domain stays pure (zero `@forge/*`); the `invoke`/`requestJira` seams stay mocked in the harness; the stored `Assignment` schema is unchanged (only read-time DTOs + an optional rollup depth-cap field are added).

---

## 6. Acceptance-criteria coverage map (requirements §7)

| # | Slice | Phase | Home |
|---|---|---|---|
| 1 | Percent vs baselined value | 1 | `baseline.ts` / `relativeTargetValue.ts` |
| 2 | Percent vs provisional baseline | 1 | `baseline.ts` |
| 3 | Interpolation at the due date | 1 | `baseline.ts` |
| 4 | Due date drives target date | 1 | (existing `resolveRelativeTargetDate` + `effectiveTiming`) |
| 5 | Measured-only baseline | 1 | `baseline.ts` |
| 6 | Pending date, present value | 1 | `relativeTargetValue.ts` |
| 7 | Provisional issue-page estimate | 2 | panel + domain |
| 8 | Zero vs one reading | 1 | `baseline.ts` |
| 9 | Display-state classification (8) | 1 + 2 | `displayState.ts` + panel story |
| 10 | Two warnings fire correctly | 1 + 2 | `displayState.ts` + panel story |
| 11 | Freeze | 1 | `freeze.ts` |
| 12 | Depth cap | 1 | `effectiveTiming.ts` |
| 13 | Tree renders before slow subtrees | 3 | Timeline story |
| 14 | Undated chip → modal; estimated markers distinct | 3 | Timeline story |

---

## 7. Deferred / out of scope (this increment)

Per requirements §2 / §10:

- **Amount change** (absolute-amount delta) and **Rate of change** (trend/growth) target types — reserved label siblings, not built.
- Configurable baseline ("Measured from" picker) — dropped; baseline is always the value at the due date.
- Trend/slope extrapolation, ML, seasonality, confidence intervals.
- Child→parent value aggregation / coverage / summing; value inheritance down the chain.
- Sprint-derived due dates.
- A **durable** freeze write path + snapshot storage (Q5/Q9) — v1 freezes compute-on-read only.

---

## 8. Open items carried from requirements §9 (non-blocking)

- **Q7 — Estimated-marker visual:** provisional = hollow/dashed marker + `≈` in tooltip (confirm in mock review, Phase 3).
- **Q10 — Undated lane placement:** right-pinned per-row lane (mock's approach); revisit if it crowds narrow screens.
- **Q5 — Freeze mechanics:** compute-on-read in v1; a background reconciliation write is future work.

---

## 9. Suggested first move

**Phase 1** — the baseline/value domain (`baseline.ts` → `relativeTargetValue.ts` → `displayState.ts` → `freeze.ts` → depth cap). Pure TS, TDD, no Jira, unblocks both the panel and the tree. Then the Issue panel (authoring + 8 saved states), then the KPI tree (undated lane + progressive load), then the Settings depth cap.
