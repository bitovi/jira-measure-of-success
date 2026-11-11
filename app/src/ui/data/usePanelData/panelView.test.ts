import { describe, it, expect } from 'vitest';
import type { PanelBasis, PanelData, PanelListData, PanelValuesData } from '@domain/index.js';
import { derivePanelView } from './panelView.js';

const basis: PanelBasis = {
  issueKey: 'APP-1',
  closed: false,
  own: [
    {
      kpiId: 'KPI-1',
      inheritFromParent: false,
      target: 200,
      targetType: 'absolute',
      timing: { start: null, due: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 } },
      updatedBy: 'test',
      updatedAt: 0,
    },
  ],
  parentKpiIds: [],
  catalog: [{ id: 'KPI-1', name: 'Signups', unit: 'users', direction: 'increase', currentValue: null, depth: 0 }],
};
const list: PanelListData = { basis };
const values: PanelValuesData = {
  today: '2026-06-15',
  issueDue: { date: '2026-09-30', source: 'own' },
  parent: null,
  readings: { 'KPI-1': [{ date: '2026-05-01', value: 150 }] },
};
const full: PanelData = { issueKey: 'APP-1', rows: [], catalog: [], issueDueDate: null, issueDueRolledUp: false };

describe('derivePanelView', () => {
  it('nothing yet: no data', () => {
    expect(derivePanelView({ list: null, values, valuesError: null, full: null }).data).toBeNull();
  });

  it('Phase 1 only: the list shows, rows resolving, values pending', () => {
    const v = derivePanelView({ list, values: null, valuesError: null, full: null });
    expect(v.valuesPending).toBe(true);
    expect(v.data?.resolving).toBe(true);
    expect(v.data?.rows[0].resolving).toBe(true);
    expect(v.data?.rows[0].name).toBe('Signups');
  });

  it('both phases: values merged, nothing pending', () => {
    const v = derivePanelView({ list, values, valuesError: null, full: null });
    expect(v.valuesPending).toBe(false);
    expect(v.data?.resolving).toBeUndefined();
    expect(v.data?.issueDueDate).toBe('2026-09-30');
    expect(v.data?.catalog[0].currentValue).toBe(150);
  });

  it('Phase 2 failure keeps the list, stops the shimmer and reports the error', () => {
    const v = derivePanelView({ list, values: null, valuesError: 'boom', full: null });
    expect(v.valuesError).toBe('boom');
    expect(v.valuesPending).toBe(false);
    expect(v.data?.rows).toHaveLength(1);
    expect(v.data?.rows[0].resolving).toBeUndefined();
  });

  it('a complete mutation result always wins', () => {
    const v = derivePanelView({ list, values: null, valuesError: 'boom', full });
    expect(v).toEqual({ data: full, valuesPending: false, valuesError: null });
  });

  it('a KPI issue: Phase 1 is already the complete panel', () => {
    const v = derivePanelView({ list: { panel: full }, values: null, valuesError: null, full: null });
    expect(v).toEqual({ data: full, valuesPending: false, valuesError: null });
  });
});
