# Spec 11 — status and handoff (2026-11-25)

Where the work stands, and what you need to know to pick it up. The design lives in
[plan.md](./plan.md) and the stage folders; this page is the map.

## In one paragraph

Stages **01–08 are implemented and checked live on the dev install** (bitovi-training). Stage **09
stopped at gate G5** (release review): nothing has been merged, released to staging or production, or
shown to the customer. Everything is on branch **`feat/11-scalable-data`** (based on current `main`).
Justin asked the implementer to keep going without stopping at the review gates, so several design
decisions were **made by the implementer and still need Justin's review** (below). All checks so far
were done as a **Jira admin**; checks that need a non-admin user were deferred.

## Branch and build

- Branch: `feat/11-scalable-data`, ~27 commits on top of `main` (`main` is fully contained; no rebase
  needed). Commits are titled `Spec 11 · NN: …`; use a conventional title (`feat(kpi): …`) when merging.
- Last full run (Node 22, from `app/`): `npm run test:all` → **933 unit + 325 story tests pass**;
  `npm run typecheck`, `npm run lint`, `npm run build:forge` clean.
- The plan was "one PR per stage into the branch"; in practice each stage is one or more commits on
  the branch. Review it as one PR, stage by stage via the commits.

## Stage status

Each stage's `plan.md` ends with **Live check** and **Implementation notes** sections (files, APIs,
deviations). Read those before touching a stage.

| Stage | Status | Main commits |
|---|---|---|
| [01 Jira spikes](./01-jira-spikes/plan.md) | Done; findings A–E + C5. G1 review pending | `17ebea5`, `df19e4a` |
| [02 Migration framework](./02-migration-framework/plan.md) | Done | `77343ab` |
| [03 KPI ids, not keys](./03-kpi-ids/plan.md) | Done, live-checked (migration run on dev) | `1ddeecd`, `c9d8519` |
| [04 KPI configuration (Settings)](./04-kpi-configuration/plan.md) | Done, live-checked. **G2 decided by implementer** | `5b6cdef`, `c9d8519` |
| [05 Unit & direction in fields](./05-kpi-fields/plan.md) | Done, live-checked (migration + sync trigger on dev) | `ab05d62`, `057d8ae` |
| [06 KPIs by work type](./06-kpis-by-work-type/plan.md) | Done, live-checked (admin only) | `c02e66b`, `06f671e` |
| [07 KPI picker](./07-kpi-picker/plan.md) | Done, live-checked (admin only) | `6655b89`, `2eb78bf` |
| [08 Timeline across spaces](./08-timeline-across-spaces/plan.md) | Done, live-checked (admin only). **G4 decided by implementer** | `03769bc`, `2eb78bf` |
| [09 Release & cleanup](./09-release-and-cleanup/plan.md) | Steps 1–2 done; **stopped at G5** | `b8b1b55`, `1d7e25b` |
| Code review fixes | Done | `bbbccf8` |

## Decisions that need Justin's review

Search the specs for **"implementer, autopilot"**; every such decision is marked "revisit at review".
The ones that matter most:

- **G1** (01): the spike findings themselves.
- **G2** (04, *Decided design*):
  - Settings **creates** ordinary Jira fields *KPI Unit* (text) and *KPI Direction* (single select), or
    uses existing ones.
  - They're made usable by adding them to each KPI space's **current field scheme, restricted to the KPI
    work type**. Field contexts can't restrict fields any more (01 A3).
  - No work type scheme block; the central space is optional; *Set up everything* kept.
  - Upgrade data card at the top with one **Upgrade** button.
  - Changing a block later is allowed with a warning.
  - The KPI icon is set only on types the app creates.
- **G4** (08): the `timeline-scope.html` prototype as the design. The refused row-action state was
  built straight from 06's *Permissions* section. One deviation from the prototype: the **…** menu also
  has *Record a value…* and *Add a target…*, for keyboard access.
- **05 Q2:** when a unit or direction field already differs from `kpi-meta`, the migration keeps the
  field and **rewrites `kpi-meta` to match**. This changes what the customer's report reads, so it's
  arguably beyond "migrations only copy".
- The remaining Q&A decisions in 02, 03, 06, 07 and 09 mostly took the drafts' defaults.

## The dev site (bitovi-training) right now

Dev runs the branch head. **Dev's data is migrated**:

- `kpi-assignments` carry ids;
- KPIs have field values and a marked `kpi-meta`;
- dev's Settings has the work type `KPI` (`10436`), the central space `KPI`, and the fields
  `customfield_10910` *KPI Unit* and `customfield_10911` *KPI Direction* (options `10652` Increase /
  `10653` Decrease).

Those two fields are **real configuration, not test data**. They're in the shared *Default Field Scheme*
(id 5), restricted to the KPI type.

Things to know:

- **Staging still runs an older `main` build** and reads the shared data in the old format. Expect it to
  drift from dev; that's accepted (overview *Compatibility*).
- **Test data left for review; delete when done:**
  - project `KPI2` *Team KPIs (spec 11 check)*: `KPI2-1` (KPI under KPI-1) and `KPI2-3` (a task
    carrying a target);
  - project `KPI3` *Moved KPIs (spec 11 check)*: `KPI3-1`, which was moved from KPI2-2 to test moves.
- **Legacy reader report:** baseline
  [legacy-report.before.txt](./09-release-and-cleanup/legacy-report.before.txt). Today it differs only
  by the deliberate `KPI2-3` target.
- **Dev's hierarchy setting reads the *Parent* link type the opposite way to staging's old build.**
  So the two nest KPI-1 / KPI-6 differently. That isn't a bug in this branch.

## What's left

1. **Gate G5** ([09](./09-release-and-cleanup/plan.md), *Progress → Step 3*): Justin reviews the
   release checklist and the draft customer message, plus the decisions above. Then 09 Step 4, in the
   checklist's order:
   - merge;
   - staging (use **Use existing…** for the KPI fields there, then **Upgrade**);
   - the customer-site check (`issuetype = KPI AND project != KPI` is empty);
   - production: expect a minor version (no new scopes, only a new trigger module); stop if Forge asks
     for a major one;
   - the customer's admin follows the README runbook.
2. **Non-admin checks** (deferred by Justin): 01 B4, C2 (hidden parent), E3; 06 "no Browse on a space"
   and "Edit in one space only"; 07 a hidden KPI; 08 a user who can create in only one space. Use the
   `playwright-user` MCP browser logged in as a non-admin (below).
3. **Open overview questions:** Q1 (coordinating with the customer) and Q2 (when to ship the cleanup
   release); review note R10 (the customer message).
4. **Known issue, not from this branch:** the Timeline's *Add a target* issue search uses Jira's issue
   picker. On this site it only returns issues in the user's history, so a work item they've never
   opened can't be found, even by its exact key. A direct key lookup (as 07's `lookupKpiRef`) would fix
   it.
5. **Later:** the cleanup release (09 Step 5, its own spec). Space pages and paging the all-KPIs page
   (overview Q5/Q6).

## How to work on it

- **Node 22** (`source ~/.nvm/nvm.sh && nvm use 22`), commands from `app/`. Tests: `npm run test:all`,
  `npm run typecheck`, `npm run lint`.
- **Deploy to dev:** `npm run deploy:dev`. See `.claude/skills/redeploy-forge/SKILL.md`. Forge's CDN can
  serve the old UI for up to a minute after a deploy; reload.
- **Harness** (`npm run dev`) URL switches:
  - `?surface=issue|timeline|settings`
  - `?migrations=pending|running|done|failed`, `?migrationDelayMs=`
  - `?access=split|lookupFails` (plus the older modes)
  - `?pickerDelayMs=`
- **Legacy reader report:** `node --experimental-strip-types scripts/legacy-report.ts [KEY]` from
  `app/`. It needs `JIRA_EMAIL` / `JIRA_API_TOKEN`, or uses `.env`'s `FORGE_*`. Diff the output against
  the baseline after anything that touches data.
- **Live checks through a browser:** `.vscode/mcp.json` defines two Playwright MCP servers,
  `playwright-admin` and `playwright-user`. Each has its own profile under `~/.cache/jira-mos-spikes/`,
  so you log in once by hand and the agent never sees credentials. The agent calls Jira's REST API with
  `fetch` from the logged-in page. It calls the app's resolvers from the Settings page's iframe via
  `window.__bridge.callBridge('invoke', { functionKey, payload })`. Note: on 2026-11-24 the
  `playwright-user` profile was logged in as Justin (an admin), and `playwright-admin` wasn't logged in
  at all. Log the non-admin into `playwright-user` before the deferred checks.

## Gotchas found the hard way

- **Forge bundler:** everything under `src/backend` and `src/domain` must use extensionless relative
  imports (no `@domain`, no `.js`). A `trigger` module's key must differ from its function's key.
- **Migrations must write back the stored JSON with only their new fields merged in**, never a
  Zod-parsed copy. Parsing normalizes legacy values (`targetType: 'delta'` → `'percent'`) and drops
  unknown keys. It happened once on dev and was fixed.
- **Adding a field to a screen resets its field-scheme entry to every work type** (01 B9). The screens
  step now restores the restriction.
- **`id > n` in JQL compares keys within n's project.** Page migrations with `nextPageToken` over a
  stable query (01 E2).
- **`id in (…)` with a missing or deleted id returns 200**, not 400 (01 C5).
- Forge-owned fields (KPI Reading) are in every field scheme and can't be removed (01 B8).
- Work type avatars must be PNG, GIF or JPEG; Jira rejects SVG (01 B7).
- **Story tests:** a flaky `useTimelineData` helper was fixed; run the story suite twice after UI
  changes anyway.
