# 09 — Release and cleanup

Part of [11 — Scalable KPI data](../plan.md). Status: **Steps 1–2 done; stopped at G5** · Depends on: every earlier stage.

## Goal

Prove the whole branch works on real data, **including for old readers**, then release it and walk
existing installs through upgrading. Then, later and separately, a **cleanup release** removes the
compatibility code once nothing reads the old formats.

## Design

### Legacy reader check

A small script (`app/scripts/legacy-report.ts`, run with an API token) that reads the site **the way
the customer's app does** (overview, *Compatibility*):

- KPIs via `project = <central space key>`, with their `kpi-meta` unit and direction;
- work items via `issue.property[kpi-assignments].kpiIds IS NOT EMPTY`, with each target's `kpiId` key
  and expected change.

It prints a stable, sorted report. Run it **before** anything on the branch touches the dev site's
data, save the output, and run it again after every migration and at the end. The only differences
allowed are changes someone made on purpose during testing.

### Release order

1. Merge `feat/11-scalable-data` into `main`.
2. Deploy **staging**, then run the upgrade on staging's Settings (dev already ran it, so this should be
   all "already done").
3. **Before upgrading the customer site**, check it the way 01 B1 checked bitovi-training: is the KPI
   project's work type scheme shared with other projects, and does `issuetype = KPI AND project != KPI`
   return anything? If so, fix the scheme (or move or retype those issues) first, or they become KPIs
   (06).
4. Deploy **production**. No scope change is expected (overview Q11), so this is a minor version that
   installs without the customer's admin approving it. Check `forge deploy`'s output: if it asks for a
   major version, stop and tell the customer's admin first.
5. The customer site's admin follows the **upgrade runbook** below.

### Upgrade runbook (README "Upgrading to scalable KPI data")

For a Jira admin on an existing install:

1. Open **KPI Settings**. The work type and central space are already filled in from the old setup.
2. Choose or create the **KPI fields** (and any optional building blocks, per 04's final design).
3. Under **Upgrade data**, run the pending migrations. They can be paused and resumed, and are safe to
   run again. Run them **when nobody is editing targets** (e.g. outside working hours): a target saved
   at the exact moment the migration rewrites that work item can be lost (03, *Known race*). If a run
   ends **failed**, use **Retry failed** until it's done.
4. Optional: follow **Using KPIs in other spaces** to let teams hold their own KPIs.

Do steps 1–3 **right after the upgrade is deployed**. The app reads only the new formats, so until
step 3 finishes it shows incomplete data: targets are missing from the Timeline, panels show targets
as pointing at deleted KPIs, and once the fields are chosen (step 2), units and directions are empty
until their migration runs. The customer's reporting app keeps working throughout: every write still
produces the old formats.

### Cleanup release (later, separate branch)

**When** (overview Q2): the customer confirms their app reads the new formats, and every install on
our own sites runs this release.

**What it removes:**

| Area | Change |
|---|---|
| Unit & direction | Stop writing `kpi-meta`; remove the sync trigger (05); `resolveKpiMeta` reads fields only |
| Target references | Stop writing `kpiId` (key) and `kpiIds`; drop the `kpiIds` `text` index path. Reads and Timeline discovery already use `kpiIssueId` / `kpiIssueIds` (03), so nothing else changes |
| Config | Remove the derivation from `kpi:space` / `kpi:hierarchy` (04) once every install has saved a `kpi:config:site` |
| Data | `kpi-meta-cleanup`: delete the `kpi-meta` property from every KPI. `kpi-target-refs-cleanup`: strip `kpiId` / `kpiIds` from every `kpi-assignments`. Both on 02's framework, and only runnable when their copy migrations are done with nothing pending |
| Docs | [storage-model.md](../../01-initial-build/storage-model.md) and README: remove the compatibility notes |

## Implementation steps

### Step 1 — Legacy reader check

- Write the script; run it against the dev site **before** the first migration on the branch (ideally
  at the start of 03) and save the output in this folder (`legacy-report.before.txt`).
- **Verify:** running it twice in a row gives identical output.

### Step 2 — Whole-branch live run (dev)

- Fresh deploy of the branch to dev. Run every migration from Settings.
- **Verify** on `bitovi-training`:
  - the legacy report matches `before` (apart from deliberate test edits), and edits made in dev show
    in it (what the customer's app would see);
  - after every migration is `done`, dev shows the same KPIs, units, directions and targets as
    screenshots of `main` taken before the first migration;
  - a KPI moved to another space keeps all its targets in dev;
  - every stage's own live check still passes.

### Step 3 — 🔍 Gate G5: release review

- **Stop. Ask Justin to review** the release checklist (this stage's *Release order* and runbook) and
  a draft message to the customer describing the new formats and the cleanup timing.
- **Verify:** both approved; decisions recorded here.

### Step 4 — Release

- Steps 1–5 of *Release order*.
- **Verify:** staging's and production's upgrades on our own sites complete; the legacy report on those
  sites is unchanged.

### Step 5 — Cleanup release (separate branch, when the trigger is met)

- Its own short spec, written from *Cleanup release* above when the time comes.

## Progress (2026-11-24/25, implementer, autopilot)

### Step 1 — done

`app/scripts/legacy-report.ts`; baseline [legacy-report.before.txt](./legacy-report.before.txt).

### Step 2 — whole-branch live run on dev: done (as Justin, a Jira admin)

Each stage's live check is in its own plan (03–08). Across the branch, on `bitovi-training`:

- Both migrations ran from Settings to `done`: *Point targets at KPI ids* (14 work items) and *Move unit
  and direction into fields* (13 upgraded, 1 already up to date).
- **Legacy reader report:** identical to the baseline after every migration, apart from one deliberate
  test edit (a target on the throwaway `KPI2-3`). Two bugs were found this way and fixed before
  continuing: 03's migration normalized a legacy `targetType` (`delta` → `percent`), and 04's screens step
  widened the KPI fields to every work type (01 B9).
- dev shows the same KPIs, units, directions and targets as before the first migration (14 KPIs, 17
  targets with values), plus the test KPIs below.
- **A KPI moved to another space keeps its targets:** KPI2-2 (with a target on KPI2-3) moved to `KPI3`
  became `KPI3-1`; the Timeline shows the target under it, with the new key in its link. The stored
  `kpiId` keeps the old key until the target is saved again (03 Q3, accepted).
- **Left on dev for Justin's review** (delete when done): projects `KPI2` ("Team KPIs (spec 11
  check)": KPI2-1, task KPI2-3) and `KPI3` ("Moved KPIs (spec 11 check)": KPI3-1). The `KPI Unit` /
  `KPI Direction` fields (`customfield_10910` / `10911`) are the real configured fields, not test data.
- **Not done yet (deferred by Justin, 2026-11-24): every check that needs a non-admin user** — 01 B4,
  C2 (hidden parent), E3 (count of issues the admin can't browse); 06's "no Browse" and "Edit in one
  space only"; 07's hidden KPI; 08's single-space creator.
- **Found, not fixed (outside this spec):** the Timeline's *Add a target* issue search uses Jira's issue
  picker, which on this site only returns issues in the user's history, so a work item they've never
  opened can't be found, even by its key. A direct key lookup (as 07's `lookupKpiRef`) would fix it.

### Step 3 — 🔍 Gate G5: **stopped here.** Waiting for Justin

Nothing has been merged, pushed, or deployed to staging or production. For the review:

**Release checklist** (from *Release order*):

1. Merge `feat/11-scalable-data` into `main` (the branch is local; one PR per stage was planned, but the
   stages were implemented as commits on the branch).
2. Deploy staging, then **Upgrade** on staging's Settings (dev already migrated the shared data, so it
   should be all "already done"; staging also needs **Use existing…** for the KPI fields, picking
   `KPI Unit` / `KPI Direction`).
3. On the customer site, before upgrading: `issuetype = KPI AND project != KPI` must be empty, and the
   KPI project's work type scheme unshared (01 B1 found both true on bitovi-training).
4. Deploy production. This branch adds **no scopes** (a new `trigger` module only), so it should be a
   minor version; stop if `forge deploy` asks for a major one.
5. The customer's admin follows the runbook (README, *Upgrading to scalable KPI data*).

**Draft message to the customer** (overview Q1 and R10 are still open: how and when to tell them):

> We're releasing an update to Measure of Success that lets KPIs live in any space and stores their
> unit and direction in Jira fields (KPI Unit, KPI Direction). Your reporting app keeps working
> unchanged: until you tell us you've switched, the app still writes everything your report reads today
> (`kpi-meta` on each KPI; `kpiId` keys and the `kpiIds` index on each work item; KPIs in the KPI
> project). New, for when you're ready: each target also stores the KPI's issue id (`kpiIssueId`, and a
> `kpiIssueIds` index), which doesn't change when a KPI moves to another project, and unit and direction
> are searchable fields. After the upgrade, a Jira admin runs **Upgrade data** in KPI Settings (a few
> minutes, best outside working hours). Once your report reads the new fields, let us know and we'll
> schedule a cleanup release that stops writing the old formats.

## Questions

1. **Where the legacy script lives.** `app/scripts/` (kept until cleanup), or this spec folder (not
   shipped)? It needs an API token, so it never runs in CI.
   - **Decided (2026-11-24, implementer, autopilot): `app/scripts/legacy-report.ts`**, run with
     `node --experimental-strip-types scripts/legacy-report.ts [KEY]` from `app/` (Node 22). It reads
     `JIRA_EMAIL` / `JIRA_API_TOKEN`, falling back to `.env`'s `FORGE_*`. Baseline saved as
     [legacy-report.before.txt](./legacy-report.before.txt) before any stage changed dev data; two
     runs in a row were identical.
2. **Customer site upgrade.** Do we run the upgrade runbook with the customer's admin (screen share), or
   send them the runbook?
3. ~~**Production on our sites.**~~ **Answered (2026-11-20):** the only production site with KPI data is
   the one customer site we manage; bitovi-training is our test site (overview, *Sites this affects*).
