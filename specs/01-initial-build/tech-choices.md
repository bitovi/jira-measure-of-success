# Tech Choices — Initial Build

Status: **Decisions locked (2026-07-11)**
Scope: the agentic build harness + the three surfaces we're building first (issue panel, `kpi-timeline-v2`, and the Due Date Rollup portion of settings).

This document records the significant technology decisions, the alternatives considered, and the trade-offs. Each section ends with the decision. Nothing here is code — it's the "how/why" layer that sits between the [build brief](../kpi-forge-app-build-brief.md) and the implementation plan.

---

## Decision summary

| # | Decision | Choice | Status |
|---|----------|----------------|------------|
| 1 | UI framework for our surfaces | **Custom UI (React)** | Locked |
| 2 | Native look vs. mock parity | **Atlaskit components + design tokens (native Jira look)** | Locked |
| 3 | Outside-Jira testing strategy | **Mock-bridge harness (Vite) + `forge tunnel` for integration** | Locked |
| 4 | Unit/integration test runner | **Vitest** | Locked |
| 5 | Browser / visual testing | **Copilot browser tools + Playwright regression baselines** | Locked |
| 6 | Domain layer architecture | **Pure TypeScript, zero Forge imports, Zod-validated** | Locked |
| 7 | Schema/validation library | **Zod** | Locked |
| 8 | Styling mechanism | **Tailwind mapped to Atlaskit design tokens** | Locked |
| 9 | Agentic workflow model | **Spec-Kit artifacts + Superpowers execution loop + Bitovi skills** | Locked |
| 10 | Storage model | **KPI-as-issue in a dedicated space; all data Jira-REST/CascadeMCP-reachable** — see [storage-model.md](./storage-model.md) | Revised 2026-07-12 (supersedes "follow the brief") |
| 11 | App name / package | **"Measure of Success" / `measure-of-success`** | Locked |

---

## 1. UI framework: UI Kit vs. Custom UI

Forge offers two ways to build UI. This is the most consequential choice because it dictates whether we can test and visually verify outside Jira.

### Option A — UI Kit ("native" render)
You write components with `@forge/react` (`<Button>`, `<Stack>`, `<Textfield>`). These are **declarative descriptors**, not DOM. The actual rendering (Atlaskit components, design tokens, styling) is performed by **Atlassian's host page**. Your bundle never contains the rendering code.

**Pros**
- Fastest to write; components look native to Jira with zero styling work.
- Automatic design-token/theme/accessibility compliance.
- Less bundle/build surface to maintain.
- The brief's default preference ("UI Kit is preferred for speed").

**Cons**
- **Cannot render outside Atlassian's runtime** — no local DOM to screenshot, so no computer-vision loop and no offline CI for UI.
- The only "see it rendered" path is `forge tunnel` against a live dev site → slow iteration.
- **Cannot match the HTML mocks pixel-for-pixel** — Atlassian owns the styling; you get *their* look, not the mock's.
- Constrained to the fixed component vocabulary; the timeline visualization (§5) likely exceeds it.

### Option B — Custom UI (React)
You ship a normal static web bundle (React/Vite) served in a sandboxed iframe. Your bundle contains its own DOM/CSS. It talks to the backend via `@forge/bridge`.

**Pros**
- **Renders anywhere a browser runs** → local Vite server, Playwright screenshots, offline CI.
- **Full pixel/CSS control** → can match `specs/00-mocks/*.html` exactly.
- Required anyway for the timeline visualization (brief §3 explicitly allows Custom UI "if visualization needs exceed UI Kit").
- Enables the whole "always evaluate with computer vision + build tests + work outside Jira" requirement.

**Cons**
- You wire up Atlaskit / design tokens yourself to look native (more upfront work).
- Larger build/bundle surface; you own responsive + a11y.
- Slightly more boilerplate for backend calls (`invoke` via bridge vs. direct resolver wiring).

### Option C — Mix (UI Kit for simple forms, Custom UI for timeline)
**Pros**: least effort where UI Kit suffices. **Cons**: two rendering models, two testing stories, inconsistent look; the issue panel and settings both benefit from mock-parity too, so the split saves little.

### Decision: **Custom UI (React)** for all three surfaces

The `kpi-timeline-v2` surface makes this a **capability requirement, not just a preference**. Confirmed against the mock: [specs/00-mocks/kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html) builds its visualization from ~15+ absolutely-positioned DOM elements (axis/gridlines/tracks/bars) **plus a dynamically-generated `<svg><polyline>` sparkline** — none of which UI Kit's fixed component vocabulary can express. So the timeline is locked to Custom UI regardless of testing concerns; keeping the issue panel and settings on the same model avoids a second rendering + testing story for marginal savings. UI Kit's speed advantage only ever applied to the two simple forms.

> Note: this choice only affects the **three visual surfaces**. The domain logic is UI-agnostic and testable either way.

## 2. Native look vs. mock parity

With Custom UI chosen, a second decision follows: do surfaces look like **native Jira** (Atlaskit) or like the **mocks** (their own CSS)?

- **Native (Atlaskit components + design tokens):** users get the familiar Jira look, free dark mode / theming / accessibility. **Consequence:** the app deliberately will *not* match `specs/00-mocks/styles.css`, so the mocks become **layout/interaction references, not a pixel-diff target.**
- **Mock parity (port the mock CSS):** pixel-matches the mocks; costs the native look and free theming.

### Decision: **Native Atlaskit look.** The mocks are the reference for *what elements exist, their arrangement, and their states* (inherited/local, pending, coverage) — not a pixel target. This reshapes visual testing (see §5): computer vision verifies **regression against our own baselines** and **semantic correctness** (timeline geometry, no clipping, dark mode intact), and diffs the **custom timeline** against the mock for *geometry* with loose tolerance.

---

## 3. Testing outside Jira: mock-bridge harness vs. tunnel-only

### Option A — `forge tunnel` only (what Atlassian gives you by default)
Run the app on a live dev site with local hot-reload.

**Pros**: real runtime, real data, zero mocking, catches integration issues.
**Cons**: requires a provisioned Jira Premium site with the custom hierarchy; slow loop; no screenshots; unusable in CI; every UI change needs a round-trip to Atlassian.

### Option B — Mock-bridge harness (Vite) + tunnel for integration only
A ~30-line module stands in for `@forge/bridge`; Vite aliases `@forge/bridge` → the mock in the harness build. The **same React components** render locally against fixtures and, unchanged, against real data in Jira. `forge tunnel` is reserved for final integration checks.

```ts
// test-harness/mock-bridge.ts
export const invoke = async (fnKey: string, payload: unknown) => fixtures[fnKey](payload);
export const view = { getContext: async () => fixtureContext };
export const requestJira = async (path: string) => fixtureJira(path);
```

**Pros**
- Instant local loop; no Jira site needed for most work.
- Runs in CI; enables Playwright + visual-diff.
- Fixtures can encode the exact hierarchy the brief needs (Outcome→Initiative chains for inheritance/rollup).
- Officially-aligned: Atlassian's own front-end testing guidance is "mock `@forge/bridge`."

**Cons**
- Fixtures can drift from real Jira shapes → mitigated by validating fixtures against the same zod schemas the app uses, plus periodic `forge tunnel` smoke checks.
- We author/maintain the mock (small, low-churn).

### Decision: **Option B.** Mock-bridge harness as the primary loop; `forge tunnel` as the integration gate before deploy. Validate all fixtures with the production Zod schemas so mock and reality can't silently diverge. **Implemented** in [app/test-harness/mock-bridge.ts](../../app/test-harness/mock-bridge.ts).

---

## 4. Test runner: Vitest vs. Jest

**Jest** — Atlassian's docs use it; ubiquitous.
**Vitest** — Vite-native, faster, ESM-first, Jest-compatible API.

| | Jest | Vitest |
|---|---|---|
| Speed | Slower | **Faster (Vite transform)** |
| ESM/TS | Needs config | **Native** |
| Shares Vite config with harness | No | **Yes (one toolchain)** |
| Atlassian docs alignment | **Yes** | Compatible API |
| Ecosystem maturity | **Highest** | High |

### Decision: **Vitest.**
Because the Custom UI harness already runs on Vite, Vitest reuses the same config/transform, giving one toolchain for domain tests + component tests. The API is Jest-compatible, so Atlassian's `jest.mock('@forge/bridge')` patterns port over unchanged (`vi.mock`). Choose Jest only if a Forge tooling constraint later forces it.

---

## 5. Visual / browser testing: Copilot browser tools + regression baselines

With the **native Atlaskit look** (§2), the mocks are no longer a pixel target, so the visual-testing strategy is:

1. **Copilot's built-in browser tools** (`open_browser_page` / `screenshot_page`) drive the local harness during development for **semantic visual review** — "does the surface render correctly, timeline bars aligned, no clipping, dark mode intact, states (inherited/local/pending) visible." (No Playwright MCP required.)
2. **Playwright** captures **locked baseline screenshots of our own surfaces** for automated regression in CI — catching unintended visual changes over time.
3. The **custom timeline** is additionally compared against [specs/00-mocks/kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html) for *geometry* (axis/track/bar positioning) with **loose tolerance**, since Atlaskit provides nothing there and the layout should **approximate** the design — a reference, **not pixel-perfect** and not a hard gate.

The Bitovi `playwright` skills (`visual-diff`, `computed-styles`, `discover-visual-states`) are installed in `.claude/skills/` as reference for these flows.

### Decision: **Copilot browser tools for the dev loop; Playwright for regression baselines; loose-tolerance geometry diff for the timeline.** The mocks are a layout/interaction reference, not a pixel acceptance target.

### §5 Addendum (2026-07-12): Storybook + injectable loader hooks + portable-stories tests

Added **Storybook** (React + Vite) as a per-scenario visual workbench and, with
it, an explicit **data-scenario testing** layer. This *complements* the locked
choices — it rides on Vitest (§4) and does not replace the Copilot dev loop or
Playwright baselines.

- **Injectable loader hook** — surfaces take their data loader as a prop
  (`usePanel`/`useSettings`/`useData`) defaulted to the real `@forge/bridge`
  hook. Stories/tests inject a stub returning canned data, so every branch
  (loading / error / empty / pending / each data shape) renders deterministically
  with no bridge. This is the constitution's "pure core, thin adapters" rule
  applied to the UI; the `call()` seam lives in one hook modlet per surface.
- **Modlet structure** — surfaces and hooks are self-contained folders
  (`IssuePanel/`, `usePanelData/`) with co-located `index.ts` + implementation +
  `*.stories.tsx` + `*.test.tsx`. See the project skill
  [`.claude/skills/create-react-modlet/`](../../.claude/skills/create-react-modlet/SKILL.md).
- **Stories double as tests** — each surface's stories carry `play()` interaction
  assertions and are replayed as tests via **portable stories**
  (`composeStories`) in jsdom under a **separate** `vitest.stories.config.ts`.
  No Playwright/browser download; fast.
- **Segmented scripts** — `npm test` = pure-domain suite (node, `*.test.ts`);
  `npm run test:stories` = story tests (jsdom, `src/ui/**/*.test.tsx`);
  `npm run test:all` = both; `npm run storybook` = the workbench. The two suites
  never overlap (extension-segmented).

Why this over the alternatives: portable stories keep the story-tests in the
Vitest/jsdom world already chosen (no Playwright browser install), and the
injectable-hook approach beats per-story bridge mocking — it reaches the
loading/error branches cleanly and keeps fetching out of the render.


---

## 6. Domain layer architecture: pure TypeScript, no Forge imports

The riskiest logic in the brief — inheritance resolution (§2.1) and `effectiveDueDate` rollup (§6.1) — has **no UI and no storage coupling**. Isolate it in `src/domain/` with zero `@forge/*` imports.

**Pros**
- Unit-testable with Vitest in milliseconds; no Jira, no mocks.
- Exhaustively covers the brief's required test cases (no ancestor / nearest wins / partial override / pending anchors / offset 0).
- Reusable identically in the resolver (backend) and, where needed, the UI.
- Storage and UI become thin adapters around a tested core.

**Cons**
- A little upfront discipline to keep the boundary clean (enforce with an import lint rule).

### Decision: **Adopt.** Structure (implemented): `app/src/domain/` (pure: models + resolvers), `app/src/backend/` (Forge resolver + storage/Jira adapters — imports domain), `app/src/ui/` (Custom UI — imports domain types only). This is what makes TDD cheap.

---

## 7. Schema/validation: Zod

The brief defines four data shapes (KPI definition, assignment, reporting-index entry, config). We need runtime validation at every boundary (entity property reads, KVS reads, fixture data, bridge payloads).

**Pros of Zod**
- Single source of truth: `z.infer` gives TypeScript types *and* runtime validation from one schema.
- Guards against malformed issue-entity-property data (untrusted — any user with edit permission can write it, brief §6 permissions note).
- Validates harness fixtures against the *same* schema the app uses → prevents mock/reality drift (ties into §2).
- Great error messages for debugging the parent-walk/rollup edge cases.

**Cons / alternatives**
- Adds a dependency + minor runtime cost (negligible at these sizes).
- Alternatives (Valibot — smaller bundle; io-ts — FP-heavy; plain TS types — no runtime safety). Zod is the ecosystem default and the user's stated preference for models.

### Decision: **Zod**, one file per shape under `app/src/domain/models/`, exporting both schema and inferred type. Parse at every trust boundary; pass typed objects inward. **Implemented** — all four brief shapes plus fixtures validated against them.

---

## 8. Styling: Tailwind mapped to Atlaskit design tokens

Decision #2 (native look) and the user's preference for **Tailwind** both need to coexist. Atlaskit ships its own Emotion-based styling + design tokens; Tailwind is utility CSS. Rather than let them fight over ownership, they divide cleanly:

- **Atlaskit components + design tokens** → the native look for standard UI (Select, Button, Textfield, Table, Lozenge…).
- **Tailwind** → custom page layout + the bespoke **timeline** visualization.
- Tailwind's theme is **wired to Atlaskit design tokens** via CSS variables (see [app/tailwind.config.js](../../app/tailwind.config.js) + [app/src/ui/styles.css](../../app/src/ui/styles.css)) so custom parts stay consistent and theme/dark-mode aware.

### Decision: **Atlaskit for native widgets, Tailwind (mapped to Atlaskit tokens) for the custom canvas.**

---

## 9. Agentic workflow: what to borrow from Spec Kit, Superpowers, and Bitovi

We're not adopting any one system wholesale; we're composing the best parts.

### Spec Kit — the artifact spine
Separates **constitution → spec (what/why) → plan (how) → tasks → implement**, with gates (`clarify`, `analyze`, `checklist`).
- **Take:** the artifact structure and the "keep *what* separate from *how*" discipline; reviewable-in-chunks specs.
- **Leave:** the Python CLI / full toolchain — overkill for one app; we mirror the structure as plain markdown in `specs/01-initial-build/`.

### Superpowers — the execution discipline
brainstorm → worktree → **writing-plans (2–5 min tasks, exact file paths + code)** → **subagent-driven-development (fresh subagent per task, two-stage review)** → **TDD red/green/refactor** → code-review → finish-branch.
- **Take:** subagent-per-task, mandatory two-stage review, real red/green TDD, YAGNI/DRY, evidence-over-claims.
- **Leave:** its exact hook/marketplace plumbing; we invoke the pattern manually via subagents.

### Bitovi plugins (`.claude`) — concrete skills
- `playwright` → visual regression flows (§5).
- `implement-workflow` → `/implement` 8-step loop + `code-reviewer` agent + `ready-to-push`.
- `react-mock` → `generate-sample-data` for harness fixtures.
- `code` → `spec` / `spec-check` / `spec-implement` for Spec-Kit-style artifact discipline.

> Installed in [.claude/skills/](../../.claude/skills) and [.claude/agents/](../../.claude/agents).

### Recommendation
Structure artifacts like Spec Kit, execute like Superpowers, using Bitovi skills as the concrete tools. Per-feature loop:

```
zod models → failing tests (RED) → domain impl (GREEN) →
Custom UI wired to mock bridge → Playwright visual-diff vs mock →
code-reviewer → commit with evidence (test output + screenshot diff)
```

**Pros:** autonomy without drift; every task ends with verifiable evidence.
**Cons:** more ceremony than "just code it" — justified by the brief's testing/verification requirements.

---

## Mockup workflow: `make-mockup` HTML as visual reference

Static HTML mocks already exist in `specs/00-mocks/`. The Bitovi/bitos `make-mockup` skill produces exactly this style of artifact.

**Pros**
- The mock is a cheap, reviewable, framework-free **reference** for "roughly what it should look like" — influential, **not binding** (Constitution §1a).
- It's a **loose visual reference** for `visual-diff` (§4) — helps close the loop between design and implementation, but is **not pixel-perfect** and not an acceptance gate.
- New surfaces usually get a mock *first*, before any React is written.

**Cons**
- Mocks can lag behind evolving requirements → treat them as living references; the authoritative spec is `specs/01-initial-build/`, and the mock is updated opportunistically, not as a hard prerequisite.

### Decision: **Any new/changed surface can start as (or update) an HTML mock in `specs/00-mocks/`**, which serves as the geometry reference for the timeline comparison (§5) and the layout/interaction reference elsewhere — influential, not binding. Fold `make-mockup` into the workflow once the skill is shareable.

---

## 10. Storage model (locked by brief — recorded for completeness)

The brief §3 fixes this: per-issue assignments in a **Jira issue entity property**, KPI catalog in **Forge KVS** (one key per def), reporting index in **Forge Custom Entity Store** (indexed on `kpiId`), config in **KVS** (single doc). We follow it as-is.

**Only harness-relevant note:** all four shapes get Zod schemas (§7), and the mock bridge serves fixtures that satisfy those schemas — so storage stays a thin, swappable adapter behind the domain layer.

## 11. App name / package

**"Measure of Success"**, package `measure-of-success`, under [app/](../../app). Forge app id assigned by `forge register` once a dev site is provisioned.

---

## 12. Sister-project interoperability (Bitovi)

Three Bitovi-owned projects can be designed to work together, so we build toward shared contracts rather than silos:

- **[`jira-timeline-report`](https://github.com/bitovi/jira-timeline-report)** (Status Reports for Jira) — its "Timing Calculation" is the model our Due Date Rollup mirrors (Q7). Direction: extract the **timing schema + `effectiveDueDate`/date-source resolution into a shared package** so both apps resolve timing identically (also de-dupes our domain code). Same agentic stack too (spec-kit + superpowers).
- **`cascademcp`** (Bitovi-owned) — an MCP server that adds tools over **standard Atlassian REST** (filling gaps in the official Atlassian MCP). Because recorded values live as **Jira issue entity properties** (Q6), CascadeMCP can read/set them directly; we can extend it with a purpose-built KPI get/set tool so people update values themselves.
- **Shared contract = the `kpi-*` entity-property schema.** The Zod models for assignments and readings become the interop boundary: this app reads/writes them, CascadeMCP get/sets them, the Timeline Report can read them. Keep those schemas stable and documented; a shared Jira property key could eventually let one config serve multiple apps.

All roadmap-level (none blocks v1), but it steers decisions now: **prefer Jira-native storage (entity properties) for anything external tools must touch**, and keep timing logic factorable into a shared package.

## Consequences / what this sets up

- `app/src/domain/` is buildable and 100% tested **today**, with no Jira account (de-risks the hardest logic first) — 22 tests green.
- The three surfaces are built in Custom UI against fixtures and visually verified with Copilot browser tools before ever touching a live site.
- `forge tunnel` becomes a periodic integration gate, not the inner loop.
- CI can run domain tests + component tests + regression baselines headlessly.

## Status

Decisions locked and the Phase-0 harness is built: domain layer + Zod models + resolvers (tested), mock-bridge harness + minimal Custom UI (renders + screenshotted), Forge manifest + backend resolver skeleton, `.claude` skills installed. Next: `requirements.md`, then the per-feature build loop.
