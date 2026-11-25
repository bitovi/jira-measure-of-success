import { describe, it, expect } from 'vitest';
import type { KpiOptionDto, KpiSuggestionsDto } from '@domain/index.js';
import {
  article,
  defaultView,
  groupBySpace,
  listRows,
  menuEntries,
  pickedLabel,
  viewSpace,
  whereLabel,
  withoutTracked,
} from './pickerView.js';

const opt = (id: string, space: string, parentId: string | null = null, hasChildren = false): KpiOptionDto => ({
  id,
  key: `${space}-${id}`,
  name: `KPI ${id}`,
  typeIconUrl: null,
  unit: '%',
  direction: 'increase',
  space: { key: space, name: `${space} space` },
  parentId,
  hasChildren,
});

const due = { mode: 'absolute' as const, absolute: '2026-12-31', anchor: 'issueDueDate' as const, offsetMonths: 0 };

const S: KpiSuggestionsDto = {
  thisSpace: { key: 'TEAM', name: 'Team' },
  hasParents: true,
  trackedByParents: [
    {
      item: { id: '45', key: 'PROG-45', summary: 'Epic', typeName: 'Epic', typeIconUrl: null },
      targets: [{ option: opt('1', 'PROG', null, true), target: { target: 2, targetType: 'percent', due }, subKpis: [opt('2', 'PROG', '1')] }],
    },
  ],
  inThisSpace: [opt('3', 'TEAM')],
  parentSpaces: [{ key: 'PROG', name: 'Growth Program' }],
  globalSpace: { key: 'KPI', name: 'KPIs' },
};

describe('pickerView', () => {
  it('menu: Tracked by parents, This space, the parent spaces then Global KPIs, All KPIs; known-empty views flagged', () => {
    const menu = menuEntries(S);
    expect(menu.map((m) => m.id)).toEqual(['tracked', 'thisSpace', 'space:PROG', 'global', 'all']);
    expect(menu.filter((m) => m.parentSpace).map((m) => m.label)).toEqual(['Growth Program', 'Global KPIs']);
    expect(menu.some((m) => m.empty)).toBe(false);
    const empty = menuEntries({ ...S, trackedByParents: [], inThisSpace: [], globalSpace: null, parentSpaces: [] });
    expect(empty.map((m) => [m.id, m.empty])).toEqual([
      ['tracked', true],
      ['thisSpace', true],
      ['all', false],
    ]);
  });

  it('opens on Tracked by parents, or This space when it is empty', () => {
    expect(defaultView(S)).toBe('tracked');
    expect(defaultView({ ...S, trackedByParents: [] })).toBe('thisSpace');
  });

  it('a target saved since the load leaves every list; a band left empty goes', () => {
    const s = withoutTracked(S, new Set(['1', '3']));
    expect(s.trackedByParents).toEqual([]);
    expect(s.inThisSpace).toEqual([]);
    expect(withoutTracked(S, new Set())).toBe(S);
  });

  it('rows expand per place, and a search opens the path to a sub-KPI', () => {
    const options = [opt('1', 'PROG', null, true), opt('2', 'PROG', '1')];
    expect(listRows(options, 'a', new Set(), '').map((r) => r.option.id)).toEqual(['1']);
    expect(listRows(options, 'a', new Set(['b|1']), '').map((r) => r.option.id)).toEqual(['1']);
    expect(listRows(options, 'a', new Set(['a|1']), '').map((r) => [r.option.id, r.depth, r.open])).toEqual([
      ['1', 0, true],
      ['2', 1, false],
    ]);
    expect(listRows(options, 'a', new Set(), 'kpi 2').map((r) => r.option.id)).toEqual(['1', '2']);
  });

  it('groups All KPIs by space, in the order met', () => {
    expect(groupBySpace([opt('1', 'B'), opt('2', 'A'), opt('3', 'B')]).map((g) => [g.space.key, g.options.length])).toEqual([
      ['B', 2],
      ['A', 1],
    ]);
  });

  it('where a KPI came from', () => {
    expect(whereLabel(S, opt('2', 'PROG'))).toBe('Tracked by parents');
    expect(whereLabel(S, opt('3', 'TEAM'))).toBe('In this space');
    expect(whereLabel(S, opt('9', 'KPI'))).toBe('Global KPIs');
    expect(whereLabel(S, opt('9', 'PROG'))).toBe('In a parent space');
    expect(whereLabel(S, opt('9', 'OPS'))).toBe('In another space');
  });

  it('labels and the view a space entry lists', () => {
    expect(pickedLabel({ key: 'TEAM-1', name: 'Conversion', unit: ' % ' })).toBe('TEAM-1 Conversion (%)');
    expect(pickedLabel({ key: 'TEAM-1', name: 'Conversion', unit: '' })).toBe('TEAM-1 Conversion');
    expect(viewSpace(S, 'global')).toEqual({ key: 'KPI', name: 'KPIs' });
    expect(viewSpace(S, 'space:PROG')).toEqual({ key: 'PROG', name: 'Growth Program' });
    expect(viewSpace(S, 'tracked')).toBeNull();
    expect([article('Epic'), article('Initiative'), article('Story')]).toEqual(['an', 'an', 'a']);
  });
});
