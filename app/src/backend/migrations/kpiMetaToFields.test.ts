import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildScaleFixture,
  chooseKpiFields,
  createMockJira,
  FIELD_EDITED_UNIT,
  KPI_DIRECTION_FIELD_ID,
  KPI_UNIT_FIELD_ID,
  type KpiFieldsShape,
  type MockJira,
} from '../testing/scaleFixture';
import {
  decodeKpiMetaFields,
  KpiMetaProperty,
  type KpiFieldsConfig,
  type MigrationRecord,
  type MigrationsData,
  type PanelListData,
  type TimelineData,
} from '../../domain/index';
import type { MigrationContext } from './index';

/**
 * `kpi-meta-to-fields` (spec 11 · 05) through the REAL resolver and the real
 * registry, against the in-memory Jira: 30 KPIs (two batches: 25, 5).
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null, requests: [] as Array<{ route: string; as: string }> }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('../testing/scaleFixture');
  const api = mockForgeApi(
    () => h.jira!,
    (route, as) => h.requests.push({ route: decodeURIComponent(String((route as { value: string }).value)), as }),
  );
  return { default: api, ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.jira!.fixture.kvs.get(key),
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, structuredClone(value));
    },
  },
}));

const ID = 'kpi-meta-to-fields';
const SETTINGS = { moduleKey: 'kpi-settings-page' };
const FIXTURE = { kpis: 30, initiatives: 2, epicsPerInitiative: 3, storiesPerEpic: 0, subtasksPerStory: 0 };

type Handler = (req: unknown, runtime: unknown) => Promise<unknown>;
let jira: MockJira;
let cfg: KpiFieldsConfig | null;
/** each KPI's kpi-meta before the run */
let original: Map<string, Record<string, unknown>>;

async function load(shape: KpiFieldsShape | null, direction: 'select' | 'text' = 'select') {
  vi.resetModules();
  jira = createMockJira(buildScaleFixture(FIXTURE));
  cfg = shape ? chooseKpiFields(jira.fixture, shape, { direction }) : null;
  original = new Map(jira.fixture.kpiIds.map((id) => [id, structuredClone(meta(id))]));
  h.jira = jira;
  h.requests = [];
}

async function call<T>(key: string, payload: unknown = {}, context: Record<string, unknown> = SETTINGS) {
  const handler = (await import('../resolver')).handler as Handler;
  return (await handler({ call: { functionKey: key, payload }, context }, { principal: { accountId: 'acc-1' } })) as T;
}
const runBatch = () => call<MigrationRecord>('runMigrationBatch', { id: ID });
async function runToEnd(): Promise<MigrationRecord> {
  for (let i = 0; i < 20; i += 1) {
    const record = await runBatch();
    if (record.cursor === null) return record;
  }
  throw new Error('migration never finished');
}
const statusOf = async () => (await call<MigrationsData>('getMigrations')).migrations.find((m) => m.id === ID)!;
/** `status().pending`, as the app (getMigrations doesn't count a `done` migration). */
const pending = async () => {
  const { kpiMetaToFields } = await import('./kpiMetaToFields');
  const app = jira as unknown as MigrationContext['app'];
  return (await kpiMetaToFields.status({ accountId: null, writer: app, app })).pending;
};
const meta = (id: string) => jira.fixture.issues.get(id)!.properties['kpi-meta'] as Record<string, unknown>;
const fieldsOf = (id: string) => decodeKpiMetaFields(cfg!, { [KPI_UNIT_FIELD_ID]: null, [KPI_DIRECTION_FIELD_ID]: null, ...jira.fixture.issues.get(id)!.fieldValues });
const issueWrites = () => jira.writes.filter((w) => /^PUT \/rest\/api\/3\/issue\/\d+$/.test(w));
const kpiIds = () => jira.fixture.kpiIds;

beforeEach(async () => {
  await load('pre-migration');
});

describe('kpi-meta-to-fields', () => {
  it('does not apply until the KPI fields are chosen', async () => {
    await load(null);
    expect(await statusOf()).toMatchObject({
      writeAs: 'user',
      status: { applicable: false, reason: 'Choose the KPI fields in Settings first (KPI building blocks).', pending: null },
    });
    await expect(runBatch()).rejects.toThrow('Choose the KPI fields in Settings first (KPI building blocks).');
    expect(jira.writes.filter((w) => w.startsWith('PUT'))).toEqual([]);
  });

  it('counts every KPI with an unmarked kpi-meta as pending, as the app, paging the KPIs by work type', async () => {
    expect((await statusOf()).status).toEqual({ applicable: true, pending: FIXTURE.kpis });
    const searches = h.requests.filter((r) => r.route.includes('/search/jql'));
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((r) => r.as === 'app' && r.route.includes('jql=issuetype = 10300 ORDER BY id ASC'))).toBe(true);
  });

  it('pre-migration: copies every value into the fields, marks kpi-meta (otherwise unchanged), reads as before, and ends done', async () => {
    const last = await runToEnd();
    expect(last).toMatchObject({
      state: 'done',
      cursor: null,
      counts: { migrated: FIXTURE.kpis, alreadyDone: 0, skipped: 0, failed: 0 },
      failures: [],
    });
    expect(await pending()).toBe(0);
    for (const id of kpiIds()) {
      const before = original.get(id)!;
      expect(meta(id)).toEqual({ ...before, fields: true });
      expect(fieldsOf(id)).toEqual(KpiMetaProperty.parse(before));
    }
    // One PUT per KPI, as the admin (History names them); listed and re-read as the app.
    expect(issueWrites()).toHaveLength(FIXTURE.kpis);
    const puts = h.requests.filter((r) => /^\/rest\/api\/3\/issue\/\d+$/.test(r.route));
    expect(new Set(puts.map((r) => r.as))).toEqual(new Set(['user']));
    expect(jira.unhandled).toEqual([]);
  });

  it('after the run the Timeline and panel read exactly as before the fields were chosen', async () => {
    const read = async () => ({
      timeline: await call<TimelineData>('getTimelineSkeleton', undefined, {}),
      panel: await call<PanelListData>('getPanelList', { issueId: '200000' }, {}),
    });
    // The same site with no fields chosen, as this version read it before.
    const fieldsChosen = jira.fixture.kvs.get('kpi:config:site');
    jira.fixture.kvs.delete('kpi:config:site');
    const before = await read();
    jira.fixture.kvs.set('kpi:config:site', fieldsChosen);
    await runToEnd();
    vi.resetModules();
    expect(await read()).toEqual(before);
  });

  it('a second run changes nothing', async () => {
    await runToEnd();
    jira.fixture.kvs.delete(`kpi:migration:${ID}`);
    const writes = issueWrites().length;
    const again = await runToEnd();
    expect(again).toMatchObject({ state: 'done', counts: { migrated: 0, alreadyDone: FIXTURE.kpis, failed: 0 } });
    expect(issueWrites().length).toBe(writes);
  });

  it('mixed: migrated KPIs are already done (not written), the rest are migrated', async () => {
    await load('mixed');
    const last = await runToEnd();
    expect(last).toMatchObject({ state: 'done', counts: { migrated: FIXTURE.kpis / 2, alreadyDone: FIXTURE.kpis / 2, failed: 0 } });
    expect(issueWrites()).toHaveLength(FIXTURE.kpis / 2);
    expect(issueWrites()).not.toContain('PUT /rest/api/3/issue/1000');
  });

  it('a text direction field gets increase / decrease', async () => {
    await load('pre-migration', 'text');
    await runToEnd();
    expect(jira.fixture.issues.get('1001')!.fieldValues).toEqual({ [KPI_UNIT_FIELD_ID]: 'count', [KPI_DIRECTION_FIELD_ID]: 'decrease' });
  });

  it('a field edited in Jira first keeps its value; kpi-meta is rewritten to match, and the KPI is listed', async () => {
    await load('field-edited');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const last = await runToEnd();
    expect(last).toMatchObject({ state: 'done', counts: { migrated: FIXTURE.kpis, failed: 0 } });
    // KPI-2 (1001): kpi-meta had "count", decrease; the unit field already held "orders".
    expect(fieldsOf('1001')).toEqual({ unit: FIELD_EDITED_UNIT, direction: 'decrease' });
    expect(meta('1001')).toEqual({ unit: FIELD_EDITED_UNIT, direction: 'decrease', fields: true });
    const logged = info.mock.calls.flat().join('\n');
    expect(logged).toContain('KPI-2');
    expect(logged).toContain(`field "${FIELD_EDITED_UNIT}", kpi-meta "count"`);
    info.mockRestore();
  });

  it('plans from a fresh read: a value set in Jira after the page was listed is kept', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    jira.intercept = (method, path, _body, _raw, as) => {
      if (method === 'GET' && as === 'app' && path === '/rest/api/3/issue/1002') {
        jira.fixture.issues.get('1002')!.fieldValues = { [KPI_UNIT_FIELD_ID]: 'users' };
      }
      return undefined;
    };
    await runToEnd();
    expect(fieldsOf('1002')).toEqual({ unit: 'users', direction: 'increase' });
    expect(meta('1002')).toEqual({ unit: 'users', direction: 'increase', fields: true });
    vi.restoreAllMocks();
  });

  it("a malformed kpi-meta is copied part by part; one that isn't an object is a failure, left untouched", async () => {
    jira.fixture.issues.get('1001')!.properties['kpi-meta'] = { unit: 'count', direction: 'Decrease', note: 'keep' };
    jira.fixture.issues.get('1002')!.properties['kpi-meta'] = { unit: '%' };
    jira.fixture.issues.get('1003')!.properties['kpi-meta'] = 'percent';
    const last = await runToEnd();
    expect(last).toMatchObject({ state: 'failed', counts: { migrated: FIXTURE.kpis - 1, failed: 1 } });
    expect(last.failures).toEqual([{ issueId: '1003', issueKey: 'KPI-4', message: expect.stringMatching(/kpi-meta isn't an object/) }]);
    expect(fieldsOf('1001')).toEqual({ unit: 'count', direction: 'decrease' });
    expect(meta('1001')).toEqual({ unit: 'count', direction: 'decrease', note: 'keep', fields: true });
    expect(fieldsOf('1002')).toEqual({ unit: '%', direction: null });
    expect(meta('1002')).toEqual({ unit: '%', fields: true });
    expect(jira.fixture.issues.get('1003')!.properties['kpi-meta']).toBe('percent');
    expect(issueWrites()).not.toContain('PUT /rest/api/3/issue/1003');
  });

  it("a KPI the admin can't edit is a failure naming its space, and the run ends failed", async () => {
    jira.fixture.userView.hidden.add('1004');
    const last = await runToEnd();
    expect(last).toMatchObject({ state: 'failed', counts: { migrated: FIXTURE.kpis - 1, failed: 1 } });
    expect(last.failures).toEqual([
      {
        issueId: '1004',
        issueKey: 'KPI-5',
        message: expect.stringMatching(/^Jira 404 while trying to edit KPI-5: you need Edit Issues in space KPI/),
      },
    ]);
    expect(meta('1004')).toEqual(original.get('1004'));
    expect(await pending()).toBe(1);
  });

  it('resumes from the saved cursor after a failed batch', async () => {
    const first = await runBatch();
    expect(first.cursor).not.toBeNull();
    let fail = true;
    jira.intercept = (method, path, _body, raw) => {
      if (fail && method === 'GET' && path === '/rest/api/3/search/jql' && raw.includes('nextPageToken')) {
        fail = false;
        return { status: 503, body: { errorMessages: ['Service unavailable'] } };
      }
      return undefined;
    };
    await expect(runBatch()).rejects.toThrow(/Jira 503 while trying to list the KPIs/);
    const last = await runToEnd();
    expect(last).toMatchObject({ state: 'done', counts: { migrated: FIXTURE.kpis, failed: 0 } });
  });
});
