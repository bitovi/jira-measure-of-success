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
  own: [assignment('10001', ownDue), assignment('10002', parentDue)],
  parentKpiIds: ['10002', '10003'],
  catalog: [
    { id: '10001', key: 'KPI-1', name: 'Signups', unit: 'users', direction: 'increase', currentValue: null, depth: 0 },
    { id: '10002', key: 'KPI-2', name: 'Churn', unit: '%', direction: 'decrease', currentValue: null, depth: 0 },
    { id: '10003', key: 'KPI-3', name: 'NPS', unit: 'pts', direction: 'increase', currentValue: null, depth: 1 },
  ],
};

const values: PanelValuesData = {
  today: '2026-06-15',
  issueDue: { date: '2026-09-30', source: 'children', fromIssueKey: 'APP-9' },
  parent: { issueKey: 'INIT-1', due: { date: '2026-12-31', source: 'own' } },
  readings: {
    '10001': [
      { date: '2026-01-01', value: 100 },
      { date: '2026-05-01', value: 120 },
    ],
    '10002': [{ date: '2026-04-01', value: 5 }],
  },
};

describe('assemblePanel', () => {
  it('Phase 1 only: final targets and grouping, value fields empty and resolving', () => {
    const panel = assemblePanel(basis, null);
    expect(panel.resolving).toBe(true);
    expect(panel.issueDueDate).toBeNull();
    expect(panel.rows.map((r) => [r.kpiId, r.relationship, r.resolving])).toEqual([
      ['10002', 'shared', true],
      ['10001', 'onlyHere', true],
      ['10003', 'onParentNotTracked', undefined],
    ]);
    const signups = panel.rows.find((r) => r.kpiId === '10001')!;
    expect(signups).toMatchObject({ kpiKey: 'KPI-1', name: 'Signups', target: 10, targetType: 'percent', dueTiming: ownDue });
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

    const signups = panel.rows.find((r) => r.kpiId === '10001')!;
    expect(signups.resolving).toBeUndefined();
    expect(signups.dueDate).toBe('2026-09-30');
    expect(signups.dueDateRolledUp).toBe(true);
    expect(signups.targetDate?.date).toBe('2026-12-31');
    expect(signups.resolvedValue?.value).not.toBeNull();

    const churn = panel.rows.find((r) => r.kpiId === '10002')!;
    expect(churn.dueDate).toBe('2026-12-31');
    expect(churn.targetDate?.date).toBe('2027-01-31');
  });

  it('a parent-anchored target stays pending when the parent was not loaded', () => {
    const panel = assemblePanel(basis, { ...values, parent: null });
    const churn = panel.rows.find((r) => r.kpiId === '10002')!;
    expect(churn.targetDate).toMatchObject({ date: null, pending: true });
  });

  it('a fixed-date percent target baselines at the issue due date, not the target date (FR-4)', () => {
    const fixed = { mode: 'absolute', absolute: '2026-12-15', anchor: 'issueDueDate', offsetMonths: 0 } as const;
    const panel = assemblePanel({ ...basis, own: [assignment('10001', fixed)], parentKpiIds: [] }, values);
    const signups = panel.rows.find((r) => r.kpiId === '10001')!;
    expect(signups.targetDate?.date).toBe('2026-12-15');
    expect(signups.dueDate).toBe('2026-09-30');
    expect(signups.resolvedValue).toMatchObject({ baselineDate: '2026-09-30', baseline: 120, value: 132 });
  });

  it('a fixed-date absolute target ignores the issue due date (no baseline needed)', () => {
    const fixed = { mode: 'absolute', absolute: '2026-12-15', anchor: 'issueDueDate', offsetMonths: 0 } as const;
    const total: Assignment = { ...assignment('10001', fixed), targetType: 'absolute', target: 500 };
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

  describe('a target on a KPI that Jira confirmed deleted', () => {
    const orphaned: PanelBasis = {
      ...basis,
      own: [assignment('10001', ownDue), assignment('10009', ownDue)],
      parentKpiIds: ['10009', '10008'],
      deletedKpiIds: ['10009', '10008'],
    };

    it.each([
      ['Phase 1 only', null],
      ['with Phase 2', values],
    ])('%s: keeps the bet, flags it missing, and never resolves values', (_label, phase2) => {
      const row = assemblePanel(orphaned, phase2).rows.find((r) => r.kpiId === '10009')!;
      expect(row).toMatchObject({
        kpiMissing: true,
        name: '10009',
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
      const signups = assemblePanel(orphaned, values).rows.find((r) => r.kpiId === '10001')!;
      expect(signups.kpiMissing).toBeUndefined();
    });

    it("doesn't offer to track a parent's target on a deleted KPI", () => {
      const panel = assemblePanel(orphaned, values);
      expect(panel.rows.some((r) => r.kpiId === '10008')).toBe(false);
    });

    it('a key-only reference (deleted before the migration) keeps its key as id, key and name', () => {
      const keyOnly: PanelBasis = { ...basis, own: [assignment('KPI-404', ownDue)], parentKpiIds: [], deletedKpiIds: ['KPI-404'] };
      const row = assemblePanel(keyOnly, values).rows[0];
      expect(row).toMatchObject({ kpiId: 'KPI-404', kpiKey: 'KPI-404', name: 'KPI-404', kpiMissing: true });
    });
  });

  describe('a target on a KPI the user may not see (spec 10)', () => {
    const hidden: PanelBasis = {
      ...basis,
      own: [assignment('10001', ownDue), assignment('10009', ownDue)],
      parentKpiIds: ['10009', '10008'],
      noAccessKpiIds: ['10009', '10008'],
    };

    it.each([
      ['Phase 1 only', null],
      ['with Phase 2', values],
    ])('%s: keeps the bet, flags it no-access, and never resolves values', (_label, phase2) => {
      const row = assemblePanel(hidden, phase2).rows.find((r) => r.kpiId === '10009')!;
      expect(row).toMatchObject({
        kpiNoAccess: true,
        name: '10009',
        relationship: 'shared',
        target: 10,
        resolvedValue: null,
        displayState: null,
      });
      expect(row.kpiMissing).toBeUndefined();
      expect(row.resolving).toBeUndefined();
    });

    it('labels it with the key Jira gave for it', () => {
      const row = assemblePanel({ ...hidden, kpiKeys: { '10009': 'KPI-9' } }, values).rows.find((r) => r.kpiId === '10009')!;
      expect(row).toMatchObject({ kpiKey: 'KPI-9', name: 'KPI-9', kpiNoAccess: true });
    });

    it("doesn't offer to track a parent's target on a KPI the user may not see", () => {
      expect(assemblePanel(hidden, values).rows.some((r) => r.kpiId === '10008')).toBe(false);
    });

    it('carries no access: it is looked up per space when an action is used (spec 11 · 06)', () => {
      expect(assemblePanel(hidden, values).access).toBeUndefined();
    });
  });

  describe('a KPI missing from the catalog but not confirmed deleted (e.g. search-index lag)', () => {
    const lagging: PanelBasis = {
      ...basis,
      own: [assignment('10001', ownDue), assignment('10009', ownDue)],
      parentKpiIds: ['10009', '10008'],
    };

    it('is not flagged as deleted', () => {
      const row = assemblePanel(lagging, values).rows.find((r) => r.kpiId === '10009')!;
      expect(row.kpiMissing).toBeUndefined();
      expect(row).toMatchObject({ name: '10009', target: 10, relationship: 'shared' });
    });

    it("still offers to track the parent's target", () => {
      const row = assemblePanel(lagging, values).rows.find((r) => r.kpiId === '10008');
      expect(row).toMatchObject({ relationship: 'onParentNotTracked', target: null });
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
