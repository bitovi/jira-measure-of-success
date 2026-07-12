# Implementation Plan — Measure of Success (Initial Build)

Status: **Ready to build** · Repo: [bitovi/jira-measure-of-success](https://github.com/bitovi/jira-measure-of-success)
Reads with: [constitution.md](./constitution.md) · [requirements.md](./requirements.md) · [tech-choices.md](./tech-choices.md) · [positioning.md](./positioning.md)

This is the **HOW**. It sequences the v1 slice (Issue panel, KPI Timeline v2, Settings — Due Date Rollup) into phases, each with concrete tasks, files, acceptance criteria (mapped to requirements story IDs), and verification. It reflects all resolved decisions (Q1–Q12) and the parked/roadmap items.

---

## 1. Current state (Phase 0 — DONE)

Already built and green (**22 tests, typecheck clean**):

- **Scaffold** — `app/` (Vite + React + Tailwind + Vitest), `.gitignore`, git on `main`.
- **Domain (pure TS + Zod, no `@forge/*`):**
  - Models: `KpiDefinition`, `Assignment` (target-only, per Q2), `RollupConfig`, `ReportingEntry`.
  - `effectiveDueDate` (§6.1) — recursive, memoized, cycle-guarded; **fully tested** (all 5 methods + pending).
  - `resolveInheritance` — **parked** (kept + tested, unused; Q11).
- **Harness** — `test-harness/mock-bridge.ts` aliases `@forge/bridge`; fixtures validated against the Zod schemas.
- **Backend** — `@forge/resolver` skeleton + `requestJira` parent-walk + KVS config read/write; keys mirror the mock bridge.
- **Forge manifest** (`app/manifest.yml`), `.claude` skills + `code-reviewer` agent installed.

Nothing is committed yet; no Forge dev site (deferred).

---

## 2. Architecture (recap)

```
app/src/
  domain/     pure TS + Zod — models, resolvers (no @forge/*). 100% unit-tested.
  backend/    Forge resolver + Jira REST + storage adapters. Imports domain.
  ui/         Custom UI (React). Imports domain TYPES only. Atlaskit + Tailwind(tokens).
  test-harness/  Vite entry + mock-bridge + fixtures. Local dev + computer-vision.
```

**Storage map** (all Jira-native or Forge, per brief + Q6):

| Data | Where | Writable by |
|---|---|---|
| KPI assignments (targets) | Jira **issue entity property** `kpi-assignments` | app + Jira REST/MCP |
| **KPI readings** (recorded values) | Jira **issue entity property** `kpi-readings-{kpiId}` (Q6) | app + Jira REST/**CascadeMCP** |
| KPI catalog | Forge **KVS** `kpi:def:{id}` | app only |
| Rollup config | Forge **KVS** `kpi:config:rollup` | app only |
| Reporting index | Forge **Custom Entity Store** (deferred — reporting out of scope) | app only |

**The two mocked seams** (harness ↔ real): `invoke` (our resolver) and `requestJira` (Jira REST).

---

## 3. Data models to build (Zod, domain-first)

Already exist: `KpiDefinition`, `Assignment`, `RollupConfig`. To add:

- **`KpiReading`** — `{ date: IsoDate, value: number, recordedBy: string, recordedAt: number }`.
- **`KpiReadingsProperty`** — `{ readings: KpiReading[] }` (the entity-property value at key `kpi-readings-{kpiId}`).
- **`labelsFor(childName, selfName)`** — a pure helper producing the five per-level option labels. **Rollup behavior** is ported from `jira-timeline-report` (`dates.ts`) and is authoritative (Constitution §1a); **label wording** follows [settings.html](../00-mocks/settings.html). Default option = `widestRange`.
- **Timing node carries `{ start, due }`** — the hierarchy node exposes its own `start`/`due`; `effectiveTiming` rolls up the pair (§5.2). v1 reads `due` for single-date displays.

No `aggregation` field on `KpiDefinition` (parked, Q11). `ReportingEntry` stays as-is for the deferred reporting index.

---

## 4. Build sequence

Ordered to **de-risk pure logic first**, then smallest UI, then the headline surfaces. Each phase ends **green + screenshot-verified**.

### Phase 1 — Timing domain (pure TS, TDD) — *no UI, no Jira*
The riskiest remaining logic; unblocks both Settings and the panel/timeline dates.

| Task | Files | Verify |
|---|---|---|
| **Port the rollup engine** from `jira-timeline-report` (`src/jira/rollup/dates/dates.ts`) verbatim; generalize the current `effectiveDueDate` to `effectiveTiming(node) → { start, due }` over the ported methods | `domain/resolve/effectiveTiming.ts` (+`.test.ts`) | Port `dates.test.ts` cases + DUE-1…DUE-9 (assert `due`; `start` symmetric) |
| `resolveConfig(stored, levels) → fully-populated { levelName: method }` (unconfigured → `widestRange`, leaf → `parentOnly`) so form + engine share one default source | `domain/resolve/resolveConfig.ts` (+`.test.ts`) | Defaults applied; engine fallback never triggers |
| `resolveRelativeTargetDate(assignment, { effectiveTimingOf, parentTimingOf, kpiStart }) → { date \| null (pending), source }` (§5.3) | `domain/resolve/relativeTargetDate.ts` (+`.test.ts`) | Tests **REL-1…REL-7** |
| `labelsFor(childName, selfName)` — five option labels, wording per settings.html | `domain/models/config.ts` (extend) | Unit-test label interpolation |
| Add `KpiReading` / `KpiReadingsProperty` models | `domain/models/kpiReading.ts` | Schema round-trip tests |

**Gate:** `npm test` green; ported engine matches `dates.test.ts`; `resolveRelativeTargetDate` covers pending + offset-0 + all three anchors.

### Phase 2 — Settings: Due Date Rollup (global admin page)
Smallest surface; visually proves `effectiveDueDate` + `resolveRelativeTargetDate`. Mock: [settings.html](../00-mocks/settings.html).

| Task | Files | Verify |
|---|---|---|
| Hierarchy discovery (issue-type metadata → ordered levels, runtime, never hardcoded) | `backend/jira.ts` | Unit test with mocked REST |
| Resolver: `getRollupConfig` / `saveRollupConfig` (done) + `getHierarchyLevels` | `backend/resolver.ts` | mock-bridge parity |
| Settings UI — one dropdown per discovered level, 5 methods w/ interpolated labels, save/reset, leaf disabled | `ui/surfaces/Settings.tsx` | Screenshot vs mock |
| ~~Read-only relative-date **preview** table~~ | — | **DROPPED (2026-07-12)** — see requirements ST-4; the only Settings control is Due Date Rollup |

**AC:** ST-1, ST-2, ST-3. (~~ST-4~~ dropped.) **Gate:** tests green; Settings screenshot matches the mock's structure.

### Phase 3 — Issue panel (independent targets) — headline
Mock: [issue.html](../00-mocks/issue.html). **No inheritance** (Q11) — grouped independent targets.

| Task | Files | Verify |
|---|---|---|
| `groupByRelationship(ownAssignments, parentAssignments, catalog)` → `sharedWithParent / onlyHere / onParentNotTracked` (pure) | `domain/resolve/panelGrouping.ts` (+test) | Unit tests incl. empty/edge |
| Resolver: `getPanelData(issueId)` — own + parent assignments, catalog, resolved target dates | `backend/resolver.ts` | mock-bridge parity |
| Resolver: `saveAssignment` / `removeAssignment` / `defineKpi` (KVS + entity property, batched) | `backend/resolver.ts`, `backend/storage.ts` | Round-trip tests |
| Panel UI — grouped rows (name/unit/target value/resolved target date + source); **Edit / Remove**; **Associate** existing; **+ Track this**; **Define new…** inline; absolute vs relative target-date control; empty + error + loading states | `ui/surfaces/IssuePanel.tsx` | Screenshot vs mock; behavior tests |

**AC:** IP-1, IP-4, IP-5, IP-6, IP-7, IP-8, IP-9, IP-10. **Deferred:** IP-2, IP-3 (inheritance). **Gate:** green; panel screenshot matches the mock's three groups + associate form.

### Phase 4 — KPI Timeline v2 — headline, most complex
Mock: [kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html). New scope from Q5 (3-quarter window + **horizontal scroll**).

| Task | Files | Verify |
|---|---|---|
| Readings adapter (read/write `kpi-readings-{kpiId}` entity properties) | `backend/readings.ts` | Round-trip; schema-validated |
| `targetStatus(target, readings, direction, asOf) → hit \| missed \| upcoming` (pure) | `domain/resolve/targetStatus.ts` (+test) | Status matrix (past/future/none-recorded) |
| Date-axis math: 3-quarter default window centered on today + scroll offset → x-position mapping (pure) | `domain/resolve/timelineAxis.ts` (+test) | Position tests; today marker; no clipping |
| Resolver: `getTimelineData` (catalog + per-issue targets + readings across tree) ; `recordValue(issueId, kpiId, {date,value})` | `backend/resolver.ts` | mock-bridge parity |
| Timeline UI — nested rows (collapse/expand), shared **scrollable** axis, sparklines, target diamonds w/ status + source, drill-in, **Record a value** modal | `ui/surfaces/Timeline.tsx` | Screenshot vs mock; scroll interaction |

**AC:** TL-1…TL-7. **Gate:** green; timeline screenshot matches; scroll pans quarters; modal writes a reading (harness) and the sparkline updates.

### Phase 5 — Integration & polish (needs a Forge dev site — deferred)
| Task | Notes |
|---|---|
| `forge register` / `deploy` / `install` on a dev site | Requires Node 22 + Forge CLI + Premium hierarchy (brief §11) |
| `forge tunnel` smoke of all three surfaces | Swap mock bridge → real |
| `jira:entityProperty` JQL index for KPI-centric queries | Brief §6 |
| README (choices, setup, storage), loading/error polish | Brief Phase 7 |

---

## 5. Per-task workflow (every task)

Superpowers loop, honoring the constitution:

```
1. (UI) confirm/adjust the mock → it's the visual target
2. write the failing test (RED)            ← domain: Vitest; UI: behavior test
3. minimal code to pass (GREEN)
4. wire Custom UI to the mock bridge
5. screenshot via Copilot browser tools → verify vs mock (semantic/regression)
6. code-reviewer agent on non-trivial changes
7. commit with evidence (test output + screenshot)
```

**Boundaries enforced:** domain has zero `@forge/*`; all external data parsed with Zod at the boundary; targets/readings are Jira-native (external-tool writable).

---

## 6. Testing & verification

- **Domain** — Vitest, exhaustive matrices (INH parked, DUE, REL, targetStatus, grouping, axis).
- **Fixtures** — validated against production Zod schemas (drift guard).
- **Components** — Vitest + Testing Library for behavior; **Copilot browser tools** for visual verification against the mocks (native Atlaskit look, so regression + semantic review, not pixel-diff — except the **timeline geometry** which is diffed with loose tolerance).
- **Integration** — `forge tunnel` (Phase 5).

---

## 7. Deferred / roadmap (explicitly NOT v1)

- **Value inheritance** (`resolveInheritance` parked) and **aggregation/coverage/summing** (Q11) — distinct metrics + unit mismatches; design-explored in `coverage.html` / `kpi-timeline-v3.html`, not adopted.
- **Per-project date-field configuration** (Timeline-Report parity) and **sprint-derived dates** (§5.7, Q12).
- **Sister-project interop** — extract timing (`effectiveDueDate` + resolution) into a shared package; `kpi-*` entity-property schema as the shared contract; **CascadeMCP** get/set tool for readings (tech-choices §12).
- **Reporting page** + coverage indicator, notifications, cross-project rollups.

---

## 8. Open items (non-blocking)

- **Q10 — RESOLVED:** panel editing uses Jira inline-edit (Atlaskit `InlineEdit`) — readable values become editable in place on click/focus; no separate "Edit" mode (requirements IP-8).
- **Q7 — RESOLVED:** rollup engine ported verbatim from `jira-timeline-report` `dates.ts`; default = `widestRange`; labels per settings.html (Phase 1).

---

## 9. Suggested first move

**Phase 1 (timing domain)** — pure TS, TDD, no Jira, unblocks everything. Then Phase 2 (Settings) to visually prove the timing engine, then the headline Issue panel and Timeline. Commit the current scaffold + specs first so the repo has a clean baseline.
