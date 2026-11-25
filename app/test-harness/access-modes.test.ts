import { describe, it, expect } from 'vitest';
import { getPanelList, getTimelineSkeleton, panelParts } from './fixtures/mock-resolvers.js';
import {
  accessFor,
  accessMode,
  applyAccessToPanelList,
  applyAccessToPanelParts,
  applyAccessToTimeline,
  assertKpiWriteAllowed,
} from './access-modes.js';
import type { PanelBasis, TimelineNodeDto } from '@domain/index.js';

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('harness ?access= modes (spec 10, per space since spec 11 · 06)', () => {
  it('reads only the known modes from the query string', () => {
    expect(accessMode('?access=none')).toBe('none');
    expect(accessMode('?access=readonly')).toBe('readonly');
    expect(accessMode('?access=split')).toBe('split');
    expect(accessMode('?access=lookupFails')).toBe('lookupFails');
    expect(accessMode('?access=hiddenKpi')).toBe('hiddenKpi');
    expect(accessMode('?access=bogus')).toBeNull();
    expect(accessMode('')).toBeNull();
  });

  it('none: no KPIs on the timeline, every targeted KPI is no-permission on the panel', () => {
    const tl = applyAccessToTimeline(getTimelineSkeleton(), 'none', null);
    expect(tl.roots).toEqual([]);
    expect(tl).not.toHaveProperty('access');
    const list = applyAccessToPanelList(getPanelList('10048'), 'none', null);
    expect(list.basis!.kpis).toEqual([]);
    expect(list.basis!.picker!.trackedByParents).toEqual([]);
    expect(list.basis!.noAccessKpiIds!.length).toBeGreaterThan(0);
  });

  it('hiddenKpi: removes just that KPI (its children stay) and flags it on the panel', () => {
    const hidden = getPanelList('10048').basis!.own[0].kpiId;
    const before = flatten(getTimelineSkeleton().roots);
    const after = flatten(applyAccessToTimeline(getTimelineSkeleton(), 'hiddenKpi', hidden).roots);
    expect(after.map((n) => n.kpiId)).not.toContain(hidden);
    expect(after).toHaveLength(before.length - 1);
    const list = applyAccessToPanelList(getPanelList('10048'), 'hiddenKpi', hidden);
    expect(list.basis!.noAccessKpiIds).toEqual([hidden]);
    expect(list.basis!.kpis.map((c) => c.id)).not.toContain(hidden);
  });

  it('hiddenKpi: the hidden KPI is out of the KPI browser on issues that don’t target it, and not flagged there', () => {
    const hidden = getPanelList('10048').basis!.own[0].kpiId;
    const listed = (basis: PanelBasis) => {
      const p = basis.picker;
      return p ? [...p.inThisSpace, ...p.trackedByParents.flatMap((b) => b.targets.flatMap((t) => [t.option, ...t.subKpis]))] : [];
    };
    const other = ['10000', '10001', '10002', '10003', '10004', '10012', '10020', '10090', '10231', '10500'].find((id) => {
      const b = getPanelList(id).basis;
      return b && listed(b).some((o) => o.id === hidden) && ![...b.own.map((a) => a.kpiId), ...b.parentKpiIds].includes(hidden);
    });
    expect(other).toBeDefined();
    const list = applyAccessToPanelList(getPanelList(other!), 'hiddenKpi', hidden);
    expect(listed(list.basis!).map((o) => o.id)).not.toContain(hidden);
    expect(list.basis!.noAccessKpiIds).toBeUndefined();
  });

  it('a KPI issue’s own panel: unopenable without Browse or when it’s the hidden KPI', () => {
    expect(() => applyAccessToPanelList(getPanelList('KPI-1'), 'none', null)).toThrow(/do not have permission to see it/);
    const kpi1 = getPanelList('KPI-1').panel!.kpiView!.node.kpiId;
    expect(() => applyAccessToPanelList(getPanelList('KPI-1'), 'hiddenKpi', kpi1)).toThrow(/do not have permission/);
  });

  it('a KPI issue’s own panel carries its own space’s access (and no other KPIs)', () => {
    expect(applyAccessToPanelList(getPanelList('KPI-1'), 'split', null).panel!.access).toEqual(accessFor('KPI', 'split'));
    const ops = applyAccessToPanelList(getPanelList('OPS-1'), 'split', null).panel!;
    expect(ops.access).toEqual({ browse: true, create: false, edit: false, link: false });
    expect(ops.kpis).toEqual([]);
    expect(applyAccessToPanelList(getPanelList('OPS-1'), 'lookupFails', null).panel).not.toHaveProperty('access');
  });

  it('access per space: split refuses only outside the central space; lookupFails answers null', () => {
    expect(accessFor('KPI', 'split')?.edit).toBe(true);
    expect(accessFor('OPS', 'split')?.edit).toBe(false);
    expect(accessFor('OPS', 'lookupFails')).toBeNull();
    expect(accessFor('OPS', null)?.edit).toBe(true);
  });

  it('the harness KPIs are in more than one space, nested across them', () => {
    const nodes = flatten(getTimelineSkeleton().roots);
    expect(new Set(nodes.map((n) => n.space?.key))).toEqual(new Set(['KPI', 'OPS', 'FIN']));
    const orders = nodes.find((n) => n.issueKey === 'KPI-2')!;
    expect(orders.children.map((c) => c.issueKey)).toContain('OPS-1');
    expect(getTimelineSkeleton().centralSpace?.key).toBe('KPI');
  });

  it('save/remove responses are filtered like the initial load (no access on loads, hidden KPI still hidden)', () => {
    const hidden = getPanelList('10048').basis!.own[0].kpiId;
    const readonly = applyAccessToPanelParts(panelParts('10048'), 'readonly', null);
    expect(readonly.list.basis).not.toHaveProperty('access');
    const hiddenParts = applyAccessToPanelParts(panelParts('10048'), 'hiddenKpi', hidden);
    expect(hiddenParts.list.basis!.kpis.map((c) => c.id)).not.toContain(hidden);
    expect(hiddenParts.list.basis!.noAccessKpiIds).toEqual([hidden]);
    expect(hiddenParts.values.readings[hidden]).toBeUndefined();
  });

  it('refuses the writes the mode forbids, with the backend’s wording naming the KPI’s space', () => {
    expect(() => assertKpiWriteAllowed('add', 'readonly', null, null)).toThrow(/^Adding a KPI needs Create Issues/);
    expect(() => assertKpiWriteAllowed('record', 'readonly', 'KPI-1', null)).toThrow(/^Recording a value on KPI-1 needs Edit Issues/);
    const ops = { key: 'OPS', name: 'Operations' };
    expect(() => assertKpiWriteAllowed('record', 'split', '20006', null, 'OPS-1', ops)).toThrow(
      'Recording a value on OPS-1 needs Edit Issues permission on the Operations space. Ask a Jira admin.',
    );
    expect(() => assertKpiWriteAllowed('record', 'split', '20001', null, 'KPI-1')).not.toThrow();
    expect(() => assertKpiWriteAllowed('record', 'lookupFails', '20006', null, 'OPS-1', ops)).not.toThrow();
    expect(() => assertKpiWriteAllowed('target', 'hiddenKpi', 'KPI-1', 'KPI-1')).toThrow(/^KPI-1 doesn't exist, or you don't have permission/);
    expect(() => assertKpiWriteAllowed('record', null, 'KPI-1', null)).not.toThrow();
    expect(() => assertKpiWriteAllowed('target', 'hiddenKpi', 'KPI-2', 'KPI-1')).not.toThrow();
  });
});
