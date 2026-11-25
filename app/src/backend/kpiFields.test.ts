import { describe, it, expect, vi } from 'vitest';
import {
  buildScaleFixture,
  chooseKpiFields,
  createMockJira,
  FIELD_EDITED_UNIT,
  KPI_DIRECTION_FIELD_ID,
  KPI_DIRECTION_OPTION_IDS,
  KPI_UNIT_FIELD_ID,
  type KpiFieldsShape,
  type MockJira,
} from './testing/scaleFixture';
import {
  KpiMetaProperty,
  type CatalogEntryDto,
  type CreatedKpi,
  type PanelListData,
  type TimelineData,
  type TimelineNodeDto,
  type UpdateKpiResult,
} from '../domain/index';
import type { Trace } from './requestLog';

/**
 * Spec 11 · 05: unit and direction in Jira fields. The REAL resolver against
 * the in-memory Jira, with the fields not chosen (today's behaviour) and in
 * each of the fixture's shapes: pre-migration, migrated, mixed.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('./testing/scaleFixture');
  return { default: mockForgeApi(() => h.jira!), ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.jira!.fixture.kvs.get(key),
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, value);
    },
  },
}));

// KPI-1 (1000) is "%", increase; KPI-2 (1001) "count", decrease; KPI-3 (1002) "count", increase.
const SMALL = { kpis: 10, initiatives: 2, epicsPerInitiative: 2, storiesPerEpic: 1, subtasksPerStory: 0 };
const EPIC = '200000';
type Shape = KpiFieldsShape | 'not configured';
type Direction = 'select' | 'text';

function load(shape: Shape, direction: Direction = 'select'): MockJira {
  vi.resetModules();
  const jira = createMockJira(buildScaleFixture(SMALL));
  if (shape !== 'not configured') chooseKpiFields(jira.fixture, shape, { direction });
  h.jira = jira;
  return jira;
}

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown>;
  as: string;
}

/** Load a site, then run one resolver invocation, recording its trace and the bodies it sent. */
async function invoke<T>(shape: Shape, key: string, payload: unknown = {}, setup?: (jira: MockJira) => void, direction: Direction = 'select') {
  const jira = load(shape, direction);
  setup?.(jira);
  const sent: Sent[] = [];
  jira.intercept = (method, path, body, _raw, as) => {
    if (method !== 'GET') sent.push({ method, path, body: body ? (JSON.parse(String(body)) as Record<string, unknown>) : {}, as });
    return undefined;
  };
  const { setTraceSink, summarizeTrace } = await import('./requestLog');
  const traces: Trace[] = [];
  setTraceSink((t) => traces.push(t));
  const { handler } = await import('./resolver');
  let data: T | undefined;
  let error: Error | undefined;
  try {
    data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
      { call: { functionKey: key, payload }, context: {} },
      { principal: { accountId: 'acc-1' } },
    )) as T;
  } catch (e) {
    error = e as Error;
  }
  expect(jira.unhandled).toEqual([]);
  return { data, error, jira, sent, summary: summarizeTrace(traces[0]), trace: traces[0] };
}

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const metaOf = (data: TimelineData) => flatten(data.roots).map((n) => ({ key: n.issueKey, unit: n.unit, direction: n.direction }));

describe('reads', () => {
  it.each<Direction>(['select', 'text'])(
    'the migrated shape (%s direction) reads exactly as the fields-not-chosen site (Timeline and panel)',
    async (direction) => {
      const before = {
        timeline: (await invoke<TimelineData>('not configured', 'getTimelineSkeleton')).data,
        panel: (await invoke<PanelListData>('not configured', 'getPanelList', { issueId: EPIC })).data,
        kpiPanel: (await invoke<PanelListData>('not configured', 'getPanelList', { issueId: '1001' })).data,
      };
      const after = {
        timeline: (await invoke<TimelineData>('migrated', 'getTimelineSkeleton', {}, undefined, direction)).data,
        panel: (await invoke<PanelListData>('migrated', 'getPanelList', { issueId: EPIC }, undefined, direction)).data,
        kpiPanel: (await invoke<PanelListData>('migrated', 'getPanelList', { issueId: '1001' }, undefined, direction)).data,
      };
      expect(after).toEqual(before);
      expect(metaOf(after.timeline!).filter((m) => ['KPI-1', 'KPI-2', 'KPI-3'].includes(m.key))).toEqual(expect.arrayContaining([
        { key: 'KPI-1', unit: '%', direction: 'increase' },
        { key: 'KPI-2', unit: 'count', direction: 'decrease' },
        { key: 'KPI-3', unit: 'count', direction: 'increase' },
      ]));
    },
  );

  it('pre-migration with the fields chosen: units and directions are empty (the accepted gap)', async () => {
    const { data } = await invoke<TimelineData>('pre-migration', 'getTimelineSkeleton');
    expect(metaOf(data!).every((m) => m.unit === '' && m.direction === null)).toBe(true);
    const panel = (await invoke<PanelListData>('pre-migration', 'getPanelList', { issueId: EPIC })).data!;
    const catalog: CatalogEntryDto[] = panel.basis!.catalog;
    expect(catalog).toHaveLength(SMALL.kpis);
    expect(catalog.every((k) => k.unit === '' && k.direction === null)).toBe(true);
  });

  it('mixed: migrated KPIs show their values, the others are empty', async () => {
    const { data } = await invoke<TimelineData>('mixed', 'getTimelineSkeleton');
    const byKey = new Map(metaOf(data!).map((m) => [m.key, m]));
    expect(byKey.get('KPI-1')).toMatchObject({ unit: '%', direction: 'increase' });
    expect(byKey.get('KPI-2')).toMatchObject({ unit: '', direction: null });
    expect(byKey.get('KPI-3')).toMatchObject({ unit: 'count', direction: 'increase' });
  });

  it('a field edited in Jira shows as the field holds it, not as kpi-meta', async () => {
    const { data } = await invoke<TimelineData>('field-edited', 'getTimelineSkeleton');
    expect(metaOf(data!).find((m) => m.key === 'KPI-2')).toEqual({ key: 'KPI-2', unit: FIELD_EDITED_UNIT, direction: null });
  });

  it('the Timeline request count is unchanged: the field ids ride in the KPI-space search', async () => {
    const before = await invoke<TimelineData>('not configured', 'getTimelineSkeleton');
    const after = await invoke<TimelineData>('migrated', 'getTimelineSkeleton');
    expect(after.summary.byEndpoint).toEqual(before.summary.byEndpoint);
    expect(after.summary.totalRequests).toBe(before.summary.totalRequests);
  });

  it('fetchKpiMeta: one GET with the fields (fields chosen), the property GET otherwise', async () => {
    const requests: string[] = [];
    const jira = load('migrated');
    jira.intercept = (method, _path, _body, raw) => {
      requests.push(`${method} ${decodeURIComponent(raw)}`);
      return undefined;
    };
    const { fetchKpiMeta } = await import('./jira');
    const { readKpiFieldsConfig } = await import('./kpiConfig');
    const cfg = await readKpiFieldsConfig();
    expect(await fetchKpiMeta('1001', cfg)).toEqual({ unit: 'count', direction: 'decrease' });
    expect(await fetchKpiMeta('1001', null)).toEqual({ unit: 'count', direction: 'decrease' });
    expect(requests).toEqual([
      `GET /rest/api/3/issue/1001?fields=${KPI_UNIT_FIELD_ID},${KPI_DIRECTION_FIELD_ID}&properties=kpi-meta`,
      'GET /rest/api/3/issue/1001/properties/kpi-meta',
    ]);
  });
});

describe('writes', () => {
  const kpiMeta = (jira: MockJira, id: string) => jira.fixture.issues.get(id)!.properties['kpi-meta'] as Record<string, unknown>;
  const fieldValues = (jira: MockJira, id: string) => jira.fixture.issues.get(id)!.fieldValues ?? {};
  const DECREASE = expect.objectContaining({ id: KPI_DIRECTION_OPTION_IDS.decrease });
  const INCREASE = expect.objectContaining({ id: KPI_DIRECTION_OPTION_IDS.increase });

  it('createKpi sends the fields and a marked kpi-meta in one request, as the user', async () => {
    const { data, jira, sent } = await invoke<CreatedKpi>('migrated', 'createKpi', { name: 'Churn', unit: '%', direction: 'decrease' });
    expect(sent.filter((s) => s.method === 'POST' && s.path === '/rest/api/3/issue')).toEqual([
      {
        method: 'POST',
        path: '/rest/api/3/issue',
        as: 'user',
        body: {
          fields: expect.objectContaining({
            summary: 'Churn',
            [KPI_UNIT_FIELD_ID]: '%',
            [KPI_DIRECTION_FIELD_ID]: { id: KPI_DIRECTION_OPTION_IDS.decrease },
          }),
          properties: [{ key: 'kpi-meta', value: { unit: '%', direction: 'decrease', fields: true } }],
        },
      },
    ]);
    expect(fieldValues(jira, data!.id)).toEqual({ [KPI_UNIT_FIELD_ID]: '%', [KPI_DIRECTION_FIELD_ID]: DECREASE });
    expect(KpiMetaProperty.parse(kpiMeta(jira, data!.id))).toEqual({ unit: '%', direction: 'decrease' });
  });

  it('createKpi with an empty unit and no direction sends no field values (kpi-meta still marked)', async () => {
    const { data, jira, sent } = await invoke<CreatedKpi>('migrated', 'createKpi', { name: 'Blank', unit: '', direction: null }, undefined, 'text');
    const body = sent.find((s) => s.path === '/rest/api/3/issue')!.body as { fields: Record<string, unknown> };
    expect(body.fields).not.toHaveProperty(KPI_UNIT_FIELD_ID);
    expect(body.fields).not.toHaveProperty(KPI_DIRECTION_FIELD_ID);
    expect(kpiMeta(jira, data!.id)).toEqual({ unit: '', direction: null, fields: true });
  });

  it('createKpi with the fields not chosen: an unmarked kpi-meta only, as before', async () => {
    const { data, jira, sent } = await invoke<CreatedKpi>('not configured', 'createKpi', { name: 'Churn', unit: '%', direction: 'decrease' });
    const body = sent.find((s) => s.path === '/rest/api/3/issue')!.body as { fields: Record<string, unknown> };
    expect(Object.keys(body.fields).sort()).toEqual(['issuetype', 'project', 'summary']);
    expect(kpiMeta(jira, data!.id)).toEqual({ unit: '%', direction: 'decrease' });
  });

  it('a unit-only edit sends the unit field and the whole marked kpi-meta in one edit', async () => {
    const { data, jira, sent } = await invoke<UpdateKpiResult>('migrated', 'updateKpi', { kpiId: '1001', unit: '$' });
    expect(sent).toEqual([
      {
        method: 'PUT',
        path: '/rest/api/3/issue/1001',
        as: 'user',
        body: {
          fields: { [KPI_UNIT_FIELD_ID]: '$' },
          properties: [{ key: 'kpi-meta', value: { unit: '$', direction: 'decrease', fields: true } }],
        },
      },
    ]);
    expect(data!.kpi).toMatchObject({ unit: '$', direction: 'decrease' });
    expect(fieldValues(jira, '1001')).toEqual({ [KPI_UNIT_FIELD_ID]: '$', [KPI_DIRECTION_FIELD_ID]: DECREASE });
  });

  it('a direction-only edit sends only the direction field', async () => {
    const { jira, sent } = await invoke<UpdateKpiResult>('migrated', 'updateKpi', { kpiId: '1001', direction: 'increase' });
    expect(sent.map((s) => s.body)).toEqual([
      {
        fields: { [KPI_DIRECTION_FIELD_ID]: { id: KPI_DIRECTION_OPTION_IDS.increase } },
        properties: [{ key: 'kpi-meta', value: { unit: 'count', direction: 'increase', fields: true } }],
      },
    ]);
    expect(fieldValues(jira, '1001')).toEqual({ [KPI_UNIT_FIELD_ID]: 'count', [KPI_DIRECTION_FIELD_ID]: INCREASE });
  });

  it('a rename writes the summary only: no field or property writes', async () => {
    const { sent } = await invoke<UpdateKpiResult>('migrated', 'updateKpi', { kpiId: '1001', name: 'Orders', unit: 'count', direction: 'decrease' });
    expect(sent.map((s) => s.body)).toEqual([{ fields: { summary: 'Orders' } }]);
  });

  it("a unit-only edit on an unmigrated KPI keeps kpi-meta's direction and leaves it unmarked (still pending)", async () => {
    const { data, jira, sent } = await invoke<UpdateKpiResult>('pre-migration', 'updateKpi', { kpiId: '1001', unit: '$' });
    expect(sent.map((s) => s.body)).toEqual([
      { fields: { [KPI_UNIT_FIELD_ID]: '$' }, properties: [{ key: 'kpi-meta', value: { unit: '$', direction: 'decrease' } }] },
    ]);
    // The app shows the fields: the direction field is still empty until the migration copies it.
    expect(data!.kpi).toMatchObject({ unit: '$', direction: null });
    expect(fieldValues(jira, '1001')).toEqual({ [KPI_UNIT_FIELD_ID]: '$' });
    expect(KpiMetaProperty.parse(kpiMeta(jira, '1001'))).toEqual({ unit: '$', direction: 'decrease' });
  });

  it('with the fields not chosen: kpi-meta only, unmarked (text-free body)', async () => {
    const { jira, sent } = await invoke<UpdateKpiResult>('not configured', 'updateKpi', { kpiId: '1001', unit: '$' });
    expect(sent.map((s) => s.body)).toEqual([{ fields: {}, properties: [{ key: 'kpi-meta', value: { unit: '$', direction: 'decrease' } }] }]);
    expect(kpiMeta(jira, '1001')).toEqual({ unit: '$', direction: 'decrease' });
  });

  it("a field missing from the space's field scheme fails the edit with Jira's message (nothing half-saved)", async () => {
    const { error, jira } = await invoke<UpdateKpiResult>('migrated', 'updateKpi', { kpiId: '1001', name: 'Orders', unit: '$' }, (j) => {
      j.fixture.fieldSchemes.get('5')!.delete(KPI_UNIT_FIELD_ID);
    });
    expect(error?.message).toMatch(/^Jira 400 while trying to edit KPI 1001/);
    expect(jira.fixture.issues.get('1001')!.summary).toBe('KPI 2');
    expect(kpiMeta(jira, '1001')).toEqual({ unit: 'count', direction: 'decrease', fields: true });
  });
});

describe('sync trigger (kpi-meta follows edits made in Jira)', () => {
  async function sync(shape: Shape, event: unknown, setup?: (jira: MockJira) => void) {
    const jira = load(shape);
    setup?.(jira);
    const requests: string[] = [];
    jira.intercept = (method, path) => {
      requests.push(`${method} ${path}`);
      return undefined;
    };
    const { syncKpiMetaFromFields } = await import('./kpiMetaSync');
    const outcome = await syncKpiMetaFromFields(event as never);
    return { outcome, requests, jira };
  }
  const unitEdit = (issueId: string, to: string) => ({
    issue: { id: issueId, key: `KPI-${Number(issueId) - 999}` },
    changelog: { items: [{ field: 'KPI Unit', fieldId: KPI_UNIT_FIELD_ID, fromString: 'count', toString: to }] },
  });

  it('a unit edit on a marked KPI rewrites kpi-meta, as the app', async () => {
    const { outcome, requests, jira } = await sync('migrated', unitEdit('1001', 'orders'), (j) => {
      j.fixture.issues.get('1001')!.fieldValues![KPI_UNIT_FIELD_ID] = 'orders';
    });
    expect(outcome).toBe('written');
    expect(requests).toEqual(['GET /rest/api/3/issue/1001/properties/kpi-meta', 'PUT /rest/api/3/issue/1001/properties/kpi-meta']);
    expect(jira.fixture.issues.get('1001')!.properties['kpi-meta']).toEqual({ unit: 'orders', direction: 'decrease', fields: true });
  });

  it('does nothing on an unmarked KPI (left to the migration)', async () => {
    const { outcome, requests, jira } = await sync('pre-migration', unitEdit('1001', 'orders'));
    expect(outcome).toBe('unchanged');
    expect(requests.filter((r) => !r.startsWith('GET'))).toEqual([]);
    expect(jira.fixture.issues.get('1001')!.properties['kpi-meta']).toEqual({ unit: 'count', direction: 'decrease' });
  });

  it('does nothing, without a request, for an edit to another field or when the fields are not chosen', async () => {
    const other = { issue: { id: '1001' }, changelog: { items: [{ fieldId: 'summary', toString: 'x' }] } };
    expect(await sync('migrated', other)).toMatchObject({ outcome: 'unchanged', requests: [] });
    expect(await sync('migrated', { issue: { id: '1001' }, changelog: { items: [] } })).toMatchObject({ outcome: 'unchanged', requests: [] });
    expect(await sync('not configured', unitEdit('1001', 'orders'))).toMatchObject({ outcome: 'unchanged', requests: [] });
  });

  it('does nothing on a non-KPI (no kpi-meta) or when kpi-meta already matches', async () => {
    expect((await sync('migrated', unitEdit(EPIC, 'orders'))).outcome).toBe('unchanged');
    const same = await sync('migrated', unitEdit('1001', 'count'));
    expect(same.outcome).toBe('unchanged');
    expect(same.requests).toEqual(['GET /rest/api/3/issue/1001/properties/kpi-meta']);
  });
});
