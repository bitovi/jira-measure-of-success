import { assumeTrustedRoute, route, routeFromAbsolute } from '@forge/api';
import { asApp, asUser } from './requestLog';
import {
  AssignmentProperty,
  KpiMetaProperty,
  KPI_META_PROPERTY_KEY,
  breakParentCycles,
  DEFAULT_KPI_LINK_TYPE,
  isDirectionalLinkType,
  KPI_HIERARCHY_NOT_SET_UP,
  dateFieldSelection,
  encodeReadingValue,
  kpiParentLinkBody,
  parentFromIssueLinks,
  readOwnDates,
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
  type KpiHierarchyLink,
  type ReadingChange,
  type TimingNode,
} from '../domain/index';

/**
 * Jira access helpers for the resolver. These are the ONLY place that talks to
 * Jira's REST API; everything else operates on plain domain objects, so the
 * logic stays testable without a live site.
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
  issuetype?: { name: string; hierarchyLevel?: number };
  status?: { statusCategory?: { key?: string } };
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

/**
 * `fetchIssueMeta` plus the issue's own targets: the `kpi-assignments` property
 * comes back inside the same GET (`properties=`), so no separate property request.
 */
export async function fetchIssueWithAssignments(
  issueId: string,
  selection: DateFieldSelection = DEFAULT_DATE_SELECTION,
): Promise<IssueParentInfo & { assignments: Assignment[] }> {
  const fieldList = metaFieldList(selection);
  const res = await asUser().requestJira(
    route`/rest/api/3/issue/${issueId}?fields=${fieldList}&properties=${ASSIGNMENT_PROPERTY_KEY}`,
  );
  if (!res.ok) throw new Error(`Failed to load issue ${issueId} (${res.status})`);
  const data = (await res.json()) as { key: string; fields: RawMetaFields; properties?: Record<string, unknown> };
  return {
    ...toIssueMeta(data.key, data.fields, selection),
    assignments: parseAssignments(data.properties?.[ASSIGNMENT_PROPERTY_KEY]),
  };
}

/** Assignments from a raw `kpi-assignments` property value; [] when absent or invalid. */
function parseAssignments(value: unknown): Assignment[] {
  const parsed = AssignmentProperty.safeParse(value);
  return parsed.success ? parsed.data.assignments : [];
}

/** One issue's assignments. For single-issue paths; bulk loads read the property in the search instead. */
export async function fetchAssignments(issueId: string): Promise<Assignment[]> {
  const res = await asUser()
    .requestJira(
      route`/rest/api/3/issue/${issueId}/properties/${ASSIGNMENT_PROPERTY_KEY}`,
    );
  if (res.status === 404) return [];
  const body = (await res.json()) as { value?: unknown };
  return parseAssignments(body.value);
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
    assignments: parseAssignments(data.properties?.[ASSIGNMENT_PROPERTY_KEY]),
  };
}

/** Persist the full assignment list for an issue (batched single write). */
export async function writeAssignments(issueId: string, assignments: Assignment[]): Promise<void> {
  // Also persist a denormalized `kpiIds` list: the manifest indexes
  // `kpi-assignments` → `kpiIds` (searchAlias), and that index is what the
  // timeline uses to find which issues target a given KPI. Without writing it
  // the index stays empty and no targets are ever discovered.
  const value: unknown = AssignmentProperty.parse({
    assignments,
    kpiIds: [...new Set(assignments.map((a) => a.kpiId))],
  });
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
 * issue has one app-only field whose CHANGELOG holds the reading series: every
 * recorded value is an embedded-date payload, so each write is one changelog
 * entry. The series is reconstructed by the pure `readingsFromChangelog` reducer.
 * The field id is assigned when the KPI space is provisioned (Phase 5).
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
    reading:
      fields.find((f) => (f.key ?? '').includes('kpi-reading') || f.name === 'KPI Reading')?.id ?? null,
    rank: fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-lexo-rank')?.id ?? null,
  };
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

/** Record a reading on a KPI issue (value=null = tombstone/delete) by writing the encoded payload. */
export async function writeReading(kpiIssueId: string, date: string, value: number | null): Promise<void> {
  const fieldId = await getReadingFieldId();
  const encoded = encodeReadingValue(date, value);
  // The KPI Reading field is app-managed + readOnly, so it CANNOT be written via
  // the standard issue-edit PUT /rest/api/3/issue/{id} (Jira returns 400 "Field
  // does not support update"). It must be written through the dedicated app
  // custom field value API, which only the owning app can call.
  //
  // That API requires the NUMERIC issue id. The resolver may hand us either a
  // key (e.g. KPI-1) or a numeric id, so resolve it via a GET (which accepts
  // both) and read the numeric `.id` back.
  const idRes = await asApp().requestJira(route`/rest/api/3/issue/${kpiIssueId}?fields=`);
  if (!idRes.ok) {
    const body = await idRes.text().catch(() => '');
    throw new Error(`Failed to resolve KPI issue id for "${kpiIssueId}" (${idRes.status}): ${body}`);
  }
  const { id: numericId } = (await idRes.json()) as { id: string };
  // App custom field value API. `generateChangelog=true` is REQUIRED: readings
  // are reconstructed from this field's changelog (Option B), so every write must
  // emit a changelog entry. Success is 204 No Content.
  const res = await asApp()
    .requestJira(route`/rest/api/3/app/field/${fieldId}/value?generateChangelog=true`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ issueIds: [Number(numericId)], value: encoded }] }),
    });
  // A silently-ignored 4xx/5xx here is exactly what made "record value did
  // nothing": the write failed, the field stayed empty, yet the resolver still
  // returned unchanged timeline data. Surface the failure so the UI banner /
  // Forge logs reveal Jira's actual message.
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to write reading (${res.status}): ${body}`);
  }
}
/**
 * Fetch the reading-field changelog for KPI issues via the bulk endpoint
 * (`POST /rest/api/3/changelog/bulkfetch`, filtered to the reading field). Up to
 * 1000 issues/request — one call covers a whole KPI space. Returns the raw
 * changes for `readingsFromChangelog` to reduce into series.
 */
export async function fetchReadingChangelog(kpiIssueIds: string[]): Promise<Map<string, ReadingChange[]>> {
  const byIssue = new Map<string, ReadingChange[]>();
  if (kpiIssueIds.length === 0) return byIssue;
  const fieldId = await getReadingFieldId();
  // Read asApp to match writeReading: the app-managed read-only reading field's
  // values/changelog are generally NOT visible to asUser, so an asUser read
  // comes back empty even after a successful write.
  const res = await asApp().requestJira(route`/rest/api/3/changelog/bulkfetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      issueIdsOrKeys: kpiIssueIds.slice(0, 1000),
      fieldIds: [fieldId],
      maxResults: 1000,
    }),
  });
  // Non-throwing on initial load — an empty series shouldn't crash the timeline —
  // but warn so a failed fetch is observable in Forge logs.
  if (!res.ok) {
    console.warn(`fetchReadingChangelog: bulkfetch failed (${res.status})`);
    return byIssue;
  }
  const data = (await res.json()) as {
    issueChangeLogs?: Array<{
      issueId: string;
      changeHistories?: Array<{
        created: number | string;
        author?: { accountId?: string };
        items?: Array<{ fieldId?: string; field?: string; to?: string | null; toString?: string | null }>;
      }>;
    }>;
  };
  for (const log of data.issueChangeLogs ?? []) {
    const changes: ReadingChange[] = [];
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
  return byIssue;
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

export interface KpiSpaceIssue {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  /** Native LexoRank value for sibling ordering (null if the field is absent). */
  rank: string | null;
  /** unit/direction from the `kpi-meta` property, included in the search (null if unset/invalid) */
  meta: KpiMetaProperty | null;
}

/** Best-effort: null if the Rank field can't be found (siblings keep creation order). */
async function getRankFieldId(): Promise<string | null> {
  try {
    return (await getFieldIds()).rank;
  } catch {
    return null;
  }
}

/**
 * Enumerate every KPI issue in the KPI space (JQL `project = <key>`), reading the
 * summary (KPI name), issue links (for parent nesting), native rank (for
 * sibling ordering) and the `kpi-meta` property (unit/direction — included in
 * the search so no per-KPI property GET is needed). Paginated to cover large spaces.
 *
 * The KPI tree is expressed with issue links of the configured hierarchy type
 * (`hierarchy`, see resolve/kpiLinks) rather than the native `parent` field (a
 * standard issue can't be the native parent of another standard issue) — so
 * each issue's parent is derived from its `issuelinks` via the pure
 * `parentFromIssueLinks`, restricted to links whose parent is also a KPI-space
 * issue. With no hierarchy configured every KPI is a root. The nested tree +
 * readings are assembled by `getTimelineData`.
 */
export async function fetchKpiSpaceIssues(
  projectKey: string,
  hierarchy: KpiHierarchyLink | null,
): Promise<KpiSpaceIssue[]> {
  const rankFieldId = await getRankFieldId();
  const fieldList = ['summary', 'issuelinks', ...(rankFieldId ? [rankFieldId] : [])].join(',');
  type RawIssue = {
    id: string;
    key: string;
    name: string;
    links: IssueLinkRef[];
    rank: string | null;
    meta: KpiMetaProperty | null;
  };
  const raw: RawIssue[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const res = await asApp()
      .requestJira(
        nextPageToken
          ? route`/rest/api/3/search/jql?jql=project=${projectKey}+ORDER+BY+created+ASC&fields=${fieldList}&properties=${KPI_META_PROPERTY_KEY}&maxResults=100&nextPageToken=${nextPageToken}`
          : route`/rest/api/3/search/jql?jql=project=${projectKey}+ORDER+BY+created+ASC&fields=${fieldList}&properties=${KPI_META_PROPERTY_KEY}&maxResults=100`,
      );
    // Fail loudly rather than return a partial list: callers treat a KPI that's
    // absent here as non-existent (catalog, timeline tree).
    if (!res.ok) throw new Error(await jiraError(res, `list the KPIs in project ${projectKey}`));
    const data = (await res.json()) as {
      isLast?: boolean;
      nextPageToken?: string;
      issues?: Array<{
        id: string;
        key: string;
        fields?: { summary?: string; issuelinks?: IssueLinkRef[]; [field: string]: unknown };
        properties?: Record<string, unknown>;
      }>;
    };
    const batch = data.issues ?? [];
    for (const i of batch) {
      raw.push({
        id: String(i.id),
        key: i.key,
        name: i.fields?.summary ?? i.key,
        links: i.fields?.issuelinks ?? [],
        rank: rankFieldId ? ((i.fields?.[rankFieldId] as string | undefined) ?? null) : null,
        meta: parseKpiMeta(i.properties?.[KPI_META_PROPERTY_KEY]),
      });
    }
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  // Resolve parents only after every id is known, so hierarchy links pointing
  // outside the KPI space are ignored (a reused type like "Blocks" is generic).
  const idSet = new Set(raw.map((r) => r.id));
  return breakParentCycles(
    raw.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      parentId: parentFromIssueLinks(r.links, idSet, hierarchy),
      rank: r.rank,
      meta: r.meta,
    })),
  );
}

function parseKpiMeta(value: unknown): KpiMetaProperty | null {
  const parsed = KpiMetaProperty.safeParse(value);
  return parsed.success ? parsed.data : null;
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

/** JQL that finds every issue carrying a KPI target, via the denormalized index. */
const ASSIGNMENT_INDEX_JQL = 'issue.property[kpi-assignments].kpiIds IS NOT EMPTY';

/**
 * Discover every issue that has authored a KPI target — in ONE JQL query against
 * the denormalized `kpiIds` search index (`issue.property[kpi-assignments].kpiIds
 * IS NOT EMPTY`), and let the caller group the assignments by KPI in memory.
 * This deliberately avoids a per-KPI query fan-out.
 *
 * The search asks Jira to include each issue's `kpi-assignments` property in the
 * results (`properties=`), so the targets arrive WITH the issues — no per-issue
 * property request (spec 06 P1). Pages may hold fewer than 100 issues when
 * properties are included, so paging follows `nextPageToken` until `isLast`.
 *
 * Caveat: only finds issues SAVED AFTER the `kpiIds` index was populated
 * (writeAssignments) — assignments written before that must be re-saved or
 * backfilled once. See specs/bug-fixes/timeline-targets-not-shown.md.
 *
 * Live-only: exercised via `forge tunnel` / `npm run test:e2e`; the mock harness
 * bakes targets into fixtures instead. Non-throwing — a failed search yields no
 * targets rather than crashing the timeline.
 */
export async function fetchTargetContributions(): Promise<TargetContributions> {
  const fieldList = ['summary', 'issuetype', 'parent', 'duedate'].join(',');
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
          ? route`/rest/api/3/search/jql?jql=${ASSIGNMENT_INDEX_JQL}&fields=${fieldList}&properties=${ASSIGNMENT_PROPERTY_KEY}&maxResults=100&nextPageToken=${nextPageToken}`
          : route`/rest/api/3/search/jql?jql=${ASSIGNMENT_INDEX_JQL}&fields=${fieldList}&properties=${ASSIGNMENT_PROPERTY_KEY}&maxResults=100`,
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
        assignments: parseAssignments(i.properties?.[ASSIGNMENT_PROPERTY_KEY]),
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

// ── KPI space provisioning (storage-model.md) ────────────────────────────────

/**
 * Turn a failed Jira response into a readable Error message. Jira returns
 * `{ errorMessages: [...], errors: {...} }` on 4xx/5xx — surface that instead of
 * letting a downstream `undefined` produce an opaque platform error.
 */
type JiraResponse = { status: number; json(): Promise<unknown>; text(): Promise<string> };
async function jiraError(res: JiraResponse, action: string): Promise<string> {
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
  name: string;
  /** issue-type names available in the project (via `expand=issueTypes`) */
  issueTypeNames: string[];
}

/** Look up a project (+ its issue types) by key; null if it doesn't exist. */
export async function findProjectByKey(key: string): Promise<ProjectInfo | null> {
  const res = await asApp().requestJira(route`/rest/api/3/project/${key}?expand=issueTypes`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await jiraError(res, `look up project "${key}"`));
  const p = (await res.json()) as {
    id: string | number;
    name: string;
    issueTypes?: Array<{ name: string }>;
  };
  return {
    id: String(p.id),
    name: p.name,
    issueTypeNames: (p.issueTypes ?? []).map((t) => t.name),
  };
}

/**
 * Create the KPI project shell for `key`. `leadAccountId` is the invoking user
 * (from the resolver context) — passed in so this stays a pure `asApp` call and
 * never triggers 3LO/`asUser` consent. The `KPI` issue type is provisioned and
 * associated separately by `ensureKpiIssueTypeOnProject`; the app-only reading
 * field is installed globally by the manifest `jira:customField` module.
 */
export async function createKpiProject(
  key: string,
  leadAccountId: string,
): Promise<{ id: string; name: string }> {
  const name = `KPIs (${key})`;
  const res = await asApp().requestJira(route`/rest/api/3/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, name, projectTypeKey: 'software', leadAccountId }),
  });
  if (!res.ok) throw new Error(await jiraError(res, `create project "${key}"`));
  const p = (await res.json()) as { id: string | number };
  return { id: String(p.id), name };
}

/** KPI-space issue-type name that KPI issues are created as. */
export const KPI_ISSUE_TYPE = 'KPI';

/** Find (or create) the global "KPI" standard issue type; returns its id. */
async function ensureKpiIssueType(): Promise<string> {
  const listRes = await asApp().requestJira(route`/rest/api/3/issuetype`);
  if (!listRes.ok) throw new Error(await jiraError(listRes, 'list issue types'));
  const types = (await listRes.json()) as Array<{ id: string; name: string }>;
  const found = types.find((t) => t.name === KPI_ISSUE_TYPE);
  if (found) return found.id;
  const createRes = await asApp().requestJira(route`/rest/api/3/issuetype`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: KPI_ISSUE_TYPE,
      type: 'standard',
      description: 'App-managed KPI metric (Measure of Success).',
    }),
  });
  if (!createRes.ok) {
    throw new Error(await jiraError(createRes, `create the "${KPI_ISSUE_TYPE}" issue type`));
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Ensure the `KPI` issue type exists and is associated with the given project's
 * issue-type scheme, so KPI issues can be created in it. Company-managed only —
 * team-managed projects don't expose a classic scheme.
 */
export async function ensureKpiIssueTypeOnProject(projectId: string): Promise<void> {
  const issueTypeId = await ensureKpiIssueType();
  const schemeRes = await asApp()
    .requestJira(route`/rest/api/3/issuetypescheme/project?projectId=${projectId}`);
  if (!schemeRes.ok) throw new Error(await jiraError(schemeRes, 'read the project issue-type scheme'));
  const body = (await schemeRes.json()) as {
    values?: Array<{ issueTypeScheme?: { id: string } }>;
  };
  const schemeId = body.values?.[0]?.issueTypeScheme?.id;
  if (!schemeId) {
    throw new Error(
      'No issue-type scheme found for this project. Team-managed projects cannot be used as a KPI space — use a company-managed project.',
    );
  }
  const addRes = await asApp()
    .requestJira(route`/rest/api/3/issuetypescheme/${schemeId}/issuetype`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueTypeIds: [issueTypeId] }),
    });
  // 204 on success; a type already in the scheme is a harmless 409.
  if (!addRes.ok && addRes.status !== 409) {
    throw new Error(await jiraError(addRes, `add the "${KPI_ISSUE_TYPE}" issue type to the project`));
  }
}

/**
 * Create a KPI as an issue in the KPI space. Nesting under `parentKpiId` uses an
 * issue LINK of the configured `hierarchy` type, because Jira forbids a
 * standard issue from being the native `parent` of another standard issue.
 * Nesting without a configured hierarchy throws before anything is created.
 * NOTE: unit/direction persist to the `kpi-meta` entity property (the summary
 * carries the KPI name) — set in the create request itself, so there's no
 * separate property write.
 */
export async function createKpiIssue(
  projectId: string,
  input: CreateKpiInput,
  hierarchy: KpiHierarchyLink | null,
): Promise<CreatedKpi> {
  if (input.parentKpiId && !hierarchy) {
    throw new Error(`${KPI_HIERARCHY_NOT_SET_UP} — choose how KPIs nest in Settings first.`);
  }
  const name = input.name.trim() || 'Untitled KPI';
  // unit/direction are descriptive, low-churn → issue entity property (not a field).
  const meta: KpiMetaProperty = KpiMetaProperty.parse({
    unit: input.unit.trim(),
    direction: input.direction ?? null,
  });
  const fields: Record<string, unknown> = {
    project: { id: projectId },
    issuetype: { name: KPI_ISSUE_TYPE },
    summary: name,
  };
  const res = await asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, properties: [{ key: KPI_META_PROPERTY_KEY, value: meta }] }),
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
    kpiId: created.key,
    issueKey: created.key,
    name,
    unit: meta.unit,
    direction: meta.direction ?? null,
    parentKpiId,
  };
}

/**
 * Link a child KPI to its parent with the configured hierarchy link type; the
 * body puts each issue on the end `parentFromIssueLinks` reads it back from.
 */
export async function linkKpiParent(
  hierarchy: KpiHierarchyLink,
  parentKpiKey: string,
  childKpiKey: string,
): Promise<void> {
  const res = await asApp().requestJira(route`/rest/api/3/issueLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(kpiParentLinkBody(hierarchy, parentKpiKey, childKpiKey)),
  });
  // 201 on success. Surface failures so a broken nest doesn't look like a no-op.
  if (!res.ok) {
    throw new Error(await jiraError(res, `link KPI "${childKpiKey}" under "${parentKpiKey}"`));
  }
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
  const res = await asApp().requestJira(route`/rest/api/3/issueLinkType`, {
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

/** Delete an issue (used to roll back a half-created KPI). */
async function deleteIssue(issueKey: string): Promise<void> {
  const res = await asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(await jiraError(res, `delete issue ${issueKey}`));
}

/**
 * Of the given issue keys, the ones Jira says no longer exist (404). Any other
 * outcome — found, or a transient error — counts as "not deleted", so a hiccup
 * never makes the panel offer to remove a target on a live KPI.
 */
export async function fetchDeletedIssueKeys(keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys)];
  const deleted = await Promise.all(
    unique.map(async (key) => {
      const res = await asApp().requestJira(route`/rest/api/3/issue/${key}?fields=summary`);
      return res.status === 404 ? key : null;
    }),
  );
  return deleted.filter((k): k is string => k !== null);
}

/** Read a KPI's unit/direction from the `kpi-meta` entity property (null if unset). */
export async function fetchKpiMeta(kpiIssueId: string): Promise<KpiMetaProperty | null> {
  const res = await asUser()
    .requestJira(route`/rest/api/3/issue/${kpiIssueId}/properties/${KPI_META_PROPERTY_KEY}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: unknown };
  return parseKpiMeta(body.value);
}
