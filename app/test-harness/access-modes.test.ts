import { describe, it, expect } from 'vitest';
import { getPanelList, getTimelineSkeleton, panelParts } from './fixtures/mock-resolvers.js';
import {
  accessMode,
  applyAccessToPanelList,
  applyAccessToPanelParts,
  applyAccessToTimeline,
  assertKpiWriteAllowed,
} from './access-modes.js';
import type { TimelineNodeDto } from '@domain/index.js';

const flatten = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('harness ?access= modes (spec 10)', () => {
  it('reads only the known modes from the query string', () => {
    expect(accessMode('?access=none')).toBe('none');
    expect(accessMode('?access=readonly')).toBe('readonly');
    expect(accessMode('?access=hiddenKpi')).toBe('hiddenKpi');
    expect(accessMode('?access=bogus')).toBeNull();
    expect(accessMode('')).toBeNull();
  });

  it('none: no KPIs on the timeline, every targeted KPI is no-permission on the panel', () => {
    const tl = applyAccessToTimeline(getTimelineSkeleton(), 'none', null);
    expect(tl.roots).toEqual([]);
    expect(tl.access?.browse).toBe(false);
    const list = applyAccessToPanelList(getPanelList('10048'), 'none', null);
    expect(list.basis!.catalog).toEqual([]);
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
    expect(list.basis!.catalog.map((c) => c.id)).not.toContain(hidden);
  });

  it('hiddenKpi: the hidden KPI is out of the catalog on issues that don’t target it, and not flagged there', () => {
    const hidden = getPanelList('10048').basis!.own[0].kpiId;
    const other = ['10000', '10001', '10002', '10003', '10004', '10012', '10020', '10090', '10231', '10500'].find((id) => {
      const b = getPanelList(id).basis;
      return b && b.catalog.some((c) => c.id === hidden) && ![...b.own.map((a) => a.kpiId), ...b.parentKpiIds].includes(hidden);
    });
    expect(other).toBeDefined();
    const list = applyAccessToPanelList(getPanelList(other!), 'hiddenKpi', hidden);
    expect(list.basis!.catalog.map((c) => c.id)).not.toContain(hidden);
    expect(list.basis!.noAccessKpiIds).toBeUndefined();
  });

  it('a KPI issue’s own panel: unopenable without Browse or when it’s the hidden KPI', () => {
    expect(() => applyAccessToPanelList(getPanelList('KPI-1'), 'none', null)).toThrow(/do not have permission to see it/);
    const kpi1 = getPanelList('KPI-1').panel!.kpiView!.node.kpiId;
    expect(() => applyAccessToPanelList(getPanelList('KPI-1'), 'hiddenKpi', kpi1)).toThrow(/do not have permission/);
  });

  it('a KPI issue’s own panel: a hidden KPI is out of its catalog and its nested chart', () => {
    const panel = getPanelList('KPI-1').panel!;
    const child = panel.kpiView!.node.children[0].kpiId;
    const out = applyAccessToPanelList({ panel }, 'hiddenKpi', child).panel!;
    expect(out.catalog.map((c) => c.id)).not.toContain(child);
    expect(flatten(out.kpiView!.node.children).map((n) => n.kpiId)).not.toContain(child);
    expect(out.access).toEqual({ browse: true, create: true, edit: true, link: true });
  });

  it('save/remove responses are filtered like the initial load (access kept, hidden KPI still hidden)', () => {
    const hidden = getPanelList('10048').basis!.own[0].kpiId;
    const readonly = applyAccessToPanelParts(panelParts('10048'), 'readonly', null);
    expect(readonly.list.basis!.access).toEqual({ browse: true, create: false, edit: false, link: false });
    const hiddenParts = applyAccessToPanelParts(panelParts('10048'), 'hiddenKpi', hidden);
    expect(hiddenParts.list.basis!.catalog.map((c) => c.id)).not.toContain(hidden);
    expect(hiddenParts.list.basis!.noAccessKpiIds).toEqual([hidden]);
    expect(hiddenParts.values.readings[hidden]).toBeUndefined();
  });

  it('refuses the writes the mode forbids, with the backend’s wording', () => {
    expect(() => assertKpiWriteAllowed('add', 'readonly', null, null)).toThrow(/^Adding a KPI needs Create Issues/);
    expect(() => assertKpiWriteAllowed('record', 'readonly', 'KPI-1', null)).toThrow(/^Recording a value on KPI-1 needs Edit Issues/);
    expect(() => assertKpiWriteAllowed('target', 'hiddenKpi', 'KPI-1', 'KPI-1')).toThrow(/^KPI-1 doesn't exist, or you don't have permission/);
    expect(() => assertKpiWriteAllowed('record', null, 'KPI-1', null)).not.toThrow();
    expect(() => assertKpiWriteAllowed('target', 'hiddenKpi', 'KPI-2', 'KPI-1')).not.toThrow();
  });
});
