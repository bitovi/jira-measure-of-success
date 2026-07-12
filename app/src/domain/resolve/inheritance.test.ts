import { describe, it, expect } from 'vitest';
import { resolveInheritance, type AncestorAssignment } from './inheritance.js';
import type { Assignment } from '../models/index.js';

const DUE = { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 } as const;

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    kpiId: 'revenue',
    inheritFromParent: true,
    target: null,
    targetType: 'absolute',
    timing: { start: null, due: DUE },
    updatedBy: 'acc-1',
    updatedAt: 0,
    ...over,
  };
}

function ancestor(issueKey: string, over: Partial<Assignment> = {}): AncestorAssignment {
  return { issueKey, assignment: assignment(over) };
}

describe('resolveInheritance (Brief §2.1)', () => {
  it('no ancestor: inherited fields are unset', () => {
    const r = resolveInheritance(assignment({ inheritFromParent: true }), []);
    expect(r.target).toEqual({ value: null, source: 'unset' });
    expect(r.start).toEqual({ value: null, source: 'unset' });
  });

  it('ancestor with same KPI: null local fields resolve from ancestor', () => {
    const local = assignment({ inheritFromParent: true });
    const r = resolveInheritance(local, [
      ancestor('OUT-12', { target: 1_500_000, timing: { start: '2026-01-01', due: DUE } }),
    ]);
    expect(r.target).toEqual({ value: 1_500_000, source: 'inherited', fromIssueKey: 'OUT-12' });
    expect(r.start).toEqual({ value: '2026-01-01', source: 'inherited', fromIssueKey: 'OUT-12' });
  });

  it('multiple ancestors: nearest wins', () => {
    const local = assignment({ inheritFromParent: true });
    const r = resolveInheritance(local, [
      ancestor('INIT-48', { target: 900 }), // nearest
      ancestor('OUT-12', { target: 1500 }), // farther
    ]);
    expect(r.target).toEqual({ value: 900, source: 'inherited', fromIssueKey: 'INIT-48' });
  });

  it('nearest ancestor missing the field falls through to the next', () => {
    const local = assignment({ inheritFromParent: true });
    const r = resolveInheritance(local, [
      ancestor('INIT-48', { target: null }), // nearest but unset
      ancestor('OUT-12', { target: 1500 }),
    ]);
    expect(r.target).toEqual({ value: 1500, source: 'inherited', fromIssueKey: 'OUT-12' });
  });

  it('local override of one field but not others', () => {
    const local = assignment({ inheritFromParent: true, target: 2000 }); // start still null → inherited
    const r = resolveInheritance(local, [
      ancestor('OUT-12', { target: 1_500_000, timing: { start: '2026-01-01', due: DUE } }),
    ]);
    expect(r.target).toEqual({ value: 2000, source: 'local' });
    expect(r.start).toEqual({ value: '2026-01-01', source: 'inherited', fromIssueKey: 'OUT-12' });
  });

  it('inheritFromParent=false: ancestors are ignored, unset stays unset', () => {
    const local = assignment({ inheritFromParent: false });
    const r = resolveInheritance(local, [ancestor('OUT-12', { target: 1500 })]);
    expect(r.target).toEqual({ value: null, source: 'unset' });
  });

  it('ignores ancestors assigning a different KPI', () => {
    const local = assignment({ kpiId: 'revenue', inheritFromParent: true });
    const r = resolveInheritance(local, [
      { issueKey: 'OUT-12', assignment: assignment({ kpiId: 'nps', target: 50 }) },
    ]);
    expect(r.target).toEqual({ value: null, source: 'unset' });
  });
});
