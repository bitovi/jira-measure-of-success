import { describe, it, expect } from 'vitest';
import { groupByRelationship } from './panelGrouping.js';
import type { Assignment, KpiDefinition } from '../models/index.js';

function assignment(kpiId: string): Assignment {
  return {
    kpiId,
    inheritFromParent: false,
    target: 100,
    targetType: 'absolute',
    timing: { start: null, due: { mode: 'absolute', absolute: '2026-01-01', anchor: 'issueDueDate', offsetMonths: 0 } },
    updatedBy: 'u',
    updatedAt: 0,
  };
}

function def(id: string): KpiDefinition {
  return { id, name: id, unit: 'x', direction: 'increase', description: '', archived: false, createdBy: 'u', createdAt: 0 };
}

const catalog = [def('revenue'), def('stores'), def('costs')];

describe('groupByRelationship', () => {
  it('splits shared / only-here / on-parent-not-tracked', () => {
    const own = [assignment('revenue'), assignment('stores')];
    const parent = [assignment('revenue'), assignment('costs')];
    const g = groupByRelationship(own, parent, catalog);

    expect(g.sharedWithParent.map((r) => r.kpiId)).toEqual(['revenue']);
    expect(g.onlyHere.map((r) => r.kpiId)).toEqual(['stores']);
    expect(g.onParentNotTracked.map((r) => r.kpiId)).toEqual(['costs']);
  });

  it('attaches catalog definitions and the own assignment', () => {
    const g = groupByRelationship([assignment('revenue')], [], catalog);
    expect(g.onlyHere[0].definition?.name).toBe('revenue');
    expect(g.onlyHere[0].assignment?.kpiId).toBe('revenue');
  });

  it('handles empty own and empty parent', () => {
    expect(groupByRelationship([], [], catalog)).toEqual({
      sharedWithParent: [],
      onlyHere: [],
      onParentNotTracked: [],
    });
  });

  it('de-dupes repeated parent KPIs in onParentNotTracked', () => {
    const g = groupByRelationship([], [assignment('costs'), assignment('costs')], catalog);
    expect(g.onParentNotTracked.map((r) => r.kpiId)).toEqual(['costs']);
  });
});
