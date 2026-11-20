# 09 — Release and cleanup

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft** · Depends on: every earlier stage.

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
3. Deploy **production** (`forge install --upgrade` if 05's trigger or any scope was added).
4. Each customer site's admin follows the **upgrade runbook** below.

### Upgrade runbook (README "Upgrading to scalable KPI data")

For a Jira admin on an existing install:

1. Open **KPI Settings**. The work type and central space are already filled in from the old setup.
2. Choose or create the **KPI fields** (and any optional building blocks, per 04's final design).
3. Under **Upgrade data**, run the pending migrations. They can be paused and resumed, and are safe to
   run again.
4. Optional: follow **Using KPIs in other spaces** to let teams hold their own KPIs.

The app works throughout: before step 2 it behaves exactly as before, and during step 3 it reads both
the old and new formats.

### Cleanup release (later, separate branch)

**When** (overview Q2): the customer confirms their app reads the new formats, and every install on
our own sites runs this release.

**What it removes:**

| Area | Change |
|---|---|
| Unit & direction | Stop writing `kpi-meta`; remove the sync trigger (05); `resolveKpiMeta` reads fields only |
| Target references | Stop writing `kpiId` (key) and `kpiIds`; reads use `kpiIssueId` only; drop the `kpiIds` `text` index path |
| Config | Remove the derivation from `kpi:space` / `kpi:hierarchy` (04) once every install has saved a `kpi:config:site` |
| Data | `kpi-meta-cleanup`: delete the `kpi-meta` property from every KPI. `kpi-target-refs-cleanup`: strip `kpiId` / `kpiIds` from every `kpi-assignments`. Both on 02's framework, and only runnable when their copy migrations are done with nothing pending |
| Docs | [storage-model.md](../../01-initial-build/storage-model.md) and README: remove the compatibility notes |

## Implementation steps

### Step 1 — Legacy reader check

- Write the script; run it against the dev site **before** the first migration on the branch (ideally
  at the start of 03) and save the output in this folder (`legacy-report.before.txt`).
- **Verify:** running it twice in a row gives identical output.

### Step 2 — Whole-branch live run (dev, with staging as the older install)

- Fresh deploy of the branch to dev. Run every migration from Settings.
- **Verify** on `bitovi-training`:
  - the legacy report matches `before` (apart from deliberate test edits);
  - staging (`main`) shows the same KPIs, units, directions and targets as dev in the central space;
  - edits in staging show in dev, and edits in dev show in staging;
  - a KPI moved to another space keeps all its targets in dev;
  - every stage's own live check still passes.

### Step 3 — 🔍 Gate G5: release review

- **Stop. Ask Justin to review** the release checklist (this stage's *Release order* and runbook) and
  a draft message to the customer describing the new formats and the cleanup timing.
- **Verify:** both approved; decisions recorded here.

### Step 4 — Release

- Steps 1–3 of *Release order*.
- **Verify:** staging's and production's upgrades on our own sites complete; the legacy report on those
  sites is unchanged.

### Step 5 — Cleanup release (separate branch, when the trigger is met)

- Its own short spec, written from *Cleanup release* above when the time comes.

## Questions

1. **Where the legacy script lives.** `app/scripts/` (kept until cleanup), or this spec folder (not
   shipped)? It needs an API token, so it never runs in CI.
2. **Customer site upgrade.** Do we run the upgrade runbook with the customer's admin (screen share), or
   send them the runbook?
3. **Production on our sites.** Which production sites (if any, besides `bitovi-training`) have KPI
   data that needs upgrading?
