# KPI nesting doesn't persist — design decision

Status: **OPEN (design decision for the user)** — hardening shipped, nesting mechanism not chosen.

## Symptom

The timeline has a "create child KPI" flow (the `+` row action opens **New KPI**
pre-filled with a parent), but nested KPIs don't actually nest: on the deployed
site every KPI (KPI-1 / KPI-2 / KPI-3) has `parent = None`. All KPIs end up as
roots regardless of whether they were created as a child.

## Root cause

Live inspection of `/rest/api/3/issue/createmeta/KPI/issuetypes` on the deployed
`KPI` project:

- The `KPI` issue type sits at **hierarchyLevel 0** — the same level as `Task`.
- The only issue types in the KPI project are `Task` (level 0), `KPI` (level 0),
  and `Sub-task` (level −1). There is **no higher-level type** (e.g. an
  Epic/level-1 equivalent) available in this project.
- Jira's **native `parent` field requires the parent to be at a *higher*
  hierarchy level** than the child. A level-0 `KPI` therefore cannot take another
  level-0 `KPI` as its `parent`. Native same-level nesting is simply not
  supported by Jira.

So `createKpiIssue` faithfully sets `fields.parent = { key: parentKpiId }` when a
child is created, but Jira rejects that parent (a level-0 → level-0 link). Before
the hardening below, that rejection was **silently swallowed** — the POST failed,
`created.key` was `undefined`, and `writeKpiMeta(undefined, …)` ran — so the UI
looked like it created a root KPI with no error.

Relevant code:

- `app/src/backend/jira.ts` — `createKpiIssue(projectId, input)` sets
  `fields.parent` from `input.parentKpiId`.
- `app/src/backend/resolver.ts` — `buildTimelineData()` builds the tree adjacency
  from `issue.parentId` (`childrenOf.set(issue.parentId, …)`), which is populated
  from the native `fields.parent.id`. So even if a parent *could* be set, the tree
  currently reads exclusively from the native parent field.

## Interim behavior (after the hardening shipped in this change)

`createKpiIssue` now checks `res.ok` on the create POST and throws
`jiraError(res, 'create KPI issue "…"')` (reads Jira's `errorMessages`/body) when
the create fails, instead of returning `{ key: undefined }` and half-creating.

Consequence for the user, **until a nesting mechanism is chosen**:

- Creating a **root** KPI is unaffected — still works.
- Creating a **child** KPI will now **surface an error banner** (the Timeline
  mutation-error alert) if Jira rejects the level-0 → level-0 parent, instead of
  silently creating a detached root. This makes the missing capability *visible*
  rather than *misleading*. It does not add nesting.

## Options to actually support KPI nesting

All three keep domain data reachable over standard Jira REST, which is the hard
requirement in `specs/01-initial-build/storage-model.md` ("CascadeMCP must read
*and* write everything via standard Jira REST … issues, their fields, entity
properties, and changelog").

### Option A — Give KPIs a higher-level parent type (native hierarchy)

Configure a custom issue-type hierarchy so a KPI's parent is a *different*,
higher-level issue type (or introduce a level-1 "KPI Group"/Epic-like type and
put child KPIs under it).

- **Pros:** Uses Jira's native `parent` field and the existing
  `buildTimelineData` adjacency unchanged; first-class hierarchy, JQL-friendly,
  fully REST-visible.
- **Cons:** Requires **site administration** and typically **Advanced Roadmaps**
  to edit the issue-type hierarchy; one issue type can't be both the parent level
  and the child level, so "a KPI nested under a KPI" is impossible — you'd nest
  KPIs under a *distinct* parent type, changing the data model. Highest ceremony;
  depends on the customer's Jira config, which the app can't guarantee.

### Option B — Represent nesting with issue links

Add a KPI parent/child **issue link type** and, on child creation, create a link
instead of setting `fields.parent`. Change `buildTimelineData` to build the tree
from links rather than `issue.parentId`.

- **Pros:** Works entirely within the level-0 `KPI` type (KPI-under-KPI is
  fine); issue links are **standard-REST readable/writable** and CascadeMCP-
  reachable; no admin/hierarchy config required beyond a link type (createable
  via REST).
- **Cons:** Links are directional-but-not-hierarchical — need to pick/enforce a
  convention and guard against cycles; adjacency logic in `buildTimelineData`
  must be rewritten to walk links; a KPI could have multiple parent links (must
  constrain to one).

### Option C — Store a parent pointer as an issue entity property

Persist the parent on the child KPI as an entity property (e.g. `kpi-parent`,
alongside the existing `kpi-meta` property) and build adjacency from it.

- **Pros:** Simplest and **fully app-owned**; entity properties **are**
  REST-readable/writable (`/rest/api/3/issue/{key}/properties/{key}`) and
  CascadeMCP-reachable per the storage model; no admin config, no link-type
  setup; single-parent by construction; mirrors the pattern already used for
  `kpi-meta`.
- **Cons:** Not a "first-class" Jira relationship — invisible to Jira's native
  parent/child UI, JQL, and Advanced Roadmaps; the app is the only thing that
  understands the hierarchy; requires an extra property read when enumerating
  KPIs to reconstruct the tree.

## Recommendation

For v1, prefer **Option C (entity property)**, falling back to **Option B (issue
links)** if a first-class, Jira-visible relationship becomes important.

- Option C is the least-friction path that satisfies the storage-model REST
  requirement, needs **no site configuration**, allows genuine KPI-under-KPI
  nesting, and reuses the entity-property pattern already in place for
  `kpi-meta`. The tree is app-owned, which is acceptable because the timeline is
  the app's own surface.
- Option B is the better long-term choice if the nesting should be visible to
  Jira/CascadeMCP as a native relationship, at the cost of a link-type + cycle/
  single-parent handling and rewriting `buildTimelineData` adjacency.
- Option A is **not recommended for v1**: it depends on customer Jira admin +
  Advanced Roadmaps and can't express KPI-under-KPI (only KPI-under-a-different-
  type), so it changes the model and isn't guaranteed to be available.

Whichever is chosen, `buildTimelineData` in `app/src/backend/resolver.ts` must be
updated to derive adjacency from the chosen source (entity property or links)
instead of, or in addition to, `issue.parentId`.
