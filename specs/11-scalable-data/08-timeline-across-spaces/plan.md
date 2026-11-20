# 08 — Timeline and Add KPI across spaces

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft: design pending gate G4** · Depends on: 06.

## Problem

After 06, the Timeline loads every KPI the user can browse, from every space, as one tree. With many
teams that's:

- **too much to look at**: there's no way to narrow it to the spaces you care about;
- **possibly too much to load**: spec 06's performance work assumed one team-sized space;
- **unclear where a new KPI goes**: **Add KPI** used to create in the one KPI project. Now it could be
  the central space, the space you're working in, or any space with the KPI type where you may create
  issues. And there may be no central space at all (04 Q5).

## Proposed direction (pending the G4 prototype)

- A **Space filter** on the Timeline, built from the spaces of the loaded KPIs (no extra request).
  Filtering keeps ancestors for context, the way the project filter does today.
- **Add KPI** asks which space, offering spaces where the KPI type is available and the user has
  Create Issues (`GET /project/search?action=create&expand=issueTypes`, one request when the form
  opens, 01 B6). It defaults to the central space if there is one. **Add child KPI** defaults to the
  parent's space.
- Each KPI row shows its space when the Timeline spans more than one.

## Implementation steps

### Step 1 — Build the prototype

- A static HTML prototype in this folder (`timeline-spaces.html`), styled like the current Timeline
  (start from the harness Timeline's look, or
  [kpi-timeline-v3.html](../../00-mocks/kpi-timeline-v3.html)). Scenarios:
  - KPIs in 1 space (today) vs. 6 spaces;
  - Space filter: none selected, one, several; a filtered-out parent kept for context;
  - the Timeline's default scope (Q1);
  - Add KPI with a central space, without one, and from a user who can create in only one space;
  - Add child KPI under a parent in another space;
  - a user who can browse no KPIs at all.
- **Verify:** every scenario works in the browser; nothing talks to Jira.

### Step 2 — 🔍 Gate G4: prototype review

- **Stop. Ask Justin to review** the prototype. Iterate on it until it's agreed.
- Write the decisions into *Questions*, then **write *Design* and rewrite Steps 3–6** before writing
  any code. If Q1 decides the Timeline shouldn't load every KPI by default, add the backend scoping
  (and request-count tests, as in
  [timelinePerf.test.ts](../../../app/src/backend/timelinePerf.test.ts)) to Step 3.

### Step 3 — Backend: Timeline scope and spaces for Add KPI

- Timeline resolvers take an optional set of spaces (per Q1). A `getKpiCreateSpaces` resolver for the
  Add KPI form.
- **Verify:** backend tests on the multi-space fixture: scoped loads only search the chosen spaces; a
  space without Create Issues isn't offered; a project without the KPI type isn't offered; the central
  space comes first.

### Step 4 — UI: Space filter

- Modlet with stories and tests, wired into the Timeline toolbar.
- **Verify:** in the harness, light and dark, clean console: matches the reviewed prototype; ancestors
  kept for context; the filter survives a reload if Q3 says so.

### Step 5 — UI: Add KPI space choice

- The space field in the Add KPI form, its default, and Add child's default.
- **Verify:** in the harness: the default per the reviewed prototype; creating in a second space puts
  the KPI under the right space; with no central space and no choice made, the form explains why it
  can't save.

### Step 6 — Live check (dev)

- **Verify** on `bitovi-training`: with KPIs in the central space and a hand-enabled second space, the
  Space filter shows both; adding a KPI in the second space works, and it shows its unit and direction
  in Jira (05); a user with Create Issues in only one space is offered only that one.

## Questions

_To be answered at gate G4._

1. **Default scope.** With KPIs across many spaces, should the Timeline default to all spaces, "spaces
   on my recent work", the central space, or the last filter the user chose?
2. **Is a Space filter enough**, or does a company-wide Timeline need more (e.g. collapse a space,
   search)? Does it need its own spec?
3. **Remember the filter** per user (KVS or local storage), or reset each visit?
4. **Add KPI from the current space.** The Timeline is a global page, so there's no "current space".
   Should Add KPI remember the last space used?
5. **No central space** (if 04 makes it optional): no default, the user always picks?
