import { describe, expect, it } from 'vitest';
import { KpiSiteConfig, StoredKpiSiteConfig, SetUpKpiFieldsInput } from '../models/kpiSiteConfig';
import { assessKpiSetup, deriveKpiSiteConfig, kpiSiteConfigFrom, type KpiSiteFacts } from './kpiSiteConfig';

const SPACE = { key: 'KPI', projectId: '10900', name: 'KPIs (KPI)' };
const HIERARCHY = { linkTypeId: '10500', parentEnd: 'inward' as const };
const TYPES = [
  { id: '10001', name: 'Story' },
  { id: '10436', name: 'KPI' },
];
const FIELDS = {
  unit: { fieldId: 'customfield_10907' },
  direction: { fieldId: 'customfield_10908', kind: 'select' as const, optionIds: { increase: '10650', decrease: '10651' } },
};
const SAVED = { workType: { id: '10436', name: 'KPI' }, fields: FIELDS, schemes: {} };

describe('kpiSiteConfigFrom: derivation from older records', () => {
  it.each([
    [
      'nothing set up',
      { stored: undefined, space: null, hierarchy: null, issueTypes: TYPES.slice(0, 1) },
      { workType: null, fields: null, centralSpace: null, hierarchy: null, schemes: {} },
      false,
    ],
    [
      'old install with a space and a hierarchy',
      { stored: undefined, space: SPACE, hierarchy: HIERARCHY, issueTypes: TYPES },
      { workType: { id: '10436', name: 'KPI' }, fields: null, centralSpace: { projectId: '10900', key: 'KPI', name: 'KPIs (KPI)' }, hierarchy: HIERARCHY, schemes: {} },
      false,
    ],
    [
      'old install whose KPI type was renamed',
      { stored: undefined, space: SPACE, hierarchy: HIERARCHY, issueTypes: [{ id: '10436', name: 'Metric' }] },
      { workType: null, fields: null, centralSpace: { projectId: '10900', key: 'KPI', name: 'KPIs (KPI)' }, hierarchy: HIERARCHY, schemes: {} },
      false,
    ],
    [
      'old install with only a key (the project was never resolved)',
      { stored: undefined, space: { key: 'KPI', projectId: null, name: null }, hierarchy: null, issueTypes: TYPES },
      { workType: { id: '10436', name: 'KPI' }, fields: null, centralSpace: null, hierarchy: null, schemes: {} },
      false,
    ],
    [
      'new config already saved',
      { stored: SAVED, space: SPACE, hierarchy: HIERARCHY, issueTypes: null },
      { ...SAVED, centralSpace: { projectId: '10900', key: 'KPI', name: 'KPIs (KPI)' }, hierarchy: HIERARCHY },
      true,
    ],
    [
      'a saved record that does not parse is ignored',
      { stored: { workType: 'KPI' }, space: null, hierarchy: null, issueTypes: TYPES },
      { workType: { id: '10436', name: 'KPI' }, fields: null, centralSpace: null, hierarchy: null, schemes: {} },
      false,
    ],
  ])('%s', (_name, sources, expected, saved) => {
    const result = kpiSiteConfigFrom(sources);
    expect(result).toEqual({ config: expected, saved });
    expect(KpiSiteConfig.safeParse(result.config).success).toBe(true);
  });

  it('a space name that was never stored falls back to the key', () => {
    expect(deriveKpiSiteConfig({ space: { key: 'KPI', projectId: '1', name: null }, hierarchy: null }).centralSpace).toEqual({
      projectId: '1',
      key: 'KPI',
      name: 'KPI',
    });
  });
});

describe('KpiSiteConfig: fields are all or nothing', () => {
  const base = { workType: null, centralSpace: null, hierarchy: null, schemes: {} };

  it('accepts no fields, or both', () => {
    expect(KpiSiteConfig.safeParse({ ...base, fields: null }).success).toBe(true);
    expect(KpiSiteConfig.safeParse({ ...base, fields: FIELDS }).success).toBe(true);
    expect(
      KpiSiteConfig.safeParse({ ...base, fields: { unit: FIELDS.unit, direction: { fieldId: 'cf_2', kind: 'text' } } }).success,
    ).toBe(true);
  });

  it.each([
    ['only a unit', { unit: FIELDS.unit }],
    ['only a direction', { direction: FIELDS.direction }],
    ['one field for both', { unit: { fieldId: 'cf_1' }, direction: { fieldId: 'cf_1', kind: 'text' } }],
    ['a select without its options', { unit: FIELDS.unit, direction: { fieldId: 'cf_2', kind: 'select' } }],
    ['one option for both directions', { unit: FIELDS.unit, direction: { fieldId: 'cf_2', kind: 'select', optionIds: { increase: '1', decrease: '1' } } }],
  ])('rejects %s', (_name, fields) => {
    expect(KpiSiteConfig.safeParse({ ...base, fields }).success).toBe(false);
    expect(StoredKpiSiteConfig.safeParse({ workType: null, fields, schemes: {} }).success).toBe(false);
  });

  it('parses the Settings payload for fields', () => {
    expect(SetUpKpiFieldsInput.safeParse({ unit: { mode: 'create' }, direction: { mode: 'create' } }).success).toBe(true);
    expect(
      SetUpKpiFieldsInput.safeParse({
        unit: { mode: 'existing', fieldId: 'cf_1' },
        direction: { mode: 'existing', fieldId: 'cf_2', kind: 'select', optionIds: { increase: '1', decrease: '2' } },
      }).success,
    ).toBe(true);
    expect(SetUpKpiFieldsInput.safeParse({ unit: { mode: 'create' } }).success).toBe(false);
  });
});

describe('assessKpiSetup: existence checks', () => {
  const config: KpiSiteConfig = { ...SAVED, centralSpace: { projectId: '10900', key: 'KPI', name: 'KPIs (KPI)' }, hierarchy: HIERARCHY };
  const facts: KpiSiteFacts = {
    issueTypes: [{ id: '10436', name: 'KPI', iconUrl: 'icon' }],
    fields: [
      { id: 'customfield_10907', name: 'KPI Unit' },
      { id: 'customfield_10908', name: 'KPI Direction' },
    ],
    directionOptions: [
      { id: '10650', value: 'Increase' },
      { id: '10651', value: 'Decrease' },
    ],
    centralProject: { id: '10900', key: 'KPI', name: 'KPIs (KPI)', issueTypeIds: ['10436'] },
  };

  it('everything in place', () => {
    expect(assessKpiSetup(config, true, facts)).toEqual({
      saved: true,
      workType: { state: 'ready', id: '10436', name: 'KPI', iconUrl: 'icon' },
      fields: {
        state: 'ready',
        unit: { id: 'customfield_10907', name: 'KPI Unit' },
        direction: { id: 'customfield_10908', name: 'KPI Direction', kind: 'select', increase: 'Increase', decrease: 'Decrease' },
      },
      centralSpace: { state: 'ready', projectId: '10900', key: 'KPI', name: 'KPIs (KPI)' },
    });
  });

  it('nothing chosen', () => {
    const empty = { workType: null, fields: null, centralSpace: null, hierarchy: null, schemes: {} };
    expect(assessKpiSetup(empty, false, facts)).toMatchObject({
      saved: false,
      workType: { state: 'unset' },
      fields: { state: 'unset' },
      centralSpace: { state: 'unset' },
    });
  });

  it('a deleted work type, field and option are broken (keeping their ids)', () => {
    const status = assessKpiSetup(config, true, {
      ...facts,
      issueTypes: [],
      fields: [{ id: 'customfield_10907', name: 'KPI Unit' }],
      centralProject: { ...facts.centralProject!, issueTypeIds: [] },
    });
    expect(status.workType).toEqual({ state: 'broken', id: '10436', name: 'KPI', iconUrl: null });
    expect(status.fields).toMatchObject({ state: 'broken', direction: { id: 'customfield_10908', name: null } });
    expect(status.fields.problem).toMatch(/direction field \(customfield_10908\) no longer exists/);
    expect(status.centralSpace.state).toBe('misconfigured');

    const option = assessKpiSetup(config, true, { ...facts, directionOptions: [{ id: '10650', value: 'Increase' }] });
    expect(option.fields).toMatchObject({ state: 'broken', direction: { increase: 'Increase', decrease: null } });
  });

  it('a deleted central space is broken', () => {
    expect(assessKpiSetup(config, true, { ...facts, centralProject: null }).centralSpace).toMatchObject({
      state: 'broken',
      key: 'KPI',
      problem: 'The space KPI no longer exists.',
    });
  });

  it('marks nothing broken when the site could not be read', () => {
    const status = assessKpiSetup(config, true, { issueTypes: null, fields: null, directionOptions: null });
    expect([status.workType.state, status.fields.state, status.centralSpace.state]).toEqual(['ready', 'ready', 'ready']);
  });
});
