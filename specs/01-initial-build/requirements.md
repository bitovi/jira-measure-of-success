# Requirements — Measure of Success (Initial Build)

Status: **Draft for engineering** · Scope: first vertical slice
Sources: [build brief](../kpi-forge-app-build-brief.md) · [constitution](./constitution.md) · [tech-choices](./tech-choices.md)
Mocks: [issue.html](../00-mocks/issue.html) · [kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html) · [settings.html](../00-mocks/settings.html)

> **Precedence (Constitution §1a):** where the **mocks and the brief conflict on behavior/UX, the mocks win**. Sole terminology exception: user-facing "KPI", not the mocks' "Measurement". A behavior conflict that also affects positioning (value inheritance) is flagged in §8-Q11 for an explicit decision.

This document describes **what** the first slice must do and **why** — not how. No tech stack, no code. It is written so an engineer can turn each user story into tasks with a test per acceptance criterion. Where a rule originates in the brief it is cross-referenced (e.g. "Brief §2.1").

---

## 1. Overview

"Measure of Success" is a hierarchy-native KPI tracker for Jira Cloud: KPI **targets** (value, type, and timing) live **on the issue itself** and **inherit down the native parent chain** (Outcome → Initiative → Increment → Epic → Story), rather than in a separate strategic object model (Brief §1). This initial slice delivers three surfaces that together let a team author KPI targets on issues, see them roll up and inherit, visualize progress over time, and configure how due dates are resolved:

1. **Issue panel** — the on-issue KPI editor: view assigned KPIs **grouped by their relationship to the parent** (shared / only here / on parent-not-tracked), add/edit/remove assignments, define new KPIs inline, and set an absolute or relative target date whose resolved value and source are shown (Brief §5).
2. **KPI Timeline v2** — a nested, plan-style visualization of every KPI on a shared date axis, with recorded-value sparklines, target markers (hit/missed/upcoming), a "record a value" modal, and drill-in to the issues behind each target (mock [kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html)).
3. **Settings — Due Date Rollup** — one dropdown per discovered hierarchy level choosing how that level's due date is resolved between parent and children (Brief §6.1), plus a read-only preview of how relative KPI target dates resolve (mock [settings.html](../00-mocks/settings.html)).

The goal is a "green and visually verified" slice that exercises the riskiest logic — **effective-due-date rollup and relative target dates** (Brief §6.1) — end to end, before any of the out-of-scope surfaces are built. (Value *inheritance* is **not** in v1 — see §8-Q11.)

---

## 2. Personas & context

| Persona | Who they are | Which surface, and when |
|---|---|---|
| **Strategy owner** (e.g. product/portfolio lead) | Authors KPIs at the top of the hierarchy (Outcome/Initiative). | **Issue panel** on high-level issues: sets targets and timing so descendants inherit them. **Timeline** to see whether targets are being hit. |
| **Delivery lead** (e.g. team lead on an Epic/Increment) | Owns a mid/lower-level issue that shares KPIs with its parent and adds its own local ones. | **Issue panel** on their issue: reviews inherited values, overrides individual fields, adds local KPIs, and records progress. |
| **Contributor / analyst** | Records measured values and reads progress. | **Timeline**: records a value via the modal, inspects target status, drills into contributing issues. |
| **App administrator** | Configures how the app resolves dates for the whole installation. | **Settings**: sets the per-level due-date rollup method once; consults the preview to confirm relative target dates resolve as expected. |

Context notes:
- The custom hierarchy above Epic requires Jira Premium and is assumed already configured on the site (Brief §1). Hierarchy level **names are read at runtime**, never hardcoded (Brief §1, §4.4, Constitution §6).
- Issue-entity-property data is writable by any user with edit permission on the issue, so it is **untrusted** and must be validated before use (Brief §6, Constitution §7).

---

## 3. Glossary

Terms are kept consistent with the brief. The HTML mocks use the user-facing word **"Measurement"** for what the brief and data model call a **KPI** (see Open Questions §8-Q1); this document uses **KPI**.

| Term | Definition |
|---|---|
| **KPI (measurement)** | A named metric in the shared catalog: `id`/slug, `name`, `unit`, `direction` (`increase`/`decrease`, or none), optional `description` (Brief §4.1). |
| **KPI definition** | A catalog entry for a KPI (the record above). Created once, reused across issues; deletion is soft (`archived: true`) so existing assignments don't break (Brief §4.1). |
| **Assignment** | A KPI attached to a specific issue with its own `target`, `targetType`, and `timing`, plus an `inheritFromParent` flag (Brief §4.2). Stored on the issue as an entity property. The panel sets **targets only** — no baseline or current/recorded value (Q2). |
| **Inheritance** | Resolving a `null` assignment field at **read time** by walking up the `parent` chain to the nearest ancestor that assigns the **same KPI** and using that ancestor's value; a non-null local field always wins (Brief §2.1). |
| **Rollup (due-date)** | A per-level rule deciding whether an issue's due date comes from its own date, its children's dates, or a combination (Brief §6.1). Configured in Settings. Note: KPI **targets are not summed** into parents — that is coverage, not rollup (Brief §2.2, out of scope here). |
| **Effective due date** | The result of applying an issue's rollup method recursively (bottom-up, memoized) to produce the date the issue is treated as "due" (Brief §6.1). |
| **Relative target date** | A KPI target date expressed as `offsetMonths` after a resolved **anchor** (`issueDueDate`, `parentDueDate`, or `kpiStart`), computed at read time — never snapshotted (Brief §4.2, §6.1). |
| **Anchor** | What a relative target date is measured from: `issueDueDate` (the assignment's own issue's effective due date), `parentDueDate` (its parent's), or `kpiStart` (the assignment's `timing.start`) (Brief §4.2, §6.1). |
| **Pending** | The displayed state of a relative target date whose anchor cannot be resolved (no own date and no dated descendants) — surfaced instead of a wrong computed date (Brief §6.1). |
| **Coverage** | Sum of direct children's targets vs. a parent's own target, shown to reveal gaps/over-commitment without conflating them (Brief §2.2). *Referenced for glossary completeness; the reporting surface that shows it is out of scope.* |
| **Hierarchy levels** | The discovered issue-type chain, deepest-parent first: **Outcome → Initiative → Increment → Epic → Story**. Names discovered at runtime (Brief §1). "Leaf level" = the bottom (Story). |
| **Source (of a value)** | Whether a value in effect is **Local** (set on this issue) or **Inherited from `<ISSUE-KEY>`** (resolved from an ancestor) — shown to the user per field/row (Brief §5). |

---

## 4. User stories with acceptance criteria

Acceptance criteria are written Given/When/Then and are intended to be individually testable. Counts are summarized in §4.4.

### 4.1 Issue panel (`jira:issuePanel`)

Reference mock: [issue.html](../00-mocks/issue.html). Brief §5 "On-issue editor behavior".

> **v1 model (Q11):** the panel authors **independent** per-issue targets, **grouped by relationship** to the parent (shared / only here / on parent-not-tracked). It does **not** inherit or sum parent values. Stories **IP-2 and IP-3** (inherited-vs-local source labels and per-field override) are **deferred** — retained below for history but not built in v1.

---

**Story IP-1 — View assigned KPIs on an issue**
As a delivery lead, I want to see all KPIs assigned to the current issue with their target value and target date, so that I understand what this issue is committed to.

1. Given an issue with one or more assignments, When the panel loads, Then each assigned KPI is rendered as a row showing the KPI **name**, **unit**, the **target value**, and the **resolved target date**.
2. Given a KPI definition has a `direction`, When its row renders, Then the direction (increase/decrease) is available to the user (label or icon); a KPI with no direction shows none.
3. Given the issue's assignment property is present, When the panel loads, Then the panel reads the issue's own assignments first and then resolves inheritance by walking `parent` (Brief §5, §6).
4. Given assignments exist, When they are displayed, Then rows are grouped by their relationship to the parent — **shared with parent**, **only on this issue**, and **on parent but not tracked here** (mock groups: "Shared with parent", "Only on this issue", "On parent, not tracked here").

---

**Story IP-2 — Distinguish inherited vs. local values with their source**
As a delivery lead, I want each value to clearly show whether it is local or inherited and from which ancestor, so that I know where a number comes from before I rely on it.

1. Given an assignment field is set locally (non-null), When its row renders, Then the value is labelled **Local**.
2. Given an assignment field is `null` with `inheritFromParent: true` and a nearest ancestor assigns the same KPI, When its row renders, Then the value shown is the ancestor's value, labelled **Inherited from `<ISSUE-KEY>`** (e.g. "Inherited from OUT-12") (Brief §5, Phase 3 AC).
3. Given a field is inherited and multiple ancestors assign the same KPI, When the value resolves, Then the **nearest** ancestor's value is used and named in the source label (Brief §2.1).
4. Given a field is `null`, `inheritFromParent: true`, and **no** ancestor assigns the KPI, When its row renders, Then the field is treated as locally unset (empty), not inherited (Brief §2.1).
5. Given a KPI is inherited, When the row renders, Then an **override** affordance is available to detach that field to a local value (Brief §5).

---

**Story IP-3 — Override an inherited field locally**
As a delivery lead, I want to override a single inherited field without detaching the others, so that I can localize only what differs.

1. Given a KPI with all fields inherited, When I set a local value for one field (e.g. target), Then only that field becomes Local and the remaining fields stay Inherited with their source labels (Brief §2.1, Phase 3 AC).
2. Given I have overridden a field, When I clear it back to empty with inherit enabled, Then it returns to showing the inherited value and source.
3. Given I override a field, When I save, Then the local value is persisted on this issue's assignment property and wins over inheritance on subsequent reads (Brief §2.1).

---

**Story IP-4 — Add an assignment (track an existing KPI)**
As a delivery lead, I want to associate an existing KPI with this issue and set its target, so that this issue contributes to that KPI.

1. Given a KPI defined in the catalog and not yet on this issue, When I open the "Associate a measurement" control, Then I can pick it from a list of catalog KPIs (mock select).
2. Given a KPI appears on the parent but not this issue ("on parent, not tracked here"), When I choose **+ Track this**, Then an assignment for that KPI is created on this issue with inheritance enabled (mock "+ Track this").
3. Given I have selected a KPI, When I enter a target value and a target date and confirm, Then a new assignment is created and appears in the appropriate group.
4. Given I create an assignment, When it is saved, Then it persists across reloads (Brief Phase 2 AC).

---

**Story IP-5 — Define a new KPI inline**
As a strategy owner, I want to add a brand-new KPI definition without leaving the issue, so that I can start tracking something the catalog doesn't have yet.

1. Given the catalog picker is open, When I choose the **"Define new…"** affordance, Then I can enter a new KPI's name, unit, and direction (Brief §4.1, §5).
2. Given I submit a new KPI definition, When it is saved, Then a new catalog entry is created with a unique slug generated from the name, disambiguated on collision (Brief §4.1, Phase 1 AC).
3. Given I just created a new KPI, When creation succeeds, Then it is immediately selected for assignment on the current issue (Brief §5 "immediately selects it").
4. Given a KPI with the same name already exists, When I create another, Then the new slug is collision-suffixed and both definitions remain usable (Brief §4.1).

---

**Story IP-6 — Set the target value and target type**
As a strategy owner, I want to set a KPI's target value and its type (absolute vs. delta), so that the issue has a clear goal that descendants can inherit.

1. Given I am editing an assignment, When I enter a **target** value, Then it persists as a numeric value on the assignment (Brief §4.2).
2. Given I am editing an assignment, When I choose **target type**, Then I can pick **absolute** or **delta** and it persists (Brief §4.2).
3. Given the target is left blank with inheritance enabled, When saved, Then it is stored as `null` (inherited/unset), not `0` (Brief §4.2).

> **Scope (Q2 resolved):** the panel does **not** capture baseline or current/recorded values — the brief §4.2 was wrong to include them. Recorded values over time are a **Timeline** concern (§4.2); persisted history stays out of scope (§7).

---

**Story IP-7 — Set an absolute or relative target date and see the resolved date + source**
As a strategy owner, I want to set a KPI's target date either as a fixed calendar date or as "N months after {anchor}", so that a moving anchor keeps the target date correct automatically.

1. Given I am editing a target date, When I choose **Absolute date**, Then I enter a fixed ISO date that is stored and displayed verbatim (Brief §4.2 `mode: "absolute"`).
2. Given I choose **N months after {anchor}**, When I pick an anchor (`issueDueDate` / `parentDueDate` / `kpiStart`) and an `offsetMonths`, Then the row displays the **resolved** date computed at read time as `resolve(anchor) + offsetMonths`, never a stored snapshot (Brief §4.2, §6.1).
3. Given a relative target date resolves, When the row renders, Then it shows the resolved date **and its source**, e.g. "2027-03-31 · 3 mo after INIT-48 due, rolled up from children" (Brief §5).
4. Given the chosen anchor cannot be resolved (no own date and no dated descendants), When the row renders, Then the target date is shown as **pending** rather than a computed-from-nothing date (Brief §6.1).
5. Given `offsetMonths` is `0`, When the target date resolves, Then the resolved date equals the resolved anchor date exactly (Brief §6.1 "offset of 0").
6. Given an anchor's underlying dates change (e.g. a child's date), When the panel is re-rendered, Then the resolved relative target date reflects the new anchor without any manual re-save (Brief §2.1, §6.1).

---

**Story IP-8 — Edit an assignment**
As a delivery lead, I want to edit an existing assignment's fields, so that I can correct or update targets.

1. Given an assignment row, When I click or focus a field's readable value, Then it becomes editable **in place** using Jira's inline-edit pattern (Atlaskit `InlineEdit`) — readable by default, immediately editable on click/focus; there is **no** separate row-level "Edit" mode (this supersedes the mock's per-row "Edit" button).
2. Given I edit a field and confirm (blur or the ✓ confirm), When the panel reloads, Then the updated value persists (Brief Phase 2 AC).
3. Given I edit a field and cancel (Esc or the ✕), When I dismiss, Then no change is written and the readable value is restored.
4. Given the target-date field, When it enters edit mode, Then it exposes the absolute-vs-relative control (anchor + `offsetMonths`) required by IP-7, not a bare date input.

---

**Story IP-9 — Remove an assignment**
As a delivery lead, I want to remove a KPI from this issue, so that it no longer contributes here.

1. Given an assignment row, When I choose **Remove** and confirm, Then the assignment is deleted from this issue's property (mock "Remove"; Brief §5, Phase 2 AC).
2. Given I remove an assignment, When the panel reloads, Then the KPI no longer appears in the tracked groups.
3. Given a removed KPI is still assigned on the parent, When the panel reloads, Then it reappears under "on parent, not tracked here" with a **+ Track this** option (mock grouping).

---

**Story IP-10 — Empty and error states**
As any user, I want clear empty and error states, so that I know whether the panel is broken or simply has no data.

1. Given an issue with no assignments and no inheritable ancestor KPIs, When the panel loads, Then an empty state invites the user to associate a measurement (mock "Associate a measurement").
2. Given the assignment property fails schema validation (untrusted data), When the panel loads, Then the panel surfaces an error state and does not render malformed values (Constitution §7, Brief §6).
3. Given the parent walk hits an error or the depth cap (≤10) or a cycle, When resolving inheritance, Then the panel degrades gracefully to locally-set values and does not hang (Brief §6).
4. Given data is still loading, When the panel first mounts, Then a loading indicator is shown (Brief Phase 7).

---

### 4.2 KPI Timeline v2

Reference mock: [kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html).

---

**Story TL-1 — See every KPI as a row on a shared date axis**
As a contributor, I want all KPIs laid out as nested rows against one shared date axis, so that I can compare progress across the hierarchy at a glance.

1. Given the KPI tree, When the timeline renders, Then each KPI is a row with a **label cell** (name, unit, direction) and a **track cell** plotted against a shared, quarter-marked date axis (mock header row "Q1–Q4", `.plan-row` grid).
2. Given a KPI has child KPIs, When rendered, Then rows are **nested** and can be **collapsed/expanded** via the row toggle (mock `.plan-toggle`, `collapsed` set).
3. Given the axis, When rendered, Then quarter gridlines and a **"today" marker** are drawn in the plotted band, and markers at the extreme dates are not clipped (mock `.q-grid`, `.today-line`, `PAD_L`/`PAD_R` insets).
4. Given a leaf KPI with no children, When rendered, Then its toggle is hidden/disabled (mock `.plan-toggle.leaf`).

---

**Story TL-2 — See recorded values as a sparkline**
As a contributor, I want each KPI's recorded values drawn as a sparkline over time, so that I can see the trend and the value at any date.

1. Given a KPI with recorded values (points), When its track renders, Then the values are drawn as a connected line with a dot per reading, scaled to the row's own value domain (mock `.tl-line` polyline, `.tl-dot`, `scaleFor`).
2. Given I hover across a track, When the cursor moves, Then a **crosshair + date flag** follow the cursor across all rows and a tooltip reports the value in effect — **measured** at a reading, or **interpolated/latest/none-yet** between/around readings (mock crosshair, `valueDetailAt`).
3. Given a KPI has no recorded values, When its track renders, Then it shows an empty hint ("No values yet — use + to add") instead of a line (mock `.tl-empty`).

---

**Story TL-3 — See target markers with status and source**
As a strategy owner, I want each KPI target drawn as a marker classified as hit/missed/upcoming with the issue it was set on, so that I can see which commitments are on track.

1. Given a KPI has targets set on issues, When the track renders, Then each target is a **diamond** positioned by its date and value (mock `.tl-target`).
2. Given a target's due date is in the past, When classified, Then it is **hit** or **missed** by comparing the recorded value at that date against the target, respecting the KPI's direction; a future target is **upcoming** (mock `targetStatus`, statuses `hit`/`missed`/`future`).
3. Given a target that cannot be judged (nothing recorded by its date), When classified, Then it is treated as **upcoming** rather than missed (mock `valueAt` → null → "future").
4. Given I hover or focus a target, When its tooltip shows, Then it names the target value, status, due date, and the **source issue** ("Set on Outcome OUT-12 — Grow Revenue") (mock `dia.dataset.tip`, `.src`).

---

**Story TL-4 — Drill in to the issues behind a KPI's targets**
As an analyst, I want to expand a KPI row to see which issues each target came from, so that I can trace a number to its owning work item.

1. Given a KPI row, When I click its track, Then the row expands to reveal each target's **source issue name**, angled and connected by an elbow line to its diamond (mock `namesOpen`, `.name-label`, `.tl-elbows`).
2. Given a KPI has no targets, When expanded, Then it shows "No targets set on issues for this measurement." (mock `.names-empty`).
3. Given a row is expanded, When it renders, Then a value **y-axis** (unit + min/max labels + gridlines) is shown for that row (mock expanded `.tl-unit`, `.tl-axis-label`, `.h-grid`).
4. Given an expanded row, When I click the track again, Then it collapses back to the compact height.

---

**Story TL-5 — Record a value via the modal**
As a contributor, I want to record a new measured value for a KPI from the timeline, so that the sparkline stays current without leaving the page.

1. Given a KPI row, When I click its **+** ("Record a value"), Then a modal opens titled "Record a value" showing the KPI name + unit and a date (defaulting to today) and value input (mock `openModal`, `#modal`).
2. Given the modal is open, When I enter a valid date and numeric value and choose **Record**, Then the value is added to that KPI's series and the sparkline updates (mock `modal-save`).
3. Given the modal is open, When I choose **Cancel**, click the overlay, or press **Escape**, Then it closes without recording (mock `closeModal`, overlay click, keydown Escape).
4. Given I enter a non-numeric or empty value, When I submit, Then no value is recorded (mock guards `Number.isNaN`, empty check).

---

**Story TL-6 — Filter the timeline**
As an analyst, I want to filter which KPIs are shown, so that I can focus on the ones I care about.

1. Given many KPIs, When I collapse a parent row, Then its descendant rows are hidden until re-expanded (mock collapse — the primary filtering mechanism present in the mock).
2. Given a filter capability beyond collapse is desired (by KPI or by top-level ancestor, mirroring the reporting page filters in Brief §5), Then its exact controls are **an open question** (see §8-Q4) and not assumed by this story's acceptance beyond collapse/expand.

---

**Story TL-7 — Timeline empty state**
As a contributor, I want a clear empty state when there are no KPIs, so that I understand there is nothing to show yet.

1. Given no KPIs exist, When the timeline renders, Then it shows an empty state rather than an empty grid.
2. Given a KPI exists with no targets and no readings (e.g. "Opportunity Enablement"), When rendered, Then its row still appears with the appropriate empty hints rather than being omitted (mock third root node).

---

### 4.3 Settings — Due Date Rollup

Reference mock: [settings.html](../00-mocks/settings.html). Brief §4.4, §6.1.

---

**Story ST-1 — Choose a rollup method per discovered hierarchy level**
As an app administrator, I want one dropdown per hierarchy level to choose how that level's due date is resolved, so that relative KPI target dates anchor correctly.

1. Given the site's issue-type configuration, When the settings form loads, Then it shows **one row per discovered hierarchy level**, labelled with the level's runtime name and icon, ordered deepest-parent to leaf (mock rows Outcome → Story); **no level name is hardcoded** (Brief §4.4, Constitution §6).
2. Given a level row, When I open its dropdown, Then it offers exactly the five rollup methods (Brief §6.1) with plain-language labels that interpolate the child level's name:
   - **From {children}, then {self}** → `childrenFirstThenParent`
   - **From {children}** → `childrenOnly`
   - **From {self}, then {children}** → `parentFirstThenChildren`
   - **From {self} only** → `parentOnly`
   - **From {self} or {children} (earliest → latest) (default)** → `widestRange`
   (labels ported from `jira-timeline-report`; e.g. "From Outcome or Initiatives (earliest → latest) (default)".)
3. Given a level has no configured method, When the form loads, Then it defaults to **widestRange** (leaf level defaults to **parentOnly**) (Brief §4.4, §6.1). *(Default is `widestRange` to match the ported `jira-timeline-report` form default; see plan §3.)*
4. Given the descriptive hint, When the form renders, Then it explains how each method resolves a date (bottom-up, memoized) matching the five behaviors in Brief §6.1 (mock hint block).

---

**Story ST-2 — Leaf level is disabled**
As an app administrator, I want the leaf level's control disabled, so that I can't configure a rollup for a level with no children.

1. Given the leaf (bottom) level, When its row renders, Then its dropdown is **disabled** and shows "From {leaf} only (leaf level)" with a "no children to roll up" note (mock disabled Story select).
2. Given the leaf level, When config is saved, Then its method is stored as **parentOnly** regardless of interaction (Brief §6.1 leaf default).

---

**Story ST-3 — Save and reset the configuration**
As an app administrator, I want to save my choices or reset to defaults, so that I can manage the app-level configuration deliberately.

1. Given I have changed one or more dropdowns, When I choose **Save settings**, Then the per-level methods are written to the single config document (`kpi:config:rollup`), keyed by runtime issue-type name (Brief §4.4, mock footer note).
2. Given I choose **Reset to defaults**, When I confirm, Then every level returns to its default method (non-leaf → widestRange, leaf → parentOnly) in the form (mock "Reset to defaults").
3. Given a save succeeds, When the page reloads, Then the saved methods are reflected in each dropdown.
4. Given a save fails, When it errors, Then the user is informed and prior settings remain intact.

---

**Story ST-4 — Read-only relative target-date preview**
As an app administrator, I want a read-only preview of how relative KPI target dates resolve under the current rollup settings, so that I can verify the configuration before relying on it.

1. Given the preview table, When it renders, Then it is clearly marked **preview / read-only / derived** and is **not editable** (mock "preview" lozenge; this surface is a verification view only).
2. Given each preview row, When it renders, Then it shows the issue, its **effective due date** with a source tag (**own date** = local, or **from {children}** = rolled up), the **KPI target timing** (e.g. "+3 months after due", "on due date"), and the **resolved target date** (mock table columns and `.source-tag` local/inherited).
3. Given an issue whose anchor cannot be resolved (no own date and no dated descendants), When its row renders, Then the resolved target date shows **pending** rather than a computed date (mock hint; Brief §6.1).
4. Given the rollup methods above change, When the preview re-derives, Then the effective due dates and resolved target dates reflect the current configuration (Brief §6.1 "resolve at read time").

---

### 4.4 Story & criteria counts

| Surface | Stories | Acceptance criteria |
|---|---|---|
| Issue panel | 10 (IP-1…IP-10) | 39 |
| KPI Timeline v2 | 7 (TL-1…TL-7) | 22 |
| Settings — Due Date Rollup | 4 (ST-1…ST-4) | 13 |
| **Total** | **21** | **74** |

---

## 5. Cross-cutting requirements

These rules apply across surfaces. They live in the pure domain layer (Constitution §3) and are exercised identically by the panel, the timeline, and the settings preview.

### 5.1 Inheritance resolution (Brief §2.1) — DEFERRED (Q11), not in v1
> Value inheritance is **not built in v1**: each issue authors independent targets (§8-Q11). This section and IP-2/IP-3/INH-* are retained for history; the domain `resolveInheritance` is **parked** (kept, unused). `effectiveDueDate` (§5.2) is unaffected.

- Resolution is a pure function `(localAssignment, ancestorAssignments[]) → resolvedAssignment`.
- Walk `parent → parent → parent`, stopping at the top of the hierarchy or at the **nearest** ancestor assigning the **same** `kpiId`.
- A non-null local field **always** wins; a `null` field with `inheritFromParent: true` takes the nearest ancestor's value; if no ancestor assigns the KPI, the field is locally unset.
- Fields resolve **independently** (per-field override): overriding one field does not detach the others.
- Resolution happens at **read time** — nothing is snapshotted.

### 5.2 Effective timing rollup (Brief §6.1)
- **Ported from `jira-timeline-report`** (`src/jira/rollup/dates/dates.ts`) — that implementation is the authoritative source for rollup behavior (Constitution §1a). We port its five methods verbatim into the domain layer rather than re-deriving them.
- `effectiveTiming(issue)` is a pure, **recursive, memoized** function keyed on the per-level method from `kpi:config:rollup`. It rolls up a **`{ start, due }` range**, not a single date: aggregation across children = **earliest child start + latest child due** (`mergeStartAndDueData`); resolve **bottom-up**. v1 surfaces read `due` where a single "effective due date" is needed.
- The five methods behave as (each operates per-field on `start` and `due`):

  | Method | Behavior |
  |---|---|
  | `childrenFirstThenParent` | Use merged children's range; if no children, fall back to the issue's own `{start,due}`. |
  | `childrenOnly` | Earliest start + latest due across children; ignore the issue's own dates. Empty if no children. |
  | `parentFirstThenChildren` | The issue's own date wins per-field; children fill only the gaps. |
  | `parentOnly` (leaf default) | Never roll up; use the issue's own `{start,due}`. |
  | `widestRange` (default) | Earliest start + latest due across the issue's own dates and all children. |

### 5.3 Relative target-date resolution (Brief §4.2, §6.1)
- Relative target date = `effectiveDueDate(resolve(anchor)) + offsetMonths`, computed at read time.
- Anchors: `issueDueDate` → the assignment's own issue; `parentDueDate` → its parent; `kpiStart` → the assignment's `timing.start` (no rollup).
- **Unresolvable anchor** (no own date, no dated descendants) → surface **pending**, never a computed-from-nothing date.
- `offsetMonths: 0` → resolved date equals the resolved anchor date.
- Displayed value always carries its **source** description (anchor + offset + how the anchor was rolled up).

### 5.4 Runtime hierarchy discovery (Brief §1, §4.4, Constitution §6)
- The hierarchy (levels, names, order) is discovered at runtime via the `parent` field and issue-type metadata. **Never hardcode** issue-type names anywhere (settings labels, grouping, rollup keys).

### 5.5 Validation of untrusted data (Brief §6, Constitution §7)
- Every trust boundary — issue entity property reads, KVS/config reads, bridge payloads, and harness fixtures — is parsed with the domain schemas before use. Malformed data yields an error state, never a silently-rendered wrong value.

### 5.6 Performance / caching (Brief §2.1, §6, §6.1)
- Parent-walk lookups and `effectiveDueDate` results are **memoized per render** and share one parent-walk cache and depth cap (≤10). Cycles are guarded against. Writes are batched and reads favored over writes (Brief §6, §7).

### 5.7 Date sources for rollup
The rollup engine is **ported from Bitovi's `jira-timeline-report`** ("Timeline Report", whose "Timing Calculation" settings the Due Date Rollup mirrors) — see §5.2. Adopted **in v1**:

- **Start + due as a range** — the engine rolls up both endpoints (earliest start, latest due), not a single date. The domain node carries a `{ start, due }` pair and every method operates per-field. v1 UI reads `due` where a single date is displayed.

Deferred to a later hardening pass (kept out of v1, but the ported engine is designed to extend without a rewrite):

- **Sprint dates** — an issue on a sprint can derive start/due from the **sprint's start/end dates**, not just its own `duedate`. Useful for Stories/Epics that carry no explicit due date but are sprinted.
- **Configurable field precedence** — which date source wins (own field vs. sprint vs. rolled-up children) is user-configurable in the Timeline Report, consistent with our per-level `kpi:config:rollup`.

**Implication for our model:** the domain node carries candidate date sources. v1 populates the issue's own `{ start, due }` (the `startdate`/`duedate` fields); a later pass adds sprint start/end via the backend `fetchIssueMeta` (Agile REST API / `fields=sprint`). The resolver stays pure — it consumes whatever dated sources the adapter provides.

> Reference repo: `jira-timeline-report` (Bitovi Timeline Report). Sprint-derived dates are out of scope for this slice; recorded so the rollup engine is designed to extend to them without a rewrite.

---

## 6. Acceptance test matrix

Concrete example cases mapped to the rules above, mirroring the brief's required unit tests (Brief §2.1, §6.1). Each row is a testable scenario for the pure domain layer.

### 6.1 Inheritance resolution (Brief §2.1)

| # | Case | Setup | Expected result |
|---|---|---|---|
| INH-1 | No ancestor | Issue assigns KPI `revenue`, `inheritFromParent: true`, all fields `null`; no ancestor assigns `revenue`. | All fields locally unset (empty); source not "inherited". |
| INH-2 | Ancestor same KPI | Parent assigns `revenue` target 1,500,000; child assigns `revenue`, target `null`, inherit true. | Child target resolves to 1,500,000, source **Inherited from `<parentKey>`**. |
| INH-3 | Multiple ancestors, nearest wins | Grandparent target 2,000,000; parent target 1,500,000; child inherits. | Child target = 1,500,000 (nearest), source names the parent. |
| INH-4 | Partial override | Parent sets target 1,500,000 and start `2026-01-01`; child overrides target = 1,800,000, start `null`. | Child target = 1,800,000 **Local**; start = `2026-01-01` **Inherited**. |
| INH-5 | Local wins | Parent target 1,500,000; child target 1,200,000 (non-null). | Child target = 1,200,000, source **Local**. |

### 6.2 Effective due date under each method (Brief §6.1)

These cases assert the `due` endpoint; `start` rolls up symmetrically (earliest instead of latest) via the same ported methods. Setup unless noted: parent own due `2026-06-30`; three children with effective dues `2026-03-31`, `2026-09-30`, `2026-12-20`.

| # | Method | Parent own date | Children | Expected effective due |
|---|---|---|---|---|
| DUE-1 | `childrenOnly` | present | dated | `2026-12-20` (max child; own ignored). |
| DUE-2 | `childrenOnly` | present | **none** | Unresolvable from children → falls through to pending (no children to roll up). |
| DUE-3 | `childrenFirstThenParent` | present | dated | `2026-12-20` (children win). |
| DUE-4 | `childrenFirstThenParent` | present | **none** | `2026-06-30` (fall back to own date). |
| DUE-5 | `parentOnly` | present | dated | `2026-06-30` (own date; never rolls up). |
| DUE-6 | `parentFirstThenChildren` | present | dated | `2026-06-30` (own wins; children fill gaps only). |
| DUE-7 | `parentFirstThenChildren` | **none** | dated | `2026-12-20` (children fill the gap). |
| DUE-8 | `widestRange` | `2026-06-30` | latest child `2026-12-20` | `2026-12-20` (latest across own + children). |
| DUE-9 | any | **none** | **none** | **pending** (no dates anywhere). |

### 6.3 Relative target-date resolution (Brief §4.2, §6.1)

| # | Case | Setup | Expected resolved target date |
|---|---|---|---|
| REL-1 | Absolute mode | `mode: absolute`, `absolute: 2026-11-30`. | `2026-11-30` verbatim. |
| REL-2 | Offset after own due | anchor `issueDueDate` = `2026-12-31`, `offsetMonths: 3`. | `2027-03-31`, source "3 mo after due, rolled up from children". |
| REL-3 | Offset after parent due | anchor `parentDueDate` = `2026-09-30`, `offsetMonths: 1`. | `2026-10-31`. |
| REL-4 | Offset of 0 | anchor resolves `2026-03-31`, `offsetMonths: 0`. | `2026-03-31` (equals anchor). |
| REL-5 | Anchor = kpiStart | anchor `kpiStart`, `timing.start = 2026-01-01`, `offsetMonths: 6`. | `2026-07-01` (no rollup applied). |
| REL-6 | Unresolvable anchor | anchor `issueDueDate`, no own date, no dated descendants. | **pending** (not a computed date). |
| REL-7 | Moving anchor | REL-2 setup, then a child's date changes so own effective due becomes `2027-01-31`. | Re-render → `2027-04-30` without re-save. |

---

## 7. Out of scope (for this slice)

Explicitly **not** built now (Brief §10, Constitution "Initial scope"):

- **Catalog management page** — a dedicated surface to list/edit/archive KPI definitions. (Inline "Define new…" from the issue panel is in scope; a full management UI is not.)
- **Full reporting page** — the group-by-KPI reporting surface with the coverage indicator and ancestor filters (Brief §2.2, §5). Coverage is defined in the glossary for continuity only.
- **JQL indexing polish** — the `jira:entityProperty` flat `kpiIds` mirror and JQL query tuning (Brief §6).
- **Notifications / check-in reminders** (Brief §10).
- **Recorded-value storage is now IN scope (Q6)** as per-(issue, KPI) Jira **entity properties** (`kpi-readings-{kpiId}`) — Jira is the writable source of record (REST/MCP). Out of scope: advanced history **analytics/retention** beyond a simple readings array, and any timeline history features past reading + plotting.
- **Baseline and current/recorded values on the issue** — the brief §4.2 modeled `baseline` and `current`; both are **dropped** (Q2). The panel sets **targets only**; recorded values are a Timeline concern and their persistence stays out of scope.
- **Cross-project rollups** beyond the parent chain and **non-Jira surfaces** (Brief §10).

---

## 8. Open questions

Genuine ambiguities between the brief and the mocks that a human should resolve before or during implementation:

- **Q1 — "Measurement" vs. "KPI" terminology. → RESOLVED: use "KPI".** The mocks ([issue.html](../00-mocks/issue.html), [kpi-timeline-v2.html](../00-mocks/kpi-timeline-v2.html)) use **"Measurement"**, but the shipped UI standardizes on **"KPI"** (matches the brief, data model, and internal `kpi*` identifiers; avoids collision with the recorded *values*/measurements users take; and reinforces our market positioning away from the saturated "OKR" category — see [positioning.md](./positioning.md) §4). Internal identifiers stay `kpi*`; only the display string is "KPI". **Done:** the mocks' user-facing "Measurement" wording has been updated to "KPI" (the `measurement-detail.html` file path/links are unchanged). *(Fallback if jargon is a concern: "Metric" — never "Measurement".)*




- **Q2 — Issue-panel field richness. → RESOLVED: targets only.** The brief (§4.2) modeled baseline, `current`, and target type; the shipped panel captures **target value, target type (absolute/delta), and the target date (absolute or relative)** — **no baseline, no current/recorded value** (the brief was wrong to include them). Recorded values over time are a **Timeline** concern. The domain model, resolver, fixtures, and panel have been updated to match. Absolute-vs-relative target date (IP-7) is retained.
- **Q3 — Grouping vs. source-labelling. → RESOLVED: grouping.** [issue.html](../00-mocks/issue.html) uses relationship **groups** ("Shared with parent" / "Only on this issue" / "On parent, not tracked here" + "+ Track this") and **no** per-field "Inherited from `<KEY>`" labels. The panel uses relationship grouping, not per-field source tags. (Whether any *inherited value* is shown at all depends on Q11.)
- **Q4 — Timeline filtering. → RESOLVED: collapse/expand only.** No explicit filters (by KPI / ancestor / status) in v1; expand/collapse of the tree is sufficient.
- **Q5 — Timeline date domain. → RESOLVED: 3-quarter window + scroll.** Default view = **previous + current + next quarter**, centered on today; the axis **horizontally scrolls** to pan backward/forward in time. Not a fixed year, not auto-fit. *(New interaction vs. the v2 mock, which has no pan — update the timeline mock when built.)* "Today" = the real current date.
- **Q6 — Recorded-value storage. → RESOLVED: Jira issue entity properties.** Recorded values are stored per **(issue, KPI)** as a Jira **issue entity property**, key `kpi-readings-{kpiId}` = `{ readings: [{ date, value, recordedBy, recordedAt }] }`. **Rationale:** they must be readable/writable over **standard Jira REST** so external tools — **CascadeMCP** (Bitovi-owned; we can extend it) and any API client — let people set values themselves; Forge KVS / Custom Entity Store are app-private and unreachable by them. Free (unmetered), travels with the issue, **per-KPI key** avoids concurrent-write clobbering. **Jira is the source of record**; the Forge app *reads* these for the timeline. KPI-centric querying ("all readings for KPI X") via a `jira:entityProperty` JQL index or a small app-side index. This **supersedes** the earlier "time-series history out of scope" for **storage** (§7 updated); the *depth* of timeline history UI may still stage.
- **Q7 — Rollup option set/order. → RESOLVED: port the Bitovi Timeline Report.** The rollup engine and its five methods are **ported verbatim** from [`jira-timeline-report`](https://github.com/bitovi/jira-timeline-report) (`src/jira/rollup/dates/dates.ts`; `CalculationType` in `src/jira/shared/types.ts`) — its behavior is authoritative (Constitution §1a). The method identifiers already match our `config.ts` enum. **Default = `widestRange`** (matching the report's form default in `useTimingCalculations.ts`), leaf = `parentOnly`. The Increment dropdown ordering in [settings.html](../00-mocks/settings.html) is a mock typo. Labels follow the mock wording (the report also ships arrow-prefixed variants in `src/utils/timing/helpers.ts`).
- **Q8 — Settings surface placement. → RESOLVED: global admin page.** Config is a single **app-level** document (`kpi:config:rollup`), so Settings is a global/admin page, not a per-project page.
- **Q9 — Which date field rolls up. → RESOLVED: `{ start, due }` range (v1).** The ported engine rolls up **both** `start` and `due` as a range (§5.2, §5.7). The Settings preview and panel display the `due` endpoint where a single date is needed, but the domain resolves the full range. *(Sprint-derived date sources remain deferred — see Q12 and §5.7.)*
- **Q10 — Editing in the panel. → RESOLVED: Jira inline-edit (Atlaskit `InlineEdit`).** Fields render as **readable** values and become editable **in place** on click/focus, per Jira's design system — there is no separate row-level "Edit" mode. The always-present "Associate a measurement" form remains for adding a new assignment; editing an existing one happens inline in its row (see IP-8). Target-date fields expose the absolute/relative control (IP-7) when in edit mode.
- **Q11 — Value inheritance vs. independent targets. → RESOLVED: independent targets (option a).** Each issue authors its **own** KPI targets; the panel groups them by relationship to the parent ("Shared with parent" / "Only on this issue" / "On parent, not tracked here") but does **not** copy a parent's value down. Value **inheritance** (brief §2.1) is **dropped** — inheriting the same number onto every descendant overstates the child. **Aggregation / contribution / coverage** (summing children toward a parent) is **not adopted either**, not even as a roadmap commitment: children are frequently *distinct metrics* (e.g. revenue for a particular department), and summing across issues breaks on **unit / measurement mismatches**. The additive model was design-explored ([coverage.html](../00-mocks/coverage.html), [kpi-timeline-v3.html](../00-mocks/kpi-timeline-v3.html)) and **parked**. Consequence: IP-2, IP-3, §5.1 and the INH-* test matrix describe an inheritance mechanism **not built in v1**; the domain `resolveInheritance` is parked (kept, unused). `effectiveDueDate` (timing rollup) is unaffected and stays.
- **Q12 — Per-project date config + sister-project interop (ROADMAP, not v1).** (1) [`jira-timeline-report`](https://github.com/bitovi/jira-timeline-report) configures **date fields per project/space**; matching that (choose date sources — own due / sprint / start / custom field — per project) is desired but **deferred** (v1 keeps the single app-level rollup config). (2) All three projects are **Bitovi-owned** (this app, `jira-timeline-report`, `cascademcp`), so they can interoperate: extract the **timing schema + `effectiveDueDate`/date-source resolution into a shared package**, and treat the **`kpi-*` Jira entity-property schema as the shared contract** (CascadeMCP get/set, this app reads/writes, Timeline Report can read). A shared Jira property key could eventually let one config serve both apps.

---

*End of requirements — first build slice.*
