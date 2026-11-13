import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `jira.ts` imports `@forge/api`, which is only available inside a Forge runtime.
// Stub it so we can unit-test the `writeReading` flow: it writes the encoded
// reading through the standard issue edit (PUT /rest/api/3/issue/{id}).
let putResult: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};
let postResult: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};
const defaultRequestJira = async (route: unknown, options?: { method?: string }): Promise<unknown> => {
  const url = String(route);
  if (options?.method === 'POST') {
    // Issue create (POST /rest/api/3/issue).
    return postResult;
  }
  if (options?.method === 'PUT') {
    // Issue edit (the reading write).
    return putResult;
  }
  if (url.includes('/rest/api/3/issue/')) {
    // Numeric-id resolution GET → returns the issue's numeric id.
    return { ok: true, json: async () => ({ id: '10001' }) };
  }
  // getReadingFieldId() → GET /rest/api/3/field
  return {
    ok: true,
    json: async () => [{ id: 'customfield_10837', key: 'kpi-reading', name: 'KPI Reading' }],
  };
};
const requestJira = vi.fn<(route: unknown, options?: { method?: string }) => Promise<unknown>>(defaultRequestJira);

vi.mock('@forge/api', () => ({
  default: {
    asApp: () => ({ requestJira }),
    asUser: () => ({ requestJira }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), ''),
  // Mirror the real `@forge/api` behavior (strip the domain, keep pathname +
  // search) so `fetchIconDataUrl`'s own path-normalization logic is what's
  // actually under test, not a mock stand-in for it.
  routeFromAbsolute: (absolutePath: string) => {
    const u = new URL(absolutePath);
    return `${u.pathname}${u.search}`;
  },
  assumeTrustedRoute: (path: string) => path,
  getAppContext: () => {
    throw new Error('not running in Forge');
  },
}));

import {
  JiraForbiddenError,
  writeReading,
  createKpiIssue,
  writeAssignments,
  fetchIssuesByIds,
  fetchChildrenForIds,
  fetchSubtreeTimingNodesForRoots,
  fetchIconDataUrl,
  fetchHierarchyLevels,
  pickReadingField,
} from './jira.js';
import { dateFieldSelection } from '../domain/index.js';

describe('createKpiIssue', () => {
  const HIER = { linkTypeId: '10500', parentEnd: 'inward' as const };
  beforeEach(() => {
    requestJira.mockClear();
  });

  it('refuses to nest (before creating anything) when no hierarchy link type is configured', async () => {
    await expect(
      createKpiIssue('10000', { name: 'Revenue', unit: '$', direction: null, parentKpiId: 'KPI-1' }, null),
    ).rejects.toThrow(/^KPI hierarchy is not set up/);
    expect(requestJira).not.toHaveBeenCalled();
  });

  it('throws (not a silent half-create) when Jira rejects the issue POST', async () => {
    // e.g. a level-0 KPI `parent` link Jira won't accept — must surface, not
    // return a KPI with an undefined key.
    postResult = { ok: false, status: 400, json: async () => ({ errorMessages: ['boom'] }) };
    await expect(
      createKpiIssue('10000', { name: 'Revenue', unit: '$', direction: 'increase', parentKpiId: 'KPI-1' }, HIER),
    ).rejects.toThrow('Jira 400 while trying to create KPI issue "Revenue": boom');

    // No property write should have been attempted after the failed create.
    const putCall = requestJira.mock.calls.find(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeUndefined();
  });

  it('sets kpi-meta in the create request itself (no separate property PUT) and returns the new KPI', async () => {
    postResult = { ok: true, status: 201, json: async () => ({ id: '10050', key: 'KPI-7' }) };
    const created = await createKpiIssue('10000', {
      name: ' Revenue ',
      unit: ' $ ',
      direction: 'increase',
      parentKpiId: 'KPI-1',
    }, HIER);

    expect(created).toEqual({
      id: '10050',
      kpiId: 'KPI-7',
      issueKey: 'KPI-7',
      name: 'Revenue',
      unit: '$',
      direction: 'increase',
      parentKpiId: 'KPI-1',
    });
    const posts = requestJira.mock.calls.filter(([, o]) => o?.method === 'POST');
    const createBody = JSON.parse((posts[0][1] as { body: string }).body) as {
      fields: { summary: string };
      properties: Array<{ key: string; value: unknown }>;
    };
    expect(createBody.fields.summary).toBe('Revenue');
    expect(createBody.properties).toEqual([{ key: 'kpi-meta', value: { unit: '$', direction: 'increase' } }]);
    // The nest is the only follow-up request: a link of the configured type, parent on its configured end.
    expect(posts.map(([r]) => String(r))).toEqual(['/rest/api/3/issue', '/rest/api/3/issueLink']);
    expect(JSON.parse((posts[1][1] as { body: string }).body)).toEqual({
      type: { id: '10500' },
      inwardIssue: { key: 'KPI-1' },
      outwardIssue: { key: 'KPI-7' },
    });
    expect(requestJira.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false);
  });

  describe('when the hierarchy link fails', () => {
    const linkFails = (deleteResult: { ok: boolean; status: number }) =>
      requestJira.mockImplementation(async (route, options) => {
        const url = String(route);
        if (options?.method === 'DELETE') return { ...deleteResult, json: async () => ({}) };
        if (url === '/rest/api/3/issueLink') {
          return { ok: false, status: 404, json: async () => ({ errorMessages: ['No issue KPI-1'] }) };
        }
        return { ok: true, status: 201, json: async () => ({ id: '10050', key: 'KPI-7' }) };
      });
    afterEach(() => requestJira.mockImplementation(defaultRequestJira));

    it('deletes the just-created issue (no orphan root KPI, no duplicate on retry) and rethrows', async () => {
      linkFails({ ok: true, status: 204 });
      await expect(
        createKpiIssue('10000', { name: 'Revenue', unit: '$', direction: null, parentKpiId: 'KPI-1' }, HIER),
      ).rejects.toThrow('Jira 404 while trying to link KPI "KPI-7" under "KPI-1": No issue KPI-1');
      const del = requestJira.mock.calls.find(([, o]) => o?.method === 'DELETE');
      expect(String(del?.[0])).toBe('/rest/api/3/issue/KPI-7');
    });

    it('says the KPI was left behind when the rollback fails too', async () => {
      linkFails({ ok: false, status: 403 });
      await expect(
        createKpiIssue('10000', { name: 'Revenue', unit: '$', direction: null, parentKpiId: 'KPI-1' }, HIER),
      ).rejects.toThrow('KPI-7 was created without its parent; delete it in Jira.');
    });
  });
});

describe('fetchIconDataUrl', () => {
  beforeEach(() => {
    requestJira.mockClear();
  });

  // Regression test: Jira's search API returns CUSTOM issue-type icon URLs
  // already in Atlassian's API-gateway absolute form
  // (`https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/...`) — the same
  // gateway host `asUser().requestJira()` itself used to make the search call.
  // Naively stripping just the domain (as `routeFromAbsolute` does) would
  // leave the `/ex/jira/{cloudId}` segment in the "path" handed back to
  // `requestJira`, which prefixes its own gateway routing onto it — a
  // double-prefixed request that fails outright. `fetchIconDataUrl` must
  // normalize this down to a plain site-relative REST path.
  it('normalizes an API-gateway-absolute icon URL to a plain site-relative REST path', async () => {
    requestJira.mockImplementationOnce(async () => ({
      ok: true,
      headers: { get: () => 'image/svg+xml' },
      arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer,
    }));
    const gatewayUrl =
      'https://api.atlassian.com/ex/jira/74eb923a-a968-44b2-8b4c-5b69e7266b8c/rest/api/2/universal_avatar/view/type/issuetype/avatar/10322?size=medium';

    const result = await fetchIconDataUrl(gatewayUrl);

    expect(result).toMatch(/^data:image\/svg\+xml/);
    expect(String(requestJira.mock.calls[0][0])).toBe(
      '/rest/api/2/universal_avatar/view/type/issuetype/avatar/10322?size=medium',
    );
  });

  it('still handles a plain site-relative absolute icon URL (built-in issue types)', async () => {
    requestJira.mockImplementationOnce(async () => ({
      ok: true,
      headers: { get: () => 'image/svg+xml' },
      arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer,
    }));
    const siteUrl = 'https://bitovi-training.atlassian.net/images/icons/issuetypes/epic.svg';

    const result = await fetchIconDataUrl(siteUrl);

    expect(result).toMatch(/^data:image\/svg\+xml/);
    expect(String(requestJira.mock.calls[0][0])).toBe('/images/icons/issuetypes/epic.svg');
  });
});

describe('writeReading', () => {
  beforeEach(() => {
    requestJira.mockClear();
  });

  it('throws a descriptive error when the reading PUT fails (not silently swallowed)', async () => {
    putResult = { ok: false, status: 400, text: async () => 'boom' };
    await expect(writeReading('10001', '2026-07-13', 42)).rejects.toThrow('Failed to write reading (400): boom');
  });

  it('throws JiraForbiddenError when Jira refuses the edit (no Edit Issues)', async () => {
    putResult = { ok: false, status: 403, json: async () => ({ errorMessages: ['nope'] }) };
    await expect(writeReading('10001', '2026-07-13', 42)).rejects.toBeInstanceOf(JiraForbiddenError);
  });

  it('writes the encoded reading through the standard issue edit (spec 10, Path A)', async () => {
    putResult = { ok: true, status: 204 };
    await expect(writeReading('10001', '2026-07-13', 42)).resolves.toBeUndefined();

    const putCall = requestJira.mock.calls.find(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    const [putRoute, putOpts] = putCall as [unknown, { body: string }];
    expect(String(putRoute)).toBe('/rest/api/3/issue/10001');
    expect(JSON.parse(putOpts.body)).toEqual({
      fields: { customfield_10837: JSON.stringify({ d: '2026-07-13', v: 42 }) },
    });
    expect(requestJira.mock.calls.some(([r]) => String(r).includes('/app/field/'))).toBe(false);
  });
});

describe('writeAssignments', () => {
  beforeEach(() => {
    requestJira.mockClear();
  });

  it('writes a denormalized kpiIds index so the property is JQL-searchable', async () => {
    // The manifest indexes kpi-assignments -> kpiIds; without writing kpiIds the
    // index stays empty and the timeline can never discover targeted KPIs.
    putResult = { ok: true, status: 200 };
    const base = {
      inheritFromParent: false,
      target: 250,
      targetType: 'absolute' as const,
      timing: {
        start: null,
        due: { mode: 'relative' as const, absolute: null, anchor: 'issueDueDate' as const, offsetMonths: 0 },
      },
      updatedBy: 'acc-jm',
      updatedAt: 0,
    };
    await writeAssignments('10001', [
      { kpiId: 'revenue', ...base },
      { kpiId: 'costs', ...base },
    ]);

    const putCall = requestJira.mock.calls.find(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    const [, putOpts] = putCall as [unknown, { body: string }];
    const body = JSON.parse(putOpts.body) as { assignments: unknown[]; kpiIds: string[] };
    expect(body.kpiIds).toEqual(['revenue', 'costs']);
    expect(body.assignments).toHaveLength(2);
  });

  it('throws when Jira rejects the write (e.g. no Edit Issues permission)', async () => {
    putResult = {
      ok: false,
      status: 403,
      json: async () => ({ errorMessages: ['You do not have permission to edit issues.'] }),
    };
    await expect(writeAssignments('10001', [])).rejects.toThrow(
      'Jira 403 while trying to save targets on issue 10001: You do not have permission to edit issues.',
    );
  });
});

/** Pulls the comma-separated id list out of a `jql=<keyword> (a,b,c)` search URL. */
function idsFromJql(url: string, keyword: 'id in' | 'parent in'): string[] {
  const marker = `jql=${keyword} (`;
  const start = url.indexOf(marker) + marker.length;
  const end = url.indexOf(')', start);
  return url.slice(start, end).split(',');
}

describe('fetchIssuesByIds / fetchChildrenForIds batching', () => {
  const savedImpl = requestJira.getMockImplementation();

  beforeEach(() => {
    requestJira.mockClear();
  });

  afterEach(() => {
    if (savedImpl) requestJira.mockImplementation(savedImpl);
  });

  it('chunks id-in-() lookups at the 40-id boundary', async () => {
    requestJira.mockImplementation(async (route: unknown) => {
      const ids = idsFromJql(String(route), 'id in');
      return {
        ok: true,
        json: async () => ({
          issues: ids.map((id) => ({
            id,
            key: `T-${id}`,
            fields: { issuetype: { name: 'Story' }, status: { statusCategory: { key: 'new' } } },
          })),
        }),
      };
    });

    const ids = Array.from({ length: 41 }, (_, i) => String(i + 1));
    const result = await fetchIssuesByIds(ids);

    expect(requestJira).toHaveBeenCalledTimes(2); // 40 + 1, chunked
    expect(result.size).toBe(41);
    expect(result.get('41')?.issueKey).toBe('T-41');
  });

  it('chunks parent-in-() lookups at the 40-id boundary', async () => {
    requestJira.mockImplementation(async (route: unknown) => {
      const parentIds = idsFromJql(String(route), 'parent in');
      return {
        ok: true,
        json: async () => ({
          issues: parentIds.map((pid) => ({ id: `${pid}-child`, fields: { parent: { id: pid } } })),
        }),
      };
    });

    const parentIds = Array.from({ length: 41 }, (_, i) => String(i + 1));
    const result = await fetchChildrenForIds(parentIds);

    expect(requestJira).toHaveBeenCalledTimes(2); // 40 + 1, chunked
    expect(result.get('41')).toEqual(['41-child']);
  });

  it('requests and reads the date fields selected per issue type', async () => {
    requestJira.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        issues: [
          {
            id: '1',
            key: 'INIT-1',
            fields: {
              issuetype: { name: 'Initiative' },
              duedate: '2026-12-31',
              customfield_10015: '2026-01-01',
              customfield_20001: '2026-02-01',
              customfield_20002: '2026-09-30T17:00:00.000-0500',
            },
          },
          {
            id: '2',
            key: 'EPIC-2',
            fields: { issuetype: { name: 'Epic' }, duedate: '2026-05-31', customfield_10015: '2026-03-01' },
          },
        ],
      }),
    }));

    const selection = dateFieldSelection({
      dateFields: { Initiative: { start: 'customfield_20001', due: 'customfield_20002' } },
    });
    const result = await fetchIssuesByIds(['1', '2'], selection);

    const url = String(requestJira.mock.calls[0][0]);
    for (const f of ['duedate', 'customfield_10015', 'customfield_20001', 'customfield_20002']) {
      expect(url).toContain(f);
    }
    expect(result.get('1')).toMatchObject({ ownStart: '2026-02-01', ownDueDate: '2026-09-30' });
    expect(result.get('2')).toMatchObject({ ownStart: '2026-03-01', ownDueDate: '2026-05-31' });
  });

  it("reads a level's date fields for EVERY issue type at that level", async () => {
    // Milestone and Increment share hierarchy level 2; Settings saved the level once.
    const fieldsAt = (name: string) => ({
      issuetype: { name, hierarchyLevel: 2 },
      duedate: '2026-12-31',
      customfield_10015: '2026-01-01',
      customfield_20001: '2026-02-01',
      customfield_20002: '2026-09-30',
    });
    requestJira.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        issues: [
          { id: '1', key: 'MS-1', fields: fieldsAt('Milestone') },
          { id: '2', key: 'INC-2', fields: fieldsAt('Increment') },
        ],
      }),
    }));

    const selection = dateFieldSelection({
      dateFields: { '2': { start: 'customfield_20001', due: 'customfield_20002' } },
    });
    const result = await fetchIssuesByIds(['1', '2'], selection);

    for (const id of ['1', '2']) {
      expect(result.get(id)).toMatchObject({ hierarchyLevel: 2, ownStart: '2026-02-01', ownDueDate: '2026-09-30' });
    }
  });
});

describe('fetchSubtreeTimingNodesForRoots', () => {
  const savedImpl = requestJira.getMockImplementation();

  beforeEach(() => {
    requestJira.mockClear();
  });

  afterEach(() => {
    if (savedImpl) requestJira.mockImplementation(savedImpl);
  });

  it('fetches a shared subtree level-by-level (O(depth) calls, not O(nodes))', async () => {
    // root '1' has 45 direct children ('2'..'46'); none of those have children.
    // 45 forces the level-1 fetch to chunk into 2 batches (40 + 5).
    const childIds = Array.from({ length: 45 }, (_, i) => String(i + 2));

    requestJira.mockImplementation(async (route: unknown) => {
      const url = String(route);
      if (url.includes('jql=id in (')) {
        const ids = idsFromJql(url, 'id in');
        return {
          ok: true,
          json: async () => ({
            issues: ids.map((id) => ({
              id,
              key: `T-${id}`,
              fields: {
                parent: id === '1' ? undefined : { id: '1' },
                issuetype: { name: 'Story' },
                duedate: null,
                customfield_10015: null,
                status: { statusCategory: { key: 'new' } },
              },
            })),
          }),
        };
      }
      if (url.includes('jql=parent in (')) {
        const parentIds = idsFromJql(url, 'parent in');
        const issues = parentIds.includes('1')
          ? childIds.map((cid) => ({ id: cid, fields: { parent: { id: '1' } } }))
          : [];
        return { ok: true, json: async () => ({ issues }) };
      }
      return { ok: true, json: async () => ({ issues: [] }) };
    });

    const nodes = await fetchSubtreeTimingNodesForRoots(['1']);

    expect(nodes.size).toBe(46); // root + 45 children
    expect(nodes.get('1')?.childIds).toEqual(childIds);
    // level 0: 1 id-in + 1 parent-in call; level 1 (45 ids, chunked 40+5):
    // 2 id-in + 2 parent-in calls. Total 6, vs. 92 for the old per-node walk.
    expect(requestJira).toHaveBeenCalledTimes(6);
  });

  it('fetches a node reachable from two roots only once', async () => {
    // Roots 'A' and 'B' share child 'shared'.
    requestJira.mockImplementation(async (route: unknown) => {
      const url = String(route);
      if (url.includes('jql=id in (')) {
        const ids = idsFromJql(url, 'id in');
        return {
          ok: true,
          json: async () => ({
            issues: ids.map((id) => ({
              id,
              key: `T-${id}`,
              fields: { issuetype: { name: 'Story' }, status: { statusCategory: { key: 'new' } } },
            })),
          }),
        };
      }
      if (url.includes('jql=parent in (')) {
        const parentIds = idsFromJql(url, 'parent in');
        const issues = parentIds
          .filter((pid) => pid === 'A' || pid === 'B')
          .map((pid) => ({ id: 'shared', fields: { parent: { id: pid } } }));
        return { ok: true, json: async () => ({ issues }) };
      }
      return { ok: true, json: async () => ({ issues: [] }) };
    });

    const nodes = await fetchSubtreeTimingNodesForRoots(['A', 'B']);

    expect(nodes.size).toBe(3); // A, B, shared
    expect(nodes.has('shared')).toBe(true);
    // level 0 (roots A,B, one chunk each type): 1 id-in + 1 parent-in.
    // level 1 ('shared', deduped to a single unvisited id): 1 id-in + 1 parent-in.
    expect(requestJira).toHaveBeenCalledTimes(4);
  });
});


describe('fetchHierarchyLevels', () => {
  const savedImpl = requestJira.getMockImplementation();
  afterEach(() => {
    if (savedImpl) requestJira.mockImplementation(savedImpl);
  });

  it('groups every issue type by level, top → leaf, deduping repeated names', async () => {
    requestJira.mockImplementation(async () => ({
      ok: true,
      json: async () => [
        { name: 'Bug', hierarchyLevel: 0 },
        { name: 'Story', hierarchyLevel: 0 },
        { name: 'Epic', hierarchyLevel: 1 },
        { name: 'Epic', hierarchyLevel: 1 }, // a team-managed project's own Epic
        { name: 'Increment', hierarchyLevel: 2 },
        { name: 'Milestone', hierarchyLevel: 2 },
        { name: 'Sub-task', hierarchyLevel: -1 },
      ],
    }));
    expect(await fetchHierarchyLevels()).toEqual([
      { level: 2, name: 'Increment', issueTypeNames: ['Increment', 'Milestone'] },
      { level: 1, name: 'Epic', issueTypeNames: ['Epic'] },
      { level: 0, name: 'Story', issueTypeNames: ['Story', 'Bug'] },
      { level: -1, name: 'Sub-task', issueTypeNames: ['Sub-task'] },
    ]);
  });
});

describe('pickReadingField', () => {
  const dev = { id: 'customfield_10837', key: 'app__DEVELOPMENT__kpi-reading', name: 'KPI Reading (dev)' };
  const staging = { id: 'customfield_10906', key: 'app__STAGING__kpi-reading', name: 'KPI Reading (staging)' };
  const prod = { id: 'customfield_10999', key: 'app__kpi-reading', name: 'KPI Reading' };
  const other = { id: 'summary', name: 'Summary' };

  it("picks the running environment's field when several installs share the site", () => {
    expect(pickReadingField([other, dev, staging], 'STAGING')?.id).toBe('customfield_10906');
    expect(pickReadingField([other, staging, dev], 'development')?.id).toBe('customfield_10837');
  });

  it('prefers an untagged field when the environment has no tagged one', () => {
    expect(pickReadingField([dev, prod, staging], 'PRODUCTION')?.id).toBe('customfield_10999');
  });

  it('falls back to the first match outside Forge', () => {
    expect(pickReadingField([other, dev, staging], null)?.id).toBe('customfield_10837');
    expect(pickReadingField([other], null)).toBeUndefined();
  });
});
