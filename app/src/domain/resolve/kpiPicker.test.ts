import { describe, it, expect } from 'vitest';
import {
  buildKpiSuggestions,
  kpiRefOf,
  kpiTree,
  parseKpiRefInput,
  toKpiOptions,
  visibleRows,
  type KpiSuggestionsInput,
  type PickerChainItem,
  type PickerKpi,
} from './kpiPicker';
import { kpiChildLinks } from './kpiLinks';
import type { Assignment } from '../models/index';
import type { KpiOptionDto, KpiPickerSpace } from '../contracts';

const TEAM: KpiPickerSpace = { key: 'TEAM', name: 'Team' };
const PROG: KpiPickerSpace = { key: 'PROG', name: 'Growth Program' };
const PORT: KpiPickerSpace = { key: 'PORT', name: 'Company Portfolio' };
const KPI: KpiPickerSpace = { key: 'KPI', name: 'KPIs' };

let rank = 0;
const kpi = (id: string, space: KpiPickerSpace, parentIds: string[] = [], over: Partial<PickerKpi> = {}): PickerKpi => ({
  id,
  key: `${space.key}-${id}`,
  name: `KPI ${id}`,
  typeIconUrl: 'data:image/png;base64,x',
  unit: '%',
  direction: 'increase',
  space,
  parentIds,
  rank: `0|a${String((rank += 1)).padStart(4, '0')}:`,
  ...over,
});

const target = (kpiId: string, value = 5): Assignment => ({
  kpiId,
  inheritFromParent: false,
  target: value,
  targetType: 'percent',
  timing: { start: null, due: { mode: 'absolute', absolute: '2027-03-31', anchor: 'issueDueDate', offsetMonths: 0 } },
  updatedBy: 'me',
  updatedAt: 0,
});

const parent = (id: string, space: KpiPickerSpace | null, targets: Assignment[], typeName = 'Epic'): PickerChainItem => ({
  item: { id, key: `${space?.key ?? 'X'}-${id}`, summary: `Parent ${id}`, typeName, typeIconUrl: null },
  space,
  targets,
});

const build = (over: Partial<KpiSuggestionsInput>) =>
  buildKpiSuggestions({ thisSpace: TEAM, centralSpace: KPI, chain: [], kpis: [], ownTargetIds: [], ...over });

const ids = (options: KpiOptionDto[]) => options.map((o) => o.id);

describe('buildKpiSuggestions: Tracked by parents', () => {
  it('one band per parent with targets, nearest first; a parent with no targets has no band', () => {
    const kpis = [kpi('1', PROG), kpi('2', PORT)];
    const s = build({
      kpis,
      chain: [parent('45', PROG, [target('1')]), parent('46', PROG, []), parent('7', PORT, [target('2')], 'Initiative')],
    });
    expect(s.trackedByParents.map((b) => b.item.id)).toEqual(['45', '7']);
    expect(s.hasParents).toBe(true);
  });

  it('targets are all top level, never nested under each other, each listed once in the band', () => {
    const kpis = [kpi('1', PROG), kpi('2', PROG, ['1'])];
    const s = build({ kpis, chain: [parent('45', PROG, [target('1'), target('2'), target('2')])] });
    const band = s.trackedByParents[0];
    expect(band.targets.map((t) => t.option.id)).toEqual(['1', '2']);
    expect(band.targets.every((t) => t.option.parentId === null)).toBe(true);
    expect(band.targets[0].subKpis).toEqual([]);
    expect(band.targets[0].option.hasChildren).toBe(false);
  });

  it('a KPI targeted by the Epic and the Initiative is under both', () => {
    const s = build({
      kpis: [kpi('1', PROG)],
      chain: [parent('45', PROG, [target('1', 2)]), parent('7', PORT, [target('1', 3)], 'Initiative')],
    });
    expect(s.trackedByParents.map((b) => b.targets.map((t) => [t.option.id, t.target.target]))).toEqual([
      [['1', 2]],
      [['1', 3]],
    ]);
  });

  it('a KPI in this space that the Epic targets is in This space and under the Epic', () => {
    const s = build({ kpis: [kpi('1', TEAM)], chain: [parent('45', PROG, [target('1')])] });
    expect(ids(s.inThisSpace)).toEqual(['1']);
    expect(s.trackedByParents[0].targets[0].option.id).toBe('1');
  });

  it('brings same-space sub-KPIs two levels down (nested), but not a child in another space', () => {
    const kpis = [kpi('1', PROG), kpi('2', PROG, ['1']), kpi('3', PROG, ['2']), kpi('4', PORT, ['1'])];
    const s = build({ kpis, chain: [parent('45', PROG, [target('1')])] });
    const t = s.trackedByParents[0].targets[0];
    expect(t.option.hasChildren).toBe(true);
    expect(t.subKpis.map((o) => [o.id, o.parentId, o.hasChildren])).toEqual([
      ['2', '1', true],
      ['3', '2', false],
    ]);
    expect(kpiTree([t.option, ...t.subKpis]).map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  it('each target carries the target its parent set', () => {
    const s = build({ kpis: [kpi('1', PROG)], chain: [parent('45', PROG, [target('1', 12)])] });
    expect(s.trackedByParents[0].targets[0].target).toEqual({
      target: 12,
      targetType: 'percent',
      due: { mode: 'absolute', absolute: '2027-03-31', anchor: 'issueDueDate', offsetMonths: 0 },
    });
  });

  it('leaves out KPIs this work item already targets, everywhere; a parent left with none has no band', () => {
    const kpis = [kpi('1', TEAM), kpi('2', TEAM, ['1']), kpi('3', PROG)];
    const s = build({ kpis, ownTargetIds: ['1', '3'], chain: [parent('45', PROG, [target('3')])] });
    expect(s.trackedByParents).toEqual([]);
    expect(ids(s.inThisSpace)).toEqual(['2']);
    expect(s.inThisSpace[0].parentId).toBeNull();
  });

  it('a cycle in the chain input stops (each parent once)', () => {
    const p = parent('45', PROG, [target('1')]);
    const s = build({ kpis: [kpi('1', PROG)], chain: [p, parent('7', PORT, []), p] });
    expect(s.trackedByParents).toHaveLength(1);
    expect(s.parentSpaces).toEqual([PROG, PORT]);
  });
});

describe('buildKpiSuggestions: menu entries', () => {
  it('parent spaces, nearest first, without this space or the central space; Global KPIs last', () => {
    const s = build({
      chain: [parent('1', TEAM, []), parent('45', PROG, []), parent('7', KPI, []), parent('8', PORT, [])],
    });
    expect(s.parentSpaces).toEqual([PROG, PORT]);
    expect(s.globalSpace).toEqual(KPI);
  });

  it('no chain: no parent spaces, Global KPIs still listed', () => {
    const s = build({});
    expect(s.hasParents).toBe(false);
    expect(s.parentSpaces).toEqual([]);
    expect(s.globalSpace).toEqual(KPI);
  });

  it('no Global KPIs entry when the central space is this space, or there is none', () => {
    expect(build({ thisSpace: KPI }).globalSpace).toBeNull();
    expect(build({ centralSpace: null }).globalSpace).toBeNull();
  });

  it('an empty own space', () => {
    const s = build({ kpis: [kpi('1', PROG)] });
    expect(s.inThisSpace).toEqual([]);
    expect(s.thisSpace).toEqual(TEAM);
  });
});

describe('toKpiOptions / kpiTree', () => {
  it('hasChildren exactly for KPIs with sub-KPIs in the list; a KPI whose parent is not listed is top level', () => {
    const options = toKpiOptions([kpi('1', TEAM), kpi('2', TEAM, ['1']), kpi('3', TEAM, ['99'])], TEAM);
    expect(options.map((o) => [o.id, o.parentId, o.hasChildren])).toEqual([
      ['1', null, true],
      ['2', '1', false],
      ['3', null, false],
    ]);
  });

  it('orders siblings by rank, depth-first', () => {
    const a = kpi('1', TEAM, [], { rank: '0|c:' });
    const b = kpi('2', TEAM, [], { rank: '0|a:' });
    const c = kpi('3', TEAM, ['1'], { rank: '0|b:' });
    expect(ids(toKpiOptions([a, b, c], TEAM))).toEqual(['2', '1', '3']);
  });

  it('survives a parent cycle', () => {
    const options = toKpiOptions([kpi('1', TEAM, ['2']), kpi('2', TEAM, ['1'])], TEAM);
    expect(ids(options).sort()).toEqual(['1', '2']);
    expect(kpiTree(options)).toHaveLength(2);
  });
});

describe('visibleRows', () => {
  const tree = kpiTree(toKpiOptions([kpi('1', TEAM), kpi('2', TEAM, ['1']), kpi('3', TEAM, ['2'], { name: 'Checkout speed' })], TEAM));

  it('sub-KPIs start collapsed; expanding shows one level', () => {
    expect(visibleRows(tree, new Set()).map((r) => [r.option.id, r.open])).toEqual([['1', false]]);
    expect(visibleRows(tree, new Set(['1'])).map((r) => [r.option.id, r.open])).toEqual([
      ['1', true],
      ['2', false],
    ]);
  });

  it('searching opens the path to a sub-KPI match', () => {
    expect(visibleRows(tree, new Set(), 'checkout').map((r) => [r.option.id, r.open])).toEqual([
      ['1', true],
      ['2', true],
      ['3', false],
    ]);
    expect(visibleRows(tree, new Set(), 'nothing')).toEqual([]);
    expect(visibleRows(tree, new Set(), 'team-2').map((r) => r.option.id)).toEqual(['1', '2']);
  });
});

describe('parseKpiRefInput', () => {
  it.each([
    ['', { kind: 'empty' }],
    ['  conv ', { kind: 'text', text: 'conv' }],
    ['PORT-14', { kind: 'key', key: 'PORT-14', text: 'PORT-14' }],
    ['port-14', { kind: 'key', key: 'PORT-14', text: 'port-14' }],
    ['10234', { kind: 'id', id: '10234', text: '10234' }],
    ['100', { kind: 'text', text: '100' }],
    ['https://acme.atlassian.net/browse/OPS-40', { kind: 'url', key: 'OPS-40' }],
    ['https://acme.atlassian.net/browse/ops-40/', { kind: 'url', key: 'OPS-40' }],
    ['https://acme.atlassian.net/browse/OPS-40?focusedCommentId=1', { kind: 'url', key: 'OPS-40' }],
    ['https://acme.atlassian.net/jira/software/projects/OPS/boards/1?selectedIssue=OPS-41', { kind: 'url', key: 'OPS-41' }],
    ['https://acme.atlassian.net/wiki', { kind: 'text', text: 'https://acme.atlassian.net/wiki' }],
    ['PORT-14 margin', { kind: 'text', text: 'PORT-14 margin' }],
  ])('%j', (raw, expected) => {
    expect(parseKpiRefInput(raw)).toEqual(expected);
  });

  it('kpiRefOf gives the key or id to look up', () => {
    expect(kpiRefOf(parseKpiRefInput('…/browse/PORT-14'))).toBe('PORT-14');
    expect(kpiRefOf(parseKpiRefInput('10234'))).toBe('10234');
    expect(kpiRefOf(parseKpiRefInput('revenue'))).toBeNull();
  });
});

describe('kpiChildLinks', () => {
  const hierarchy = { linkTypeId: '10500', parentEnd: 'inward' as const };
  it('reads children from the parent end, KPI type only, lowest link first', () => {
    const links = [
      { id: '9', type: { id: '10500' }, outwardIssue: { id: '2', key: 'A-2', fields: { issuetype: { id: '100' } } } },
      { id: '3', type: { id: '10500' }, outwardIssue: { id: '3', key: 'A-3' } },
      { id: '4', type: { id: '10500' }, outwardIssue: { id: '4', key: 'A-4', fields: { issuetype: { id: '200' } } } },
      { id: '5', type: { id: '10500' }, inwardIssue: { id: '1', key: 'A-1' } },
      { id: '6', type: { id: '10000' }, outwardIssue: { id: '7', key: 'A-7' } },
    ];
    expect(kpiChildLinks(links, hierarchy, '100')).toEqual([
      { id: '3', key: 'A-3' },
      { id: '2', key: 'A-2' },
    ]);
    expect(kpiChildLinks(links, null, '100')).toEqual([]);
  });
});
