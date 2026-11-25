import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildScaleFixture,
  createMockJira,
  DEFAULT_FIELD_SCHEME_ID,
  KPI_PROJECT,
  READING_FIELD_ID,
  SELECT_FIELD_TYPE,
  TEAM_PROJECT,
  TEXT_FIELD_TYPE,
  type MockJira,
} from './testing/scaleFixture';
import type { Trace } from './requestLog';
import type {
  KpiFieldChoice,
  KpiSetupStatus,
  KpiSpaceChoice,
  KpiSpaceSetupStatus,
  PanelListData,
  StoredKpiSiteConfig,
  TimelineData,
} from '../domain/index';

/**
 * Spec 11 · 04: the KPI site configuration and the Settings provisioning,
 * through the REAL resolver against the in-memory Jira. The fixture's site has
 * the `KPI` type (10300) and the `KPI` space (10000), which shares the Default
 * Field Scheme (5) and its screens (1, 2) with the `TEAM` space.
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null, kvsReads: [] as string[] }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('./testing/scaleFixture');
  return { default: mockForgeApi(() => h.jira!), ...forgeRouteHelpers };
});

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => {
      h.kvsReads.push(key);
      return h.jira!.fixture.kvs.get(key);
    },
    set: async (key: string, value: unknown) => {
      h.jira!.fixture.kvs.set(key, value);
    },
  },
}));

const SMALL = { kpis: 6, initiatives: 1, epicsPerInitiative: 2, storiesPerEpic: 1, subtasksPerStory: 0 };
const SETTINGS = { moduleKey: 'kpi-settings-page' };
const KPI_TYPE = '10300';
const STORY_TYPE = '10303';

let jira: MockJira;

function load(setup?: (jira: MockJira) => void) {
  vi.resetModules();
  jira = createMockJira(buildScaleFixture(SMALL));
  setup?.(jira);
  h.jira = jira;
}

beforeEach(() => load());

/** Run a resolver on the current fixture (keeps state between calls). */
async function call<T>(key: string, payload: unknown = undefined, context: Record<string, unknown> = SETTINGS) {
  const { handler } = await import('./resolver');
  const { setTraceSink } = await import('./requestLog');
  let trace: Trace | undefined;
  setTraceSink((t) => {
    trace = t;
  });
  const writesBefore = jira.writes.length;
  let data: T | undefined;
  let error: Error | undefined;
  try {
    data = (await (handler as (req: unknown, runtime: unknown) => Promise<unknown>)(
      { call: { functionKey: key, payload }, context: { accountId: 'acc-1', ...context } },
      { principal: { accountId: 'acc-1' } },
    )) as T;
  } catch (e) {
    error = e as Error;
  }
  expect(jira.unhandled).toEqual([]);
  const requests = trace?.requests ?? [];
  return {
    data,
    error,
    /** the non-GET requests this call made */
    writes: jira.writes.slice(writesBefore),
    /** `as` of every request to an endpoint (normalized like the trace) */
    asOf: (endpoint: string) => requests.filter((r) => r.endpoint === endpoint).map((r) => r.as),
    byEndpoint: (prefix: string) => requests.filter((r) => r.endpoint.startsWith(prefix)).length,
  };
}

const stored = () => jira.fixture.kvs.get('kpi:config:site') as StoredKpiSiteConfig | undefined;
const schemeFields = () => jira.fixture.fieldSchemes.get(DEFAULT_FIELD_SCHEME_ID)!;
const removeKpiType = (j: MockJira) => {
  j.fixture.issueTypes = j.fixture.issueTypes.filter((t) => t.name !== 'KPI');
  for (const p of j.fixture.projects.values()) p.issueTypeNames = p.issueTypeNames.filter((n) => n !== 'KPI');
};

describe('site configuration (Step 3)', () => {
  it('an upgraded install: derived from kpi:space, kpi:hierarchy and the type named KPI, nothing written', async () => {
    const { data, writes } = await call<KpiSetupStatus>('getKpiSetup');
    expect(data).toEqual({
      saved: false,
      workType: expect.objectContaining({ state: 'ready', id: KPI_TYPE, name: 'KPI' }),
      fields: { state: 'unset', unit: null, direction: null },
      centralSpace: { state: 'ready', projectId: KPI_PROJECT.id, key: 'KPI', name: KPI_PROJECT.name },
    });
    expect(writes).toEqual([]);
    expect(stored()).toBeUndefined();
  });

  it('an upgraded install whose KPI type was renamed: no work type chosen', async () => {
    jira.fixture.issueTypes.find((t) => t.id === KPI_TYPE)!.name = 'Metric';
    const { data } = await call<KpiSetupStatus>('getKpiSetup');
    expect(data!.workType.state).toBe('unset');
    // The space doesn't offer a KPI type it can check, so it isn't marked misconfigured.
    expect(data!.centralSpace.state).toBe('ready');
  });

  it('reads the configuration once per invocation (one KVS read, one /issuetype)', async () => {
    const { traced } = await import('./requestLog');
    const { readKpiSiteConfig } = await import('./kpiConfig');
    const { setTraceSink } = await import('./requestLog');
    let trace: Trace | undefined;
    setTraceSink((t) => {
      trace = t;
    });
    h.kvsReads = [];
    const [a, b] = await traced('test', async () => Promise.all([readKpiSiteConfig(), readKpiSiteConfig()]));
    await traced('test', async () => readKpiSiteConfig());
    expect(a).toBe(b);
    expect(h.kvsReads.filter((k) => k === 'kpi:config:site')).toHaveLength(2);
    expect(trace!.requests.filter((r) => r.endpoint === 'GET /rest/api/3/issuetype')).toHaveLength(1);
  });

  it('a saved configuration is used as saved (no work type lookup)', async () => {
    jira.fixture.kvs.set('kpi:config:site', { workType: { id: STORY_TYPE, name: 'Story' }, fields: null, schemes: {} });
    const { traced } = await import('./requestLog');
    const { loadKpiSiteConfig } = await import('./kpiConfig');
    const loaded = await traced('test', () => loadKpiSiteConfig());
    expect(loaded).toEqual({
      saved: true,
      config: {
        workType: { id: STORY_TYPE, name: 'Story' },
        fields: null,
        schemes: {},
        centralSpace: { projectId: KPI_PROJECT.id, key: 'KPI', name: KPI_PROJECT.name },
        hierarchy: expect.objectContaining({ parentEnd: 'inward' }),
      },
    });
  });

  it('an upgraded install with no new record reads as before; choosing fields only empties unit and direction until migrated', async () => {
    const before = {
      timeline: await call<TimelineData>('getTimelineSkeleton', undefined, {}),
      panel: await call<PanelListData>('getPanelList', { issueId: '200000' }, {}),
    };
    await call('setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } });
    vi.resetModules(); // a fresh container, so the field lookup isn't already cached
    const after = {
      timeline: await call<TimelineData>('getTimelineSkeleton', undefined, {}),
      panel: await call<PanelListData>('getPanelList', { issueId: '200000' }, {}),
    };
    // Spec 11 · 05: once fields are chosen they're the only source, and the pre-migration KPIs' fields are empty.
    const unmigrated = <T,>(data: T): T =>
      JSON.parse(JSON.stringify(data), (key, value) => (key === 'unit' ? '' : key === 'direction' ? null : value)) as T;
    expect(after.timeline.data).toEqual(unmigrated(before.timeline.data));
    expect(after.panel.data).toEqual(unmigrated(before.panel.data));
    expect(before.timeline.byEndpoint('GET /rest/api/3/field')).toBe(1);
    expect(after.timeline.byEndpoint('GET /rest/api/3/field')).toBe(1);
    expect(after.timeline.byEndpoint('GET /rest/api/3/issuetype')).toBe(0);
  });

  it('createKpi creates the configured work type (by id), or the type named KPI as before', async () => {
    const bodies: unknown[] = [];
    jira.intercept = (method, path, body) => {
      if (method === 'POST' && path === '/rest/api/3/issue') bodies.push(JSON.parse(String(body)).fields.issuetype);
      return undefined;
    };
    jira.fixture.issueTypes.find((t) => t.id === KPI_TYPE)!.name = 'Metric';
    await call('createKpi', { name: 'A', unit: '', direction: null }, {});
    jira.fixture.kvs.set('kpi:config:site', { workType: { id: KPI_TYPE, name: 'Metric' }, fields: null, schemes: {} });
    await call('createKpi', { name: 'B', unit: '', direction: null }, {});
    expect(bodies).toEqual([{ name: 'KPI' }, { id: KPI_TYPE }]);
  });

  it('marks a deleted field, option or work type broken, keeping its id', async () => {
    await call('setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } });
    const direction = stored()!.fields!.direction;
    jira.fixture.customFields = jira.fixture.customFields.filter((f) => f.id !== direction.fieldId);
    const { data } = await call<KpiSetupStatus>('getKpiSetup');
    expect(data!.fields).toMatchObject({ state: 'broken', direction: { id: direction.fieldId, name: null } });
    expect(stored()!.fields!.direction.fieldId).toBe(direction.fieldId);
  });
});

describe('work type (Step 4)', () => {
  it('creates the KPI type with the bullseye PNG, as the admin, and adds it to the central space', async () => {
    load(removeKpiType);
    const { data, writes, asOf } = await call<KpiSetupStatus>('setUpKpiWorkType', { mode: 'create' });
    const created = jira.fixture.issueTypes.find((t) => t.name === 'KPI')!;
    expect(writes).toEqual([
      'POST /rest/api/3/issuetype',
      `POST /rest/api/3/universal_avatar/type/issuetype/owner/${created.id}`,
      `PUT /rest/api/3/issuetype/${created.id}`,
      `PUT /rest/api/3/issuetypescheme/${KPI_PROJECT.id}/issuetype`,
    ]);
    expect(asOf('POST /rest/api/3/issuetype')).toEqual(['user']);
    expect(asOf('PUT /rest/api/3/issuetype/{id}')).toEqual(['user']);
    expect(jira.fixture.avatars).toEqual([expect.objectContaining({ owner: created.id, contentType: 'image/png' })]);
    expect(jira.fixture.avatars[0].size).toBeGreaterThan(100);
    expect(created.avatarId).toBe(Number(jira.fixture.avatars[0].id));
    expect(stored()!.workType).toEqual({ id: created.id, name: 'KPI' });
    expect(data!.workType).toMatchObject({ state: 'ready', id: created.id });
    expect(data!.centralSpace.state).toBe('ready');
  });

  it('running it again changes nothing; an existing KPI type is used as is (no new icon)', async () => {
    const first = await call('setUpKpiWorkType', { mode: 'create' });
    expect(first.writes).toEqual([]);
    expect(stored()!.workType).toEqual({ id: KPI_TYPE, name: 'KPI' });
    expect(jira.fixture.avatars).toEqual([]);
    const again = await call('setUpKpiWorkType', { mode: 'create' });
    expect(again.writes).toEqual([]);
  });

  it('uses an existing standard type; refuses a sub-task or an unknown id', async () => {
    const story = await call<KpiSetupStatus>('setUpKpiWorkType', { mode: 'existing', id: STORY_TYPE });
    expect(story.data!.workType).toMatchObject({ state: 'ready', id: STORY_TYPE, name: 'Story' });
    // The central space gets it too.
    expect(jira.fixture.projects.get('KPI')!.issueTypeNames).toContain('Story');
    const subtask = await call('setUpKpiWorkType', { mode: 'existing', id: '10304' });
    expect(subtask.error?.message).toMatch(/Subtask can't hold KPIs/);
    const unknown = await call('setUpKpiWorkType', { mode: 'existing', id: '999' });
    expect(unknown.error?.message).toMatch(/no work type with id "999"/);
    const malformed = await call('setUpKpiWorkType', { mode: 'sideways' });
    expect(malformed.error?.message).toMatch(/Invalid request/);
    expect(stored()!.workType!.id).toBe(STORY_TYPE);
  });
});

describe('fields (Step 4)', () => {
  it('creates KPI Unit and KPI Direction (Increase / Decrease) and makes them usable in the central space', async () => {
    const { data, writes, asOf } = await call<KpiSetupStatus>('setUpKpiFields', {
      unit: { mode: 'create' },
      direction: { mode: 'create' },
    });
    const [unit, direction] = jira.fixture.customFields;
    expect(unit).toMatchObject({ name: 'KPI Unit', custom: TEXT_FIELD_TYPE });
    expect(direction).toMatchObject({ name: 'KPI Direction', custom: SELECT_FIELD_TYPE });
    expect(direction.options!.map((o) => o.value)).toEqual(['Increase', 'Decrease']);
    expect(stored()!.fields).toEqual({
      unit: { fieldId: unit.id },
      direction: {
        fieldId: direction.id,
        kind: 'select',
        optionIds: { increase: direction.options![0].id, decrease: direction.options![1].id },
      },
    });
    expect(asOf('POST /rest/api/3/field')).toEqual(['user', 'user']);
    // Added for the KPI type, then restored after the screens step (which resets it, 01 B9).
    expect(asOf('PUT /rest/api/3/config/fieldschemes/fields')).toEqual(['user', 'user']);
    // The shared scheme gets the fields for the KPI type only; what it had is untouched.
    expect(schemeFields().get(unit.id)).toEqual([KPI_TYPE]);
    expect(schemeFields().get(direction.id)).toEqual([KPI_TYPE]);
    expect(schemeFields().get('summary')).toEqual([]);
    expect(schemeFields().get(READING_FIELD_ID)).toEqual([]);
    // First tab of each screen the KPI type uses (default and edit).
    expect(jira.fixture.screens.get('1')![0].fields).toEqual(['summary', unit.id, direction.id]);
    expect(jira.fixture.screens.get('2')![0].fields).toEqual(['summary', unit.id, direction.id]);
    expect(writes.filter((w) => w.startsWith('POST /rest/api/3/screens/'))).toHaveLength(4);
    expect(data!.fields).toMatchObject({ state: 'ready', unit: { name: 'KPI Unit' }, direction: { increase: 'Increase', decrease: 'Decrease' } });
    expect(data!.warnings).toBeUndefined();

    const again = await call('setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } });
    expect(again.writes).toEqual([]);
    expect(jira.fixture.customFields).toHaveLength(2);
  });

  it('a field already in the shared scheme for another type keeps that type and gains the KPI type', async () => {
    jira.fixture.customFields.push({ id: 'customfield_200', name: 'Unit', custom: TEXT_FIELD_TYPE });
    jira.fixture.customFields.push({
      id: 'customfield_201',
      name: 'Polarity',
      custom: SELECT_FIELD_TYPE,
      options: [
        { id: '1', value: 'Up' },
        { id: '2', value: 'Down' },
      ],
    });
    schemeFields().set('customfield_200', [STORY_TYPE]);
    schemeFields().set('customfield_201', []);
    const { data, writes } = await call<KpiSetupStatus>('setUpKpiFields', {
      unit: { mode: 'existing', fieldId: 'customfield_200' },
      direction: { mode: 'existing', fieldId: 'customfield_201', kind: 'select', optionIds: { increase: '1', decrease: '2' } },
    });
    expect(writes.filter((w) => w.startsWith('POST /rest/api/3/field'))).toEqual([]);
    expect(schemeFields().get('customfield_200')).toEqual([STORY_TYPE, KPI_TYPE]);
    // In the scheme for every type already: left alone.
    expect(schemeFields().get('customfield_201')).toEqual([]);
    expect(data!.fields).toMatchObject({ state: 'ready', direction: { name: 'Polarity', increase: 'Up', decrease: 'Down' } });
  });

  it('accepts a text field for direction; refuses the wrong kinds, a missing option, or one field for both', async () => {
    jira.fixture.customFields.push({ id: 'customfield_300', name: 'Notes', custom: TEXT_FIELD_TYPE });
    jira.fixture.customFields.push({ id: 'customfield_301', name: 'Direction', custom: TEXT_FIELD_TYPE });
    jira.fixture.customFields.push({ id: 'customfield_302', name: 'Pick', custom: SELECT_FIELD_TYPE, options: [{ id: '7', value: 'A' }] });
    const unit = { mode: 'existing', fieldId: 'customfield_300' };
    const ok = await call<KpiSetupStatus>('setUpKpiFields', { unit, direction: { mode: 'existing', fieldId: 'customfield_301', kind: 'text' } });
    expect(ok.data!.fields).toMatchObject({ state: 'ready', direction: { kind: 'text', name: 'Direction' } });
    const before = structuredClone(stored());

    const selectUnit = await call('setUpKpiFields', { unit: { mode: 'existing', fieldId: 'customfield_302' }, direction: { mode: 'create' } });
    expect(selectUnit.error?.message).toMatch(/Pick can't hold a KPI's unit/);
    const textAsSelect = await call('setUpKpiFields', {
      unit,
      direction: { mode: 'existing', fieldId: 'customfield_301', kind: 'select', optionIds: { increase: '1', decrease: '2' } },
    });
    expect(textAsSelect.error?.message).toMatch(/Direction can't hold a KPI's direction/);
    const missingOption = await call('setUpKpiFields', {
      unit,
      direction: { mode: 'existing', fieldId: 'customfield_302', kind: 'select', optionIds: { increase: '7', decrease: '8' } },
    });
    expect(missingOption.error?.message).toMatch(/no option with id "8"/);
    const same = await call('setUpKpiFields', { unit, direction: { mode: 'existing', fieldId: 'customfield_300', kind: 'text' } });
    expect(same.error?.message).toMatch(/two different fields/);
    const half = await call('setUpKpiFields', { unit });
    expect(half.error?.message).toMatch(/Invalid request/);
    expect(stored()).toEqual(before);
  });

  it('lists short-text and single-select fields to pick from', async () => {
    jira.fixture.customFields.push({ id: 'customfield_400', name: 'Unit', custom: TEXT_FIELD_TYPE });
    jira.fixture.customFields.push({ id: 'customfield_401', name: 'Labels-ish', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:labels' });
    jira.fixture.customFields.push({ id: 'customfield_402', name: 'Direction', custom: SELECT_FIELD_TYPE, options: [] });
    const { data } = await call<KpiFieldChoice[]>('getKpiFieldChoices');
    expect(data).toEqual([
      { id: 'customfield_402', name: 'Direction', kind: 'select' },
      { id: 'customfield_400', name: 'Unit', kind: 'text' },
    ]);
  });
});

describe('spaces (Step 4)', () => {
  it('central space: create one, with the work type, fields in its field scheme and on its screens', async () => {
    await call('setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } });
    const { data, asOf } = await call<KpiSetupStatus>('setUpCentralSpace', { mode: 'create', key: 'GOALS' });
    const project = jira.fixture.projects.get('GOALS')!;
    expect(project.issueTypeNames).toEqual(['KPI']);
    expect(asOf('POST /rest/api/3/project')).toEqual(['user']);
    expect(data!.centralSpace).toEqual({ state: 'ready', projectId: project.id, key: 'GOALS', name: 'KPIs (GOALS)' });
    expect(jira.fixture.kvs.get('kpi:space')).toEqual({ key: 'GOALS', projectId: project.id, name: 'KPIs (GOALS)' });
  });

  it('central space: use an existing one', async () => {
    const { data } = await call<KpiSetupStatus>('setUpCentralSpace', { mode: 'existing', projectId: TEAM_PROJECT.id });
    expect(data!.centralSpace).toMatchObject({ state: 'ready', key: 'TEAM' });
    expect(jira.fixture.projects.get('TEAM')!.issueTypeNames).toContain('KPI');
    const missing = await call('setUpCentralSpace', { mode: 'existing', projectId: '999' });
    expect(missing.error?.message).toMatch(/no space with id "999"/);
  });

  it('the guide: checks a space, then does each step for it ("Do it for TEAM")', async () => {
    const early = await call<KpiSpaceSetupStatus>('getKpiSpaceSetup', { projectId: TEAM_PROJECT.id });
    expect(early.data).toMatchObject({ key: 'TEAM', workType: false, fields: null, screens: null });

    await call('setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } });
    // The central space shares TEAM's scheme and screens, so they're done already; undo that to see each step.
    const [unit, direction] = jira.fixture.customFields;
    schemeFields().delete(unit.id);
    schemeFields().delete(direction.id);
    jira.fixture.screens.get('1')![0].fields = ['summary'];
    const before = await call<KpiSpaceSetupStatus>('getKpiSpaceSetup', { projectId: TEAM_PROJECT.id });
    expect(before.data).toMatchObject({ workType: false, fields: false, screens: false });
    expect(before.writes).toEqual([]);

    for (const step of ['workType', 'fields', 'screens']) {
      const { error, asOf } = await call('setUpKpiSpaceStep', { projectId: TEAM_PROJECT.id, step });
      expect(error).toBeUndefined();
      expect([
        ...asOf('PUT /rest/api/3/issuetypescheme/{id}/issuetype'),
        ...asOf('PUT /rest/api/3/config/fieldschemes/fields'),
        ...asOf('POST /rest/api/3/screens/{id}/tabs/{id}/fields'),
      ]).not.toContain('app');
    }
    const after = await call<KpiSpaceSetupStatus>('getKpiSpaceSetup', { projectId: TEAM_PROJECT.id });
    expect(after.data).toMatchObject({ workType: true, fields: true, screens: true });
    const again = await call('setUpKpiSpaceStep', { projectId: TEAM_PROJECT.id, step: 'fields' });
    expect(again.writes).toEqual([]);
  });

  it('a team-managed space: the steps explain why they can’t be done', async () => {
    await call('setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } });
    const { data } = await call<KpiSpaceSetupStatus>('getKpiSpaceSetup', { projectId: '10200' });
    expect(data).toMatchObject({ fields: null, screens: null });
    expect(data!.problem).toMatch(/doesn't use a field scheme/);
    const step = await call('setUpKpiSpaceStep', { projectId: '10200', step: 'workType' });
    expect(step.error?.message).toMatch(/Team-managed projects cannot hold KPIs/);
  });

  it('lists company-managed spaces, flagging the ones that offer the KPI type', async () => {
    const { data } = await call<KpiSpaceChoice[]>('getKpiSpaceChoices');
    expect(data).toEqual([
      { id: KPI_PROJECT.id, key: 'KPI', name: KPI_PROJECT.name, hasKpiWorkType: true },
      { id: TEAM_PROJECT.id, key: 'TEAM', name: TEAM_PROJECT.name, hasKpiWorkType: false },
    ]);
  });
});

describe('Set up everything (Step 4)', () => {
  const fresh = (j: MockJira) => {
    removeKpiType(j);
    j.fixture.kvs.delete('kpi:space');
    j.fixture.kvs.delete('kpi:hierarchy');
    j.fixture.linkTypes = j.fixture.linkTypes.filter((t) => t.name !== 'KPI Hierarchy');
    j.fixture.projects.delete('KPI');
  };

  it('on a fresh site: work type → fields → central space → its scheme and screens → nesting; then a no-op', async () => {
    load(fresh);
    const { data, error } = await call<KpiSetupStatus>('setUpEverything', { key: 'KPI' });
    expect(error).toBeUndefined();
    expect(data).toMatchObject({
      saved: true,
      workType: { state: 'ready', name: 'KPI' },
      fields: { state: 'ready', unit: { name: 'KPI Unit' }, direction: { name: 'KPI Direction' } },
      centralSpace: { state: 'ready', key: 'KPI' },
    });
    expect(jira.fixture.avatars).toHaveLength(1);
    expect(jira.fixture.kvs.get('kpi:hierarchy')).toMatchObject({ parentEnd: 'inward' });
    const typeId = data!.workType.id!;
    const [unit] = jira.fixture.customFields;
    expect(schemeFields().get(unit.id)).toEqual([typeId]);

    const again = await call('setUpEverything', { key: 'KPI' });
    expect(again.writes).toEqual([]);
  });

  it('keeps what an upgraded install already has', async () => {
    const { data, writes } = await call<KpiSetupStatus>('setUpEverything');
    expect(data!.workType.id).toBe(KPI_TYPE);
    expect(data!.centralSpace.key).toBe('KPI');
    expect(writes.some((w) => w.startsWith('POST /rest/api/3/project'))).toBe(false);
    expect(writes.some((w) => w === 'POST /rest/api/3/issuetype')).toBe(false);
  });
});

describe('Settings checks (Step 4)', () => {
  const writes: Array<[string, unknown]> = [
    ['setUpKpiWorkType', { mode: 'create' }],
    ['setUpKpiFields', { unit: { mode: 'create' }, direction: { mode: 'create' } }],
    ['setUpCentralSpace', { mode: 'create', key: 'NEWKPI' }],
    ['setUpKpiSpaceStep', { projectId: TEAM_PROJECT.id, step: 'workType' }],
    ['setUpEverything', undefined],
  ];

  it.each(writes)('%s by a non-admin: refused, nothing written', async (key, payload) => {
    jira.fixture.userView.isAdmin = false;
    const kvsBefore = JSON.stringify([...jira.fixture.kvs.entries()]);
    const { error, writes: made } = await call(key, payload);
    expect(error?.message).toBe('Only Jira admins can change KPI settings.');
    expect(made).toEqual([]);
    expect(JSON.stringify([...jira.fixture.kvs.entries()])).toBe(kvsBefore);
  });

  it.each([...writes, ['getKpiSetup', undefined], ['getKpiSpaceChoices', undefined], ['getKpiFieldChoices', undefined]] as Array<
    [string, unknown]
  >)('%s from another module: refused', async (key, payload) => {
    const { error, writes: made } = await call(key, payload, { moduleKey: 'kpi-timeline-page' });
    expect(error?.message).toMatch(/only be changed from the KPI Settings admin page/);
    expect(made).toEqual([]);
  });
});
