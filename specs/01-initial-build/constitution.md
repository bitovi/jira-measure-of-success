# Constitution — Measure of Success

Durable principles that govern all work on this project. Spec, plan, tasks, and
implementation must conform to these. When a principle conflicts with a request,
surface the conflict rather than silently violating it.

## 1. Spec before code
Every feature starts from a written intent: what/why (requirements) separated
from how (plan/tasks). No implementation task exists without an acceptance
criterion it satisfies. Mocks in `specs/00-mocks/` are a visual/interaction
reference to draw from — not a binding contract.

## 1a. What's authoritative
The `specs/01-initial-build/` artifacts (requirements, plan, tech-choices,
positioning, and this constitution) are **authoritative** for this build. The
original `specs/kpi-forge-app-build-brief.md` and the `specs/00-mocks/` HTML
mocks are **influential references, not binding** — consult them for intent,
rationale, and layout, but the initial-build spec governs when they diverge.

Where an external, purpose-built implementation is the acknowledged source for a
behavior (e.g. Bitovi's `jira-timeline-report` for due-date rollup), the
initial-build spec names it as that behavior's source of truth and we **port
from it** rather than re-deriving.

Standing terminology decision: the user-facing term is **"KPI"**, not the mocks'
"Measurement" (see [positioning.md](./positioning.md) §4).

## 2. Test-driven, evidence over claims
Write the failing test first (RED), minimal code to pass (GREEN), then refactor.
A change is not "done" until its tests pass, types check, and — for UI — a
screenshot has been visually verified. "It should work" is never sufficient;
attach evidence (test output, screenshot).

## 3. Pure domain core, thin adapters
All KPI logic (models, inheritance, due-date rollup, relative dates) lives in
`app/src/domain/` with **zero** `@forge/*` imports. It is validated with Zod and
unit-tested without Jira. Storage, Jira REST, and UI are thin adapters around
this core. This is what keeps the riskiest logic cheap to test.

## 4. One rendering model: Custom UI
All surfaces are Custom UI (React) — required by the timeline's custom
visualization and by the outside-Jira harness. Native look comes from Atlaskit
components + design tokens; Tailwind (mapped to those tokens) handles custom
layout and the bespoke timeline.

## 5. Develop outside Jira; integrate deliberately
The mock-bridge harness (Vite) is the inner loop: surfaces render against
fixtures that satisfy the production Zod schemas, so the mock cannot drift from
reality. `forge tunnel` on a real dev site is an integration gate, not the daily
loop. The two mocked seams are `invoke` and `requestJira`.

## 6. Follow the brief's storage & platform constraints
Per-issue assignments → Jira issue entity property. KPI catalog → Forge KVS
(one key per definition). Reporting index → Custom Entity Store (indexed on
`kpiId`). Config → KVS (single doc). Respect Forge storage limits (Brief §7),
batch writes, favor reads, and never hardcode issue-type names — discover the
hierarchy at runtime.

## 7. Validate at every trust boundary
Issue entity properties are writable by any user with edit permission — treat
all external data (properties, KVS reads, bridge payloads, fixtures) as
untrusted and parse it with the domain Zod schemas before use.

## 8. YAGNI / DRY / minimal surface
Build only what an acceptance criterion requires. No speculative abstractions,
no features beyond scope. Reuse the domain layer everywhere rather than
reimplementing resolution logic in UI or backend.

## 9. Autonomy with review
Work proceeds as small, verifiable tasks (each ~a few minutes, with exact files
and a verification step). Non-trivial changes get a code-review pass (the
`code-reviewer` agent) before being considered complete.

## Initial scope (first build)
Issue panel · KPI Timeline v2 · Settings (Due Date Rollup form + read-only
relative-date preview). Everything else in the brief is out of scope until this
slice is green and visually verified.
