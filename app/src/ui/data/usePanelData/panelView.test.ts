import { describe, it, expect } from 'vitest';
import type { KpiViewDto, PanelBasis, PanelData, PanelListData, PanelValuesData } from '@domain/index.js';
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
    expect(derivePanelView({ list: null, values, valuesError: null }).data).toBeNull();
  });

  it('Phase 1 only: the list shows, rows resolving, values pending', () => {
    const v = derivePanelView({ list, values: null, valuesError: null });
    expect(v.valuesPending).toBe(true);
    expect(v.data?.resolving).toBe(true);
    expect(v.data?.rows[0].resolving).toBe(true);
    expect(v.data?.rows[0].name).toBe('Signups');
  });

  it('both phases: values merged, nothing pending', () => {
    const v = derivePanelView({ list, values, valuesError: null });
    expect(v.valuesPending).toBe(false);
    expect(v.data?.resolving).toBeUndefined();
    expect(v.data?.issueDueDate).toBe('2026-09-30');
    expect(v.data?.catalog[0].currentValue).toBe(150);
  });

  it('Phase 2 failure keeps the list, stops the shimmer and reports the error', () => {
    const v = derivePanelView({ list, values: null, valuesError: 'boom' });
    expect(v.valuesError).toBe('boom');
    expect(v.valuesPending).toBe(false);
    expect(v.data?.rows).toHaveLength(1);
    expect(v.data?.rows[0].resolving).toBeUndefined();
  });

  it('a save/remove result always wins over the initial load (pending, failed or late)', () => {
    const later: PanelValuesData = { ...values, readings: { 'KPI-1': [{ date: '2026-06-01', value: 175 }] } };
    for (const state of [
      { list, values: null, valuesError: null },
      { list, values: null, valuesError: 'boom' },
      { list, values, valuesError: null },
    ]) {
      const v = derivePanelView({ ...state, mutated: { list, values: later } });
      expect(v.valuesPending).toBe(false);
      expect(v.valuesError).toBeNull();
      expect(v.data?.catalog[0].currentValue).toBe(175);
    }
  });

  it('a KPI issue: Phase 1 is already the complete panel', () => {
    const v = derivePanelView({ list: { panel: full }, values: null, valuesError: null });
    expect(v).toEqual({ data: full, valuesPending: false, valuesError: null });
  });

  describe('values recorded this session', () => {
    it('apply to the readings behind the target cards (no reload)', () => {
      const edit = { kpiId: 'KPI-1', date: '2026-06-10', value: 190 };
      const v = derivePanelView({ list, values, valuesError: null, readingEdits: [edit] });
      expect(v.data?.catalog[0].currentValue).toBe(190);
      // ...and on top of a later save/remove result too
      const after = derivePanelView({ list, values, valuesError: null, mutated: { list, values }, readingEdits: [edit] });
      expect(after.data?.catalog[0].currentValue).toBe(190);
    });

    it('a delete removes that date', () => {
      const v = derivePanelView({
        list,
        values,
        valuesError: null,
        readingEdits: [{ kpiId: 'KPI-1', date: '2026-05-01', value: null }],
      });
      expect(v.data?.catalog[0].currentValue).toBeNull();
    });

    it("rebuild a KPI issue's chart: new series and re-classified target markers", () => {
      const kpiView: KpiViewDto = {
        today: '2026-07-10',
        node: {
          id: 'n1',
          kpiId: 'KPI-1',
          issueKey: 'KPI-1',
          name: 'Signups',
          unit: 'users',
          direction: 'increase',
          depth: 0,
          readings: [{ date: '2026-01-01', value: 100 }],
          targets: [],
          undated: [],
          children: [],
        },
        contributions: [
          {
            assignment: { ...basis.own[0], timing: { start: null, due: { mode: 'absolute', absolute: '2026-06-30', anchor: 'issueDueDate', offsetMonths: 0 } } },
            source: { key: 'APP-1', type: 'Epic', title: 'Grow', iconUrl: null, due: null },
          },
        ],
      };
      const panel: PanelData = { ...full, kpiView };
      // Target 200 by 2026-06-30: can't be judged on the January reading; hit once 250 is recorded on the date.
      const v = derivePanelView({
        list: { panel },
        values: null,
        valuesError: null,
        readingEdits: [{ kpiId: 'KPI-1', date: '2026-06-30', value: 250 }],
      });
      expect(v.data?.kpiView?.node.readings.map((r) => r.value)).toEqual([100, 250]);
      expect(v.data?.kpiView?.node.targets.map((t) => t.status)).toEqual(['hit']);
    });
  });
});
