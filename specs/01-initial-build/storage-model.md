# Storage Model — KPI space, targets, and readings

Status: **Proposed (2026-07-12)** — revises tech-choices §10 ("Storage model — follow the brief") and repo-memory **Q6** (readings as per-issue entity properties). Not yet implemented; captured here so the trade-off is written down before code changes.

Scope: where KPI definitions, per-issue targets, and recorded readings live, and how they satisfy the hard requirement that **all data be reachable by CascadeMCP over standard Jira REST**.

---

## Context / forces

1. **CascadeMCP must read *and* write everything via standard Jira REST.** This rules out Forge app-private storage (KVS / Custom Entity Store) for anything CascadeMCP touches — i.e. for essentially all domain data. Only Jira-REST-visible surfaces qualify: issues, their fields, entity properties, and changelog.
2. **KPI *values* (readings) are independent of any issue.** A KPI (e.g. "Revenue") has one true measured series; it is not owned by a work issue. (Corrects the earlier per-issue readings model.)
3. **The hierarchy spans projects/spaces.** An Outcome and its Initiatives/Epics routinely live in different projects, so KPIs and readings are inherently **cross-project / global** — they cannot be project-scoped entity properties.
4. **A reading has two dates**: the *effective date* ("value as of D") and the *entry date* ("recorded at T"). Any storage must preserve the effective date, independent of entry order (backfill and correction are expected).
5. **Readings grow unbounded** over time; targets and definitions do not.

---

## Decisions (settled)

- **KPI = a Jira work-item in a dedicated "KPI" space.** Each KPI is one issue (issue type `KPI`) in a project created/administered by the app. This makes KPIs first-class Jira objects: cross-project-referenceable, JQL-enumerable (`project = KPI`), permissioned, audited, and fully CascadeMCP-reachable.
- **The KPI space is provisioned from the admin/Settings surface.** An admin sets/confirms the project **key**; the app creates the project + `KPI` issue type if missing, or connects to an existing one. (Not auto-on-install; requires project-admin scope.)
- **Targets stay on the contributing work issues**, in the existing `kpi-assignments` entity property, referencing the KPI by **`kpiKey`** (e.g. `KPI-1`). A target carries data (value, date, timing mode) that a native Jira issue link **cannot** hold — links have no fields — so the property is the source of truth. A native "contributes to" link is optional/deferred (navigational only, extra sync cost, no data).
- **Readings are global per KPI**, stored on that KPI's issue. `recordValue(kpiId, date, value)` — no `issueId`.

---

## Open decision: how readings are stored on the KPI issue

Two finalists. Both are 100% Jira-REST / CascadeMCP-reachable. Difference is capacity vs. editability.

### Option A — entity-property array
One entity property on the KPI issue, e.g. `kpi-readings = { readings: [{date, value, recordedBy, recordedAt}, …] }`. Append = read-modify-write the array.

### Option B — changelog of a dedicated field (leaning)
Write each reading into a dedicated **app-only field** on the KPI issue as an embedded-date value — `{"d":"2026-03-01","v":1240000}` (or `"2026-03-01=1240000"`). Every write becomes a **changelog** entry. Reconstruct the series from the field's changelog.

- Read via the **bulk changelog** endpoint `POST /rest/api/3/changelog/bulkfetch` — **1000 issues/request**, **`fieldIds` filter (≤10)** so we fetch only our one field, token-paginated, returns `changeHistories[].items[].to` + `created` (Unix ms).
- Proven pattern: `bitovi/jira-timeline-report` uses exactly this — `fetchBulkChangelogs` in `src/jira-oidc-helpers/jira.ts`, and its `src/jira/raw/rollback/rollback.ts` reconstructs a field's value over time from changelog (`collectChangelog` sorts by `created`; `applyChangelog` replays `from`/`to`).
- **Ordering**: the changelog is sorted by `created` (entry time), *not* effective date — so we **embed the effective date in the value** and sort by that on read. Backfill and out-of-order entry then work correctly.
- **Edit / delete despite append-only** (last-write-wins per date):
  - *Edit* date D → append a new `{d:D, v:newValue}`; on read keep the latest entry per date. Old value remains as audit.
  - *Delete* date D → append a **tombstone** `{d:D, v:null}`; on read, if the latest entry for D is null, omit D.
  - So the reconstructed series behaves like an editable map keyed by date; only the audit trail is immutable (a feature).

### Trade-off

| | A — entity-property array | B — changelog field (leaning) |
|---|---|---|
| Capacity | ~800 pts (≈32 KB property ceiling) | **Unbounded** |
| Edit / delete a point | ✅ direct (mutate array) | ✅ via append + last-write-wins; tombstone `v:null` to delete |
| Purge history | ✅ | ❌ audit is immutable (usually desirable) |
| Concurrency (app + CascadeMCP) | ❌ read-modify-write race on the whole array | ✅ independent single-field writes |
| Audit (who/when) | manual (`recordedBy/At` fields) | ✅ native (`author`, `created`) for free |
| Read cost | 1 property GET | changelog fetch (bulk: ~1 call / 1000 KPIs) |
| Enumeration for timeline | per-KPI property GETs | **one `bulkfetch` over `project = KPI`** returns every KPI's full series |
| Ordering | inherent (stored array) | solved by embedded date |
| CascadeMCP / REST | ✅ | ✅ |
| Complexity | low | moderate (changelog reducer + embedded-date encoding) |

### Recommendation

**Option B (changelog field).** Readings accumulate for years, so the unbounded, natively-audited, race-free model fits better; the bulk endpoint also collapses timeline enumeration into a single call. The embedded-date encoding neutralizes the ordering concern, and append + tombstone recovers edit/delete. Accept the one real cost: history can't be purged, and the field's raw value is just the last write (so it must be an app-only field users don't hand-edit).

Choose Option A instead only if curated, low-volume, directly-editable series (with history purge) outweigh capacity and audit.

---

## Consequences

- **Domain** (`@domain`, pure): add `readingsFromChangelog(histories, fieldId) → Reading[]` (dedupe latest-per-date, drop tombstones, sort by embedded date) and a `readingValueEncode/decode`. `recordValue(kpiId, date, value|null)`.
- **Backend** (`jira.ts`): port a `fetchBulkChangelogs` equivalent (Forge `requestJira` → `POST /rest/api/3/changelog/bulkfetch`, `fieldIds` = our reading field, paginate); `recordValue` writes the encoded value to the KPI issue's reading field; add project/issue-type provisioning for the KPI space.
- **Settings surface**: KPI-space key field + create/connect action.
- **Scopes**: keep `read:jira-work` / `write:jira-work` (cover field edits + `changelog/bulkfetch`); add project-management scope for provisioning.
- **Supersedes**: tech-choices §10 and repo-memory Q6 (readings are KPI-global on the KPI issue, not per-issue). The KPI catalog/config also move off KVS onto the KPI space so CascadeMCP can reach them.
