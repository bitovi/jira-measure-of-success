# 04 — KPI configuration (Settings)

Part of [11 — Scalable KPI data](../plan.md). Status: **Draft: design pending gate G2** · Depends on: 01, 02.

Prototypes: [kpi-space-setup.html](./kpi-space-setup.html) (v3, the latest).
[v1](./kpi-space-setup-v1.html) (one KPI space + a data-migrations card) and
[v2](./kpi-space-setup-v2.html) (step by step) are earlier iterations, kept for comparison.
**None of them is settled.** Justin reviews them at the start of this stage.

## Problem

Settings today sets up **one** KPI project: create or connect it, make sure it has the `KPI` issue
type, and pick the hierarchy link type. Everything the app knows about where KPIs live is
`kpi:space` + `kpi:hierarchy` in KVS ([storage.ts](../../../app/src/backend/storage.ts)), and the KPI
type is hard-coded by name (`KPI_ISSUE_TYPE` in [jira.ts](../../../app/src/backend/jira.ts)).

For the rest of this spec, the app needs to know (and an admin needs to be able to set up):

- **which work type is the KPI type** (06 finds KPIs by it);
- **which fields hold unit and direction** (05 reads and writes them);
- optionally, the **schemes and screens** that make those fields appear in Jira, and a **central
  space**;
- what **other spaces' admins** must do to hold KPIs;
- and, for existing installs, how to **upgrade their data** (02's migrations).

## What the prototypes propose (for review, not decided)

v3 splits Settings into three parts:

1. **KPI building blocks** (Jira admin only): *KPI fields*, *KPI work type* (required); *KPI work
   type scheme*, *KPI field scheme*, *KPI screens* (optional). Each can be **created** by the app,
   pointed at **something that exists**, or **skipped** (optional ones). There's also a *Set up
   everything with defaults* shortcut.
2. **Central KPI space** (optional): create or use an existing space, plus *How KPIs nest* (the
   hierarchy link type, as today).
3. **Using KPIs in other spaces**: generated, copyable instructions saying which steps need a Jira
   admin and which a space admin can do.

v1 also had a **Data migrations** card. v3 doesn't show the upgrade path yet. That's added before the
review (Step 1).

Things the prototypes imply that differ from earlier drafts, so they need a decision at G2:

- **Fields created or chosen by the admin** (v3), instead of Forge-owned `jira:customField` fields in
  the manifest (the earlier spec 11 draft). See Q1.
- **Direction as a native dropdown** with a mapping of "which option means higher is better" (v3),
  instead of a text field with a formatter, validation and a custom editor. See Q2.
- **A field scheme** per space (v3), instead of a field **context** limited to the KPI type in all
  projects (earlier draft). See Q3.
- **The central space is optional** (v3). See Q5.

## Design (the parts that hold whatever G2 decides)

### Site configuration (`@domain` model + KVS)

One record that every other stage reads, instead of the separate `kpi:space` and `kpi:hierarchy`
records plus a hard-coded type name:

```ts
KpiSiteConfig = {
  workType: { id: string; name: string } | null;
  /** null = not chosen yet (05 keeps using `kpi-meta` only). Unit and direction are chosen together. */
  fields: {
    unit: { fieldId: string };
    direction:
      | { fieldId: string; kind: 'text' }                                        // 'increase' | 'decrease'
      | { fieldId: string; kind: 'select'; optionIds: { increase: string; decrease: string } };
  } | null;
  centralSpace: { projectId: string; key: string; name: string } | null;
  hierarchy: KpiHierarchyLink | null;                     // today's kpi:hierarchy
  /** Optional building blocks, recorded so Settings can show "Using …". Not used by reads/writes. */
  schemes: { workTypeScheme?: Ref; fieldScheme?: Ref; screenScheme?: Ref };
};
```

- Stored in KVS under `kpi:config:site` (per install, like every app setting).
- **`readKpiSiteConfig()`** is the only way backend code learns the KPI type and field ids. It's
  cached per invocation (next to `getFieldIds`).
- **Existing installs** (no record yet) get a config **derived** from what they have, with no admin
  action: `centralSpace` from `kpi:space`, `hierarchy` from `kpi:hierarchy`, `workType` = the type
  named `KPI` if it exists, `fields` = `null`. With `fields: null`, 05 keeps reading and writing
  `kpi-meta` only, as today. So an upgraded install works before anyone opens Settings.
- On load, Settings checks that every configured id still exists (a deleted field or type) and marks
  that block **broken**, with a fix action.
- **`fields` is all or nothing.** It's `null` until both the unit and direction fields are chosen, and
  they're saved together. There's no half-configured state: once `fields` is set, 05 reads unit and
  direction from the fields only, so a missing direction field would mean no direction at all. A field
  deleted later keeps its id and shows as **broken** (above); it isn't set to `null`.

### Provisioning (backend, `defineSettingsWrite`, as the admin)

One idempotent function per building block, each returning the ids it created or found, so *Set up
everything* is just those functions run in order:

| Block | Function (draft) | Notes |
|---|---|---|
| Work type | `ensureKpiWorkType()` | Today's `ensureKpiIssueType`, generalised to "create or use existing". A type the app **creates** gets the app's **target avatar** (Q11), so KPIs look like KPIs everywhere Jira shows a type icon, and in the app (which inlines the type's `iconUrl`) |
| Fields | `ensureKpiFields()` | Depends on Q1/Q2 |
| Work type scheme | `ensureKpiWorkTypeScheme()` | If kept (Q4) |
| Field scheme / context | `ensureKpiFieldScheme()` or `ensureKpiFieldContexts()` | Depends on Q3 and 01 B2 |
| Screens | `ensureKpiScreens()` | View, create, edit screens + screen scheme + work type screen scheme |
| Central space | `createKpiSpace` / `saveKpiSpaceKey` | Today's functions, now using the blocks above |
| Hierarchy | `ensureKpiHierarchyLinkType()` | Unchanged |

"Use existing" saves the chosen id after checking it's the right kind (e.g. a single-select for
direction, with two options mapped). Reads of schemes and screens run `asApp`; changes run as the
admin, as spec 10 does for provisioning today.

### Upgrade data card

Built on 02's resolvers (`getMigrations`, `runMigrationBatch`, `retryMigration`). The rows, states and
behaviour (run, pause, retry failed, blocked by a dependency, not applicable yet) come from 02.
The app shows incomplete data until these have run (overview, *Compatibility*), so the card is the
first thing an admin sees after upgrading. Where it sits on the page, and whether there's a single **Upgrade**
action that runs every pending migration in order, is decided at G2 (Q7).

### Guide for other spaces

Generated from the configuration (names of the actual work type, fields and schemes), as in v3's
section 3. Who does what (Jira admin vs space admin) comes from 01 B4. The same text goes in the README.

## Implementation steps

### Step 1 — Extend the prototype with the upgrade path

- Keep v3 as `kpi-space-setup-v3.html` and make `kpi-space-setup.html` the new version. Add to it:
  - the **existing install** scenario as it really will look after upgrading: work type and central
    space already filled in from the old config, fields not chosen yet, and the **Upgrade data** card
    with 03's `kpi-target-refs-to-ids` and 05's `kpi-meta-to-fields` rows;
  - what happens after the fields are chosen (the unit/direction migration becomes runnable);
  - a **broken** block (a configured field was deleted);
  - anything 01's findings change (e.g. field schemes vs contexts, who can do what).
- **Verify:** every scenario button works; nothing talks to Jira.

### Step 2 — 🔍 Gate G2: prototype review

- **Stop. Ask Justin to review** the prototype (and v1–v3 for comparison) together with 01's findings.
- Write the decisions into *Questions* below, then **rewrite *Design* and Steps 3–7** to match before
  writing any code. Update 05's design if the field decisions change it.

### Step 3 — Site configuration

- `KpiSiteConfig` schema, the derivation from legacy records, `readKpiSiteConfig` / `writeKpiSiteConfig`,
  the per-invocation cache, and existence checks.
- **Verify:** table tests for the derivation (nothing set up; old install with space + hierarchy; old
  install with a space whose `KPI` type was renamed; new config already saved). Every derived config
  parses with the `KpiSiteConfig` schema (`fields: null`); a `fields` block with only one of the two
  entries is rejected. Backend tests: an
  upgraded install with no new record behaves exactly as before (Timeline and panel snapshots
  unchanged). Request-log tests: still one `/field` call and one config read per invocation.

### Step 4 — Provisioning functions

- One per block, per the decided design.
- **Verify:** mock-Jira tests per block: create on an empty site; use existing; running twice is a
  no-op; a shared scheme is only changed for the KPI work type; non-admin refused.

### Step 5 — Settings UI: building blocks, central space, guide

- Modlets per [create-react-modlet](../../../.claude/skills/create-react-modlet/SKILL.md), with stories
  for every prototype scenario and portable-stories tests. Harness mocks per block.
- **Verify:** in the harness at `?surface=settings`, light and dark, clean console: each scenario
  from the prototype behaves the same as the prototype.

### Step 6 — Settings UI: Upgrade data card

- The card on 02's harness mocks (`?migrations=…`).
- **Verify:** run, pause, resume, retry failed, blocked and not applicable states in light and dark,
  clean console. Story tests pass.

### Step 7 — Live check (dev)

- Deploy the branch to dev.
- **Verify** on `bitovi-training`: dev's Settings shows the existing KPI project as the central space
  and the KPI type already chosen; choosing fields works; the guide names the real fields; staging
  (on `main`) is unaffected; running 03's migration from the card works.

## Questions

_To be answered at gate G2. 01's findings are noted next to each where relevant._

1. **Who owns the unit and direction fields?**
   - **(a) Forge-owned** (`jira:customField` in the manifest, like `kpi-reading`): installed
     automatically, can have a formatter and validation, can't be a native dropdown. **Each Forge
     environment gets its own fields**, so a site with dev + staging + prod installs sees three
     "KPI Unit" fields with different values (01 A1). Can't "use existing".
   - **(b) Admin-created over REST** by Settings (v3's *Create fields*): ordinary Jira fields, shared
     by every install on the site, can be a dropdown, no Forge formatter or validation.
   - **(c) (b) plus "use existing"** (v3's picker): reuse fields a site already has.
2. **Direction field type**: a single-select dropdown with an option mapping (v3), or text
   `increase` / `decrease` with a formatter, validation and custom editor (earlier draft; only
   possible with 1a)?
3. **Making the fields usable in a space**: a **KPI field scheme** that spaces switch to (v3), or
   field **contexts** limited to the KPI work type in all projects (earlier draft), or both? Depends on
   01 A3 and B2.
4. **KPI work type scheme**: keep this optional block (a scheme with only the KPI type, for KPI-only
   spaces like the central one)?
5. **Is the central space optional?** v3 lets you skip it. Existing installs always have one (and the
   customer's report needs it). (Add KPI no longer depends on it: 08 never defaults to it.)
6. **"Set up everything with defaults"**: keep the shortcut?
7. **Upgrade data**: where on the page, shown only when there's something to do (or collapsed "All data
   is up to date")? One **Upgrade** button that runs every pending migration in order, or a Run button
   per migration?
8. **Changing a block later** ("Change…" in v3): what happens to existing KPIs if an admin switches
   the work type or the unit field? Disallow once KPIs exist, warn, or offer a migration?
9. **Config per install**: each install (dev, staging, prod) keeps its own `kpi:config:site`, so each
   one's admin configures it. With shared fields (1b/1c) they'd normally choose the same ones. OK, or
   should Settings offer "use the same as another install"?
10. **Field names** when the app creates them: "KPI Unit" / "KPI Direction" (draft), or
    "Unit" / "Direction"?
11. **KPI type icon.** A work type the app creates gets a target (bullseye) avatar, as in the
    [picker prototype](../07-kpi-picker/kpi-picker.html). Should Settings also offer to set it on an
    **existing** KPI type (e.g. bitovi-training's, which has Jira's generic checkbox avatar), or leave
    existing types' icons alone? Changing it affects every space that uses the type. 01 B7 checks the
    API.
