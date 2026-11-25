# 04 — KPI configuration (Settings)

Part of [11 — Scalable KPI data](../plan.md). Status: **Done (live check pending)** (G2 decided by the implementer on autopilot, pending Justin's review of the built page) · Depends on: 01, 02
(and 03 for Step 7's live check only).

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

**No new scopes.** Every provisioning call is covered by the app's current scopes, per Jira's published
API spec (overview Q11):
- fields, contexts and options, work types and work type schemes, screen schemes, work type screen
  schemes, field configuration schemes, field schemes, and uploading or selecting a work type avatar:
  `manage:jira-configuration`;
- screens and screen tabs: `manage:jira-project`.

Keeping it that way keeps the release a minor version, so the customer's admin doesn't have to approve
an update. A design that needs another scope has to say so at G2.

### Upgrade data card

Built on 02's resolvers (`getMigrations`, `runMigrationBatch`, `retryMigration`). The rows, states and
behaviour (run, pause, retry failed, blocked by a dependency, not applicable yet) come from 02.
The app shows incomplete data until these have run (overview, *Compatibility*), so the card is the
first thing an admin sees after upgrading. Where it sits on the page, and whether there's a single **Upgrade**
action that runs every pending migration in order, is decided at G2 (Q7).

### Guide for other spaces

Generated from the configuration (names of the actual work type, fields and schemes), as in v3's
section 3. Who does what (Jira admin vs space admin) comes from 01 B4. The same text goes in the README.

## Decided design (2026-11-24, implementer, autopilot; revisit at review)

Justin asked the implementer to continue without stopping at G2, so the decisions below (one per
question, recorded under *Questions*) were made from 01's findings and the v3 prototype, favouring the
smallest design that works for one central space and for other spaces. The UI follows v3's three parts.
**Steps 1–2 (extending the prototype and the review) are replaced by this section**; the built
Settings page in the harness is what Justin reviews.

- **Fields (Q1 c, Q2 select, Q10):** Settings **creates** *KPI Unit* (short text) and *KPI Direction*
  (single select with options *Increase* / *Decrease*), or the admin **picks existing** fields (a text
  field for unit; a single select with two options mapped to increase/decrease, or a text field holding
  `increase`/`decrease`). Saved together into `fields` (all or nothing).
- **Making them usable (Q3): field schemes, no new scheme.** `ensureKpiFieldsInSpace(projectId)` adds
  unit and direction to **the space's current field scheme**, restricted to the KPI work type
  (`PUT /config/fieldschemes/fields { [fieldId]: [{ schemeIds: [id], restrictedToWorkTypes: [typeId] }] }`,
  01 B2/A4). Harmless when the scheme is shared: other work types don't get the fields. Run for the
  central space when fields are saved or the space is set, and offered per space in the guide.
  Contexts aren't touched (01 A3). The select's options live in its one global context.
- **Screens:** `ensureKpiFieldsOnScreens(projectId)` adds unit and direction to the first tab of every
  screen the space uses for the KPI work type (its work type screen scheme → screen scheme → screens).
  Shared screens are fine: the field scheme hides the fields from other work types. Optional (only for
  people editing in Jira; the app's writes don't need it, 01 A4/B5).
- **No work type scheme block (Q4).** Adding the KPI type to a space's existing work type scheme (today's
  `ensureKpiIssueTypeOnProject`) is enough; `schemes` in the config stays for display only.
- **Central space optional (Q5)** for new installs; existing installs keep theirs (derived).
- **Set up everything (Q6):** kept: work type → fields → central space (create) → fields in its scheme
  and on its screens → hierarchy link type.
- **Upgrade data (Q7):** a card **at the top**, shown expanded only when a migration isn't `done`
  (otherwise one collapsed line, "All data is up to date"). One **Upgrade** button runs every pending
  migration in order (looping `runMigrationBatch`), with **Pause**; each row shows its state and counts,
  and a failed row has **Retry failed**.
- **Changing a block later (Q8): allowed with a warning** ("Existing KPIs keep their values in the old
  field/type; they aren't moved."), no migration.
- **Per install (Q9):** each install configures itself; the "use existing" pickers list the site's
  fields, so another install's fields are easy to pick.
- **Icon (Q11):** a work type the app **creates** gets the bullseye as a **PNG** (01 B7); existing types
  are left alone.
- **Guide for other spaces:** generated text naming the real work type and fields, in three steps (add
  the work type to the space's work type scheme; add the two fields to its field scheme for that type;
  optionally to its screens), each with a **Do it for {space}** action in Settings for a Jira admin. B4
  (what a space admin can do alone) is deferred, so the guide says these steps need a Jira admin.

## Implementation steps

### Step 1 — ~~Extend the prototype with the upgrade path~~ (replaced by *Decided design*)

- Keep v3 as `kpi-space-setup-v3.html` and make `kpi-space-setup.html` the new version. Add to it:
  - the **existing install** scenario as it really will look after upgrading: work type and central
    space already filled in from the old config, fields not chosen yet, and the **Upgrade data** card
    with 03's `kpi-target-refs-to-ids` and 05's `kpi-meta-to-fields` rows;
  - what happens after the fields are chosen (the unit/direction migration becomes runnable);
  - a **broken** block (a configured field was deleted);
  - anything 01's findings change (e.g. field schemes vs contexts, who can do what).
- **Verify:** every scenario button works; nothing talks to Jira.

### Step 2 — 🔍 Gate G2: prototype review (decided by the implementer; Justin reviews the built page)

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
  (on `main`) is unaffected; running 03's migration from the card works (needs 03 merged into the
  branch first; until then, check the card against 02's test-only migration).

## Questions

_To be answered at gate G2. 01's findings are noted next to each where relevant._

1. **Who owns the unit and direction fields?** (01: admin-created fields work over REST, as the app or
   the admin (A2, B3); Forge-owned fields appear in **every** field scheme and can't be removed from
   one (B8), so with (a) every space and work type would carry KPI Unit and KPI Direction.)
   - **(a) Forge-owned** (`jira:customField` in the manifest, like `kpi-reading`): installed
     automatically, can have a formatter and validation, can't be a native dropdown. **Each Forge
     environment gets its own fields**, so a site with dev + staging + prod installs sees three
     "KPI Unit" fields with different values (01 A1). Can't "use existing".
   - **(b) Admin-created over REST** by Settings (v3's *Create fields*): ordinary Jira fields, shared
     by every install on the site, can be a dropdown, no Forge formatter or validation.
   - **(c) (b) plus "use existing"** (v3's picker): reuse fields a site already has.
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** (c).
2. **Direction field type**: a single-select dropdown with an option mapping (v3), or text
   `increase` / `decrease` with a formatter, validation and custom editor (earlier draft; only
   possible with 1a)?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** a single-select dropdown with an option mapping (text still accepted for an existing field).
3. **Making the fields usable in a space** (01 A3/B2 answer most of this: **contexts can no longer
   restrict a field**: Jira gives each field one global context that can't be narrowed or deleted, and
   field configuration schemes are gone on bitovi-training. **Field schemes are the only way**, with the
   field restricted to the KPI work type. The central space uses the shared *Default Field Scheme*, so
   04 either adds the fields to that scheme for the KPI type only (harmless to other spaces' work types)
   or gives KPI spaces their own scheme. Remaining question: which.): a **KPI field scheme** that spaces switch to (v3), or
   field **contexts** limited to the KPI work type in all projects (earlier draft), or both? Depends on
   01 A3 and B2. Note: Jira marks the field schemes REST API (`/rest/api/3/config/fieldschemes`)
   **experimental**, so it may change under us. Contexts and field configuration schemes are stable.
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** add the fields to each KPI space's **current** field scheme, restricted to the KPI type; no KPI-specific scheme.
4. **KPI work type scheme**: keep this optional block (a scheme with only the KPI type, for KPI-only
   spaces like the central one)?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** no; adding the KPI type to the space's existing work type scheme is enough.
5. **Is the central space optional?** v3 lets you skip it. Existing installs always have one (and the
   customer's report needs it). (Add KPI no longer depends on it: 08 never defaults to it.)
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** optional for new installs.
6. **"Set up everything with defaults"**: keep the shortcut?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** keep it.
7. **Upgrade data**: where on the page, shown only when there's something to do (or collapsed "All data
   is up to date")? One **Upgrade** button that runs every pending migration in order, or a Run button
   per migration?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** a card at the top, collapsed when everything is done; one **Upgrade** button plus per-row **Retry failed**.
8. **Changing a block later** ("Change…" in v3): what happens to existing KPIs if an admin switches
   the work type or the unit field? Disallow once KPIs exist, warn, or offer a migration?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** allowed, with a warning; nothing is moved.
9. **Config per install**: each install (dev, staging, prod) keeps its own `kpi:config:site`, so each
   one's admin configures it. With shared fields (1b/1c) they'd normally choose the same ones. OK, or
   should Settings offer "use the same as another install"?
   - **Decided (2026-11-24, implementer, autopilot; revisit at review):** per install; the pickers make reuse easy.
10. **Field names** when the app creates them: "KPI Unit" / "KPI Direction" (draft), or
    "Unit" / "Direction"?
    - **Decided (2026-11-24, implementer, autopilot; revisit at review):** "KPI Unit" / "KPI Direction".
11. **KPI type icon.** A work type the app creates gets a target (bullseye) avatar, as in the
    [picker prototype](../07-kpi-picker/kpi-picker.html). Should Settings also offer to set it on an
    **existing** KPI type (e.g. bitovi-training's, which has Jira's generic checkbox avatar), or leave
    existing types' icons alone? Changing it affects every space that uses the type. 01 B7 checks the
    API. (01 B7: PNG, GIF or JPEG only; SVG is rejected. Ship the bullseye as a PNG.)
    - **Decided (2026-11-24, implementer, autopilot; revisit at review):** only types the app creates get the PNG bullseye; existing types are left alone.

## Live check (2026-11-24, dev v10.4.0)

- Settings showed the Upgrade data card first, the existing KPI type and the KPI project already chosen.
  **Upgrade** ran 03's migration to `done` (see 03).
- **Create fields** created *KPI Unit* (`customfield_10910`) and *KPI Direction* (`customfield_10911`,
  options `10652` Increase / `10653` Decrease), added them to the KPI space's screens, and to the shared
  *Default Field Scheme*. **Bug found and fixed:** adding the fields to the screens reset their field
  scheme entries to every work type (01 B9). The screens step now restores the restriction; the mock Jira
  reproduces Jira's reset. On dev the restriction was put back by hand; an Initiative in ECOM briefly got
  a test value in KPI Unit while checking this (cleared; its History shows it).

## Implementation notes

Done 2026-11-24 on `feat/11-scalable-data`, Steps 3–6. Step 7 (live check on dev) is pending.

**Files added**

- Domain: `models/kpiSiteConfig.ts` (`KpiSiteConfig`, `StoredKpiSiteConfig`, `KpiFieldsConfig`,
  `KpiDirectionField`, the Settings payload schemas, default names), `resolve/kpiSiteConfig.ts` (+ test):
  `deriveKpiSiteConfig`, `kpiSiteConfigFrom`, `parseStoredKpiSiteConfig`, `assessKpiSetup` (the existence
  checks). `resolve/migrations.ts` gained `migrationRowState` / `nextMigrationToRun` (+ tests).
- Backend: `kpiConfig.ts` (`loadKpiSiteConfig`, `readKpiSiteConfig`, `writeKpiSiteConfig`),
  `kpiSetup.ts` (provisioning, pickers, per-space checks, Settings status), `kpiIcon.ts` (48×48 PNG
  bullseye, base64), `kpiSetup.test.ts` (mock-Jira tests for Steps 3 and 4).
- UI: `data/useKpiSetupData` (`KpiSetupApi`, `bridgeKpiSetupApi`, `useKpiSetupData(api?)`),
  `data/useMigrationsData` (`MigrationsApi`, `useMigrationsData(api?)`: the Upgrade loop),
  `Settings/components/UpgradeDataCard`, `KpiBuildingBlocks` (+ `WorkTypeStep`, `FieldsStep`, `StepCard`),
  `CentralSpaceCard`, `OtherSpacesGuide` (+ `guideText.ts`), each with stories and a story runner.
- Harness: `fixtures/kpiSetup.ts` (an in-memory site, `?setup=fresh|upgraded|blocks|configured|broken`,
  default `upgraded`; stories create their own), `fixtures/mockMigrations.ts` (02's mock migrations as
  a factory, `createMockMigrations(mode, { applicability })` + `mockMigrationsApi(mock, delayMs)`), and
  `fixtures/kpiSetup.test.ts`.

**Files changed:** `jira.ts` (`findProject(keyOrId)` with `key` / `issueTypeIds`, per-invocation
`listIssueTypes()`, `ensureKpiIssueTypeOnProject(projectId, workType)` checks first and takes the
configured type, `createKpiIssue(..., workType)`, `jiraError` exported; `ensureKpiIssueType` moved to
`kpiSetup.ensureKpiWorkType`), `requestLog.ts` (`perInvocation(key, load)` / `forgetPerInvocation`),
`storage.ts` (`readStoredKpiSiteConfig` / `writeStoredKpiSiteConfig`, key `kpi:config:site`; the
legacy writers drop the cached config), `resolver.ts`, `contracts.ts`, `testing/scaleFixture.ts`
(custom fields + contexts + options, field schemes, work type screen schemes / screen schemes /
screens / tabs, avatars, `PUT /issuetype/{id}`, `/project/search`, projects by id, a `TEAM` space
sharing the KPI space's field scheme `5` and screens, a team-managed `TMP`), the harness
(`mock-resolvers.ts`, `mock-bridge.ts`), `Settings.tsx` / stories, `useSettingsData` (no more KPI
space; `reloadHierarchy()`), `test-e2e/jira-api.e2e.ts`, README (setup step + the guide).

**API for 05 / 06**

```ts
// backend/kpiConfig.ts: the only way backend code learns the KPI type and field ids
loadKpiSiteConfig(): Promise<{ config: KpiSiteConfig; saved: boolean }> // once per invocation
readKpiSiteConfig(): Promise<KpiSiteConfig>
writeKpiSiteConfig(patch: Partial<KpiSiteConfig>): Promise<KpiSiteConfig>

KpiSiteConfig = {
  workType: { id: string; name: string } | null;
  fields: {                                   // null until both are chosen (all or nothing)
    unit: { fieldId: string };
    direction: { fieldId: string; kind: 'text' }
             | { fieldId: string; kind: 'select'; optionIds: { increase: string; decrease: string } };
  } | null;
  centralSpace: { projectId: string; key: string; name: string } | null;
  hierarchy: KpiHierarchyLink | null;
  schemes: { workTypeScheme?: Ref; fieldScheme?: Ref; screenScheme?: Ref };  // display only, unused so far
};
```

- `saved: false` = nothing saved yet: `workType` is the type named `KPI` (one `GET /issuetype`,
  cached per invocation), `fields` is `null`. 05's `kpi-meta-to-fields` should report not applicable
  while `fields` is `null` (the harness's stand-in already does, with the reason "Choose the KPI
  fields in Settings first").
- A created direction field has options **Increase** / **Decrease** in its global context; write by
  `{ id: optionIds.increase }`, read `.id` (01 A5).
- `kpiSetup.makeSpaceUsableForKpis(projectId, config)` / `applyKpiSpaceStep` are what 06/08 can reuse
  to make a space hold KPIs.

**Resolvers added** (all Settings-page only; writes via `defineSettingsWrite`, so Jira admin too)

| Resolver | Payload | Returns |
|---|---|---|
| `getKpiSetup` | — | `KpiSetupStatus` (`saved`, `workType`, `fields`, `centralSpace`, each `unset` / `ready` / `broken`, the space also `misconfigured`) |
| `getKpiWorkTypeChoices` | — | `KpiWorkTypeChoice[]` (standard, site-wide types) |
| `getKpiFieldChoices` | — | `KpiFieldChoice[]` (`kind: 'text' \| 'select'`) |
| `getKpiFieldOptions` | `{ fieldId }` | `KpiFieldOption[]` (the global context's enabled options) |
| `getKpiSpaceChoices` | — | `KpiSpaceChoice[]` (company-managed, `hasKpiWorkType`) |
| `getKpiSpaceSetup` | `{ projectId }` | `KpiSpaceSetupStatus` (`workType` / `fields` / `screens`: done, not done, or null = can't tell, plus `problem`) |
| `setUpKpiWorkType` | `{ mode: 'create' } \| { mode: 'existing', id }` | `KpiSetupStatus` |
| `setUpKpiFields` | `{ unit: { mode: 'create' } \| { mode: 'existing', fieldId }, direction: { mode: 'create' } \| { mode: 'existing', fieldId, kind: 'text' } \| { mode: 'existing', fieldId, kind: 'select', optionIds: { increase, decrease } } }` | `KpiSetupStatus` |
| `setUpCentralSpace` | `{ mode: 'create', key } \| { mode: 'existing', projectId }` | `KpiSetupStatus` |
| `setUpKpiSpaceStep` | `{ projectId, step: 'workType' \| 'fields' \| 'screens' }` | `KpiSpaceSetupStatus` |
| `setUpEverything` | `{ key? }` (default `KPI`) | `KpiSetupStatus` |

Writes return `warnings` when an optional step didn't finish (e.g. the field scheme API failed for
the central space) instead of failing the whole change. `createKpiSpace` now runs the same code as
`setUpCentralSpace({ mode: 'create' })` and still returns `KpiSpaceStatus`; `getKpiSpace` /
`saveKpiSpaceKey` are kept but no longer used by the UI.

**Jira calls** (reads as the app, writes as the admin): work type `GET/POST /issuetype`, then
`POST /universal_avatar/type/issuetype/owner/{id}?x=0&y=0&size=48` (`image/png`, binary) and
`PUT /issuetype/{id} { avatarId }` (best effort: a failure is logged, the type is kept); fields
`GET/POST /field`, `GET /field/{id}/context`, `GET/POST /field/{id}/context/{ctx}/option`; field
scheme `GET /config/fieldschemes/projects?projectId=`, `GET /config/fieldschemes/{id}/fields?fieldId=…`,
`PUT /config/fieldschemes/fields { [fieldId]: [{ schemeIds, restrictedToWorkTypes }] }` (keeps the
types a field already had there; a field in the scheme for every type is left alone); screens
`GET /issuetypescreenscheme/project`, `…/mapping`, `GET /screenscheme?id=`, `GET /screens/{id}/tabs`,
`GET/POST /screens/{id}/tabs/{tab}/fields` (first tab, only fields on none of the screen's tabs);
spaces `GET /project/search?expand=issueTypes` (style `classic` only), `GET /project/{idOrKey}`.

**Decisions made while implementing**

- **Storage:** `kpi:config:site` holds `workType`, `fields` and `schemes` only. The central space and
  hierarchy stay in `kpi:space` / `kpi:hierarchy` (one source each), which the timeline, panel and
  createKpi still read until 06 switches them; `readKpiSiteConfig` puts the four together. 09's cleanup
  can fold them into one record.
- **Derived until saved.** Nothing is written on read. The first Settings change that touches the
  work type or fields saves the record, including the derived work type. Saving the hierarchy or
  space alone doesn't create the record.
- "Create" is **create-or-use**: an existing standard type named `KPI`, or a field named `KPI Unit`
  (short text) / `KPI Direction` (single select), is used rather than duplicated. Only a type the app
  creates gets the icon.
- Unit must be a **short text** field (`textfield`); direction a short text or a **single select**.
  Unit and direction must be different fields; a select's two mapped options must exist and differ.
- The work type picker lists standard types only (no sub-tasks, no team-managed types, level 0).
- `createKpi` creates the configured work type by id. On an install with nothing saved that's the
  type named KPI found by id (one extra `GET /issuetype` per createKpi until Settings saves), or
  `{ name: 'KPI' }` as before when the site has none. Timeline and panel reads are unchanged (budget
  tests unchanged); 06 does the "is a KPI by type" switch.
- Changing the work type or fields re-runs the central space's setup (type in its scheme, fields in
  its field scheme and screens); errors there come back as warnings.
- Central space: the UI waits for the work type ("First: choose the KPI work type above"); the
  backend would create the `KPI` type if called without one (as `createKpiSpace` did). A new space
  still gets KPI nesting set up, best effort.
- "Set up everything" only fills in **unset** blocks (broken ones need their own fix), and is a no-op
  the second time (tested: no writes).
- Upgrade data: one Upgrade button (Resume when a migration is part-way); the loop runs the first
  runnable migration (pending or running, ready, applicable) in registry order to its end, re-reads the
  list and carries on; a thrown batch stops the run with the error. Pause takes effect after the batch
  in flight. Retry failed resets the migration and then runs Upgrade. Rows: To do / Running / Paused /
  Done / Failed (with up to 5 failures) / Waiting (blocked: "Runs after …") / Not yet (the migration's
  reason). Settings re-reads the list after any building block change, so choosing fields makes 05's
  migration runnable without a reload.
- Prototype differences: no work type scheme block (Q4); no separate "screens" or "field scheme"
  blocks (they're done per space: for the central space automatically, for other spaces from the
  guide's **Do it for {space}**); create actions run directly (the step text says what they create)
  instead of a confirm modal, except **Set up everything…**, which lists its steps first; pickers are
  inline, not modals. The hierarchy card keeps its existing title ("KPI Hierarchy") and sits between the
  central space and the guide.

**Live check (Step 7) should verify** on bitovi-training (dev): Settings opens with the Upgrade data
card first; the KPI type (10436) and the KPI project show as chosen (derived, `saved: false`);
**Create fields** creates *KPI Unit* / *KPI Direction* (Increase, Decrease) once, adds them to the
*Default Field Scheme* (5) for type 10436 only (check another space's Story doesn't get them) and to
the KPI space's screens; a new work type created on a scratch site gets the bullseye icon (the binary
upload through Forge is the one call 01 B7 only ran from the browser); the guide names the real fields
and **Do it for {space}** works on a scratch company-managed space; `GET /config/fieldschemes/projects` returns `{ values: [{ projectId,
schemeId }] }` as the OpenAPI spec says; staging (on `main`) is unaffected; running 03's migration
from the card works.

