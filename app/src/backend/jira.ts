import api, { route } from '@forge/api';
import {
  AssignmentProperty,
  KpiMetaProperty,
  KPI_META_PROPERTY_KEY,
  KPI_PARENT_LINK_TYPE,
  encodeReadingValue,
  parentFromIssueLinks,
  type Assignment,
  type CreateKpiInput,
  type IssueLinkRef,
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

interface IssueParentInfo {
  parentId: string | null;
  issueKey: string;
  issueTypeName: string;
  ownStart: string | null;
  ownDueDate: string | null;
}

export async function fetchIssueMeta(issueId: string): Promise<IssueParentInfo> {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueId}?fields=parent,issuetype,duedate,customfield_10015`);
  const data = (await res.json()) as {
    key: string;
    fields: {
      parent?: { id: string };
      issuetype?: { name: string };
      duedate?: string | null;
      /** Jira Cloud's default "Start date" field */
      customfield_10015?: string | null;
    };
  };
  return {
    parentId: data.fields.parent?.id ?? null,
    issueKey: data.key,
    issueTypeName: data.fields.issuetype?.name ?? 'Unknown',
    ownStart: data.fields.customfield_10015 ?? null,
    ownDueDate: data.fields.duedate ?? null,
  };
}

export async function fetchAssignments(issueId: string): Promise<Assignment[]> {
  const res = await api
    .asUser()
    .requestJira(
      route`/rest/api/3/issue/${issueId}/properties/${ASSIGNMENT_PROPERTY_KEY}`,
    );
  if (res.status === 404) return [];
  const body = (await res.json()) as { value?: unknown };
  const parsed = AssignmentProperty.safeParse(body.value);
  return parsed.success ? parsed.data.assignments : [];
}

/** Persist the full assignment list for an issue (batched single write). */
export async function writeAssignments(issueId: string, assignments: Assignment[]): Promise<void> {
  const value: unknown = AssignmentProperty.parse({ assignments });
  await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueId}/properties/${ASSIGNMENT_PROPERTY_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
}

/**
 * Reading storage — Option B (specs/01-initial-build/storage-model.md). Each KPI
 * issue has one app-only field whose CHANGELOG holds the reading series: every
 * recorded value is an embedded-date payload, so each write is one changelog
 * entry. The series is reconstructed by the pure `readingsFromChangelog` reducer.
 * The field id is assigned when the KPI space is provisioned (Phase 5).
 */
/**
 * The app-owned "KPI Reading" custom field (manifest `jira:customField` key
 * `kpi-reading`). Its numeric `customfield_NNNNN` id is assigned at install per
 * site, so resolve it once by matching the app field key/name, then cache it.
 */
let readingFieldIdCache: string | null = null;
async function getReadingFieldId(): Promise<string> {
  if (readingFieldIdCache) return readingFieldIdCache;
  const res = await api.asApp().requestJira(route`/rest/api/3/field`);
  const fields = (await res.json()) as Array<{ id: string; key?: string; name?: string }>;
  const match = fields.find((f) => (f.key ?? '').includes('kpi-reading') || f.name === 'KPI Reading');
  if (!match) {
    throw new Error('KPI Reading field not found — deploy the app so its custom field is installed.');
  }
  readingFieldIdCache = match.id;
  return match.id;
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
  const idRes = await api.asApp().requestJira(route`/rest/api/3/issue/${kpiIssueId}?fields=`);
  if (!idRes.ok) {
    const body = await idRes.text().catch(() => '');
    throw new Error(`Failed to resolve KPI issue id for "${kpiIssueId}" (${idRes.status}): ${body}`);
  }
  const { id: numericId } = (await idRes.json()) as { id: string };
  // App custom field value API. `generateChangelog=true` is REQUIRED: readings
  // are reconstructed from this field's changelog (Option B), so every write must
  // emit a changelog entry. Success is 204 No Content.
  const res = await api
    .asApp()
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
  const res = await api.asApp().requestJira(route`/rest/api/3/changelog/bulkfetch`, {
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

/** Direct children of an issue via JQL `parent = X`. */
export async function fetchChildren(issueId: string): Promise<string[]> {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/search/jql?jql=parent=${issueId}&fields=id&maxResults=100`);
  if (!res.ok) return [];
  const data = (await res.json()) as { issues?: Array<{ id: string }> };
  return (data.issues ?? []).map((i) => i.id);
}

export interface KpiSpaceIssue {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  /** Native LexoRank value for sibling ordering (null if the field is absent). */
  rank: string | null;
}

/**
 * The site's native LexoRank "Rank" field id (`com.pyxis.greenhopper.jira:
 * gh-lexo-rank`) — resolved once per runtime, since the numeric `customfield_*`
 * id varies per site. Used to order sibling KPIs the same way a backlog drag
 * would. Returns null (best-effort) if the field can't be found.
 */
let rankFieldIdCache: string | null | undefined;
async function getRankFieldId(): Promise<string | null> {
  if (rankFieldIdCache !== undefined) return rankFieldIdCache;
  const res = await api.asApp().requestJira(route`/rest/api/3/field`);
  if (!res.ok) {
    rankFieldIdCache = null;
    return null;
  }
  const fields = (await res.json()) as Array<{ id: string; schema?: { custom?: string } }>;
  const match = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-lexo-rank');
  rankFieldIdCache = match?.id ?? null;
  return rankFieldIdCache;
}

/**
 * Enumerate every KPI issue in the KPI space (JQL `project = <key>`), reading the
 * summary (KPI name), issue links (for parent nesting) and native rank (for
 * sibling ordering). Paginated to cover large spaces.
 *
 * The KPI tree is expressed with built-in `Parent` issue links rather than the
 * native `parent` field (a standard issue can't be the native parent of another
 * standard issue) — so each issue's parent is derived from its `issuelinks` via
 * the pure `parentFromIssueLinks`, restricted to links whose parent is also a
 * KPI-space issue. The nested tree + readings are assembled by `getTimelineData`.
 */
export async function fetchKpiSpaceIssues(projectKey: string): Promise<KpiSpaceIssue[]> {
  const rankFieldId = await getRankFieldId();
  const fieldList = ['summary', 'issuelinks', ...(rankFieldId ? [rankFieldId] : [])].join(',');
  type RawIssue = {
    id: string;
    key: string;
    name: string;
    links: IssueLinkRef[];
    rank: string | null;
  };
  const raw: RawIssue[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const res = await api
      .asApp()
      .requestJira(
        nextPageToken
          ? route`/rest/api/3/search/jql?jql=project=${projectKey}+ORDER+BY+created+ASC&fields=${fieldList}&maxResults=100&nextPageToken=${nextPageToken}`
          : route`/rest/api/3/search/jql?jql=project=${projectKey}+ORDER+BY+created+ASC&fields=${fieldList}&maxResults=100`,
      );
    if (!res.ok) break;
    const data = (await res.json()) as {
      isLast?: boolean;
      nextPageToken?: string;
      issues?: Array<{
        id: string;
        key: string;
        fields?: { summary?: string; issuelinks?: IssueLinkRef[]; [field: string]: unknown };
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
      });
    }
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    nextPageToken = data.nextPageToken;
  }

  // Resolve parents only after every id is known, so `Parent` links pointing
  // outside the KPI space are ignored (the built-in type is generic).
  const idSet = new Set(raw.map((r) => r.id));
  return raw.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    parentId: parentFromIssueLinks(r.links, idSet),
    rank: r.rank,
  }));
}

/**
 * Build the timing-node map for the subtree rooted at `issueId` (its own dates
 * plus all descendants), so `effectiveTiming` can roll up its due date.
 * Bounded by MAX_DEPTH; visited-guarded against cycles.
 */
export async function fetchSubtreeTimingNodes(issueId: string): Promise<Map<string, TimingNode>> {
  const nodes = new Map<string, TimingNode>();
  const queue: Array<{ id: string; depth: number }> = [{ id: issueId, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (nodes.has(id) || depth > MAX_DEPTH) continue;
    const [meta, childIds] = await Promise.all([fetchIssueMeta(id), fetchChildren(id)]);
    nodes.set(id, {
      id,
      issueKey: meta.issueKey,
      issueTypeName: meta.issueTypeName,
      ownStart: meta.ownStart,
      ownDue: meta.ownDueDate,
      childIds,
    });
    for (const childId of childIds) queue.push({ id: childId, depth: depth + 1 });
  }
  return nodes;
}

/**
 * Discover hierarchy level names ordered deepest-parent → leaf, from the site's
 * issue-type hierarchy configuration (never hardcoded — Constitution §6).
 */
export async function fetchHierarchyLevels(): Promise<string[]> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issuetype`);
  if (!res.ok) return [];
  const types = (await res.json()) as Array<{ name: string; hierarchyLevel?: number }>;
  const namesByLevel = new Map<number, string[]>();
  for (const t of types) {
    const level = t.hierarchyLevel ?? 0;
    const names = namesByLevel.get(level) ?? [];
    names.push(t.name);
    namesByLevel.set(level, names);
  }
  // higher hierarchyLevel = closer to the top (deepest parent) → leaf last
  return [...namesByLevel.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([level, names]) => pickLevelName(level, names));
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
  const res = await api.asApp().requestJira(route`/rest/api/3/project/${key}?expand=issueTypes`);
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
  const res = await api.asApp().requestJira(route`/rest/api/3/project`, {
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
  const listRes = await api.asApp().requestJira(route`/rest/api/3/issuetype`);
  if (!listRes.ok) throw new Error(await jiraError(listRes, 'list issue types'));
  const types = (await listRes.json()) as Array<{ id: string; name: string }>;
  const found = types.find((t) => t.name === KPI_ISSUE_TYPE);
  if (found) return found.id;
  const createRes = await api.asApp().requestJira(route`/rest/api/3/issuetype`, {
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
  const schemeRes = await api
    .asApp()
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
  const addRes = await api
    .asApp()
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
 * Create a KPI as an issue in the KPI space. Nesting under `parentKpiId` uses a
 * built-in `Parent` issue LINK (parent = link's outward end), because Jira
 * forbids a standard issue from being the native `parent` of another standard
 * issue. NOTE: unit/direction persist to the `kpi-meta` entity property (the
 * summary carries the KPI name).
 */
export async function createKpiIssue(projectId: string, input: CreateKpiInput): Promise<string> {
  const fields: Record<string, unknown> = {
    project: { id: projectId },
    issuetype: { name: KPI_ISSUE_TYPE },
    summary: input.name.trim() || 'Untitled KPI',
  };
  const res = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  // Surface Jira's rejection instead of returning `{ key: undefined }` — a
  // swallowed 4xx here is the same silent-failure class fixed in `writeReading`.
  if (!res.ok) {
    throw new Error(await jiraError(res, `create KPI issue "${input.name}"`));
  }
  const created = (await res.json()) as { key: string };
  // unit/direction are descriptive, low-churn → issue entity property (not a field).
  await writeKpiMeta(created.key, {
    unit: input.unit.trim(),
    direction: input.direction ?? null,
  });
  if (input.parentKpiId) await linkKpiParent(input.parentKpiId, created.key);
  return created.key;
}

/**
 * Link a child KPI to its parent with the built-in `Parent` link type
 * (outward "Parent" / inward "Child"): the parent is the link's outward issue,
 * the child its inward issue — matching how `parentFromIssueLinks` reads it back.
 */
export async function linkKpiParent(parentKpiKey: string, childKpiKey: string): Promise<void> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issueLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: { name: KPI_PARENT_LINK_TYPE },
      outwardIssue: { key: parentKpiKey },
      inwardIssue: { key: childKpiKey },
    }),
  });
  // 201 on success. Surface failures so a broken nest doesn't look like a no-op.
  if (!res.ok) {
    throw new Error(await jiraError(res, `link KPI "${childKpiKey}" under "${parentKpiKey}"`));
  }
}

/** Persist a KPI's unit/direction as the `kpi-meta` entity property. */
export async function writeKpiMeta(kpiIssueKey: string, meta: KpiMetaProperty): Promise<void> {
  const value: unknown = KpiMetaProperty.parse(meta);
  await api.asApp().requestJira(route`/rest/api/3/issue/${kpiIssueKey}/properties/${KPI_META_PROPERTY_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

/** Read a KPI's unit/direction from the `kpi-meta` entity property (null if unset). */
export async function fetchKpiMeta(kpiIssueId: string): Promise<KpiMetaProperty | null> {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${kpiIssueId}/properties/${KPI_META_PROPERTY_KEY}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: unknown };
  const parsed = KpiMetaProperty.safeParse(body.value);
  return parsed.success ? parsed.data : null;
}
