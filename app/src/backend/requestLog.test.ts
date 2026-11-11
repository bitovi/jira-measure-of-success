import { describe, it, expect, vi } from 'vitest';

const requestJira = vi.fn(async () => ({ status: 200 }));
vi.mock('@forge/api', () => ({
  default: { asUser: () => ({ requestJira }), asApp: () => ({ requestJira }) },
}));

import { asApp, asUser, endpointOf, setTraceSink, stage, summarizeTrace, traced, type Trace } from './requestLog';

describe('endpointOf', () => {
  it('replaces ids and keys but keeps the API version', () => {
    expect(endpointOf('get', '/rest/api/3/issue/10001/properties/kpi-meta')).toBe(
      'GET /rest/api/3/issue/{id}/properties/kpi-meta',
    );
    expect(endpointOf('GET', { value: '/rest/api/3/issue/KPI-12?fields=' })).toBe('GET /rest/api/3/issue/{id}');
    expect(endpointOf('PUT', '/rest/api/3/app/field/customfield_10837/value?generateChangelog=true')).toBe(
      'PUT /rest/api/3/app/field/{field}/value',
    );
  });

  it('tags JQL searches by query shape', () => {
    const search = (jql: string) => `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100`;
    expect(endpointOf('GET', search('id in (1,2)'))).toBe('GET /rest/api/3/search/jql [id in]');
    expect(endpointOf('GET', search('parent in (1,2)'))).toBe('GET /rest/api/3/search/jql [parent in]');
    expect(endpointOf('GET', '/rest/api/3/search/jql?jql=project=KPI+ORDER+BY+created+ASC')).toBe(
      'GET /rest/api/3/search/jql [project]',
    );
    expect(endpointOf('GET', search('issue.property[kpi-assignments].kpiIds IS NOT EMPTY'))).toBe(
      'GET /rest/api/3/search/jql [kpi-assignments index]',
    );
  });
});

describe('traced', () => {
  it('records requests and stages of one invocation and hands the trace to the sink', async () => {
    const traces: Trace[] = [];
    const prev = setTraceSink((t) => traces.push(t));
    try {
      await traced('getThing', async () => {
        await stage('load', async () => {
          await asUser().requestJira({ value: '/rest/api/3/issue/1' } as never);
          await asApp().requestJira({ value: '/rest/api/3/issue/2' } as never);
        });
      });
    } finally {
      setTraceSink(prev);
    }
    expect(traces).toHaveLength(1);
    const summary = summarizeTrace(traces[0]);
    expect(summary.label).toBe('getThing');
    expect(summary.byEndpoint).toEqual({ 'GET /rest/api/3/issue/{id}': 2 });
    expect(Object.keys(summary.stages)).toEqual(['load']);
    expect(traces[0].requests.map((r) => r.as)).toEqual(['user', 'app']);
  });

  it('is a pass-through outside a trace', async () => {
    requestJira.mockClear();
    await expect(stage('x', async () => 42)).resolves.toBe(42);
    await asUser().requestJira({ value: '/rest/api/3/field' } as never);
    expect(requestJira).toHaveBeenCalledTimes(1);
  });

  it('logs even when the invocation throws', async () => {
    const traces: Trace[] = [];
    const prev = setTraceSink((t) => traces.push(t));
    try {
      await expect(traced('boom', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    } finally {
      setTraceSink(prev);
    }
    expect(traces.map((t) => t.label)).toEqual(['boom']);
  });
});
