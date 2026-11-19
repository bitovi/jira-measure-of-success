# 12 — KPI details in the issue sidebar (`jira:issueContext`)

Status: **Draft** · Scope: adds a collapsible **KPI** section to the right-hand sidebar of every KPI
work item. It shows the KPI's unit, direction and current value **without anyone having to open the
app's issue panel**. It's independent of [spec 11](../11-kpi-native-fields/plan.md): it reads unit and
direction through the backend, so it works whether they live in `kpi-meta` or in fields.

## Problem

On a KPI work item, the only place the app shows the KPI's definition is the **KPIs issue panel**,
in its KPI View mode (`isKpiIssue` in [resolver.ts](../../app/src/backend/resolver.ts),
[spec 04](../04-kpi-view/plan.md)). A Forge issue panel only appears after someone adds it to that
issue from the **Apps** button. So most people opening `KPI-11` see a bare work item, with no unit, no
direction and no current value.

Spec 11 puts unit and direction in Jira's **Details** section. That still leaves "what is this KPI at
right now?" unanswered, and spec 11 needs a migration before it shows anything.

## Decision

Add a **`jira:issueContext`** module. Jira renders it automatically as a collapsible section under
the issue's fields on the right, with no **Apps** click. It's shown only on issues of type `KPI`:

```yaml
jira:issueContext:
  - key: kpi-details
    resource: kpi-details
    resolver:
      function: resolver
    title: KPI${TITLE_SUFFIX}
    label: KPI${TITLE_SUFFIX}
    displayConditions:
      issueType: KPI
```

- `issueType: KPI` matches the issue type the app provisions (`KPI_ISSUE_TYPE` in
  [jira.ts](../../app/src/backend/jira.ts)). The resolver still checks that the issue is **in the KPI
  space**: a `KPI`-typed issue in another project renders a quiet "This work item isn't in the KPI
  space" note.
- It's a **new Custom UI resource** (`kpi-details`), built like the existing three surfaces, so it
  stays small and loads fast. It doesn't reuse the issue panel bundle.
- It adds **no scopes**: it uses the same resolver and the same `asUser` reads as the panel.

## Design

### What the section shows

```
▾ KPI
  Unit        %                          ✎
  Direction   ↑ Higher is better         ✎
  Current     42.5 %   as of 3 Nov 2026
  Readings    12  ·  Open in KPI Timeline ↗
```

| Row | Source | Notes |
|---|---|---|
| Unit | KPI meta (property or field) | Inline-editable when the user can edit the KPI (Q2) |
| Direction | KPI meta | Inline select: Higher is better, Lower is better, Not set |
| Current | Latest non-tombstoned reading | `fmtVal` with the unit, as the Timeline formats it. "No readings yet" when empty |
| Readings | Reading count + link | The link opens the KPI Timeline global page, focused on this KPI if Q4 says so |

The empty, read-only and error states use the existing patterns: the `text-text-subtle` loading line
from the issue-panel entry, and `DisabledReason` tooltips on the edit pencils when the user lacks Edit
Issues (spec 10 `KpiSpaceAccess.edit`).

### Contract (`@domain/contracts.ts`)

```ts
type KpiDetailsDto =
  | { kind: 'kpi';
      issueKey: string; name: string;
      unit: string; direction: KpiDirection | null;
      current: { value: number; date: string } | null;
      readingCount: number;
      access: Pick<KpiSpaceAccess, 'edit'>; }   // edit covers unit/direction and recording values
  | { kind: 'notInSpace' }      // a KPI-typed issue outside the KPI space
  | { kind: 'noSpace' }         // the app's KPI space isn't set up
  | { kind: 'notVisible' };     // Jira hid it from this user
```

The `current` value comes from a **pure** `@domain` helper (`latestReading(readings)`) over the series
`readingsFromChangelog` already builds, so it's tested without Jira.

### Resolver: `getKpiDetails`

- The issue comes from `context.extension.issue.id`, the same way `panelIssueId` does it.
- **Requests** (all as the user, in parallel where possible):
  - `readResolvedKpiSpaceConfig()`
  - `fetchKpiIssueForEdit(id)`: name, meta, project
  - `fetchReadingChangelog([id])`
  - `fetchKpiSpaceAccess(spaceKey)`
- That's **one KPI's** worth of requests. It must not call `fetchKpiSpaceIssues` or the full timeline
  build. [requestLog.ts](../../app/src/backend/requestLog.ts) gets a test that pins the request set.

### Editing: `updateKpiMeta`

Today's `updateKpi` treats a missing `parentKpiId` as "move to the root", so the sidebar can't call it
without knowing the parent. Add a narrow **`updateKpiMeta({ kpiId, unit, direction })`** resolver:

- The same KPI-space and `access.edit` checks as `updateKpi`.
- It calls `updateKpiDefinition(id, { meta })` only. That means it automatically writes fields instead
  of `kpi-meta` once spec 11 lands.
- It returns the saved `{ unit, direction }`. The client lays the result over its state, as the
  Timeline does.

### Keeping in sync with the rest of the issue view

- If someone edits the KPI elsewhere on the page (spec 11's Details fields, or the issue panel), the
  section should refresh. Subscribe to the bridge's issue-changed event, if Step 0 confirms it fires
  for `jira:issueContext`, and refetch. If it doesn't, refetch on window focus.
- After an edit in this section, call the bridge's issue-view refresh, if available, so spec 11's
  Details fields show the new value.

### New surface wiring

| File | Change |
|---|---|
| [manifest.yml](../../app/manifest.yml) | `jira:issueContext` module + `kpi-details` resource (`static/kpi-details/build`) |
| `forge-ui/kpi-details/index.html` | New, a copy of the issue-panel HTML pointing at the new entry |
| `src/ui/entries/kpi-details.tsx` | New: `view.theme.enable()`, `getContext()`, render `<KpiDetails issueId />`, and prefetch `getKpiDetails` before mount (spec 07 pattern) |
| `src/ui/surfaces/KpiDetails/` | New surface modlet: `KpiDetails.tsx`, stories, tests, `index.ts` |
| `src/ui/data/useKpiDetailsData/` | New loader hook (injectable, like `usePanelData`) |
| [vite.forge.config.ts](../../app/vite.forge.config.ts) | `'kpi-details': 'static/kpi-details/build'` in `SURFACES` |
| [package.json](../../app/package.json) | `build:forge` builds `SURFACE=kpi-details` too |
| [test-harness/main.tsx](../../app/test-harness/main.tsx) | `?surface=kpi-details&issueId=…` |
| [mock-resolvers.ts](../../app/test-harness/fixtures/mock-resolvers.ts) | `getKpiDetails`, `updateKpiMeta` (honouring `accessMode()` / `hiddenKpiId()` like the panel mocks) |

## Implementation steps

Each step ends with `npm run test:all`, `npm run typecheck` and `npm run lint` passing.

### Step 0 — Check the module on the dev site

Deploy a stub `kpi-details` that renders the issue key, then check:

1. It appears on KPI work items and **not** on other issue types.
2. Is it **collapsed or expanded** by default? Does Jira remember each user's choice? (This decides
   Q1.)
3. Does `dynamicProperties` let the **collapsed** header show a status (e.g. a `42.5 %` lozenge), or is
   it only fetched on first expand, as the docs suggest?
4. Does the bridge's issue-changed event fire in this module when a field is edited? Does an
   issue-view refresh call exist here?
5. The iframe resizes to its content with no inner scrollbar.

Record the findings here under *Step 0 findings*.

### Step 1 — Domain + contract

- `KpiDetailsDto` in [contracts.ts](../../app/src/domain/contracts.ts). Pure `latestReading`.
- **Verify:** table tests for `latestReading`: none, one, several, a tombstone as the latest entry,
  and same-day edits.

### Step 2 — `getKpiDetails` + `updateKpiMeta` resolvers

- As designed above, in [resolver.ts](../../app/src/backend/resolver.ts).
- **Verify:** backend tests on the scale fixture: a KPI issue, a KPI-typed issue outside the space,
  no space, hidden from the user, no edit permission (save refused with spec 10's message), a save
  that writes only meta (no link changes), and a pinned request set (no KPI-space search).

### Step 3 — `KpiDetails` surface (harness + stories)

- Follow [create-react-modlet](../../.claude/skills/create-react-modlet/SKILL.md): surface + loader
  hook + stories for loading, increase, decrease, no unit, no readings, read-only, notInSpace, noSpace,
  notVisible, save error. Add portable-stories tests.
- Wire `?surface=kpi-details` into the harness and mocks.
- **Verify:** in the browser at `?surface=kpi-details&issueId=<KPI id>`, in light and dark themes with
  a clean console: edit unit and direction, see a save error with `mutationDelayMs`, and see the
  read-only state with the access-mode param. Story tests pass.

### Step 4 — Forge wiring + live check

- Manifest module and resource, entry, `vite.forge.config.ts`, `build:forge`.
- `npm run deploy:dev` (the new module needs **no** `install --upgrade`, since no scope changes).
- **Verify** on `bitovi-training`:
  - `KPI-11` shows the **KPI** section with the right unit, direction and current value.
  - Editing the direction there updates the Timeline after reload.
  - A Story or Epic shows no KPI section.
  - A user without Edit Issues on the KPI project sees no edit pencils (or disabled ones).

### Step 5 — Sync + docs

- Refetch on the issue-changed event (or on focus), per Step 0.
- README: list the new surface. [spec 04](../04-kpi-view/plan.md): note that the sidebar now carries
  the summary, and the panel's KPI View carries the chart.
- **Verify:** with spec 11 shipped, editing **KPI Unit** in Details updates this section without a
  reload (or on focus).

## Out of scope

- Charts in the sidebar (the issue panel's KPI View already has one).
- Showing KPI info on **non-KPI** work items (targets stay in the issue panel).
- Recording values from the sidebar (see Q3).

## Questions

1. **Collapsed by default is Jira's behaviour.** If Step 0 shows it can't be changed, is a collapsed
   "KPI" header acceptable? Or should this spec also make the issue panel easier to find (e.g. a
   "Show KPI chart" link from the sidebar that opens the panel)?
2. **Edit in the sidebar, or read-only?** The draft allows inline edits of unit and direction. Once
   spec 11 ships, those are also editable in Details, so the sidebar could become read-only to avoid
   two editors for the same value.
3. **Record a value from the sidebar?** A small "Record value" action would reuse the Timeline's record
   modal and the `recordValue` resolver. It's useful, but it grows the bundle and the surface. In or
   out for this spec?
4. **"Open in KPI Timeline":** plain navigation to the global page, or deep-link to this KPI
   (scrolled and highlighted)? Deep-linking needs a URL parameter the Timeline doesn't read today.
5. **More rows?** Parent KPI, number of work items targeting this KPI, or the next target's status.
   Each adds requests (targets need `fetchTargetContributions`). The draft keeps to one KPI's own
   data.
6. **Order with spec 11:** ship this first, since it needs no migration and shows unit and direction
   right away, then spec 11? Or spec 11 first, as requested? The two don't depend on each other.
