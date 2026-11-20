# 07 — KPI picker: suggestions, search, paste

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft: design pending gate G3** · Depends on: 06.

Prototype: [kpi-picker.html](./kpi-picker.html). **Not settled.** Justin reviews it at the start of
this stage. The *Design* below describes what the prototype proposes, and gets revised after review.

## Problem

The issue panel's "Set a KPI target" dropdown
([AssociateForm](../../../app/src/ui/surfaces/IssuePanel/IssuePanel.tsx)) lists **every** KPI,
indented by the KPI tree. With KPIs in many spaces (06), that's thousands of options and the relevant
handful is buried. Loading it is also the panel's most expensive step: every panel open loads every KPI
and, in Phase 2, every KPI's readings.

## Proposed design (from the prototype, pending G3)

### The picker suggests, in this order

For a work item, its **own space** is its project. Its **chain** is its parent, grandparent, and so
on, up to the top.

| # | Section | What's in it |
|---|---|---|
| 1 | **In {your space}** | KPIs whose issue is in the work item's own project |
| 2 | **Tracked above you** | KPIs targeted by any issue on the chain, from any space. Each shows *who* targets it ("PROG-45 · Epic") |
| 3 | **Other KPIs you can access** | Everything else the user can browse: search, or paste a key or URL. What shows before typing is Q1 |

Rules:

1. **Each KPI appears once, in its highest section.** A KPI in your space that's also tracked above
   stays in section 1, with a "Tracked by PROG-45" badge.
2. **Nesting within a space works as it does today**: within each section, KPIs are grouped by space;
   children are indented under their parent, in rank order.
3. **A parent in another space isn't pulled in.** The child shows at the top of its own space with a
   hint ("under PROG · Conversion rate").
4. **KPIs already targeted** by the work item are left out, as today (`trackedIds`).
5. **Search covers all three sections.** Typing filters what's listed and also searches every KPI the
   user can browse. Results keep their section and space headers.
6. **Pasting a key or URL** (`PORT-14`, `https://…/browse/PORT-14`) looks the KPI up directly:
   - found → selected, in its natural section;
   - an old key of a moved KPI → resolved (03) and shown under its new key;
   - not a KPI → "PORT-7 is an Initiative, not a KPI";
   - hidden or missing → "You don't have access to FIN-2, or it doesn't exist" (Jira doesn't say which,
     spec 10).

### Panel data: suggestions instead of the whole catalog

`PanelBasis.catalog` (06's temporary "every KPI") is replaced by:

```ts
interface KpiOptionDto {
  id: string;              // issue id (03)
  key: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  space: { key: string; name: string };
  depth: number;           // within its space group
  /** set when the tree parent is in another space (rule 3) */
  crossSpaceParent: { key: string; name: string; spaceKey: string } | null;
  /** chain issues that target this KPI, nearest first */
  trackedBy: Array<{ issueKey: string; typeName: string; typeIconUrl: string | null }>;
}

interface KpiSuggestionsDto {
  ownSpace: { key: string; name: string; hasKpis: boolean; canCreateKpis: boolean };
  inYourSpace: KpiOptionDto[];
  trackedAbove: KpiOptionDto[];      // grouped by space in the client
  other: KpiOptionDto[];             // section 3 before typing, per Q1 (may be empty)
  moreAvailable: boolean;            // section 3 was capped; search finds more
}
```

The issue's **own target rows** still need each targeted KPI's name, unit and direction. They come
from an `id in (…)` lookup of just those KPIs.

New resolvers:

- `searchKpis({ issueId, text })` → `KpiOptionDto[]` (capped, e.g. 50), with section and `trackedBy`
  filled in from the chain.
- `lookupKpiRef({ issueId, ref })` → `{ kind: 'kpi', option } | { kind: 'notKpi', typeName } |
  { kind: 'hidden' }`. Accepts a key, an old key, or a `/browse/` URL.
- `getKpiCurrentValue({ kpiId })` → the picked KPI's current value, for the form's preview.

### Requests (all `asUser`)

| Need | Request | Bound |
|---|---|---|
| Section 1 | `issuetype = {workTypeId} AND project = {own}` + fields + `kpi-meta` + hierarchy links | one space |
| Chain | Walk up: `GET /issue/{parentId}?fields=parent,issuetype,project&properties=kpi-assignments`, one per level | depth cap (Q6), cycle guard; typically 2–4 |
| Section 2 + own target rows | One `id in (KPIs targeted on the chain or by this issue)` | number of targets |
| Section 3 before typing | Per Q1 | capped |
| Search | `issuetype = {workTypeId} AND summary ~ "{text}*"`, capped, debounced | capped (01 C3) |

The chain walk starts at t=0 alongside section 1 (spec 07 Phase 1). It replaces today's
`parentTargets` stage (the parent is the walk's first step) and still feeds the "On parent, not
tracked" rows.

**Readings.** Phase 2 no longer loads every KPI's readings: only the issue's own targets (for the
cards), plus `getKpiCurrentValue` for a KPI picked in the form.

## Implementation steps

### Step 1 — 🔍 Gate G3: prototype review

- **Stop. Ask Justin to review** [kpi-picker.html](./kpi-picker.html): the scenarios (TEAM-123, NEW-8
  new space, PORT-7 top level), the section 3 variants (Q1) and the sub-KPI toggle (Q2). If his
  feedback needs prototype changes, make them in the prototype first and review again.
- Write the decisions into *Questions*, then **rewrite *Proposed design* and Steps 2–6** to match before
  writing any code.

### Step 2 — Domain: suggestion builder (pure)

- `buildKpiSuggestions({ ownProjectKey, chain, kpis, ownTargets })` → `KpiSuggestionsDto`: section
  assignment, dedupe (rule 1), per-space nesting in rank order (rule 2), cross-space parent hints
  (rule 3), leaving out already-targeted KPIs (rule 4), `trackedBy` nearest first.
- `parseKpiRefInput(text)` → key / URL / free text.
- **Verify:** table tests: a KPI in your space tracked above (stays in section 1, badged); a tracked
  KPI's child in the same space (nested); a child whose parent is in another space (top level,
  hinted); a chain of 4 with the same KPI tracked twice (one row, two `trackedBy`); an empty own space;
  no chain; a cycle in the chain input (no infinite loop); URL and key parsing, including lowercase and
  trailing slashes.

### Step 3 — Backend: suggestions, search, lookup, current value

- Chain walk (replacing `parentTargets`), `buildKpiSuggestions` in Phase 1, the three new resolvers,
  Phase 2 readings limited to own targets.
- **Verify:** request-log tests pin Phase 1's requests: **no** query over all KPIs, one request per
  chain level, section 2 and own rows in one `id in (…)`. On a fixture with 2,000 KPIs over 20 spaces,
  the Phase 1 request count doesn't grow with the number of spaces. `lookupKpiRef` covers key, URL, old
  key, non-KPI and hidden.

### Step 4 — UI: `KpiPicker`

- Follow [create-react-modlet](../../../.claude/skills/create-react-modlet/SKILL.md): a `KpiPicker`
  (Atlaskit `Select` with grouped options, custom option and group renderers, async search, paste
  handling) used by `AssociateForm`. Stories for each prototype scenario plus loading, search in
  flight, and lookup errors. Harness mocks for `searchKpis`, `lookupKpiRef`, `getKpiCurrentValue` and a
  multi-space fixture.
- **Verify:** in the harness (`?surface=issue`), light and dark, clean console: sections in order;
  nesting and badges as in the reviewed prototype; typing searches other spaces; pasting a key selects
  it; keyboard-only use works (arrows, Enter, Esc closes only the menu); the menu isn't clipped in a
  narrow panel (`useMenuRoom`).

### Step 5 — Remove the temporary catalog

- Delete 06's temporary "every KPI" panel catalog and `PanelBasis.catalog`.
- **Verify:** no code path loads all KPIs for the panel (grep and request-log test).

### Step 6 — Live check (dev)

- **Verify** on `bitovi-training`, with KPIs in the central space and a hand-enabled second space, and
  a Story → Epic → Initiative chain across three projects: the Story's picker shows its space's KPIs
  first, then the Epic's and Initiative's targets; pasting a KPI key from a third space works; a user
  without access to one space never sees its KPIs.

## Questions

_To be answered at gate G3._

1. **Section 3 before typing.** Which prototype variant? (A) nearest spaces first: untracked KPIs from
   the chain's spaces, then a search box; (B) search only, with a count ("Search 214 more KPIs in
   9 spaces"); (C) every accessible KPI space as a collapsed group.
2. **Sub-KPIs in "Tracked above you".** Should it also show the **same-space children** of a tracked
   KPI (nested, marked "sub-KPI of Conversion rate")? A story often contributes to a sub-KPI rather than
   the tracked one. The prototype has a toggle.
3. **Collapsing.** Should section headers be collapsible, and should section 1 start collapsed when it
   has more than N KPIs?
4. **Current values in the list** (e.g. "Conversion rate · 3.1%")? That costs a readings fetch for
   every suggested KPI. The draft shows it only for the picked KPI.
5. **New team, no KPIs in their space.** Should the empty section 1 offer "Create a KPI in {space}" (when
   the KPI type is available there) or "Create one in the central space", or nothing? Today KPIs are
   only created from the Timeline.
6. **Chain depth.** Walk to the top (capped at 10 for safety), or reuse Settings' rollup `depthCap`?
7. **Central space in the picker.** Special treatment, e.g. list its KPIs right after the chain's
   spaces in section 3, or mark them "Company-wide"? The draft treats it like any other space.
