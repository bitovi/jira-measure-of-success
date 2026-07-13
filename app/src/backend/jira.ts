import api, { route } from '@forge/api';
import {
  AssignmentProperty,
  encodeReadingValue,
  type Assignment,
  type CreateKpiInput,
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
const READING_FIELD_ID = 'customfield_kpi_reading'; // TODO: real id from KPI-space provisioning

/** Record a reading on a KPI issue (value=null = tombstone/delete) by writing the encoded payload. */
export async function writeReading(kpiIssueId: string, date: string, value: number | null): Promise<void> {
  const encoded = encodeReadingValue(date, value);
  await api.asUser().requestJira(route`/rest/api/3/issue/${kpiIssueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [READING_FIELD_ID]: encoded } }),
  });
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
  const res = await api.asUser().requestJira(route`/rest/api/3/changelog/bulkfetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      issueIdsOrKeys: kpiIssueIds.slice(0, 1000),
      fieldIds: [READING_FIELD_ID],
      maxResults: 1000,
    }),
  });
  if (!res.ok) return byIssue;
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
      const item = (h.items ?? []).find((i) => i.fieldId === READING_FIELD_ID || i.field === READING_FIELD_ID);
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
    .requestJira(route`/rest/api/3/search?jql=parent=${issueId}&fields=id&maxResults=100`);
  if (!res.ok) return [];
  const data = (await res.json()) as { issues?: Array<{ id: string }> };
  return (data.issues ?? []).map((i) => i.id);
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
  const seen = new Map<number, string>();
  for (const t of types) {
    const level = t.hierarchyLevel ?? 0;
    if (!seen.has(level)) seen.set(level, t.name);
  }
  // higher hierarchyLevel = closer to the top (deepest parent) → leaf last
  return [...seen.entries()].sort((a, b) => b[0] - a[0]).map(([, name]) => name);
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

/** Look up a project by key; null if it doesn't exist. */
export async function findProjectByKey(key: string): Promise<{ id: string; name: string } | null> {
  const res = await api.asApp().requestJira(route`/rest/api/3/project/${key}`);
  if (!res.ok) return null;
  const p = (await res.json()) as { id: string | number; name: string };
  return { id: String(p.id), name: p.name };
}

/** Current user's account id — the project lead for a newly-created KPI space. */
async function currentAccountId(): Promise<string> {
  const res = await api.asUser().requestJira(route`/rest/api/3/myself`);
  const me = (await res.json()) as { accountId: string };
  return me.accountId;
}

/**
 * Create the KPI project for `key`. NOTE: creating the dedicated `KPI` issue type
 * + scheme and the app-only reading field is finished during the Phase-5
 * integration pass on a live site; this creates the project shell.
 */
export async function createKpiProject(key: string): Promise<{ id: string; name: string }> {
  const name = `KPIs (${key})`;
  const leadAccountId = await currentAccountId();
  const res = await api.asApp().requestJira(route`/rest/api/3/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, name, projectTypeKey: 'software', leadAccountId }),
  });
  const p = (await res.json()) as { id: string | number };
  return { id: String(p.id), name };
}

/** KPI-space issue-type name that KPI issues are created as. */
const KPI_ISSUE_TYPE = 'KPI';

/**
 * Create a KPI as an issue in the KPI space. Nesting under `parentKpiId` uses the
 * issue parent field. NOTE: unit/direction persist to the app-only KPI fields
 * provisioned on the live site (Phase 5); summary carries the name today.
 */
export async function createKpiIssue(projectId: string, input: CreateKpiInput): Promise<string> {
  const fields: Record<string, unknown> = {
    project: { id: projectId },
    issuetype: { name: KPI_ISSUE_TYPE },
    summary: input.name.trim() || 'Untitled KPI',
  };
  if (input.parentKpiId) fields.parent = { key: input.parentKpiId };
  const res = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  const created = (await res.json()) as { key: string };
  return created.key;
}
