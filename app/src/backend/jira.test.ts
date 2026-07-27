import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `jira.ts` imports `@forge/api`, which is only available inside a Forge runtime.
// Stub it so we can unit-test the `writeReading` flow: it resolves the numeric
// issue id via GET, then writes the reading through the app custom field value
// API (PUT /rest/api/3/app/field/{id}/value?generateChangelog=true).
let putResult: { ok: boolean; status: number; text?: () => Promise<string> };
let postResult: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};
const requestJira = vi.fn<(route: unknown, options?: { method?: string }) => Promise<unknown>>(
  async (route: unknown, options?: { method?: string }) => {
    const url = String(route);
    if (options?.method === 'POST') {
      // Issue create (POST /rest/api/3/issue).
      return postResult;
    }
    if (options?.method === 'PUT') {
      // App custom field value write.
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
  },
);

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
}));

import {
  writeReading,
  createKpiIssue,
  writeAssignments,
  fetchIssuesByIds,
  fetchChildrenForIds,
  fetchSubtreeTimingNodesForRoots,
  fetchIconDataUrl,
} from './jira.js';

describe('createKpiIssue', () => {
  beforeEach(() => {
    requestJira.mockClear();
  });

  it('throws (not a silent half-create) when Jira rejects the issue POST', async () => {
    // e.g. a level-0 KPI `parent` link Jira won't accept — must surface, not
    // fall through to writeKpiMeta with an undefined key.
    postResult = { ok: false, status: 400, json: async () => ({ errorMessages: ['boom'] }) };
    await expect(
      createKpiIssue('10000', { name: 'Revenue', unit: '$', direction: 'increase', parentKpiId: 'KPI-1' }),
    ).rejects.toThrow('Jira 400 while trying to create KPI issue "Revenue": boom');

    // No property write should have been attempted after the failed create.
    const putCall = requestJira.mock.calls.find(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeUndefined();
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
    await expect(writeReading('KPI-1', '2026-07-13', 42)).rejects.toThrow(
      'Failed to write reading (400): boom',
    );
  });

  it('writes via the app custom field value API with the numeric issue id', async () => {
    putResult = { ok: true, status: 204 };
    await expect(writeReading('KPI-1', '2026-07-13', 42)).resolves.toBeUndefined();

    const putCall = requestJira.mock.calls.find(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    const [putRoute, putOpts] = putCall as [unknown, { body: string }];
    expect(String(putRoute)).toContain('/app/field/customfield_10837/value?generateChangelog=true');
    expect(JSON.parse(putOpts.body)).toMatchObject({
      updates: [{ issueIds: [10001] }],
    });
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

