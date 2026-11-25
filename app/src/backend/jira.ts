import { assumeTrustedRoute, getAppContext, route, routeFromAbsolute } from '@forge/api';
import { asApp, asUser, perInvocation, forgetPerInvocation, type RequestJira } from './requestLog';
import {
  isKpiIssueId,
  kpiMetaCreate,
  kpiMetaFieldIds,
  KpiMetaProperty,
  KPI_META_PROPERTY_KEY,
  parseKpiMeta,
  resolveKpiMeta,
  breakParentCycles,
  DEFAULT_KPI_LINK_TYPE,
  isDirectionalLinkType,
  KPI_HIERARCHY_NOT_SET_UP,
  dateFieldSelection,
  encodeReadingValue,
  kpiChildLinks,
  kpiParentLinkBody,
  kpiParentLinks,
  KPI_SPACE_REQUIRED,
  KPI_WORK_TYPE_NOT_SET_UP,
  readOwnDates,
  readStoredAssignments,
  shouldStampRefs,
  storedKeysById,
  StoredAssignments,
  toStoredAssignments,
  FALLBACK_DATE_FIELD_DEFAULTS,
  type Assignment,
  type DateFieldCatalog,
  type DateFieldOption,
  type DateFieldSelection,
  type HierarchyLevel,
  type CreatedKpi,
  type CreateKpiInput,
  type IssueLinkRef,
  type IssueLinkTypeInfo,
  type IssuePickerItem,
  type KpiFieldsConfig,
  type KpiPickerSpace,
  type KpiHierarchyLink,
  type KpiSpaceAccess,
  type KpiSpaceRef,
  type ReadingChange,
  type TimingNode,
} from '../domain/index';

/**
 * Jira access helpers for the resolver. These (with kpiSetup.ts for the KPI
 * building blocks' Jira configuration, and the migrations) are the only place
 * that talks to Jira's REST API; everything else operates on plain domain
 * objects, so the logic stays testable without a live site.
 */
const ASSIGNMENT_PROPERTY_KEY = 'kpi-assignments';
const MAX_DEPTH = 10;
/**
 * Batch size for `id in (...)` / `parent in (...)` JQL clauses — matches
 * bitovi/jira-timeline-report's own convention (`fetchChildrenResponses`,
 * "batches of 40"). Keeps JQL/URL length well under Jira's limits while
 * turning what would be N single-issue REST calls into a handful of bulk ones.
 */
const BATCH_SIZE = 40;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface IssueParentInfo {
  parentId: string | null;
  issueKey: string;
  issueTypeName: string;
  /** Jira `issuetype.id` (what "is a KPI" compares, spec 11 · 06); null when absent */
  issueTypeId: string | null;
  /** Jira `issuetype.hierarchyLevel`; null when Jira didn't return one */
  hierarchyLevel: number | null;
  ownStart: string | null;
  ownDueDate: string | null;
  /**
   * true when the issue's status category is "done" (Feature 03 freeze). Read but
   * not yet used to stop rollup walks — Follow-up F1 in specs/09-stacked-targets/plan.md.
   */
  closed: boolean;
}

/** Start date / Due date — what callers that don't pass a selection read. */
const DEFAULT_DATE_SELECTION = dateFieldSelection(null);

/** Raw issue fields as returned by Jira, including the selected date fields. */
type RawMetaFields = {
  parent?: { id: string };
  issuetype?: { id?: string; name: string; hierarchyLevel?: number };
  status?: { statusCategory?: { key?: string } };
  project?: { id?: string; key?: string; name?: string };
  [field: string]: unknown;
};

function metaFieldList(selection: DateFieldSelection): string {
  return [...new Set(['parent', 'issuetype', 'status', ...selection.fieldIds])].join(',');
}

function toIssueMeta(key: string, fields: RawMetaFields | undefined, selection: DateFieldSelection): IssueParentInfo {
  const issueTypeName = fields?.issuetype?.name ?? 'Unknown';
  const hierarchyLevel = fields?.issuetype?.hierarchyLevel ?? null;
  const { ownStart, ownDue } = readOwnDates(fields, { name: issueTypeName, hierarchyLevel }, selection);
  return {
    parentId: fields?.parent?.id ?? null,
    issueKey: key,
    issueTypeName,
    issueTypeId: fields?.issuetype?.id ? String(fields.issuetype.id) : null,
    hierarchyLevel,
    ownStart,
    ownDueDate: ownDue,
    closed: fields?.status?.statusCategory?.key === 'done',
  };
}

/**
 * One issue's parent/type/status and own start/due — the dates read from the
 * fields `selection` picks for its issue type (default Start date / Due date).
 */
export async function fetchIssueMeta(
  issueId: string,
  selection: DateFieldSelection = DEFAULT_DATE_SELECTION,
): Promise<IssueParentInfo> {
  const fieldList = metaFieldList(selection);
  const res = await asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=${fieldList}`);
  const data = (await res.json()) as { key: string; fields: RawMetaFields };
  return toIssueMeta(data.key, data.fields, selection);
}

/** A space as Jira returns an issue's `project` field; null without an id and key. */
export function spaceRefOf(project: { id?: string | number; key?: string; name?: string } | undefined): KpiSpaceRef | null {
  if (!project?.key || project.id === undefined) return null;
  return { id: String(project.id), key: project.key, name: project.name ?? project.key };
}

/**
 * `fetchIssueMeta` plus the issue's own targets and its space: the
 * `kpi-assignments` property comes back inside the same GET (`properties=`),
 * so no separate property request.
 */
export async function fetchIssueWithAssignments(
  issueId: string,
  selection: DateFieldSelection = DEFAULT_DATE_SELECTION,
): Promise<IssueParentInfo & { assignments: Assignment[]; project: KpiSpaceRef | null }> {
  const fieldList = `${metaFieldList(selection)},project`;
  const res = await asUser().requestJira(
    route`/rest/api/3/issue/${issueId}?fields=${fieldList}&properties=${ASSIGNMENT_PROPERTY_KEY}`,
  );
  if (!res.ok) throw new Error(`Failed to load issue ${issueId} (${res.status})`);
  const data = (await res.json()) as { key: string; fields: RawMetaFields; properties?: Record<string, unknown> };
  return {
    ...toIssueMeta(data.key, data.fields, selection),
    assignments: parseAssignments(data.properties?.[ASSIGNMENT_PROPERTY_KEY]),
    project: spaceRefOf(data.fields?.project),
  };
}

/** A raw `kpi-assignments` property value; null when absent or invalid. */
function parseStoredAssignments(value: unknown): StoredAssignments | null {
  const parsed = StoredAssignments.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Assignments (KPI ids, spec 11 · 03) from a raw `kpi-assignments` property value; [] when absent or invalid. */
function parseAssignments(value: unknown): Assignment[] {
  const stored = parseStoredAssignments(value);
  return stored ? readStoredAssignments(stored).assignments : [];
}

/** One issue's stored `kpi-assignments` property, as the user; null when it has none. */
export async function fetchStoredAssignments(issueId: string): Promise<StoredAssignments | null> {
  const res = await asUser()
    .requestJira(
      route`/rest/api/3/issue/${issueId}/properties/${ASSIGNMENT_PROPERTY_KEY}`,
    );
  if (res.status === 404) return null;
  const body = (await res.json()) as { value?: unknown };
  return parseStoredAssignments(body.value);
}

/** One issue's assignments. For single-issue paths; bulk loads read the property in the search instead. */
export async function fetchAssignments(issueId: string): Promise<Assignment[]> {
  const stored = await fetchStoredAssignments(issueId);
  return stored ? readStoredAssignments(stored).assignments : [];
}

/**
 * What `addTarget` needs about the issue a target is held on, in ONE request:
 * its current assignments (`properties=`) plus the type/summary/due the new
 * marker shows — the picker's item omits the issue type.
 */
export async function fetchTargetSourceIssue(issueId: string): Promise<{
  key: string;
  typeName: string;
  typeIconUrl: string | null;
  hierarchyLevel: number | null;
  summary: string;
  due: string | null;
  assignments: Assignment[];
  /** the stored property the assignments were read from (null when it has none), for `writeAssignments` */
  stored: StoredAssignments | null;
}> {
  const res = await asUser().requestJira(
    route`/rest/api/3/issue/${issueId}?fields=summary,issuetype,duedate&properties=${ASSIGNMENT_PROPERTY_KEY}`,
  );
  if (!res.ok) throw new Error(await jiraError(res, `load issue ${issueId}`));
  const data = (await res.json()) as {
    key: string;
    fields?: {
      summary?: string;
      duedate?: string | null;
      issuetype?: { name?: string; iconUrl?: string; hierarchyLevel?: number };
    };
    properties?: Record<string, unknown>;
  };
  return {
    key: data.key,
    typeName: data.fields?.issuetype?.name ?? 'Issue',
    typeIconUrl: data.fields?.issuetype?.iconUrl ?? null,
    hierarchyLevel: data.fields?.issuetype?.hierarchyLevel ?? null,
    summary: data.fields?.summary ?? data.key,
    due: data.fields?.duedate ?? null,
    ...storedAndAssignments(data.properties?.[ASSIGNMENT_PROPERTY_KEY]),
  };
}

function storedAndAssignments(value: unknown): { stored: StoredAssignments | null; assignments: Assignment[] } {
  const stored = parseStoredAssignments(value);
  return { stored, assignments: stored ? readStoredAssignments(stored).assignments : [] };
}

/**
 * Current keys of the given issue ids, looked up AS THE APP (so a KPI the user
 * can't see still gets its key written for the customer's app; the keys are
 * only written, never shown). One `id in (…)` search per BATCH_SIZE ids; if Jira
 * refuses the search (e.g. JQL naming a deleted issue), one GET per id instead.
 * Ids that no longer exist are absent.
 */
export async function fetchIssueKeysAsApp(issueIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(issueIds)].filter(isKpiIssueId);
  await Promise.all(
    chunkArray(ids, BATCH_SIZE).map(async (batch) => {
      const jql = `id in (${batch.join(',')})`;
      const res = await asApp().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=id&maxResults=100`);
      if (res.ok) {
        const data = (await res.json()) as { issues?: Array<{ id: string; key: string }> };
        for (const issue of data.issues ?? []) out.set(String(issue.id), issue.key);
        return;
      }
      await Promise.all(
        batch.map(async (id) => {
          const one = await asApp().requestJira(route`/rest/api/3/issue/${id}?fields=issuetype`);
          if (one.ok) out.set(id, ((await one.json()) as { key: string }).key);
        }),
      );
    }),
  );
  return out;
}

/**
 * Persist the full assignment list for an issue (one write), in the stored
 * format (spec 11 · 03): every id reference gets `kpiIssueId` plus the KPI's
 * current key in `kpiId`, and both index arrays are filled (`kpiIssueIds` for
 * discovery, `kpiIds` for the customer's app). Keys come from `loadedKeys` (KPIs
 * the caller already looked up), then one app lookup for the others; an id whose
 * KPI no longer exists keeps the key stored with it in `previous`. The issue is
 * stamped `refsVersion` per `shouldStampRefs(previous)`.
 */
export async function writeAssignments(
  issueId: string,
  assignments: Assignment[],
  previous: StoredAssignments | null,
  loadedKeys: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  const keyOfId = storedKeysById(previous);
  for (const [id, key] of loadedKeys) keyOfId.set(id, key);
  const toLookUp = [...new Set(assignments.map((a) => a.kpiId))].filter((id) => isKpiIssueId(id) && !loadedKeys.has(id));
  if (toLookUp.length > 0) {
    for (const [id, key] of await fetchIssueKeysAsApp(toLookUp)) keyOfId.set(id, key);
  }
  const value: unknown = StoredAssignments.parse(toStoredAssignments(assignments, keyOfId, shouldStampRefs(previous)));
  const res = await asUser()
    .requestJira(route`/rest/api/3/issue/${issueId}/properties/${ASSIGNMENT_PROPERTY_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  // Surface rejections (e.g. 403 when the user can view but not edit the issue):
  // callers return the saved target and the client keeps it, so a swallowed
  // failure would show an unsaved target as saved.
  if (!res.ok) throw new Error(await jiraError(res, `save targets on issue ${issueId}`));
}

/**
 * Type-ahead issue search for the Add Target picker — Jira's issue-picker
 * endpoint (`GET /rest/api/3/issue/picker`), the same source the native Parent
 * field uses. Returns matched issues across its sections (recents + query),
 * de-duplicated by key. The endpoint omits issue type, so `issueType` is null.
 */
export async function searchIssuePicker(query: string): Promise<IssuePickerItem[]> {
  const res = await asUser()
    .requestJira(route`/rest/api/3/issue/picker?query=${query}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    sections?: Array<{
      issues?: Array<{ id: number | string; key: string; summaryText?: string; img?: string }>;
    }>;
  };
  const seen = new Set<string>();
  const out: IssuePickerItem[] = [];
  for (const section of data.sections ?? []) {
    for (const issue of section.issues ?? []) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      out.push({
        id: String(issue.id),
        key: issue.key,
        summary: issue.summaryText ?? issue.key,
        issueType: null,
        iconUrl: issue.img ?? null,
      });
    }
  }
  return out;
}

/**
 * Reading storage — Option B (specs/01-initial-build/storage-model.md). Each KPI
 * issue has one app-defined field whose CHANGELOG holds the reading series: every
 * recorded value is an embedded-date payload, so each write is one changelog
 * entry. The series is reconstructed by the pure `readingsFromChangelog` reducer.
 * Since spec 10 the field is written and read AS THE USER (see `writeReading`).
 */
/**
 * Field ids this app needs from `GET /rest/api/3/field` — ONE request serves
 * both (spec 06 P7), cached per runtime since the numeric `customfield_*` ids
 * vary per site and are stable once assigned:
 *  - the app-owned "KPI Reading" custom field (manifest `jira:customField` key
 *    `kpi-reading`), matched by app field key/name;
 *  - the native LexoRank "Rank" field (`com.pyxis.greenhopper.jira:gh-lexo-rank`)
 *    used to order sibling KPIs like a backlog drag would.
 * The in-flight promise is cached so concurrent callers share the single call.
 */
interface FieldIds {
  reading: string | null;
  rank: string | null;
}

type RawField = { id: string; key?: string; name?: string; schema?: { type?: string; custom?: string } };

/** Per-user "Last viewed" isn't a planning date — keep it out of the pickers. */
const HIDDEN_DATE_FIELDS = new Set(['lastViewed']);

function dateFieldsFrom(fields: RawField[]): DateFieldOption[] {
  return fields
    .filter((f) => (f.schema?.type === 'date' || f.schema?.type === 'datetime') && !HIDDEN_DATE_FIELDS.has(f.id))
    .map((f) => ({ id: f.id, name: f.name ?? f.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

let fieldIdsPromise: Promise<FieldIds> | null = null;

async function loadFieldIds(): Promise<FieldIds> {
  const res = await asApp().requestJira(route`/rest/api/3/field`);
  if (!res.ok) throw new Error(`Failed to list Jira fields (${res.status})`);
  const fields = (await res.json()) as RawField[];
  return {
    reading: pickReadingField(fields, currentEnvironmentType())?.id ?? null,
    rank: fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-lexo-rank')?.id ?? null,
  };
}

/** The Forge environment this code runs in (`DEVELOPMENT`, `STAGING`, `PRODUCTION`); null outside Forge. */
function currentEnvironmentType(): string | null {
  try {
    return getAppContext().environmentType?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

const ENV_TAG = /__(DEVELOPMENT|STAGING|PRODUCTION)__/i;

/**
 * This install's KPI Reading field. Each Forge environment installed on a site
 * gets its own field (key `<appId>__<ENV>__kpi-reading`), so a site with dev and
 * staging installs has two. Since readings are written as the user (spec 10), a
 * wrong pick would silently record into the other install's field — so prefer
 * the running environment's field, then one without an environment tag, then
 * any match.
 */
export function pickReadingField<F extends RawField>(fields: F[], environmentType: string | null): F | undefined {
  const candidates = fields.filter((f) => (f.key ?? '').includes('kpi-reading') || f.name === 'KPI Reading');
  const env = environmentType?.toUpperCase();
  return (
    (env ? candidates.find((f) => (f.key ?? '').toUpperCase().includes(`__${env}__`)) : undefined) ??
    candidates.find((f) => !ENV_TAG.test(f.key ?? '')) ??
    candidates[0]
  );
}

function getFieldIds(): Promise<FieldIds> {
  if (!fieldIdsPromise) {
    const pending = loadFieldIds().then(
      (ids) => {
        // Not installed yet (app not deployed) → look again next time.
        if (!ids.reading && fieldIdsPromise === pending) fieldIdsPromise = null;
        return ids;
      },
      (err: unknown) => {
        if (fieldIdsPromise === pending) fieldIdsPromise = null;
        throw err;
      },
    );
    fieldIdsPromise = pending;
  }
  return fieldIdsPromise;
}

/**
 * Every date/datetime field on the site plus the default start/due fields, for
 * the Settings date-field pickers. Uncached so newly created fields show up.
 *
 * The defaults are the same fixed ids the rollup reads when a level has no
 * choice (`FALLBACK_DATE_FIELD_DEFAULTS`), so the form and the backend agree. On
 * the rare site whose "Start date" isn't `customfield_10015` the picker shows it
 * as "not found" and the admin picks the real field.
 */
export async function fetchDateFieldCatalog(): Promise<DateFieldCatalog> {
  const res = await asApp().requestJira(route`/rest/api/3/field`);
  if (!res.ok) throw new Error(`Failed to list Jira fields (${res.status})`);
  const fields = (await res.json()) as RawField[];
  return { fields: dateFieldsFrom(fields), defaults: FALLBACK_DATE_FIELD_DEFAULTS };
}

/** Start the shared `/field` lookup early so later steps find it already resolved. */
export async function warmFieldIds(): Promise<void> {
  await getFieldIds().catch(() => undefined);
}

async function getReadingFieldId(): Promise<string> {
  const { reading } = await getFieldIds();
  if (!reading) {
    throw new Error('KPI Reading field not found — deploy the app so its custom field is installed.');
  }
  return reading;
}

/** Jira refused a write because the user lacks the permission (403). */
export class JiraForbiddenError extends Error {}

/**
 * Record a reading on a KPI issue (value=null = tombstone/delete) by writing the
 * encoded payload to the KPI Reading field — as the USER, through the standard
 * issue edit (spec 10, Path A). Jira itself requires Edit Issues on the KPI, and
 * the changelog entry the series is rebuilt from names the person who recorded it.
 * The field is editable (manifest `readOnly: false`) but on no screen; Jira
 * accepts the REST edit regardless (verified live, spec 10 Step 0).
 *
 * `kpiIssueId` is the numeric id or key of a KPI the caller has already checked
 * is a KPI (of the KPI work type, see the `recordValue` resolver).
 */
export async function writeReading(kpiIssueId: string, date: string, value: number | null): Promise<void> {
  const fieldId = await getReadingFieldId();
  const encoded = encodeReadingValue(date, value);
  const res = await asUser().requestJira(route`/rest/api/3/issue/${kpiIssueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [fieldId]: encoded } }),
  });
  // A silently-ignored 4xx/5xx here is exactly what made "record value did
  // nothing" once: surface the failure so the UI banner / Forge logs reveal it.
  if (res.status === 403) throw new JiraForbiddenError(await jiraError(res, `record a value on ${kpiIssueId}`));
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to write reading (${res.status}): ${body}`);
  }
}

/**
 * Look up an issue AS THE USER: its numeric id, key, space and work type. null
 * when the user can't see it (Jira answers 404 for "doesn't exist" and "no
 * permission" alike). Used to check an issue is a visible KPI before writing
 * anything that points at it.
 */
export async function fetchKpiIssueRef(
  idOrKey: string,
): Promise<{ id: string; key: string; projectKey: string | null; project: KpiSpaceRef | null; typeId: string | null } | null> {
  const res = await asUser().requestJira(route`/rest/api/3/issue/${idOrKey}?fields=project,issuetype`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(await jiraError(res, `look up ${idOrKey}`));
  const body = (await res.json()) as {
    id: string;
    key: string;
    fields?: { project?: { id?: string; key?: string; name?: string }; issuetype?: { id?: string } };
  };
  return {
    id: String(body.id),
    key: body.key,
    projectKey: body.fields?.project?.key ?? null,
    project: spaceRefOf(body.fields?.project),
    typeId: body.fields?.issuetype?.id ? String(body.fields.issuetype.id) : null,
  };
}

/** Jira's bulk changelog caps: 1,000 issues per request, 1,000 histories per page (R4). */
export const CHANGELOG_BULK_ISSUES = 1000;
export const CHANGELOG_BULK_PAGE = 1000;
/** A runaway guard on one batch's pages (1,000 issues × 100 readings each). */
const CHANGELOG_MAX_PAGES = 100;

type BulkChangelogPage = {
  nextPageToken?: string;
  issueChangeLogs?: Array<{
    issueId: string;
    changeHistories?: Array<{
      created: number | string;
      author?: { accountId?: string };
      items?: Array<{ fieldId?: string; field?: string; to?: string | null; toString?: string | null }>;
    }>;
  }>;
};

/**
 * Fetch the reading-field changelog for KPI issues via the bulk endpoint
 * (`POST /rest/api/3/changelog/bulkfetch`, filtered to the reading field).
 * Batches of 1,000 issues, run together, each paged by `nextPageToken` past
 * 1,000 histories (spec 11 · 08, R4): an issue's histories may span pages, so
 * they're appended. Returns the raw changes for `readingsFromChangelog`.
 */
export async function fetchReadingChangelog(kpiIssueIds: string[]): Promise<Map<string, ReadingChange[]>> {
  const byIssue = new Map<string, ReadingChange[]>();
  const ids = [...new Set(kpiIssueIds)];
  if (ids.length === 0) return byIssue;
  const fieldId = await getReadingFieldId();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += CHANGELOG_BULK_ISSUES) batches.push(ids.slice(i, i + CHANGELOG_BULK_ISSUES));
  const pages = await Promise.all(batches.map((batch) => fetchChangelogBatch(batch, fieldId)));
  for (const page of pages.flat()) {
    for (const log of page.issueChangeLogs ?? []) {
      const changes = byIssue.get(log.issueId) ?? [];
      for (const h of log.changeHistories ?? []) {
        const item = (h.items ?? []).find((i) => i.fieldId === fieldId || i.field === fieldId);
        if (!item) continue;
        // Bulk API returns `created` as Unix seconds/ms; normalize to ms.
        const created =
          typeof h.created === 'number'
            ? h.created < 1e10
              ? h.created * 1000
              : h.created
            : new Date(h.created).getTime();
        changes.push({ created, to: item.toString ?? item.to ?? null, by: h.author?.accountId });
      }
      byIssue.set(log.issueId, changes);
    }
  }
  return byIssue;
}

/** Every page of one batch's changelog (at most 1,000 issues). */
async function fetchChangelogBatch(issueIds: string[], fieldId: string): Promise<BulkChangelogPage[]> {
  const pages: BulkChangelogPage[] = [];
  let nextPageToken: string | undefined;
  for (let n = 0; n < CHANGELOG_MAX_PAGES; n += 1) {
    // As the USER (spec 10): the changelog of the (now editable) reading field is
    // readable as the user, and Jira leaves out issues they may not see.
    const res = await asUser().requestJira(route`/rest/api/3/changelog/bulkfetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueIdsOrKeys: issueIds,
        fieldIds: [fieldId],
        maxResults: CHANGELOG_BULK_PAGE,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    // Non-throwing on load (an empty series shouldn't crash the timeline), but
    // warn so a failed fetch is observable in Forge logs.
    if (!res.ok) {
      console.warn(`fetchReadingChangelog: bulkfetch failed (${res.status})`);
      break;
    }
    const page = (await res.json()) as BulkChangelogPage;
    pages.push(page);
    if (!page.nextPageToken || (page.issueChangeLogs ?? []).length === 0) break;
    nextPageToken = page.nextPageToken;
  }
  return pages;
}

/**
 * Normalize an issue-type/avatar icon URL to a `Route` `requestJira` can call.
 *
 * For built-in issue types (Epic, Story, ...) Jira returns a plain site-
 * relative-looking absolute URL, so `routeFromAbsolute` (strip the domain,
 * keep pathname+search) is all that's needed. But for CUSTOM issue types
 * (Initiative, Outcome, KPI, ...) the search API instead returns the icon URL
 * already in Atlassian's API-gateway absolute form —
 * `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/universal_avatar/...`
 * — because that's the same gateway host `asUser().requestJira()` used to make
 * the search call in the first place. `routeFromAbsolute` only strips the
 * domain, so the `/ex/jira/{cloudId}` segment would stay in the "path" handed
 * to `requestJira`, which prefixes its own gateway routing onto it — the
 * resulting double-prefixed request fails outright (`NEEDS_AUTHENTICATION_ERR`)
 * before it ever reaches the real endpoint. Strip anything before `/rest/` so
 * `requestJira` always gets a plain site-relative REST path.
 */
function toJiraRoute(absoluteUrl: string) {
  const { pathname, search } = new URL(absoluteUrl);
  const restIndex = pathname.indexOf('/rest/');
  if (restIndex <= 0) return routeFromAbsolute(absoluteUrl);
  return assumeTrustedRoute(`${pathname.slice(restIndex)}${search}`);
}

/**
 * Proxy an issue-type icon into a same-origin `data:` URL.
 *
 * The Custom UI iframe runs on a different origin from Atlassian's icon hosts
 * (`api.atlassian.com`, the site CDN). A plain <img> would display, but the
 * timeline tints its target markers with CSS `mask-image`, which requires a
 * CORS-clean image — and those hosts send no `Access-Control-Allow-Origin`, so
 * the mask fails silently and the marker renders blank (intermittently, thanks
 * to cache poisoning). Fetching the bytes server-side (no browser CORS) and
 * inlining them as a `data:` URL makes the tinted marker reliable.
 *
 * Best-effort: returns null on any failure so the UI falls back to a diamond.
 */
export async function fetchIconDataUrl(iconUrl: string): Promise<string | null> {
  try {
    const res = await asUser().requestJira(toJiraRoute(iconUrl));
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Resolve a batch of issue-type icon URLs to same-origin `data:` URLs, deduped
 * (issue types repeat heavily across contributing issues, so many targets share
 * one icon). Already-inlined `data:` URLs and nulls are skipped. Failures are
 * omitted so the caller keeps the original URL (UI then shows the diamond).
 */
export async function inlineIssueTypeIcons(
  urls: ReadonlyArray<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter((u): u is string => !!u && !u.startsWith('data:')))];
  const resolved = await Promise.all(unique.map(async (u) => [u, await fetchIconDataUrl(u)] as const));
  const map = new Map<string, string>();
  for (const [u, data] of resolved) if (data) map.set(u, data);
  return map;
}

/**
 * `fetchIconDataUrl`, once per resolver invocation per URL (spec 11 · 07: the
 * picker's icons are fetched once per distinct type, never per KPI). An
 * already-inlined or missing URL is returned as is.
 */
export function inlineIconOnce(iconUrl: string | null | undefined): Promise<string | null> {
  if (!iconUrl) return Promise.resolve(null);
  if (iconUrl.startsWith('data:')) return Promise.resolve(iconUrl);
  return perInvocation(`icon:${iconUrl}`, () => fetchIconDataUrl(iconUrl));
}

/** Direct children of an issue via JQL `parent = X`. */
export async function fetchChildren(issueId: string): Promise<string[]> {
  const res = await asUser()
    .requestJira(route`/rest/api/3/search/jql?jql=parent=${issueId}&fields=id&maxResults=100`);
  if (!res.ok) return [];
  const data = (await res.json()) as { issues?: Array<{ id: string }> };
  return (data.issues ?? []).map((i) => i.id);
}

/**
 * Bulk-fetch issue meta (parent id, type, dates, status) for MANY issues at
 * once via `id in (...)` JQL, chunked at BATCH_SIZE — the same batching
 * bitovi/jira-timeline-report uses instead of one `fetchIssueMeta` GET per
 * issue. Unresolvable/deleted ids are simply absent from the returned map.
 */
export async function fetchIssuesByIds(
  issueIds: string[],
  selection: DateFieldSelection = DEFAULT_DATE_SELECTION,
): Promise<Map<string, IssueParentInfo>> {
  const out = new Map<string, IssueParentInfo>();
  const unique = [...new Set(issueIds)];
  if (unique.length === 0) return out;
  const fieldList = metaFieldList(selection);
  await Promise.all(
    chunkArray(unique, BATCH_SIZE).map(async (batch) => {
      const jql = `id in (${batch.join(',')})`;
      const res = await asUser()
        .requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldList}&maxResults=100`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        issues?: Array<{ id: string; key: string; fields?: RawMetaFields }>;
      };
      for (const issue of data.issues ?? []) {
        out.set(String(issue.id), toIssueMeta(issue.key, issue.fields, selection));
      }
    }),
  );
  return out;
}

/**
 * Bulk-fetch direct children for MANY parent issues in one batched call per
 * BATCH_SIZE parents (`parent in (...)` JQL) instead of one `fetchChildren`
 * JQL `parent = X` search PER parent — the exact level-batching pattern
 * bitovi/jira-timeline-report uses to descend a hierarchy one level at a time.
 * Children are grouped by `fields.parent.id` client-side, since a single
 * `in (...)` response doesn't otherwise indicate which clause matched.
 */
export async function fetchChildrenForIds(parentIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(parentIds)];
  if (unique.length === 0) return out;
  await Promise.all(
    chunkArray(unique, BATCH_SIZE).map(async (batch) => {
      const jql = `parent in (${batch.join(',')})`;
      const res = await asUser()
        .requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=id,parent&maxResults=1000`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        issues?: Array<{ id: string; fields?: { parent?: { id: string } } }>;
      };
      for (const issue of data.issues ?? []) {
        const parentId = issue.fields?.parent?.id;
        if (!parentId) continue;
        const list = out.get(parentId) ?? [];
        list.push(String(issue.id));
        out.set(parentId, list);
      }
    }),
  );
  return out;
}

export interface KpiIssue {
  id: string;
  key: string;
  name: string;
  /** the KPI's space (its own `project` field) */
  space: KpiSpaceRef | null;
  /** the parent KPI: the lowest-id hierarchy link to a loaded KPI (spec 11 · 06); null = top-level */
  parentId: string | null;
  /**
   * Every hierarchy link to a parent KPI (loaded, or of the KPI work type),
   * lowest link id first. More than one breaks the one-parent rule and is
   * flagged (KPI View).
   */
  parentLinks: Array<{ id: string; key: string | null }>;
  /** Native LexoRank value for sibling ordering (null if the field is absent). */
  rank: string | null;
  /** the work type's icon URL as Jira returns it (not inlined) */
  typeIconUrl: string | null;
  /** hierarchy links to its sub-KPIs (spec 11 · 07), lowest link id first */
  childLinks: Array<{ id: string; key: string | null }>;
  /**
   * unit/direction, included in the search: from the KPI fields once chosen,
   * else the `kpi-meta` property (null if unset/invalid); see resolveKpiMeta
   */
  meta: KpiMetaProperty | null;
}

/** What a KPI read needs from the site configuration (spec 11 · 04/05). */
export interface KpiReadConfig {
  /** the KPI work type's id: "is a KPI" (spec 11 · 06) */
  workTypeId: string;
  hierarchy: KpiHierarchyLink | null;
  kpiFields: KpiFieldsConfig | null;
}

/** Narrow a KPI search (all optional; ANDed). */
export interface KpiQuery {
  /** only KPIs in these spaces (project keys) */
  projects?: string[];
  /** only these KPIs (issue ids) */
  ids?: string[];
  /** summary starts-with search (`summary ~ "text*"`) */
  text?: string;
  /** stop after this many KPIs (default: the 50-page cap, 5,000) */
  limit?: number;
}

/** The most KPIs one search returns: 50 pages of 100 (overview Q6, R16: paging the KPI tree comes later). */
export const KPI_SEARCH_CAP = 5000;

/** Best-effort: null if the Rank field can't be found (siblings keep creation order). */
async function getRankFieldId(): Promise<string | null> {
  try {
    return (await getFieldIds()).rank;
  } catch {
    return null;
  }
}

const jqlString = (text: string): string => `"${text.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/** `issuetype = {id}` and the query's narrowing clauses, created ASC. */
export function kpiSearchJql(workTypeId: string, query: KpiQuery = {}): string {
  const clauses = [`issuetype = ${workTypeId}`];
  const projects = (query.projects ?? []).filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k));
  if (query.projects) clauses.push(projects.length > 0 ? `project in (${projects.map(jqlString).join(',')})` : 'id in (0)');
  const ids = (query.ids ?? []).filter(isKpiIssueId);
  if (query.ids) clauses.push(`id in (${ids.length > 0 ? ids.join(',') : '0'})`);
  const text = query.text?.trim();
  if (text) clauses.push(`summary ~ ${jqlString(`${text.replace(/\*+$/, '')}*`)}`);
  return `${clauses.join(' AND ')} ORDER BY created ASC`;
}

type RawKpiIssue = {
  id: string;
  key: string;
  fields?: {
    summary?: string;
    issuelinks?: IssueLinkRef[];
    project?: { id?: string; key?: string; name?: string };
    issuetype?: { id?: string; name?: string; iconUrl?: string };
    [field: string]: unknown;
  };
  properties?: Record<string, unknown>;
};

/** The fields a KPI read asks Jira for. */
function kpiFieldList(rankFieldId: string | null, kpiFields: KpiFieldsConfig | null): string {
  return ['summary', 'issuelinks', 'project', 'issuetype', ...(rankFieldId ? [rankFieldId] : []), ...kpiMetaFieldIds(kpiFields)].join(',');
}

/** A raw KPI issue → KpiIssue, its parent resolved among `loadedIds`. */
function toKpiIssue(
  raw: RawKpiIssue,
  cfg: KpiReadConfig,
  rankFieldId: string | null,
  loadedIds: ReadonlySet<string>,
): KpiIssue {
  const links = kpiParentLinks(raw.fields?.issuelinks, cfg.hierarchy, { loadedIds, workTypeId: cfg.workTypeId });
  return {
    id: String(raw.id),
    key: raw.key,
    name: raw.fields?.summary ?? raw.key,
    space: spaceRefOf(raw.fields?.project),
    parentId: links.find((l) => loadedIds.has(l.parentId))?.parentId ?? null,
    parentLinks: links.map((l) => ({ id: l.parentId, key: l.parentKey })),
    rank: rankFieldId ? ((raw.fields?.[rankFieldId] as string | undefined) ?? null) : null,
    typeIconUrl: raw.fields?.issuetype?.iconUrl ?? null,
    childLinks: kpiChildLinks(raw.fields?.issuelinks, cfg.hierarchy, cfg.workTypeId),
    meta: resolveKpiMeta(cfg.kpiFields, { legacy: raw.properties?.[KPI_META_PROPERTY_KEY], fields: raw.fields }),
  };
}

/**
 * Find KPIs: issues of the KPI work type (`issuetype = {workTypeId}`, spec
 * 11 · 06), in every company-managed space that uses the type, narrowed by
 * `query`. Reads the summary (KPI name), space, issue links (for parent
 * nesting), native rank (sibling order) and the unit/direction (the KPI fields
 * when chosen, else the `kpi-meta` property; both in the search, so no per-KPI
 * GET). Pages up to `query.limit` (default the 5,000-KPI cap).
 *
 * The KPI tree is expressed with issue links of the configured hierarchy type
 * (see resolve/kpiLinks): each KPI's parent is the lowest-id hierarchy link to
 * another KPI this search returned. A parent that isn't returned (outside the
 * query, or one the user can't browse) leaves the KPI top-level. With no
 * hierarchy configured every KPI is a root.
 */
export async function fetchKpis(query: KpiQuery, cfg: KpiReadConfig): Promise<KpiIssue[]> {
  const rankFieldId = await getRankFieldId();
  const fieldList = kpiFieldList(rankFieldId, cfg.kpiFields);
  const jql = kpiSearchJql(cfg.workTypeId, query);
  const limit = Math.min(query.limit ?? KPI_SEARCH_CAP, KPI_SEARCH_CAP);
  const raw: RawKpiIssue[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 50 && raw.length < limit; page += 1) {
    const maxResults = Math.min(100, limit - raw.length);
    // As the USER: Jira applies Browse Projects + issue security, so KPIs the
    // user may not see never reach them (spec 10).
    const res = await asUser()
      .requestJira(
        nextPageToken
          ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldList}&properties=${KPI_META_PROPERTY_KEY}&maxResults=${maxResults}&nextPageToken=${nextPageToken}`
          : route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldList}&properties=${KPI_META_PROPERTY_KEY}&maxResults=${maxResults}`,
      );
    // Fail loudly rather than return a partial list: callers treat a KPI that's
    // absent here as non-existent (the panel's targeted KPIs, the timeline tree).
    if (!res.ok) throw new Error(await jiraError(res, 'list the KPIs'));
    const data = (await res.json()) as { isLast?: boolean; nextPageToken?: string; issues?: RawKpiIssue[] };
    const batch = data.issues ?? [];
    raw.push(...batch);
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  // Resolve parents only after every id is known: a hierarchy link counts only
  // when its parent is a KPI this search returned.
  const kept = raw.slice(0, limit);
  const idSet = new Set(kept.map((r) => String(r.id)));
  return breakParentCycles(kept.map((r) => toKpiIssue(r, cfg, rankFieldId, idSet)));
}

/**
 * One KPI by id or key, AS THE USER, in one GET (no search, so no index lag):
 * what `fetchKpis` returns for it, its parent left unresolved (`parentId`
 * null; `parentLinks` lists its parent KPIs by work type). null when the user
 * can't see it or it isn't of the KPI work type.
 */
export async function fetchKpi(idOrKey: string, cfg: KpiReadConfig): Promise<KpiIssue | null> {
  const found = await lookupIssueAsKpi(idOrKey, cfg);
  return found.kind === 'kpi' ? found.kpi : null;
}

/** An issue as the picker names it: `{type icon} {key} {summary}` (icon not inlined). */
export interface IssueRef {
  id: string;
  key: string;
  summary: string;
  typeName: string;
  typeIconUrl: string | null;
}

/**
 * One issue by id or key AS THE USER (one GET, no index lag; Jira follows a
 * moved issue's old key): a KPI (what `fetchKpis` returns for it, its parent
 * unresolved), another work item, or hidden (404/403: Jira doesn't say which).
 */
export async function lookupIssueAsKpi(
  idOrKey: string,
  cfg: KpiReadConfig,
): Promise<{ kind: 'kpi'; kpi: KpiIssue } | { kind: 'notKpi'; item: IssueRef } | { kind: 'hidden' }> {
  const rankFieldId = await getRankFieldId();
  const fieldList = kpiFieldList(rankFieldId, cfg.kpiFields);
  const res = await asUser()
    .requestJira(route`/rest/api/3/issue/${idOrKey}?fields=${fieldList}&properties=${KPI_META_PROPERTY_KEY}`);
  if (res.status === 404 || res.status === 403) return { kind: 'hidden' };
  if (!res.ok) throw new Error(await jiraError(res, `look up ${idOrKey}`));
  const raw = (await res.json()) as RawKpiIssue;
  if (String(raw.fields?.issuetype?.id ?? '') !== cfg.workTypeId) {
    return {
      kind: 'notKpi',
      item: {
        id: String(raw.id),
        key: raw.key,
        summary: raw.fields?.summary ?? raw.key,
        typeName: raw.fields?.issuetype?.name ?? 'Work item',
        typeIconUrl: raw.fields?.issuetype?.iconUrl ?? null,
      },
    };
  }
  return { kind: 'kpi', kpi: toKpiIssue(raw, cfg, rankFieldId, new Set()) };
}

/** One parent of a work item, as the KPI picker's chain walk reads it (spec 11 · 07). */
export interface ChainIssue extends IssueRef {
  parentId: string | null;
  space: KpiSpaceRef | null;
  assignments: Assignment[];
}

/**
 * Walk a work item's parents to the top (spec 11 · 07 Q4): one
 * `GET /issue/{id}?fields=parent,issuetype,project,summary&properties=kpi-assignments`
 * per level, as the user, nearest first. Stops at `maxDepth`, at a parent seen
 * before (a cycle), at one the user can't see, or at one Jira fails to return.
 */
export async function fetchParentChain(parentId: string | null, maxDepth: number, seen: Iterable<string> = []): Promise<ChainIssue[]> {
  const chain: ChainIssue[] = [];
  const visited = new Set<string>(seen);
  let next = parentId;
  while (next && !visited.has(next) && chain.length < maxDepth) {
    visited.add(next);
    const res = await asUser().requestJira(
      route`/rest/api/3/issue/${next}?fields=parent,issuetype,project,summary&properties=${ASSIGNMENT_PROPERTY_KEY}`,
    );
    if (res.status === 404 || res.status === 403) break;
    if (!res.ok) {
      // The parents read so far still make good suggestions.
      console.warn(`[measure-of-success] ${await jiraError(res, `load parent ${next}`)}`);
      break;
    }
    const data = (await res.json()) as {
      id: string | number;
      key: string;
      fields?: RawMetaFields & { summary?: string; issuetype?: { id?: string; name: string; iconUrl?: string } };
      properties?: Record<string, unknown>;
    };
    visited.add(String(data.id));
    chain.push({
      id: String(data.id),
      key: data.key,
      summary: data.fields?.summary ?? data.key,
      typeName: data.fields?.issuetype?.name ?? 'Work item',
      typeIconUrl: data.fields?.issuetype?.iconUrl ?? null,
      parentId: data.fields?.parent?.id ? String(data.fields.parent.id) : null,
      space: spaceRefOf(data.fields?.project),
      assignments: parseAssignments(data.properties?.[ASSIGNMENT_PROPERTY_KEY]),
    });
    next = data.fields?.parent?.id ? String(data.fields.parent.id) : null;
  }
  return chain;
}

/** One page of the spaces the KPI picker's Space filter lists. */
export const KPI_SPACE_PAGE_SIZE = 50;

/**
 * Spaces the user can browse that can hold KPIs (their work types include the
 * KPI work type, 01 B6), filtered by key or name: one page of
 * `GET /project/search?action=browse&query=…&expand=issueTypes`, as the user.
 */
export async function listKpiSpaces(
  query: string,
  startAt: number,
  workTypeId: string,
): Promise<{ spaces: KpiPickerSpace[]; nextStartAt: number | null }> {
  const res = await asUser().requestJira(
    route`/rest/api/3/project/search?action=browse&query=${query}&expand=issueTypes&orderBy=key&startAt=${startAt}&maxResults=${KPI_SPACE_PAGE_SIZE}`,
  );
  if (!res.ok) throw new Error(await jiraError(res, 'list spaces'));
  const data = (await res.json()) as {
    isLast?: boolean;
    values?: Array<{ key: string; name: string; issueTypes?: Array<{ id?: string | number }> }>;
  };
  const values = data.values ?? [];
  return {
    spaces: values
      .filter((p) => (p.issueTypes ?? []).some((t) => String(t.id ?? '') === workTypeId))
      .map((p) => ({ key: p.key, name: p.name })),
    nextStartAt: data.isLast === false && values.length > 0 ? startAt + values.length : null,
  };
}

/** A runaway guard on `listKpiCreateSpaces` (100 projects a page). */
const CREATE_SPACE_MAX_PAGES = 20;

/**
 * Spaces where the user may create KPIs (spec 11 · 08, 01 B6): `GET
 * /project/search?action=create&expand=issueTypes` as the user lists the
 * projects they have Create Issues in, with their work types; keep those
 * offering the KPI work type. One page on the dev site (~80 projects); paged
 * past 100.
 */
export async function listKpiCreateSpaces(workTypeId: string): Promise<KpiSpaceRef[]> {
  const out: KpiSpaceRef[] = [];
  let startAt = 0;
  for (let n = 0; n < CREATE_SPACE_MAX_PAGES; n += 1) {
    const res = await asUser().requestJira(
      route`/rest/api/3/project/search?action=create&expand=issueTypes&orderBy=name&startAt=${startAt}&maxResults=100`,
    );
    if (!res.ok) throw new Error(await jiraError(res, 'list the spaces you can create KPIs in'));
    const data = (await res.json()) as {
      isLast?: boolean;
      values?: Array<{ id: string | number; key: string; name: string; issueTypes?: Array<{ id?: string | number }> }>;
    };
    const values = data.values ?? [];
    for (const p of values) {
      if ((p.issueTypes ?? []).some((t) => String(t.id ?? '') === workTypeId)) {
        out.push({ id: String(p.id), key: p.key, name: p.name });
      }
    }
    if (data.isLast !== false || values.length === 0) break;
    startAt += values.length;
  }
  return out;
}

/** One contributing issue's KPI targets, plus the fields needed to place them. */
export interface IssueTargetContributions {
  issueId: string;
  issueKey: string;
  issueTypeName: string;
  /** issue type icon URL (Jira `issuetype.iconUrl`), when available */
  issueTypeIconUrl: string | null;
  /** Jira `issuetype.hierarchyLevel` — targets stack within a level (spec 09); null when absent */
  hierarchyLevel: number | null;
  title: string;
  /** the issue's own due date — anchor for `issueDueDate` relative timing */
  ownDue: string | null;
  parentId: string | null;
  assignments: Assignment[];
}

export interface TargetContributions {
  issues: IssueTargetContributions[];
  /** parentId → parent's key + own due, for resolving `parentDueDate` anchors */
  parentById: Map<string, { key: string; due: string | null }>;
}

/**
 * JQL that finds every issue carrying a KPI target, via the denormalized id
 * index (spec 11 · 03). Not `kpiIds`: that's the customer's app's (keys), and
 * goes away in the cleanup release.
 */
const ASSIGNMENT_INDEX_JQL = 'issue.property[kpi-assignments].kpiIssueIds IS NOT EMPTY';

/** Exactly the issues targeting one KPI (03's exact lookup, 01 D3: no tokenising). */
const targetsOfKpiJql = (kpiId: string): string => `issue.property[kpi-assignments].kpiIssueIds = "${kpiId}"`;

/**
 * Discover every issue that has authored a KPI target — in ONE JQL query against
 * the denormalized `kpiIssueIds` search index, and let the caller group the
 * assignments by KPI (id) in memory. This deliberately avoids a per-KPI query
 * fan-out.
 *
 * The search asks Jira to include each issue's `kpi-assignments` property in the
 * results (`properties=`), so the targets arrive WITH the issues — no per-issue
 * property request (spec 06 P1). Pages may hold fewer than 100 issues when
 * properties are included, so paging follows `nextPageToken` until `isLast`.
 *
 * Caveat: only finds issues whose targets carry KPI ids — saved by this version
 * or migrated (`kpi-target-refs-to-ids`). Before the migration runs, older
 * targets aren't discovered (spec 11, Compatibility). Only id references are
 * returned: a deleted KPI's key-only reference has nothing to show under.
 *
 * Given `kpiId`, only the issues targeting that KPI (`kpiIssueIds = "{id}"`,
 * a KPI's own panel, spec 11 · 06), and only their targets on it.
 *
 * Live-only: exercised via `forge tunnel` / `npm run test:e2e`; the mock harness
 * bakes targets into fixtures instead. Non-throwing — a failed search yields no
 * targets rather than crashing the timeline.
 */
export async function fetchTargetContributions(kpiId?: string): Promise<TargetContributions> {
  const fieldList = ['summary', 'issuetype', 'parent', 'duedate'].join(',');
  const jql = kpiId ? targetsOfKpiJql(kpiId) : ASSIGNMENT_INDEX_JQL;
  interface Raw {
    id: string;
    key: string;
    issueTypeName: string;
    issueTypeIconUrl: string | null;
    hierarchyLevel: number | null;
    title: string;
    ownDue: string | null;
    parentId: string | null;
    assignments: Assignment[];
  }
  const raw: Raw[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const res = await asUser()
      .requestJira(
        nextPageToken
          ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldList}&properties=${ASSIGNMENT_PROPERTY_KEY}&maxResults=100&nextPageToken=${nextPageToken}`
          : route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldList}&properties=${ASSIGNMENT_PROPERTY_KEY}&maxResults=100`,
      );
    if (!res.ok) break;
    const data = (await res.json()) as {
      isLast?: boolean;
      nextPageToken?: string;
      issues?: Array<{
        id: string;
        key: string;
        fields?: {
          summary?: string;
          duedate?: string | null;
          issuetype?: { name?: string; iconUrl?: string; hierarchyLevel?: number };
          parent?: { id?: string | number };
        };
        properties?: Record<string, unknown>;
      }>;
    };
    const batch = data.issues ?? [];
    for (const i of batch) {
      raw.push({
        id: String(i.id),
        key: i.key,
        issueTypeName: i.fields?.issuetype?.name ?? 'Unknown',
        issueTypeIconUrl: i.fields?.issuetype?.iconUrl ?? null,
        hierarchyLevel: i.fields?.issuetype?.hierarchyLevel ?? null,
        title: i.fields?.summary ?? i.key,
        ownDue: i.fields?.duedate ?? null,
        parentId: i.fields?.parent?.id != null ? String(i.fields.parent.id) : null,
        assignments: parseAssignments(i.properties?.[ASSIGNMENT_PROPERTY_KEY]).filter((a) =>
          kpiId ? a.kpiId === kpiId : isKpiIssueId(a.kpiId),
        ),
      });
    }
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  const issues: IssueTargetContributions[] = raw.map((r) => ({
    issueId: r.id,
    issueKey: r.key,
    issueTypeName: r.issueTypeName,
    issueTypeIconUrl: r.issueTypeIconUrl,
    hierarchyLevel: r.hierarchyLevel,
    title: r.title,
    ownDue: r.ownDue,
    parentId: r.parentId,
    assignments: r.assignments,
  }));

  // Resolve each distinct parent's OWN due (for `parentDueDate` anchors),
  // reusing dates already fetched as contributing issues before re-querying Jira.
  const ownById = new Map(raw.map((r) => [r.id, { key: r.key, due: r.ownDue }]));
  const parentById = new Map<string, { key: string; due: string | null }>();
  const toFetch: string[] = [];
  for (const pid of new Set(raw.map((r) => r.parentId).filter((p): p is string => p !== null))) {
    const known = ownById.get(pid);
    if (known) parentById.set(pid, known);
    else toFetch.push(pid);
  }
  const fetched = await fetchIssuesByIds(toFetch);
  for (const pid of toFetch) {
    const meta = fetched.get(pid);
    if (meta) parentById.set(pid, { key: meta.issueKey, due: meta.ownDueDate });
  }

  return { issues, parentById };
}


/**
 * Build the timing-node map for the subtrees rooted at `rootIds` (each root's
 * own dates plus all its descendants), so `effectiveTiming` can roll up due
 * dates for each root from the SAME shared map. Descends level-by-level,
 * batch-fetching every node still in the frontier via `fetchIssuesByIds` /
 * `fetchChildrenForIds` (BATCH_SIZE ids per call) instead of one call per
 * node — the level-batching pattern bitovi/jira-timeline-report uses.
 *
 * Multiple roots share ONE traversal: a node reachable from more than one
 * root (e.g. a common ancestor) is fetched once, whichever root reaches it
 * first — safe because `TimingNode` carries no depth/root info, and
 * `effectiveTiming(rootId, nodes, ...)` recurses structurally via `childIds`,
 * not via how the map was populated. `depth` below is purely a traversal
 * safety cap (MAX_DEPTH), not per-root bookkeeping.
 */
export async function fetchSubtreeTimingNodesForRoots(
  rootIds: string[],
  selection: DateFieldSelection = DEFAULT_DATE_SELECTION,
): Promise<Map<string, TimingNode>> {
  const nodes = new Map<string, TimingNode>();
  let frontier = [...new Set(rootIds)];
  let depth = 0;
  while (frontier.length > 0 && depth <= MAX_DEPTH) {
    const unvisited = frontier.filter((id) => !nodes.has(id));
    if (unvisited.length === 0) break;
    const [metaById, childrenById] = await Promise.all([
      fetchIssuesByIds(unvisited, selection),
      fetchChildrenForIds(unvisited),
    ]);
    const nextFrontier: string[] = [];
    for (const id of unvisited) {
      const meta = metaById.get(id);
      if (!meta) continue; // unresolvable/deleted issue — skip, same as the old per-node guard
      const childIds = childrenById.get(id) ?? [];
      nodes.set(id, {
        id,
        issueKey: meta.issueKey,
        issueTypeName: meta.issueTypeName,
        hierarchyLevel: meta.hierarchyLevel,
        ownStart: meta.ownStart,
        ownDue: meta.ownDueDate,
        childIds,
      });
      nextFrontier.push(...childIds);
    }
    frontier = nextFrontier;
    depth += 1;
  }
  return nodes;
}

/**
 * Single-root convenience wrapper around `fetchSubtreeTimingNodesForRoots`,
 * kept for callers (and `test-e2e/jira-api.e2e.ts`) that only need one
 * subtree.
 */
export async function fetchSubtreeTimingNodes(
  issueId: string,
  selection: DateFieldSelection = DEFAULT_DATE_SELECTION,
): Promise<Map<string, TimingNode>> {
  return fetchSubtreeTimingNodesForRoots([issueId], selection);
}

/**
 * Discover the hierarchy levels ordered deepest-parent → leaf, from the site's
 * issue-type hierarchy configuration (never hardcoded — Constitution §6). Each
 * level lists EVERY issue type at it (e.g. Milestone and Increment), since
 * rollup settings are per level, not per type.
 */
export async function fetchHierarchyLevels(): Promise<HierarchyLevel[]> {
  const res = await asApp().requestJira(route`/rest/api/3/issuetype`);
  if (!res.ok) return [];
  const types = (await res.json()) as Array<{ name: string; hierarchyLevel?: number }>;
  const namesByLevel = new Map<number, string[]>();
  for (const t of types) {
    const level = t.hierarchyLevel ?? 0;
    const names = namesByLevel.get(level) ?? [];
    // Team-managed projects repeat type names (one "Epic" per project).
    if (!names.includes(t.name)) names.push(t.name);
    namesByLevel.set(level, names);
  }
  // higher hierarchyLevel = closer to the top (deepest parent) → leaf last
  return [...namesByLevel.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([level, names]) => {
      const name = pickLevelName(level, names);
      return { level, name, issueTypeNames: [name, ...names.filter((n) => n !== name)] };
    });
}

/**
 * Choose the single representative issue-type name for a hierarchy level. The
 * base level (0) usually has several types (Story, Task, Bug, Goal, …) — prefer
 * "Story", then "Task", otherwise fall back to the first the API returned.
 */
function pickLevelName(level: number, names: string[]): string {
  if (level === 0) {
    const preferred =
      names.find((n) => n.toLowerCase() === 'story') ??
      names.find((n) => n.toLowerCase() === 'task');
    if (preferred) return preferred;
  }
  return names[0];
}

/** Walk up the parent chain, collecting (issueKey, assignments) nearest first. */
export async function fetchAncestorChain(
  issueId: string,
): Promise<Array<{ issueKey: string; assignments: Assignment[] }>> {
  const chain: Array<{ issueKey: string; assignments: Assignment[] }> = [];
  const seen = new Set<string>([issueId]);
  let current = await fetchIssueMeta(issueId);
  let depth = 0;
  while (current.parentId && !seen.has(current.parentId) && depth < MAX_DEPTH) {
    seen.add(current.parentId);
    const [meta, assignments] = await Promise.all([
      fetchIssueMeta(current.parentId),
      fetchAssignments(current.parentId),
    ]);
    chain.push({ issueKey: meta.issueKey, assignments });
    current = meta;
    depth += 1;
  }
  return chain;
}

// ── Current user's permissions (spec 10) ─────────────────────────────────────

type MyPermissions = { permissions?: Record<string, { havePermission?: boolean }> };
type JiraRoute = ReturnType<typeof route>;

/**
 * The permission lookup itself failed (rate limit, outage, missing project) —
 * which says nothing about what the user may do. Distinct from a "no".
 */
export class PermissionLookupError extends Error {}

/** `GET /mypermissions` as the user; throws `PermissionLookupError` when the call fails. */
async function fetchMyPermissions(path: JiraRoute): Promise<MyPermissions> {
  let res: Awaited<ReturnType<ReturnType<typeof asUser>['requestJira']>>;
  try {
    res = await asUser().requestJira(path);
  } catch (error) {
    console.warn('[measure-of-success] permission lookup failed', error);
    throw new PermissionLookupError(`Couldn't check your Jira permissions: ${String(error)}`);
  }
  if (!res.ok) {
    const message = await jiraError(res, 'check your permissions');
    console.warn(`[measure-of-success] ${message}`);
    throw new PermissionLookupError(message);
  }
  return (await res.json()) as MyPermissions;
}

const has = (body: MyPermissions, key: string): boolean => body.permissions?.[key]?.havePermission === true;

/**
 * What the current user may do in ONE space holding KPIs (a project key or id)
 * — one `asUser` call (spec 10; per space since spec 11 · 06). Throws
 * `PermissionLookupError` when Jira can't answer; callers then rely on Jira's
 * own enforcement instead of guessing "no access".
 */
export async function fetchKpiAccess(project: string): Promise<KpiSpaceAccess> {
  const body = await fetchMyPermissions(
    /^\d+$/.test(project)
      ? route`/rest/api/3/mypermissions?projectId=${project}&permissions=BROWSE_PROJECTS,CREATE_ISSUES,EDIT_ISSUES,LINK_ISSUES`
      : route`/rest/api/3/mypermissions?projectKey=${project}&permissions=BROWSE_PROJECTS,CREATE_ISSUES,EDIT_ISSUES,LINK_ISSUES`,
  );
  return {
    browse: has(body, 'BROWSE_PROJECTS'),
    create: has(body, 'CREATE_ISSUES'),
    edit: has(body, 'EDIT_ISSUES'),
    link: has(body, 'LINK_ISSUES'),
  };
}

/** Whether the current user has the global Administer Jira permission; throws `PermissionLookupError` on failure. */
export async function fetchIsJiraAdmin(): Promise<boolean> {
  return has(await fetchMyPermissions(route`/rest/api/3/mypermissions?permissions=ADMINISTER`), 'ADMINISTER');
}

// ── KPI space provisioning (storage-model.md) ────────────────────────────────

/**
 * Turn a failed Jira response into a readable Error message. Jira returns
 * `{ errorMessages: [...], errors: {...} }` on 4xx/5xx — surface that instead of
 * letting a downstream `undefined` produce an opaque platform error.
 */
type JiraResponse = { status: number; json(): Promise<unknown>; text(): Promise<string> };
export async function jiraError(res: JiraResponse, action: string): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
    };
    detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join('; ');
  } catch {
    detail = await res.text().catch(() => '');
  }
  return `Jira ${res.status} while trying to ${action}${detail ? `: ${detail}` : ''}`;
}

export interface ProjectInfo {
  id: string;
  key: string;
  name: string;
  /** issue-type names available in the project (via `expand=issueTypes`) */
  issueTypeNames: string[];
  /** the same types' ids */
  issueTypeIds: string[];
}

/** Look up a project (+ its issue types) by key or id; null if it doesn't exist. */
export async function findProject(keyOrId: string): Promise<ProjectInfo | null> {
  const res = await asApp().requestJira(route`/rest/api/3/project/${keyOrId}?expand=issueTypes`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await jiraError(res, `look up project "${keyOrId}"`));
  const p = (await res.json()) as {
    id: string | number;
    key?: string;
    name: string;
    issueTypes?: Array<{ id?: string | number; name: string }>;
  };
  return {
    id: String(p.id),
    key: p.key ?? keyOrId,
    name: p.name,
    issueTypeNames: (p.issueTypes ?? []).map((t) => t.name),
    issueTypeIds: (p.issueTypes ?? []).map((t) => String(t.id ?? '')).filter(Boolean),
  };
}

/** Look up a project (+ its issue types) by key; null if it doesn't exist. */
export async function findProjectByKey(key: string): Promise<ProjectInfo | null> {
  return findProject(key);
}

/**
 * Create the KPI project shell for `key`, led by `leadAccountId` (the invoking
 * admin, from the resolver context). Runs AS THE USER (spec 10): Jira itself
 * requires Administer Jira, on top of the Settings-page + admin checks in the
 * resolver. The `KPI` issue type is provisioned and associated separately by
 * `ensureKpiIssueTypeOnProject`; the reading field is installed globally by the
 * manifest `jira:customField` module.
 */
export async function createKpiProject(
  key: string,
  leadAccountId: string,
): Promise<{ id: string; name: string }> {
  const name = `KPIs (${key})`;
  const res = await asUser().requestJira(route`/rest/api/3/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, name, projectTypeKey: 'software', leadAccountId }),
  });
  if (!res.ok) throw new Error(await jiraError(res, `create project "${key}"`));
  const p = (await res.json()) as { id: string | number };
  return { id: String(p.id), name };
}

/** The KPI work type's name on an install that hasn't chosen one (spec 11 · 04: `DEFAULT_KPI_WORK_TYPE_NAME`). */
export const KPI_ISSUE_TYPE = 'KPI';

export interface SiteIssueType {
  id: string;
  name: string;
  iconUrl: string | null;
  subtask: boolean;
  hierarchyLevel: number | null;
  /** set for a team-managed space's own type */
  projectScoped: boolean;
}

/** Every issue type on the site, read once per invocation (as the app). */
export function listIssueTypes(): Promise<SiteIssueType[]> {
  return perInvocation('issueTypes', async () => {
    const res = await asApp().requestJira(route`/rest/api/3/issuetype`);
    if (!res.ok) throw new Error(await jiraError(res, 'list issue types'));
    const types = (await res.json()) as Array<{
      id: string | number;
      name: string;
      iconUrl?: string;
      subtask?: boolean;
      hierarchyLevel?: number;
      scope?: { type?: string };
    }>;
    return types.map((t) => ({
      id: String(t.id),
      name: t.name,
      iconUrl: t.iconUrl ?? null,
      subtask: t.subtask === true,
      hierarchyLevel: typeof t.hierarchyLevel === 'number' ? t.hierarchyLevel : null,
      projectScoped: t.scope?.type === 'PROJECT',
    }));
  });
}

/** After creating or changing a type, so the next `listIssueTypes` sees it. */
export function forgetIssueTypes(): void {
  forgetPerInvocation('issueTypes');
}

/**
 * Ensure the KPI work type is in the given project's issue-type scheme, so KPI
 * issues can be created in it. Company-managed only — team-managed projects
 * don't expose a classic scheme. Returns false when it was already there.
 */
export async function ensureKpiIssueTypeOnProject(
  projectId: string,
  workType: { id: string; name: string },
): Promise<boolean> {
  if ((await findProject(projectId))?.issueTypeIds.includes(workType.id)) return false;
  const schemeRes = await asApp()
    .requestJira(route`/rest/api/3/issuetypescheme/project?projectId=${projectId}`);
  if (!schemeRes.ok) throw new Error(await jiraError(schemeRes, 'read the project issue-type scheme'));
  const body = (await schemeRes.json()) as {
    values?: Array<{ issueTypeScheme?: { id: string } }>;
  };
  const schemeId = body.values?.[0]?.issueTypeScheme?.id;
  if (!schemeId) {
    throw new Error(
      'No issue-type scheme found for this project. Team-managed projects cannot hold KPIs — use a company-managed project.',
    );
  }
  // Write as the USER (Administer Jira, spec 10); the scheme read above stays asApp.
  const addRes = await asUser()
    .requestJira(route`/rest/api/3/issuetypescheme/${schemeId}/issuetype`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueTypeIds: [workType.id] }),
    });
  // 204 on success; a type already in the scheme is a harmless 409.
  if (addRes.status === 409) return false;
  if (!addRes.ok) {
    throw new Error(await jiraError(addRes, `add the "${workType.name}" work type to the project`));
  }
  return true;
}

/**
 * Create a KPI: an issue of the KPI work type (by id) in the space `projectId`
 * (spec 11 · 06: required; no default space). Nesting under `parentKpiId` (an
 * issue id, in any space) uses an issue LINK of the configured `hierarchy`
 * type, because Jira forbids a standard issue from being the native `parent`
 * of another standard issue. Nesting without a configured hierarchy throws
 * before anything is created. Unit/direction go in the create request itself
 * (spec 11 · 05): the KPI fields when they're chosen (`kpiFields`), plus the
 * `kpi-meta` property, marked `fields: true` then, for the customer's report.
 * With `kpiFields: null`, only `kpi-meta` (unmarked), as before. The summary
 * carries the KPI name.
 */
export async function createKpiIssue(
  projectId: string,
  input: Omit<CreateKpiInput, 'projectId'>,
  hierarchy: KpiHierarchyLink | null,
  workType: { id: string } | null,
  kpiFields: KpiFieldsConfig | null = null,
): Promise<CreatedKpi> {
  if (!projectId) throw new Error(`${KPI_SPACE_REQUIRED}.`);
  if (!workType) throw new Error(`${KPI_WORK_TYPE_NOT_SET_UP} — choose one in Settings first.`);
  if (input.parentKpiId && !hierarchy) {
    throw new Error(`${KPI_HIERARCHY_NOT_SET_UP} — choose how KPIs nest in Settings first.`);
  }
  const name = input.name.trim() || 'Untitled KPI';
  const meta: KpiMetaProperty = KpiMetaProperty.parse({
    unit: input.unit.trim(),
    direction: input.direction ?? null,
  });
  const write = kpiMetaCreate(kpiFields, meta);
  const fields: Record<string, unknown> = {
    project: { id: projectId },
    // The configured KPI work type (spec 11 · 04/06); an install that hasn't saved one derives the type named KPI.
    issuetype: { id: workType.id },
    summary: name,
    ...write.fields,
  };
  // As the USER: Jira requires Create Issues in the KPI's space (spec 10).
  const res = await asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, properties: [{ key: KPI_META_PROPERTY_KEY, value: write.meta }] }),
  });
  // Surface Jira's rejection instead of returning `{ key: undefined }` — a
  // swallowed 4xx here is the same silent-failure class fixed in `writeReading`.
  if (!res.ok) {
    throw new Error(await jiraError(res, `create KPI issue "${input.name}"`));
  }
  const created = (await res.json()) as { id: string; key: string };
  const parentKpiId = input.parentKpiId ?? null;
  // The link can't ride in the create request: Jira silently drops
  // `update.issuelinks` there (verified by the live E2E). So undo the create if
  // the link fails. Otherwise an orphan root KPI is left behind, and retrying the
  // (still open) modal would create a duplicate.
  if (parentKpiId) {
    try {
      await linkKpiParent(hierarchy as KpiHierarchyLink, parentKpiId, created.key);
    } catch (err) {
      await deleteIssue(created.key).catch(() => {
        throw new Error(`${(err as Error).message}. ${created.key} was created without its parent; delete it in Jira.`);
      });
      throw err;
    }
  }
  return {
    id: String(created.id),
    kpiId: String(created.id),
    issueKey: created.key,
    name,
    unit: meta.unit,
    direction: meta.direction ?? null,
    parentKpiId,
  };
}

/**
 * Link a child KPI to its parent (each an issue id or key) with the configured
 * hierarchy link type; the body puts each issue on the end
 * `parentFromIssueLinks` reads it back from.
 */
export async function linkKpiParent(
  hierarchy: KpiHierarchyLink,
  parentKpi: string,
  childKpi: string,
): Promise<void> {
  // As the USER: Jira requires Link Issues (spec 10).
  const res = await asUser().requestJira(route`/rest/api/3/issueLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(kpiParentLinkBody(hierarchy, parentKpi, childKpi)),
  });
  // 201 on success. Surface failures so a broken nest doesn't look like a no-op.
  if (!res.ok) {
    throw new Error(await jiraError(res, `link KPI "${childKpi}" under "${parentKpi}"`));
  }
}

/** Remove an issue link by id (moving a KPI off its old parent). Already gone counts as done. */
export async function deleteIssueLink(linkId: string): Promise<void> {
  // As the USER: Jira requires Link Issues (spec 10).
  const res = await asUser().requestJira(route`/rest/api/3/issueLink/${linkId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(await jiraError(res, `remove issue link ${linkId}`));
}

/** A KPI issue as the edit flow needs it: where it lives, its current definition and links. */
export interface KpiIssueForEdit {
  id: string;
  key: string;
  projectKey: string | null;
  /** the KPI's space */
  project: KpiSpaceRef | null;
  /** its work type id ("is a KPI", spec 11 · 06) */
  typeId: string | null;
  name: string;
  /** unit/direction as the app reads them (resolveKpiMeta) */
  meta: KpiMetaProperty | null;
  /** the `kpi-meta` property exactly as stored (undefined when absent): edits rewrite it from this */
  storedMeta: unknown;
  links: IssueLinkRef[];
}

/**
 * Look up a KPI issue AS THE USER for editing (name, unit/direction from the
 * KPI fields and `kpi-meta`, issue links) in one GET. null when the user can't
 * see it (Jira's 404/403).
 */
export async function fetchKpiIssueForEdit(
  idOrKey: string,
  kpiFields: KpiFieldsConfig | null = null,
): Promise<KpiIssueForEdit | null> {
  const fieldList = ['project', 'issuetype', 'summary', 'issuelinks', ...kpiMetaFieldIds(kpiFields)].join(',');
  const res = await asUser()
    .requestJira(route`/rest/api/3/issue/${idOrKey}?fields=${fieldList}&properties=${KPI_META_PROPERTY_KEY}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(await jiraError(res, `look up ${idOrKey}`));
  const body = (await res.json()) as {
    id: string;
    key: string;
    fields?: {
      project?: { id?: string; key?: string; name?: string };
      issuetype?: { id?: string };
      summary?: string;
      issuelinks?: IssueLinkRef[];
      [field: string]: unknown;
    };
    properties?: Record<string, unknown>;
  };
  const storedMeta = body.properties?.[KPI_META_PROPERTY_KEY];
  return {
    id: String(body.id),
    key: body.key,
    projectKey: body.fields?.project?.key ?? null,
    project: spaceRefOf(body.fields?.project),
    typeId: body.fields?.issuetype?.id ? String(body.fields.issuetype.id) : null,
    name: body.fields?.summary ?? body.key,
    meta: resolveKpiMeta(kpiFields, { legacy: storedMeta, fields: body.fields }),
    storedMeta,
    links: body.fields?.issuelinks ?? [],
  };
}

/**
 * Save a KPI's name (the summary) and/or unit + direction in ONE issue edit, as
 * the USER so Jira requires Edit Issues and History names them. `fields` are
 * the changed KPI fields and `meta` the whole `kpi-meta` property to store
 * (kpiMetaWrite builds both); Jira's edit issue request also sets issue
 * properties, so they can't be half-saved (01 A6). A 403 becomes
 * `JiraForbiddenError` so the resolver can say which permission is missing.
 */
export async function updateKpiDefinition(
  kpiIssueId: string,
  change: { name?: string; fields?: Record<string, unknown>; meta?: Record<string, unknown> },
): Promise<void> {
  if (change.name === undefined && change.meta === undefined && !Object.keys(change.fields ?? {}).length) return;
  const res = await asUser().requestJira(route`/rest/api/3/issue/${kpiIssueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Jira rejects an edit without `fields` or `update`, even when it only sets properties.
      fields: { ...(change.name !== undefined ? { summary: change.name } : {}), ...change.fields },
      ...(change.meta !== undefined ? { properties: [{ key: KPI_META_PROPERTY_KEY, value: change.meta }] } : {}),
    }),
  });
  if (res.status === 403) throw new JiraForbiddenError(await jiraError(res, `edit KPI ${kpiIssueId}`));
  if (!res.ok) throw new Error(await jiraError(res, `edit KPI ${kpiIssueId}`));
}

/** Every issue link type on the site (link types are global, not per project). */
export async function listIssueLinkTypes(): Promise<IssueLinkTypeInfo[]> {
  const res = await asApp().requestJira(route`/rest/api/3/issueLinkType`);
  if (!res.ok) throw new Error(await jiraError(res, 'list issue link types'));
  const body = (await res.json()) as { issueLinkTypes?: Array<Partial<IssueLinkTypeInfo> & { id: string | number }> };
  return (body.issueLinkTypes ?? []).map((t) => ({
    id: String(t.id),
    name: t.name ?? '',
    inward: t.inward ?? '',
    outward: t.outward ?? '',
  }));
}

/**
 * Find (by name) or create the app's own `KPI Hierarchy` link type. Reusing a
 * same-named type keeps this idempotent across reinstalls; a type of that name
 * created by someone else is used as-is with its own labels.
 */
export async function ensureKpiHierarchyLinkType(): Promise<IssueLinkTypeInfo> {
  const existing = (await listIssueLinkTypes()).find(
    (t) => t.name.toLowerCase() === DEFAULT_KPI_LINK_TYPE.name.toLowerCase(),
  );
  if (existing) {
    // Adopting it would store a hierarchy nobody can read the direction of — the
    // same rule `saveKpiHierarchy` enforces. Jira won't allow a second type with
    // this name, so the admin has to rename or fix the existing one.
    if (!isDirectionalLinkType(existing)) {
      throw new Error(
        `The existing "${existing.name}" link type reads "${existing.outward}" both ways, so it can't tell a parent KPI from a child. Rename it or give its two ends different labels, then try again.`,
      );
    }
    return existing;
  }
  // Write as the USER (Administer Jira, spec 10); listing link types stays asApp.
  const res = await asUser().requestJira(route`/rest/api/3/issueLinkType`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DEFAULT_KPI_LINK_TYPE.name,
      inward: DEFAULT_KPI_LINK_TYPE.inward,
      outward: DEFAULT_KPI_LINK_TYPE.outward,
    }),
  });
  if (!res.ok) {
    throw new Error(await jiraError(res, `create the "${DEFAULT_KPI_LINK_TYPE.name}" issue link type`));
  }
  const t = (await res.json()) as Partial<IssueLinkTypeInfo> & { id: string | number };
  return {
    id: String(t.id),
    name: t.name ?? DEFAULT_KPI_LINK_TYPE.name,
    inward: t.inward ?? DEFAULT_KPI_LINK_TYPE.inward,
    outward: t.outward ?? DEFAULT_KPI_LINK_TYPE.outward,
  };
}

/**
 * Delete an issue (used to roll back a half-created KPI). Stays `asApp` on
 * purpose (spec 10): Delete Issues is usually admin-only, so an `asUser` rollback
 * would fail and leave the orphan it exists to prevent. It only ever deletes the
 * key the user's own create call just returned.
 */
async function deleteIssue(issueKey: string): Promise<void> {
  const res = await asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(await jiraError(res, `delete issue ${issueKey}`));
}

/**
 * Sort the targeted KPIs the panel's KPI search didn't return (KPI ids, spec 11 · 03) into:
 * - `deleted`: the app can't find them either (404 asApp) — gone from Jira. A
 *   key-only reference is deleted without a request: after the migration, those
 *   are the only key-only references left;
 * - `noAccess`: they exist, but the user may not see them (404 asUser).
 * Anything else is just too new for the search index and is in neither list.
 * `keys` has the current key of every one the app found, for its label. The app lookup is needed because `asUser` alone answers 404 for
 * both cases; a transient error counts as "exists" so a hiccup never offers to
 * remove a target on a live KPI.
 */
export async function classifyUnlistedKpis(
  kpiIds: string[],
): Promise<{ deleted: string[]; noAccess: string[]; keys: Record<string, string> }> {
  const unique = [...new Set(kpiIds)];
  const keys: Record<string, string> = {};
  const results = await Promise.all(
    unique.map(async (id): Promise<'deleted' | 'noAccess' | null> => {
      if (!isKpiIssueId(id)) return 'deleted';
      const appRes = await asApp().requestJira(route`/rest/api/3/issue/${id}?fields=summary`);
      if (appRes.status === 404) return 'deleted';
      if (appRes.ok) {
        const key = ((await appRes.json()) as { key?: string }).key;
        if (key) keys[id] = key;
      }
      const userRes = await asUser().requestJira(route`/rest/api/3/issue/${id}?fields=summary`);
      return userRes.status === 404 || userRes.status === 403 ? 'noAccess' : null;
    }),
  );
  return {
    deleted: unique.filter((_, i) => results[i] === 'deleted'),
    noAccess: unique.filter((_, i) => results[i] === 'noAccess'),
    keys,
  };
}

/**
 * Resolve KPI keys to issues, for the `kpi-target-refs-to-ids` migration only
 * (reads never resolve keys). One `GET /issue/{key}` per distinct key, with
 * `jira` AS THE APP: Jira follows a moved issue's old key (01 D1), and a KPI the
 * admin can't see still gets its id stored. `missing` = 404 (a deleted KPI);
 * `errors` = any other failure, so the caller fails those items instead of
 * treating a hiccup as a deletion.
 */
export async function resolveKpiKeys(
  keys: string[],
  jira: { requestJira: RequestJira } = asApp(),
): Promise<{ found: Map<string, { id: string; key: string }>; missing: Set<string>; errors: Map<string, string> }> {
  const found = new Map<string, { id: string; key: string }>();
  const missing = new Set<string>();
  const errors = new Map<string, string>();
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      try {
        const res = await jira.requestJira(route`/rest/api/3/issue/${key}?fields=issuetype`);
        if (res.status === 404) missing.add(key);
        else if (!res.ok) errors.set(key, await jiraError(res, `look up ${key}`));
        else {
          const body = (await res.json()) as { id: string | number; key: string };
          found.set(key, { id: String(body.id), key: body.key });
        }
      } catch (error) {
        errors.set(key, error instanceof Error ? error.message : String(error));
      }
    }),
  );
  return { found, missing, errors };
}

/**
 * Read a KPI's unit/direction (null if unset, or the KPI can't be read): the
 * KPI fields once chosen, else the `kpi-meta` property (resolveKpiMeta). One GET.
 */
export async function fetchKpiMeta(
  kpiIssueId: string,
  kpiFields: KpiFieldsConfig | null = null,
): Promise<KpiMetaProperty | null> {
  if (!kpiFields) {
    const res = await asUser()
      .requestJira(route`/rest/api/3/issue/${kpiIssueId}/properties/${KPI_META_PROPERTY_KEY}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: unknown };
    return parseKpiMeta(body.value);
  }
  const res = await asUser().requestJira(
    route`/rest/api/3/issue/${kpiIssueId}?fields=${kpiMetaFieldIds(kpiFields).join(',')}&properties=${KPI_META_PROPERTY_KEY}`,
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { fields?: Record<string, unknown>; properties?: Record<string, unknown> };
  return resolveKpiMeta(kpiFields, { legacy: body.properties?.[KPI_META_PROPERTY_KEY], fields: body.fields });
}
