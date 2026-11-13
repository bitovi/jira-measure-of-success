import { describe, it, expect } from 'vitest';
import { getPanelList, getTimelineSkeleton } from './fixtures/mock-resolvers.js';
import {
  accessMode,
  applyAccessToPanelList,
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

  it('refuses the writes the mode forbids, with the backend’s wording', () => {
    expect(() => assertKpiWriteAllowed('add', 'readonly', null, null)).toThrow(/^Adding a KPI needs Create Issues/);
    expect(() => assertKpiWriteAllowed('record', 'readonly', 'KPI-1', null)).toThrow(/^Recording a value on KPI-1 needs Edit Issues/);
    expect(() => assertKpiWriteAllowed('target', 'hiddenKpi', 'KPI-1', 'KPI-1')).toThrow(/^KPI-1 doesn't exist, or you don't have permission/);
    expect(() => assertKpiWriteAllowed('record', null, 'KPI-1', null)).not.toThrow();
    expect(() => assertKpiWriteAllowed('target', 'hiddenKpi', 'KPI-2', 'KPI-1')).not.toThrow();
  });
});
