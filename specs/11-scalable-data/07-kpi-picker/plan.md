# 07 — KPI picker: a two-pane KPI browser

Part of [11 — Scalable KPI data](../plan.md). Status: **Design reviewed (gate G3, 2026-11-20); open
questions below** · Depends on: 06.

Prototype: [kpi-picker.html](./kpi-picker.html). Open it in a browser; nothing talks to Jira. Its
**Layout: Two-pane browser** is the chosen design. The other layouts (two-line list, columns) and the
**Scope buttons** variants (widening, on/off chips, pick spaces) are earlier explorations kept only for
comparison; they're superseded (see *Considered and rejected*). The prototype's controls also switch the
work item (TEAM-123 Story, NEW-8 Story in a new space, PORT-7 Initiative at the top) and turn the central
space on and off.

## Problem

The issue panel's "Set a KPI target" dropdown
([AssociateForm](../../../app/src/ui/surfaces/IssuePanel/IssuePanel.tsx)) lists **every** KPI,
indented by the KPI tree. With KPIs in many spaces (06), that's thousands of options and the relevant
handful is buried. Loading it is also the panel's most expensive step: every panel open loads every KPI
and, in Phase 2, every KPI's readings.

People still need to be able to reach **any** KPI they can browse (the full catalog), so the answer is
not "suggestions only". It's: show the most relevant KPIs first, organised by *why* they're relevant,
load the rest only when asked for, and make the whole catalog searchable.

## Terms

- **This work item**: the issue whose KPI panel is open. **This space** is its project.
- **Parents** (the **chain**): its parent, grandparent, and so on to the top (Story → Epic →
  Initiative). Walked with `parent`, depth-capped, cycle-guarded.
- **Parent spaces**: the projects of the parents, other than this space and the central space.
- **Global KPIs**: the **central space** (overview, 04), shown under this name in the picker.
- **Target**: a work item's KPI target (its `kpi-assignments` entry: expected change and date). A KPI
  a parent targets is "tracked by" that parent.

## Design

### The field

- The form's **KPI** field looks like an ordinary select: `Choose KPI, search, or paste a key…` ▼.
- Clicking it, tabbing into it, or pressing ↓ **expands the two-pane browser directly under the field**,
  like a large dropdown menu. It's **inline**, not floating and not a Jira modal: the panel's iframe
  grows (the browser is ~420px tall) and the form's other fields move down.
- **Picking a KPI collapses the browser** and the field shows `{KPI icon} {KEY} {Name} ({unit})`. Below
  it: the KPI's space · where it came from (e.g. "Tracked by parents") · its **current value**
  (`getKpiCurrentValue`, fetched for the picked KPI only).
- **Esc** or a click outside collapses it. Typing over a picked KPI starts a new search (it doesn't
  append to the KPI's name).

### Left menu (the views)

```
Tracked by parents
TEAM This space
PARENT SPACES
  PROG Growth Program
  PORT Company Portfolio
  KPI  Global KPIs          ← the central space, always last: the top of every chain
──────────────────────────
All KPIs
```

| View | What it lists | Loaded |
|---|---|---|
| **Tracked by parents** | Grouped by parent work item, nearest first; under each, the KPIs it targets (see below) | When the picker opens |
| **This space** | This space's KPIs, as a collapsible tree | When the picker opens |
| **Parent spaces** › each parent's space | That space's KPIs, as a collapsible tree. One entry per space (usually 1–3) | When opened |
| **Parent spaces** › **Global KPIs** | The central space's KPIs. Listed **last** under Parent spaces because company KPIs are the top of every chain, so the group shows even for a work item with no parents. Hidden when the site has no central space (04 Q5) or this work item is in it | When opened |
| **All KPIs** | Every KPI the user can browse, grouped by space (space key + name headers), with a **Space** filter | When opened (nothing until the user types or picks a space) |

- **Other spaces are never listed one by one.** A site can have hundreds; they're reached through All
  KPIs (search + Space filter). The menu stays short because every entry above the divider is tied to
  this work item (or is the central space).
- **Opens on Tracked by parents**, or on This space when Tracked by parents is empty.
- **No counts** in the menu (or in the Space filter's list): a count for a view that isn't loaded would
  cost a request per view on every open.
- **Known-empty views are greyed out**: only Tracked by parents and This space can be known empty for
  free (they load on open). A grey entry is still clickable and shows its empty message; its tooltip
  says "Nothing here". The lazily loaded views are never greyed.
- The right pane has **no title** (the selected menu entry already says which view it is): it starts at
  the column header, **KPI · Unit**, plus **Target** in Tracked by parents only. The header labels are
  flush left ("KPI" lines up with the chevron column and the parent bands' icons).

### Tracked by parents

```
▓ ⚡ PROG-45 Frictionless checkout ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  › ◎ TEAM-501 Checkout conversion    %    +5% by Mar 31
  › ◎ PROG-210 Conversion rate        %    +2 pts by Jun 30
▓ 💡 PORT-7 FY27 growth ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  › ◎ PROG-210 Conversion rate        %    +3 pts by Dec 31
  › ◎ PORT-12 Net revenue             $    +12% by Dec 31
```

- **Each parent is a band**: `{type icon} {key} {summary}` on a shaded background with top and bottom
  borders, **not selectable** (default cursor), **pinned** (sticky) while its KPIs scroll under it. Its
  icon is **flush left**, aligned with the KPI rows' chevron column (not indented). No type label: the
  icon says Epic / Initiative.
- **Every KPI the parent targets is a top-level row** under its band, so "top-level under the band"
  always means "this parent targets it", however many it targets. Targets **never nest under each
  other**, even when one is the other's parent KPI.
- **Each target row shows the target the parent set** (expected change and date, worded as the panel's
  target cards) in the **Target** column. Sub-KPI rows leave it blank, which also tells targets and
  sub-KPIs apart.
- **Each target brings its same-space sub-KPIs** (every level), collapsed under it: a story often moves
  a sub-KPI rather than the KPI its Epic tracks. Sub-KPIs in other spaces aren't pulled in.
- **A KPI targeted at two levels is listed under both** parents (Conversion rate above). Each listing
  is true, and the view answers "what is each parent measured by".
- A parent with no targets (or whose targets are all already targeted by this work item) has no band.
- Empty view messages: "{KEY} is at the top of its hierarchy, so it has no parents." / "No parent of
  {KEY} has a KPI target that isn't already tracked here."

### Space views (This space, a parent space, Global KPIs) and All KPIs

- A collapsible **KPI tree** in rank order. A KPI whose parent KPI isn't in the list (e.g. the parent is
  in another space) is simply a **top-level row, with no note** about its parent (the KPI tree is the
  Timeline's job, and the parent is almost always reachable through Tracked by parents anyway).
- All KPIs groups its tree by space, with a header per space (`PROG` Growth Program).
- A KPI can appear in more than one view (a KPI in this space that the Epic targets is in This space and
  under the Epic). Within one view it appears once (per band in Tracked by parents).
- **KPIs this work item already targets are left out everywhere**, as today (`trackedIds`).

### Collapsing

- **Sub-KPIs start collapsed, in every view.** A KPI with sub-KPIs gets a Plans-style chevron
  (`›` / `⌄`, Atlaskit chevron-right / chevron-down) in a 24px column; leaf rows get a same-width spacer
  so icons align.
- Clicking the chevron, or **→ / ←** on the highlighted row, opens / closes it **without picking it**.
- Expand state is **per place** (the same KPI under the Epic and under the Initiative opens separately)
  and lasts while the picker is open.
- **Searching opens the path to every match**: a matching sub-KPI shows under its (expanded) ancestors.

### Search and paste

- **Typing searches the selected view.** Switching views keeps the text and re-runs it in the new view.
- Below the results: **"N more in other spaces · Search all KPIs"**, which moves the same search to All
  KPIs. While the all-spaces search is in flight: "Searching other spaces…".
- **All KPIs** searches every KPI the user can browse ("Searching every space…" while in flight). Its
  **Space** filter is a button (`Space: Any space ▾`) that opens a list with its own "Find a space…"
  box, because a site can have hundreds of spaces; Enter picks the first match, × clears it. With a space
  chosen, results are that space only and the footer offers "N more in other spaces · Search every
  space".
- **No `{SPACE-KEY} text` syntax**: the Space filter does that job, discoverably.
- **Pasting or typing a key, or pasting a URL** (`PORT-14`, `…/browse/PORT-14`) looks the KPI up
  directly, in any space (`lookupKpiRef`). Text that is a whole key runs that lookup **alongside** the
  search, because `summary ~` never matches keys (and a JQL `key = …` clause fails when the key doesn't
  exist):
  - found → listed under "Pasted key" with where it lives (e.g. "In another space · PORT");
  - an old key of a moved KPI → shown under its new key ("KPI-5 moved to PORT-20"). `lookupKpiRef`'s own
    `GET /issue/{key}` as the user follows the move: Jira resolves old keys. 03's `resolveKpiKeys` is
    migration-only;
  - not a KPI → "{icon} PROG-45 Frictionless checkout is an Epic, not a KPI.";
  - already targeted here → "{icon} TEAM-503 … is already tracked on this work item.";
  - hidden or missing → "You don't have access to FIN-2, or it doesn't exist." (Jira doesn't say which,
    spec 10).

### Visual style (match Jira Plans)

- **Every work item is `{type icon} {key} {summary}`**: KPI rows, parent bands, the picked KPI, the
  panel's target rows, lookup messages. **KPIs keep their key here** (decided 2026-11-24, overview Q7):
  picking by key is how people identify issues in Jira. Only the Timeline's KPI rows drop it (08).
  16px type icon, 5px gap; key in link blue (`#1868db`, regular
  weight); summary medium weight (500), truncated. Font: Atlassian Sans.
- **Type is shown only by the icon**, never as a text label. Every type icon has a **tooltip** with the
  type name (Atlaskit `Tooltip`).
- **Nesting is indentation only**: 24px per level, as Plans (measured on bitovi-training). No connector
  lines.
- **KPI type icon: a target (bullseye).** It's the KPI work type's Jira avatar, not something the app
  draws: 04 gives a type it creates the target avatar (04 Q11 asks about existing types; 01 B7 checks
  the API). The prototype embeds bitovi-training's real Story, Epic and Initiative icons and the
  proposed target.
- **Type icons load the app's usual way** ([forge-icon-cors-proxy.md](../../forge-icon-cors-proxy.md)):
  the backend inlines each distinct `issuetype.iconUrl` as a `data:` URL with `inlineIssueTypeIcons`
  ([jira.ts](../../../app/src/backend/jira.ts)), deduped per invocation. The UI never loads a Jira icon
  URL directly.

### Keyboard

↑ / ↓ move through options; **Enter** picks; **→ / ←** open / close sub-KPIs; **Esc** collapses the
browser (in the Space filter's box, Esc closes just that list). Mouse hover moves the highlight.

## Data

### Panel data (replaces `PanelBasis.catalog`)

06's temporary "every KPI" catalog is replaced by what the browser needs **on open**: Tracked by parents
and This space, plus the menu entries.

```ts
/** A work item as the picker shows it: {type icon} {key} {summary}. */
interface WorkItemRefDto {
  key: string;
  summary: string;
  typeName: string;               // for the icon's tooltip
  typeIconUrl: string | null;     // inlined data: URL (inlineIssueTypeIcons); null if it couldn't be fetched
}

interface KpiOptionDto {
  id: string;                     // issue id (03)
  key: string;
  name: string;
  typeIconUrl: string | null;     // the KPI work type's icon, inlined
  unit: string;
  direction: KpiDirection | null;
  space: { key: string; name: string };
  parentId: string | null;        // KPI-tree parent, for nesting within a list
  hasChildren: boolean;           // has sub-KPIs in the list it was sent with: draw a chevron
}

interface KpiSuggestionsDto {
  thisSpace: { key: string; name: string };
  /** One group per parent with targets, nearest first. A KPI may be in several groups. */
  trackedByParents: Array<{
    item: WorkItemRefDto;
    targets: Array<{
      option: KpiOptionDto;
      /** The target this parent set: expected change and date, worded as the panel's target cards. */
      target: TargetSummaryDto;   // new: a display-ready subset of the assignment
      /** The KPI's same-space sub-KPIs, every level (sent; shown collapsed). */
      subKpis: KpiOptionDto[];
    }>;
  }>;
  inThisSpace: KpiOptionDto[];
  /** The parents' spaces (excluding this space and the central space), nearest first: menu entries. */
  parentSpaces: Array<{ key: string; name: string }>;
  /** The central space, if the site has one and it isn't this space: the Global KPIs entry. */
  globalSpace: { key: string; name: string } | null;
}
```

The parent targets come from the chain walk, which already reads each parent's `kpi-assignments`: no
extra request. The issue's own target rows still need each targeted KPI's name, unit and direction, from
an `id in (…)` lookup of just those KPIs.

### Resolvers

| Resolver | Returns | Used by |
|---|---|---|
| (panel Phase 1) | `KpiSuggestionsDto` | opening the panel |
| `listKpisInSpaces({ issueId, projectKeys })` | `KpiOptionDto[]` (names, units, nesting; no readings) | opening a parent space or Global KPIs |
| `searchKpis({ issueId, text, projectKey? })` | `KpiOptionDto[]`, capped (e.g. 50) | All KPIs search; the "N more in other spaces" count; with `projectKey`, All KPIs' Space filter |
| `listKpiSpaces({ query })` | spaces that can hold KPIs, filtered by key or name, paged | opening the Space filter |
| `lookupKpiRef({ issueId, ref })` | `{ kind: 'kpi', option } \| { kind: 'notKpi', item: WorkItemRefDto } \| { kind: 'hidden' }` | pasting or typing a whole key, an old key, or a `/browse/` URL |
| `getKpiCurrentValue({ kpiId })` | the picked KPI's current value | the form's preview |

The client caches what it loads for the life of the picker (re-opening a view makes no new request).
Searching the selected view filters what's already loaded, in the client.

### Requests (all `asUser`)

| Need | Request | When / bound |
|---|---|---|
| This space | `issuetype = {workTypeId} AND project = {own}` + fields + `kpi-meta` + hierarchy links | on open; one space |
| Chain | `GET /issue/{parentId}?fields=parent,issuetype,project,summary&properties=kpi-assignments`, one per level | on open; depth cap (Q4), cycle guard; typically 2–4 |
| Parent targets + own target rows | One `id in (KPIs targeted by the parents or by this issue)` | on open; number of targets |
| Target sub-KPIs | The targets' `issuelinks` (from the request above) name their children; one `id in (…)` per level, keeping same-space KPIs | on open; depth of the subtrees |
| A parent space / Global KPIs | `issuetype = {workTypeId} AND project = {key}` + fields + `kpi-meta` + hierarchy links, paged; no readings | when opened; once per session |
| Search (All KPIs, "N more" count) | `issuetype = {workTypeId} AND summary ~ "{text}*"` (+ `AND project = {key}` with the Space filter), capped, debounced. One request gives both All KPIs' results and the count for the footer | while typing; capped (01 C3) |
| Space filter list | `GET /project/search?action=browse&query={text}&expand=issueTypes`, keeping projects whose types include the KPI type (01 B6), paged | when the filter opens / while typing in it |
| Type icons | `inlineIssueTypeIcons` over the `issuetype.iconUrl`s returned above | one per distinct type, in parallel |

The chain walk starts at t=0 alongside This space (spec 07 *Issue panel performance*, Phase 1). It
replaces today's `parentTargets` stage (the parent is the walk's first step) and still feeds the "On
parent, not tracked" rows.

**Readings.** Phase 2 no longer loads every KPI's readings: only the issue's own targets (for the
cards), plus `getKpiCurrentValue` for a KPI picked in the form. **No view lists current values** (Q2).

## Implementation steps

### Step 1 — 🔍 Gate G3: prototype review — **done (2026-11-20)**

The decisions are written into *Design*, *Decided* and *Considered and rejected*. Before Step 2, confirm
the remaining *Questions* with Justin (or proceed with the noted defaults).

### Step 2 — Domain (pure)

- `buildKpiSuggestions({ thisProjectKey, centralProjectKey, chain, kpis, ownTargets })` →
  `KpiSuggestionsDto`: Tracked by parents (bands nearest first, targets top-level and never nested under
  each other, same-space sub-KPIs, a KPI under every parent that targets it), This space, the parent
  spaces and the Global KPIs entry; already-targeted KPIs left out everywhere.
- `kpiTree(kpis)` → rows in rank order with depth and `hasChildren`; a KPI whose parent isn't in the list
  is top-level. `visibleRows(tree, expanded, text)` → what to draw: collapsed by default; with search
  text, matches plus their ancestors, expanded.
- `parseKpiRefInput(text)` → key / URL / free text.
- **Verify:** table tests: one band per parent with targets, nearest first; a parent with no targets (no
  band); a parent targeting two KPIs where one is the other's parent KPI (both top-level, neither nested,
  neither listed twice in the band); the same KPI targeted by the Epic and the Initiative (under both); a
  KPI in this space that the Epic targets (in This space **and** under the Epic); a target's same-space
  sub-KPIs two levels down (nested, collapsed); its child in **another** space (not pulled in); each
  target carries its parent's target; `hasChildren` exactly for KPIs with sub-KPIs in the list; a KPI
  whose parent isn't listed (top level, no note); an already-targeted KPI (left out everywhere); search
  opening the path to a sub-KPI match; an empty own space; no chain (no parent spaces, Global KPIs still
  listed); a central space that is this space (no Global KPIs entry); no central space; a parent in the
  central space (Global KPIs, not a duplicate parent space); a cycle in the chain input (no infinite
  loop); URL and key parsing, including lowercase and trailing slashes.

### Step 3 — Backend: suggestions, views, search, spaces, lookup, current value

- Chain walk (replacing `parentTargets`), `buildKpiSuggestions` in Phase 1, the five resolvers, Phase 2
  readings limited to own targets.
- **Verify:** request-log tests pin Phase 1's requests: **no** query over all KPIs; one request per chain
  level; parent targets and own rows in one `id in (…)`, plus one per sub-KPI level. **Opening the panel
  makes no request for parent spaces, Global KPIs or All KPIs, and none for counts.** On a fixture with
  2,000 KPIs over 20 spaces, the Phase 1 request count doesn't grow with the number of spaces.
  `listKpisInSpaces` searches only the spaces asked for and fetches no readings; `searchKpis` with
  `projectKey` searches one space; `listKpiSpaces` keeps only spaces with the KPI type and pages. Icons
  are fetched once per distinct type, never per KPI, and every `typeIconUrl` is a `data:` URL or `null`.
  `lookupKpiRef` covers key, URL, old key, non-KPI, already targeted and hidden; typing a whole key runs it next to the search.

### Step 4 — UI: `KpiPicker`

- Follow [create-react-modlet](../../../.claude/skills/create-react-modlet/SKILL.md). Modlets: the field
  (select-like combobox, the picked KPI with its icon, the preview line), the browser (left menu + right
  pane, inline under the field), the KPI tree rows (chevron, `{icon} {key} {summary}`, unit, target),
  the parent band, the Space filter, and a shared `WorkItemRef` (`{icon} {key} {summary}` + Atlaskit
  `Tooltip` on the icon). Used by `AssociateForm`. ARIA: the field is a `combobox` controlling a
  `listbox`; chevrons are buttons with `aria-expanded`.
- Stories for each prototype scenario (TEAM-123, NEW-8, PORT-7; central space on and off) plus: a lazily
  loaded view loading, search in flight, "N more in other spaces", the Space filter open and filtered,
  greyed empty views, every paste outcome. Harness mocks for `searchKpis`, `listKpisInSpaces`,
  `listKpiSpaces`, `lookupKpiRef`, `getKpiCurrentValue` and a multi-space fixture.
- **Verify** in the harness (`?surface=issue`), light and dark, clean console, against the prototype:
  the field expands the browser inline and collapses on pick / Esc / outside click; the menu order and
  names; no per-space list beyond the parents' spaces and Global KPIs; no counts; empty Tracked by
  parents / This space greyed; no right-pane title; bands shaded, flush-left, not selectable, pinned;
  targets top-level with their Target value; sub-KPIs collapsed, chevron doesn't pick the row, → / ←
  work; typing filters the selected view, switching views keeps the text, "Search all KPIs" moves it;
  the Space filter narrows All KPIs and can be typed into; every work item shows icon, key and summary
  and the icon's tooltip names the type; 24px indents, no connector lines; pasting a key selects it;
  keyboard-only use works; typing over a picked KPI starts a new search.

### Step 5 — Remove the temporary catalog

- Delete 06's temporary "every KPI" panel catalog and `PanelBasis.catalog`.
- **Verify:** no code path loads all KPIs for the panel (grep and request-log test).

### Step 6 — Live check (dev)

- **Verify** on `bitovi-training`, with KPIs in the central space and a hand-enabled second space, and a
  Story → Epic → Initiative chain across three projects: the Story's picker opens on Tracked by parents
  showing the Epic's and Initiative's targets with their values; This space lists the Story's space;
  the parent spaces and Global KPIs load when clicked; All KPIs finds a KPI in a fourth space by search
  and by the Space filter; pasting a KPI key from another space works; a user without access to one
  space never sees its KPIs; the KPI type shows its target icon (after 04 sets the avatar).

## Questions

_Still open after the G3 review._

1. **Remember the last view** each person used (per user, in the browser), or always open on Tracked by
   parents? Default: always open on Tracked by parents.
2. **Current values in the list** (e.g. "Conversion rate · 3.1%")? It costs a readings fetch for every
   listed KPI. Default: no, only for the picked KPI.
3. **A new team with no KPIs in its space.** Should the empty This space view offer "Create a KPI in
   {space}" (when the KPI type is available there) or "Create one in Global KPIs", or nothing? Today
   KPIs are only created from the Timeline. (The prototype shows a "Create one in NEW" link as a
   placeholder.) If yes, whether the user can create there is asked only when the empty view is shown,
   with 08's `getKpiCreateSpaces` (no permission lookup on panel open, overview Q10).
4. **Chain depth.** Walk to the top (capped at 10 for safety), or reuse Settings' rollup `depthCap`?
5. **Narrow issue views.** The browser is designed for the issue's main column (~820px in the
   prototype; it was checked down to ~620px). Below that, should the left menu become a select or tabs
   above the list?
6. **Scale check.** The prototype has ~30 KPIs. Before building, try the design against a scale
   fixture (e.g. 300 KPIs over 25 spaces, a parent targeting 6 KPIs) to confirm bands and collapsed trees
   stay readable.

### Decided

- **Layout: a two-pane browser that expands inline from the KPI field** (not a dropdown, not a modal,
  not always visible). Left: views; right: KPIs.
- **Menu**: Tracked by parents · This space · Parent spaces (the parents' spaces, then Global KPIs last)
  · divider · All KPIs. Opens on Tracked by parents.
- **Names**: "Tracked by parents" (it's the work item's parents, not the user, so not "Tracked above
  you"); "This space" (not "My space"); the central space is "Global KPIs".
- **No list of other spaces**; reach them through All KPIs' search and its searchable Space filter.
- **Search is scoped to the selected view** and points to the rest ("Search all KPIs"). No
  `{SPACE-KEY} text` syntax.
- **Tracked by parents is grouped by parent work item**, not by space: the parent is what makes a KPI
  relevant. Shaded, non-selectable, pinned, flush-left bands; every target top-level under its band;
  targets never nest under each other; a KPI under every parent that targets it; a **Target** column
  with the parent's target value (only in this view).
- **Same-space sub-KPIs of a target are always included**, never optional, and start collapsed.
- **Sub-KPIs collapse everywhere**, with chevrons and → / ←.
- **No context column**: no "Tracked by …", "sub-KPI of …" or "under {parent KPI}" notes. The band says
  who tracks it; indentation says what's a sub-KPI; a KPI's cross-space parent isn't shown (if it's
  missed later, show the unlisted parent as a faded, non-selectable row with the child under it).
- **Plans style**: `{icon} {key} {summary}` everywhere, icon-only types with tooltips, 24px indents, no
  connectors, target icon for KPIs.
- **Performance**: only Tracked by parents and This space load on open; everything else when opened; no
  counts; known-empty views greyed; readings only for own targets and the picked KPI.

### Considered and rejected

- **Scope buttons above a dropdown** (widening levels, on/off chips, a chip per space) and a fixed
  "Other spaces" section: still in the prototype for comparison. Rejected for the two-pane browser,
  whose menu is the scope control.
- **A "Dropdown + browse" link** that swapped the dropdown for the browser, and **a Jira modal**
  (`@forge/bridge` Modal): the browser expanding from the field is simpler and stays in the form.
- **Grouping Tracked by parents by space**, with a "Tracked by PROG-45" note on each row.
- **Indenting KPIs under the parent band**, and **nesting one target under another**: both hid that the
  parent targets each of them.
- **A "show same-space sub-KPIs" toggle**: hiding them breaks nesting and hides the KPIs a story most
  often moves.
- **Showing a KPI's cross-space parent** ("under PROG · Conversion rate"): confusing, and the Timeline's
  job.
- **Type labels** ("Epic", "Initiative") and **connector glyphs** (`└`): Plans shows neither.
- **Counts** in the menu and the Space filter: a request per lazy view on every open.
- **Listing every space** in the menu: a site can have hundreds.
