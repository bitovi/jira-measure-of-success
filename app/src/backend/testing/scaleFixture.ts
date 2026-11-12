import {
  encodeReadingValue,
  type Assignment,
  type IssueLinkTypeInfo,
  type KpiDirection,
  type RollupConfig,
} from '../../domain/index';

/**
 * Scale fixture + mock Jira REST API for backend performance tests
 * (specs/06-timeline-performance, "Instrumentation and test harness").
 *
 * Builds a deterministic site — a KPI space plus an Initiative > Epic > Story >
 * Subtask work hierarchy where every Epic carries one KPI target — and serves
 * it through `requestJira(route, init)` the way Jira Cloud would: enhanced JQL
 * search with `nextPageToken` paging and `maxResults` caps, issue properties,
 * the changelog bulk fetch, `/field`, and issue-type icons. Every call is
 * answered from memory; tests assert on the resolver's own request trace.
 */

export interface ScaleOptions {
  kpis: number;
  initiatives: number;
  epicsPerInitiative: number;
  storiesPerEpic: number;
  subtasksPerStory: number;
  readingsPerKpi: number;
  /** every Nth epic has no own due date, so its date must roll up from stories */
  undatedEpicEvery: number;
  /** every Nth story has no own due date */
  undatedStoryEvery: number;
  rollup: RollupConfig;
  /** artificial per-request latency (ms) so stage timings reflect round trips */
  latencyMs: number;
}

export const DEFAULT_SCALE: ScaleOptions = {
  kpis: 40,
  initiatives: 50,
  epicsPerInitiative: 40, // 2,000 contributing epics
  storiesPerEpic: 3, // 6,000 stories
  subtasksPerStory: 1, // 6,000 subtasks → 12,000+ descendants
  readingsPerKpi: 8,
  undatedEpicEvery: 3,
  undatedStoryEvery: 5,
  rollup: { dueDateRollup: {} },
  latencyMs: 0,
};

export const KPI_PROJECT = { key: 'KPI', id: '10000', name: 'KPIs (KPI)' };
export const RANK_FIELD_ID = 'customfield_10019';
/** The app-created hierarchy link type (labels per DEFAULT_KPI_LINK_TYPE: parent on the inward end). */
export const KPI_HIERARCHY_LINK_TYPE = {
  id: '10500',
  name: 'KPI Hierarchy',
  inward: 'is a child KPI of',
  outward: 'is the parent KPI of',
};
const SITE_LINK_TYPES = [
  { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
  KPI_HIERARCHY_LINK_TYPE,
];
export const READING_FIELD_ID = 'customfield_10837';
const WORK_PROJECTS = ['APP', 'WEB', 'OPS'];

export interface FixtureIssue {
  id: string;
  key: string;
  type: 'KPI' | 'Initiative' | 'Epic' | 'Story' | 'Subtask';
  summary: string;
  parentId: string | null;
  due: string | null;
  start: string | null;
  /** KPI-space only: parent KPI via a KPI Hierarchy issue link */
  kpiParentId?: string | null;
  rank?: string;
  properties: Record<string, unknown>;
}

export interface ScaleFixture {
  options: ScaleOptions;
  issues: Map<string, FixtureIssue>;
  childrenOf: Map<string, string[]>;
  kpiIds: string[];
  /** contributing (target-carrying) issue ids, in creation order */
  contributorIds: string[];
  readingChanges: Map<string, Array<{ created: number; to: string }>>;
  kvs: Map<string, unknown>;
  /** the site's issue link types (global in Jira) */
  linkTypes: IssueLinkTypeInfo[];
}

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 1);
const isoDay = (offsetDays: number): string => new Date(BASE + offsetDays * DAY).toISOString().slice(0, 10);

export function buildScaleFixture(overrides: Partial<ScaleOptions> = {}): ScaleFixture {
  const options = { ...DEFAULT_SCALE, ...overrides };
  const issues = new Map<string, FixtureIssue>();
  const childrenOf = new Map<string, string[]>();
  const add = (issue: FixtureIssue) => {
    issues.set(issue.id, issue);
    if (issue.parentId) {
      const list = childrenOf.get(issue.parentId) ?? [];
      list.push(issue.id);
      childrenOf.set(issue.parentId, list);
    }
  };

  // KPI space: groups of 5, the first of each group is a root.
  const kpiIds: string[] = [];
  const readingChanges = new Map<string, Array<{ created: number; to: string }>>();
  for (let k = 0; k < options.kpis; k += 1) {
    const id = String(1000 + k);
    const direction: KpiDirection = k % 2 === 0 ? 'increase' : 'decrease';
    kpiIds.push(id);
    issues.set(id, {
      id,
      key: `KPI-${k + 1}`,
      type: 'KPI',
      summary: `KPI ${k + 1}`,
      parentId: null,
      due: null,
      start: null,
      kpiParentId: k % 5 === 0 ? null : String(1000 + k - (k % 5)),
      rank: `0|i${String(options.kpis - k).padStart(5, '0')}:`,
      properties: { 'kpi-meta': { unit: k % 3 === 0 ? '%' : 'count', direction } },
    });
    const changes: Array<{ created: number; to: string }> = [];
    for (let r = 0; r < options.readingsPerKpi; r += 1) {
      const date = isoDay(-300 + r * 45);
      changes.push({ created: BASE + r * DAY, to: encodeReadingValue(date, 100 + k + r * (k % 2 === 0 ? 5 : -3)) });
    }
    readingChanges.set(id, changes);
  }

  // Work hierarchy.
  const contributorIds: string[] = [];
  let epicN = 0;
  let storyN = 0;
  let subtaskN = 0;
  for (let i = 0; i < options.initiatives; i += 1) {
    const initId = String(100_000 + i);
    add({
      id: initId,
      key: `INIT-${i + 1}`,
      type: 'Initiative',
      summary: `Initiative ${i + 1}`,
      parentId: null,
      due: null,
      start: null,
      properties: {},
    });
    for (let e = 0; e < options.epicsPerInitiative; e += 1) {
      const epicId = String(200_000 + epicN);
      const project = WORK_PROJECTS[epicN % WORK_PROJECTS.length];
      const undated = epicN % options.undatedEpicEvery === 0;
      const kpiKey = `KPI-${(epicN % options.kpis) + 1}`;
      add({
        id: epicId,
        key: `${project}-${epicN + 1}`,
        type: 'Epic',
        summary: `Epic ${epicN + 1}`,
        parentId: initId,
        due: undated ? null : isoDay(30 + (epicN % 330)),
        start: null,
        properties: { 'kpi-assignments': assignmentProperty(kpiKey, epicN) },
      });
      contributorIds.push(epicId);
      for (let s = 0; s < options.storiesPerEpic; s += 1) {
        const storyId = String(300_000 + storyN);
        add({
          id: storyId,
          key: `${project}-${10_000 + storyN}`,
          type: 'Story',
          summary: `Story ${storyN + 1}`,
          parentId: epicId,
          due: storyN % options.undatedStoryEvery === 0 ? null : isoDay(20 + ((storyN * 7) % 360)),
          start: null,
          properties: {},
        });
        for (let t = 0; t < options.subtasksPerStory; t += 1) {
          const subId = String(400_000 + subtaskN);
          add({
            id: subId,
            key: `${project}-${50_000 + subtaskN}`,
            type: 'Subtask',
            summary: `Subtask ${subtaskN + 1}`,
            parentId: storyId,
            due: subtaskN % 2 === 0 ? isoDay(10 + ((subtaskN * 11) % 370)) : null,
            start: null,
            properties: {},
          });
          subtaskN += 1;
        }
        storyN += 1;
      }
      epicN += 1;
    }
  }

  const kvs = new Map<string, unknown>([
    ['kpi:space', { key: KPI_PROJECT.key, projectId: KPI_PROJECT.id, name: KPI_PROJECT.name }],
    ['kpi:config:rollup', options.rollup],
    ['kpi:hierarchy', { linkTypeId: KPI_HIERARCHY_LINK_TYPE.id, parentEnd: 'inward' }],
  ]);
  const linkTypes = SITE_LINK_TYPES.map((t) => ({ ...t }));
  return { options, issues, childrenOf, kpiIds, contributorIds, readingChanges, kvs, linkTypes };
}

/** One target per epic, cycling absolute / relative-to-own-due / relative-to-parent-due / percent. */
function assignmentProperty(kpiKey: string, n: number): { assignments: Assignment[]; kpiIds: string[] } {
  const variant = n % 4;
  const assignment: Assignment = {
    kpiId: kpiKey,
    inheritFromParent: false,
    target: variant === 3 ? 10 : 150 + (n % 50),
    targetType: variant === 3 ? 'percent' : 'absolute',
    timing: {
      start: null,
      due:
        variant === 0
          ? { mode: 'absolute', absolute: isoDay(60 + (n % 300)), anchor: 'issueDueDate', offsetMonths: 0 }
          : variant === 2
            ? { mode: 'relative', absolute: null, anchor: 'parentDueDate', offsetMonths: 1 }
            : { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: variant === 3 ? 3 : 0 },
    },
    updatedBy: 'fixture',
    updatedAt: BASE,
  };
  return { assignments: [assignment], kpiIds: [kpiKey] };
}

// ── Mock Jira REST API ───────────────────────────────────────────────────────

interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function respond(status: number, body: unknown = {}, contentType = 'application/json'): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer as ArrayBuffer,
  };
}

const ICON_BASE = 'https://api.atlassian.com/ex/jira/cloud-id/rest/api/2/universal_avatar/view/type/issuetype/avatar';
const ICON_ID: Record<FixtureIssue['type'], number> = {
  KPI: 10300,
  Initiative: 10301,
  Epic: 10302,
  Story: 10303,
  Subtask: 10304,
};
/** Jira `issuetype.hierarchyLevel` per fixture type (KPI is a base-level type). */
const HIERARCHY_LEVEL: Record<FixtureIssue['type'], number> = {
  KPI: 0,
  Initiative: 2,
  Epic: 1,
  Story: 0,
  Subtask: -1,
};

/** How the fixture's KPI parent links read back: the configured type, parent on the configured end. */
interface FixtureLinkShape {
  type: IssueLinkTypeInfo;
  parentEnd: 'inward' | 'outward';
}

function kpiLinkShape(fixture: ScaleFixture): FixtureLinkShape {
  const cfg = fixture.kvs.get('kpi:hierarchy') as { linkTypeId?: string; parentEnd?: string } | undefined;
  const type = fixture.linkTypes.find((t) => t.id === cfg?.linkTypeId) ?? KPI_HIERARCHY_LINK_TYPE;
  return { type, parentEnd: cfg?.parentEnd === 'outward' ? 'outward' : 'inward' };
}

function issueJson(
  issue: FixtureIssue,
  fields: string[],
  properties: string[],
  link: FixtureLinkShape,
): Record<string, unknown> {
  const all: Record<string, unknown> = {
    summary: issue.summary,
    issuetype: {
      name: issue.type,
      hierarchyLevel: HIERARCHY_LEVEL[issue.type],
      iconUrl: `${ICON_BASE}/${ICON_ID[issue.type]}?size=medium`,
    },
    duedate: issue.due,
    customfield_10015: issue.start,
    status: { statusCategory: { key: 'indeterminate' } },
    parent: issue.parentId ? { id: issue.parentId } : undefined,
    issuelinks: issue.kpiParentId
      ? [{ type: link.type, [link.parentEnd === 'outward' ? 'outwardIssue' : 'inwardIssue']: { id: issue.kpiParentId } }]
      : [],
    [RANK_FIELD_ID]: issue.rank ?? null,
  };
  const picked: Record<string, unknown> = {};
  for (const f of fields) if (f in all && all[f] !== undefined) picked[f] = all[f];
  const out: Record<string, unknown> = { id: issue.id, key: issue.key, fields: picked };
  if (properties.length > 0) {
    const props: Record<string, unknown> = {};
    for (const p of properties) if (p in issue.properties) props[p] = issue.properties[p];
    out.properties = props;
  }
  return out;
}

function runJql(fixture: ScaleFixture, jql: string): FixtureIssue[] | null {
  const q = jql.trim();
  const get = (id: string): FixtureIssue | undefined => fixture.issues.get(id);
  const inList = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const childrenOf = (id: string) =>
    (fixture.childrenOf.get(id) ?? []).map(get).filter((i): i is FixtureIssue => !!i);

  let m = /^id\s+in\s*\(([^)]*)\)/i.exec(q);
  if (m) return inList(m[1]).map(get).filter((i): i is FixtureIssue => !!i);
  m = /^parent\s+in\s*\(([^)]*)\)/i.exec(q);
  if (m) return inList(m[1]).flatMap(childrenOf);
  m = /^parent\s*=\s*(\S+)/i.exec(q);
  if (m) return childrenOf(m[1]);
  m = /^project\s*=\s*(\w+)/i.exec(q);
  if (m && m[1] === KPI_PROJECT.key) return fixture.kpiIds.map(get).filter((i): i is FixtureIssue => !!i);
  if (/issue\.property\[kpi-assignments\]\.kpiIds\s+IS\s+NOT\s+EMPTY/i.test(q)) {
    return fixture.contributorIds.map(get).filter((i): i is FixtureIssue => !!i);
  }
  return null;
}

export interface MockJira {
  fixture: ScaleFixture;
  requestJira(route: unknown, init?: { method?: string; body?: unknown }): Promise<MockResponse>;
  /** requests that hit no mock handler (should stay empty) */
  unhandled: string[];
  /** every non-GET request, in order (`METHOD path`) */
  writes: string[];
  /**
   * Answer a request before the mock handlers do (return undefined to fall
   * through) — e.g. to make a write fail.
   */
  intercept?: (method: string, path: string, body: unknown, raw: string) => { status: number; body?: unknown } | undefined;
}

export { respond as mockResponse };

export function createMockJira(fixture: ScaleFixture): MockJira {
  const unhandled: string[] = [];
  const writes: string[] = [];
  const findIssue = (idOrKey: string) =>
    fixture.issues.get(idOrKey) ?? [...fixture.issues.values()].find((i) => i.key === idOrKey);
  let nextIssueId = 900_000;

  const handle = (method: string, raw: string, body: unknown): MockResponse => {
    const [path, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    if (method !== 'GET') writes.push(`${method} ${path}`);
    const intercepted = mock.intercept?.(method, path, body, raw);
    if (intercepted) return respond(intercepted.status, intercepted.body ?? {});

    if (method === 'GET' && path === '/rest/api/3/field') {
      return respond(200, [
        { id: 'summary', name: 'Summary' },
        { id: RANK_FIELD_ID, name: 'Rank', schema: { custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' } },
        { id: READING_FIELD_ID, key: 'app-key__kpi-reading', name: 'KPI Reading' },
      ]);
    }

    if (method === 'GET' && path === '/rest/api/3/search/jql') {
      const matched = runJql(fixture, params.get('jql') ?? '');
      if (!matched) return respond(400, { errorMessages: [`Unsupported JQL: ${params.get('jql')}`] });
      const fields = (params.get('fields') ?? '').split(',').filter(Boolean);
      const properties = (params.get('properties') ?? '').split(',').filter(Boolean);
      const maxResults = Number(params.get('maxResults') ?? 50);
      const offset = Number(params.get('nextPageToken') ?? 0);
      const page = matched.slice(offset, offset + maxResults);
      const more = offset + maxResults < matched.length;
      return respond(200, {
        issues: page.map((i) => issueJson(i, fields, properties, kpiLinkShape(fixture))),
        isLast: !more,
        ...(more ? { nextPageToken: String(offset + maxResults) } : {}),
      });
    }

    const single = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path);
    if (single && method === 'GET') {
      const idOrKey = decodeURIComponent(single[1]);
      const issue =
        fixture.issues.get(idOrKey) ?? [...fixture.issues.values()].find((i) => i.key === idOrKey);
      if (!issue) return respond(404, { errorMessages: ['not found'] });
      const fields = (params.get('fields') ?? '').split(',').filter(Boolean);
      const properties = (params.get('properties') ?? '').split(',').filter(Boolean);
      return respond(200, issueJson(issue, fields, properties, kpiLinkShape(fixture)));
    }

    const prop = /^\/rest\/api\/3\/issue\/([^/]+)\/properties\/([^/]+)$/.exec(path);
    if (prop && method === 'GET') {
      const idOrKey = decodeURIComponent(prop[1]);
      const issue =
        fixture.issues.get(idOrKey) ?? [...fixture.issues.values()].find((i) => i.key === idOrKey);
      const key = decodeURIComponent(prop[2]);
      if (!issue || !(key in issue.properties)) return respond(404, { errorMessages: ['not found'] });
      return respond(200, { key, value: issue.properties[key] });
    }

    if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
      const req = JSON.parse(String(body)) as { issueIdsOrKeys: string[] };
      return respond(200, {
        issueChangeLogs: req.issueIdsOrKeys.map((id) => ({
          issueId: id,
          changeHistories: (fixture.readingChanges.get(id) ?? []).map((c) => ({
            created: c.created,
            items: [{ fieldId: READING_FIELD_ID, to: c.to, toString: c.to }],
          })),
        })),
      });
    }

    if (prop && method === 'PUT') {
      const issue = findIssue(decodeURIComponent(prop[1]));
      if (!issue) return respond(404, { errorMessages: ['not found'] });
      issue.properties[decodeURIComponent(prop[2])] = JSON.parse(String(body));
      return respond(200);
    }

    if (method === 'POST' && path === '/rest/api/3/issue') {
      const req = JSON.parse(String(body)) as {
        fields: { summary: string };
        properties?: Array<{ key: string; value: unknown }>;
      };
      const id = String(nextIssueId++);
      const key = `${KPI_PROJECT.key}-${fixture.kpiIds.length + 1}`;
      fixture.issues.set(id, {
        id,
        key,
        type: 'KPI',
        summary: req.fields.summary,
        parentId: null,
        due: null,
        start: null,
        kpiParentId: null,
        properties: Object.fromEntries((req.properties ?? []).map((p) => [p.key, p.value])),
      });
      fixture.kpiIds.push(id);
      return respond(201, { id, key });
    }

    if (method === 'POST' && path === '/rest/api/3/issueLink') {
      const req = JSON.parse(String(body)) as {
        type: { id?: string };
        outwardIssue: { key: string };
        inwardIssue: { key: string };
      };
      if (!fixture.linkTypes.some((t) => t.id === req.type?.id)) {
        return respond(404, { errorMessages: [`No issue link type with id '${req.type?.id}' found.`] });
      }
      const cfg = fixture.kvs.get('kpi:hierarchy') as { parentEnd?: string } | undefined;
      const parentOnOutward = cfg?.parentEnd === 'outward';
      const parent = findIssue(parentOnOutward ? req.outwardIssue.key : req.inwardIssue.key);
      const child = findIssue(parentOnOutward ? req.inwardIssue.key : req.outwardIssue.key);
      if (!parent || !child) return respond(404, { errorMessages: ['Issue does not exist'] });
      child.kpiParentId = parent.id;
      return respond(201);
    }

    if (method === 'GET' && path === '/rest/api/3/issueLinkType') {
      return respond(200, { issueLinkTypes: fixture.linkTypes });
    }

    if (method === 'POST' && path === '/rest/api/3/issueLinkType') {
      const req = JSON.parse(String(body)) as Omit<IssueLinkTypeInfo, 'id'>;
      const created = { id: String(10_600 + fixture.linkTypes.length), ...req };
      fixture.linkTypes.push(created);
      return respond(201, created);
    }

    if (single && method === 'DELETE') {
      const issue = findIssue(decodeURIComponent(single[1]));
      if (!issue) return respond(404, { errorMessages: ['not found'] });
      fixture.issues.delete(issue.id);
      fixture.kpiIds = fixture.kpiIds.filter((id) => id !== issue.id);
      return respond(204);
    }

    if (method === 'PUT' && path === `/rest/api/3/app/field/${READING_FIELD_ID}/value`) {
      return respond(204);
    }

    if (method === 'GET' && path.startsWith('/rest/api/2/universal_avatar/')) {
      return respond(200, {}, 'image/svg+xml');
    }

    unhandled.push(`${method} ${raw}`);
    return respond(404, { errorMessages: [`[mockJira] unhandled ${method} ${path}`] });
  };

  const mock: MockJira = {
    fixture,
    unhandled,
    writes,
    async requestJira(route, init) {
      if (fixture.options.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fixture.options.latencyMs));
      }
      const raw = typeof route === 'string' ? route : String((route as { value: string }).value);
      return handle((init?.method ?? 'GET').toUpperCase(), raw, init?.body);
    },
  };
  return mock;
}

/** `@forge/api` stand-ins that build routes like the real module (query params URI-encoded). */
export const forgeRouteHelpers = {
  route: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    value: strings.reduce((acc, s, i) => {
      if (i >= values.length) return acc + s;
      const v = values[i];
      const isRoute = typeof v === 'object' && v !== null && 'value' in v;
      return acc + s + (isRoute ? String((v as { value: string }).value) : encodeURIComponent(String(v)));
    }, ''),
  }),
  routeFromAbsolute: (absolute: string) => {
    const u = new URL(absolute);
    return { value: `${u.pathname}${u.search}` };
  },
  assumeTrustedRoute: (path: string) => ({ value: path }),
};
