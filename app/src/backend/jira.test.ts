import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const requestJira = vi.fn(
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
}));

import { writeReading, createKpiIssue, writeAssignments } from './jira.js';

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

