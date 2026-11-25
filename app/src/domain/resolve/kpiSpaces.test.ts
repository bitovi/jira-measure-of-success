import { describe, it, expect } from 'vitest';
import { fullRowKpiIds, kpiCreateSpacePreselect, kpiSpacesOf, scopeShowsKpi, scopeTimeline } from './kpiSpaces';
import type { KpiSpaceRef, TimelineNodeDto, TimelineTargetDto } from '../contracts';

const KPI: KpiSpaceRef = { id: '10000', key: 'KPI', name: 'KPIs' };
const PORT: KpiSpaceRef = { id: '10400', key: 'PORT', name: 'Portfolio' };
const GROW: KpiSpaceRef = { id: '10401', key: 'GROW', name: 'Growth' };

const target = (issue: string): TimelineTargetDto => ({
  date: '2026-09-30',
  value: 1,
  status: 'upcoming',
  provisional: false,
  relative: false,
  source: { issue, type: 'Epic', title: issue },
});

const node = (
  id: string,
  space: KpiSpaceRef | undefined,
  children: TimelineNodeDto[] = [],
  targets: TimelineTargetDto[] = [],
): TimelineNodeDto => ({
  id,
  kpiId: id,
  issueKey: `${space?.key ?? 'X'}-${id}`,
  name: id,
  unit: '',
  direction: null,
  depth: 0,
  targets,
  undated: [],
  readings: [],
  children,
  ...(space ? { space } : {}),
});

describe('kpiSpacesOf', () => {
  it('lists each space once, in tree order, nested KPIs included', () => {
    const roots = [node('1', KPI, [node('2', PORT), node('3', KPI)]), node('4', PORT)];
    expect(kpiSpacesOf(roots)).toEqual([KPI, PORT]);
    expect(kpiSpacesOf([node('9', undefined)])).toEqual([]);
  });
});

describe('kpiCreateSpacePreselect', () => {
  it('fills in the one space the user can create KPIs in', () => {
    expect(kpiCreateSpacePreselect([PORT], ['KPI', 'PORT', 'GROW'])).toBe(PORT.id);
  });

  it('fills in the space every KPI is in, when the user can create there', () => {
    expect(kpiCreateSpacePreselect([KPI, PORT], ['KPI'])).toBe(KPI.id);
    expect(kpiCreateSpacePreselect([PORT, GROW], ['KPI'])).toBeNull();
  });

  it('never defaults to the central space otherwise: the user picks', () => {
    expect(kpiCreateSpacePreselect([KPI, PORT, GROW], ['KPI', 'PORT'])).toBeNull();
    expect(kpiCreateSpacePreselect([KPI, PORT], [])).toBeNull();
    expect(kpiCreateSpacePreselect([], ['KPI'])).toBeNull();
  });
});

describe('scopeTimeline', () => {
  // KPI-1 → PORT-2 → GROW-3, KPI-1 → KPI-4, PORT-5 (a root)
  const tree = () => [
    node('1', KPI, [node('2', PORT, [node('3', GROW, [], [target('APP-1')])]), node('4', KPI, [], [target('WEB-1')])]),
    node('5', PORT),
  ];

  it('shows every KPI as a full row with no filter', () => {
    const scoped = scopeTimeline(tree(), { spaces: null, workFrom: null });
    expect(scoped.context.size).toBe(0);
    expect(fullRowKpiIds(scoped)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('keeps the chosen spaces as full rows with their ancestors as context, no unrelated siblings', () => {
    const scoped = scopeTimeline(tree(), { spaces: new Set(['GROW']), workFrom: null });
    expect([...scoped.context]).toEqual(['2', '1']);
    expect(fullRowKpiIds(scoped)).toEqual(['3']);
    expect(scoped.roots.map((r) => r.id)).toEqual(['1']);
    expect(scoped.roots[0].children.map((c) => c.id)).toEqual(['2']);
    expect(scopeShowsKpi(scoped, '4')).toBe(false);
    expect(scopeShowsKpi(scoped, '1')).toBe(true);
  });

  it('several spaces: an ancestor in a chosen space is a full row', () => {
    const scoped = scopeTimeline(tree(), { spaces: new Set(['PORT', 'GROW']), workFrom: null });
    expect([...scoped.context]).toEqual(['1']);
    expect(fullRowKpiIds(scoped)).toEqual(['2', '3', '5']);
  });

  it('Work from narrows first, as before (a KPI with a matching descendant stays)', () => {
    const scoped = scopeTimeline(tree(), { spaces: null, workFrom: new Set(['APP']) });
    expect(fullRowKpiIds(scoped)).toEqual(['1', '2', '3']);
    const both = scopeTimeline(tree(), { spaces: new Set(['KPI']), workFrom: new Set(['WEB']) });
    expect(fullRowKpiIds(both)).toEqual(['1', '4']);
    expect(both.context.size).toBe(0);
  });

  it('a KPI on no hand-built space is scoped by its key', () => {
    const scoped = scopeTimeline([node('7', undefined)], { spaces: new Set(['X']), workFrom: null });
    expect(fullRowKpiIds(scoped)).toEqual(['7']);
  });
});
