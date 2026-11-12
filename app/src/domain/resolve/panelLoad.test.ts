import { describe, it, expect } from 'vitest';
import type { Assignment } from '../models/index';
import type { PanelBasis, PanelValuesData } from '../contracts';
import { assemblePanel, clearPanelResolving, needsParentDue } from './panelLoad';

const assignment = (kpiId: string, due: Assignment['timing']['due']): Assignment => ({
  kpiId,
  inheritFromParent: false,
  target: 10,
  targetType: 'percent',
  timing: { start: null, due },
  updatedBy: 'test',
  updatedAt: 0,
});

const ownDue = { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 } as const;
const parentDue = { mode: 'relative', absolute: null, anchor: 'parentDueDate', offsetMonths: 1 } as const;

const basis: PanelBasis = {
  issueKey: 'APP-1',
  closed: false,
  own: [assignment('KPI-1', ownDue), assignment('KPI-2', parentDue)],
  parentKpiIds: ['KPI-2', 'KPI-3'],
  catalog: [
    { id: 'KPI-1', name: 'Signups', unit: 'users', direction: 'increase', currentValue: null, depth: 0 },
    { id: 'KPI-2', name: 'Churn', unit: '%', direction: 'decrease', currentValue: null, depth: 0 },
    { id: 'KPI-3', name: 'NPS', unit: 'pts', direction: 'increase', currentValue: null, depth: 1 },
  ],
};

const values: PanelValuesData = {
  today: '2026-06-15',
  issueDue: { date: '2026-09-30', source: 'children', fromIssueKey: 'APP-9' },
  parent: { issueKey: 'INIT-1', due: { date: '2026-12-31', source: 'own' } },
  readings: {
    'KPI-1': [
      { date: '2026-01-01', value: 100 },
      { date: '2026-05-01', value: 120 },
    ],
    'KPI-2': [{ date: '2026-04-01', value: 5 }],
  },
};

describe('assemblePanel', () => {
  it('Phase 1 only: final targets and grouping, value fields empty and resolving', () => {
    const panel = assemblePanel(basis, null);
    expect(panel.resolving).toBe(true);
    expect(panel.issueDueDate).toBeNull();
    expect(panel.rows.map((r) => [r.kpiId, r.relationship, r.resolving])).toEqual([
      ['KPI-2', 'shared', true],
      ['KPI-1', 'onlyHere', true],
      ['KPI-3', 'onParentNotTracked', undefined],
    ]);
    const signups = panel.rows.find((r) => r.kpiId === 'KPI-1')!;
    expect(signups).toMatchObject({ name: 'Signups', target: 10, targetType: 'percent', dueTiming: ownDue });
    expect(signups.resolvedValue).toBeNull();
    expect(signups.displayState).toBeNull();
    expect(panel.catalog.every((c) => c.currentValue === null)).toBe(true);
  });

  it('with Phase 2: resolves dates and values, fills current values, clears resolving', () => {
    const panel = assemblePanel(basis, values);
    expect(panel.resolving).toBeUndefined();
    expect(panel.issueDueDate).toBe('2026-09-30');
    expect(panel.issueDueRolledUp).toBe(true);
    expect(panel.catalog.map((c) => c.currentValue)).toEqual([120, 5, null]);

    const signups = panel.rows.find((r) => r.kpiId === 'KPI-1')!;
    expect(signups.resolving).toBeUndefined();
    expect(signups.dueDate).toBe('2026-09-30');
    expect(signups.dueDateRolledUp).toBe(true);
    expect(signups.targetDate?.date).toBe('2026-12-31');
    expect(signups.resolvedValue?.value).not.toBeNull();

    const churn = panel.rows.find((r) => r.kpiId === 'KPI-2')!;
    expect(churn.dueDate).toBe('2026-12-31');
    expect(churn.targetDate?.date).toBe('2027-01-31');
  });

  it('a parent-anchored target stays pending when the parent was not loaded', () => {
    const panel = assemblePanel(basis, { ...values, parent: null });
    const churn = panel.rows.find((r) => r.kpiId === 'KPI-2')!;
    expect(churn.targetDate).toMatchObject({ date: null, pending: true });
  });

  it('a fixed-date percent target baselines at the issue due date, not the target date (FR-4)', () => {
    const fixed = { mode: 'absolute', absolute: '2026-12-15', anchor: 'issueDueDate', offsetMonths: 0 } as const;
    const panel = assemblePanel({ ...basis, own: [assignment('KPI-1', fixed)], parentKpiIds: [] }, values);
    const signups = panel.rows.find((r) => r.kpiId === 'KPI-1')!;
    expect(signups.targetDate?.date).toBe('2026-12-15');
    expect(signups.dueDate).toBe('2026-09-30');
    expect(signups.resolvedValue).toMatchObject({ baselineDate: '2026-09-30', baseline: 120, value: 132 });
  });

  it('a fixed-date absolute target ignores the issue due date (no baseline needed)', () => {
    const fixed = { mode: 'absolute', absolute: '2026-12-15', anchor: 'issueDueDate', offsetMonths: 0 } as const;
    const total: Assignment = { ...assignment('KPI-1', fixed), targetType: 'absolute', target: 500 };
    const noDue = { ...values, issueDue: { date: null, source: 'pending' } } as const;
    const signups = assemblePanel({ ...basis, own: [total], parentKpiIds: [] }, noDue).rows[0];
    expect(signups.dueDate).toBe('2026-12-15');
    expect(signups.displayState).toBe('projected');
  });

  it('clearPanelResolving stops the shimmer and keeps the rows', () => {
    const cleared = clearPanelResolving(assemblePanel(basis, null));
    expect(cleared.resolving).toBeUndefined();
    expect(cleared.rows).toHaveLength(3);
    expect(cleared.rows.every((r) => r.resolving === undefined)).toBe(true);
  });

  describe('a target on a KPI that is no longer in the catalog (deleted KPI)', () => {
    const orphaned: PanelBasis = {
      ...basis,
      own: [assignment('KPI-1', ownDue), assignment('KPI-9', ownDue)],
      parentKpiIds: ['KPI-9', 'KPI-8'],
    };

    it.each([
      ['Phase 1 only', null],
      ['with Phase 2', values],
    ])('%s: keeps the bet, flags it missing, and never resolves values', (_label, phase2) => {
      const row = assemblePanel(orphaned, phase2).rows.find((r) => r.kpiId === 'KPI-9')!;
      expect(row).toMatchObject({
        kpiMissing: true,
        name: 'KPI-9',
        unit: '',
        direction: null,
        relationship: 'shared',
        target: 10,
        targetType: 'percent',
        dueTiming: ownDue,
        resolvedValue: null,
        displayState: null,
      });
      expect(row.resolving).toBeUndefined();
    });

    it('known KPIs are not flagged', () => {
      const signups = assemblePanel(orphaned, values).rows.find((r) => r.kpiId === 'KPI-1')!;
      expect(signups.kpiMissing).toBeUndefined();
    });

    it("doesn't offer to track a parent's target on a deleted KPI", () => {
      const panel = assemblePanel(orphaned, values);
      expect(panel.rows.some((r) => r.kpiId === 'KPI-8')).toBe(false);
    });
  });
});

describe('needsParentDue', () => {
  it('only a relative parentDueDate anchor needs the parent rollup', () => {
    expect(needsParentDue([assignment('a', ownDue)])).toBe(false);
    expect(needsParentDue([assignment('a', ownDue), assignment('b', parentDue)])).toBe(true);
    expect(needsParentDue([assignment('a', { ...parentDue, mode: 'absolute', absolute: '2026-01-01' })])).toBe(false);
  });
});
