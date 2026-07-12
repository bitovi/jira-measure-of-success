import { describe, it, expect } from 'vitest';
import {
  addMonths,
  resolveRelativeTargetDate,
  type RelativeTargetContext,
} from './relativeTargetDate.js';
import type { DueTiming } from '../models/index.js';
import type { ResolvedEndpoint } from './effectiveTiming.js';

function due(date: string | null, source: ResolvedEndpoint['source'], fromIssueKey?: string): ResolvedEndpoint {
  return { date, source, fromIssueKey };
}

function relative(anchor: DueTiming['anchor'], offsetMonths: number): DueTiming {
  return { mode: 'relative', absolute: null, anchor, offsetMonths };
}

function absolute(date: string | null): DueTiming {
  return { mode: 'absolute', absolute: date, anchor: 'issueDueDate', offsetMonths: 0 };
}

describe('addMonths (end-of-month preserving)', () => {
  it('rolls end-of-month to end-of-month', () => {
    expect(addMonths('2026-12-31', 3)).toBe('2027-03-31');
    expect(addMonths('2026-09-30', 1)).toBe('2026-10-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('keeps a non-end-of-month day, clamped to month length', () => {
    expect(addMonths('2026-01-01', 6)).toBe('2026-07-01');
    expect(addMonths('2026-03-15', 0)).toBe('2026-03-15');
  });
});

describe('resolveRelativeTargetDate (requirements §6.3)', () => {
  const ctx: RelativeTargetContext = {
    issue: { issueKey: 'INIT-48', due: due('2026-12-31', 'children', 'INC-90') },
    parent: { issueKey: 'OUT-12', due: due('2026-09-30', 'own') },
  };

  it('REL-1 absolute mode → verbatim date', () => {
    const r = resolveRelativeTargetDate(absolute('2026-11-30'), ctx, null);
    expect(r.date).toBe('2026-11-30');
    expect(r.pending).toBe(false);
  });

  it('REL-2 offset after own due, rolled up from children', () => {
    const r = resolveRelativeTargetDate(relative('issueDueDate', 3), ctx, null);
    expect(r.date).toBe('2027-03-31');
    expect(r.source).toContain('INIT-48 due');
    expect(r.source).toContain('rolled up from INC-90');
  });

  it('REL-3 offset after parent due', () => {
    const r = resolveRelativeTargetDate(relative('parentDueDate', 1), ctx, null);
    expect(r.date).toBe('2026-10-31');
    expect(r.source).toContain('OUT-12 due');
  });

  it('REL-4 offset of 0 equals the anchor', () => {
    const anchorCtx: RelativeTargetContext = {
      issue: { issueKey: 'X-1', due: due('2026-03-31', 'own') },
    };
    const r = resolveRelativeTargetDate(relative('issueDueDate', 0), anchorCtx, null);
    expect(r.date).toBe('2026-03-31');
    expect(r.source).toContain('on X-1 due');
  });

  it('REL-5 anchor = kpiStart, no rollup', () => {
    const r = resolveRelativeTargetDate(relative('kpiStart', 6), ctx, '2026-01-01');
    expect(r.date).toBe('2026-07-01');
    expect(r.source).toContain('KPI start');
  });

  it('REL-6 unresolvable anchor → pending', () => {
    const pendingCtx: RelativeTargetContext = {
      issue: { issueKey: 'X-1', due: due(null, 'pending') },
    };
    const r = resolveRelativeTargetDate(relative('issueDueDate', 3), pendingCtx, null);
    expect(r.date).toBeNull();
    expect(r.pending).toBe(true);
  });

  it('REL-7 moving anchor → re-resolves without re-save', () => {
    const before = resolveRelativeTargetDate(relative('issueDueDate', 3), ctx, null);
    expect(before.date).toBe('2027-03-31');
    const movedCtx: RelativeTargetContext = {
      issue: { issueKey: 'INIT-48', due: due('2027-01-31', 'children', 'INC-90') },
    };
    const after = resolveRelativeTargetDate(relative('issueDueDate', 3), movedCtx, null);
    expect(after.date).toBe('2027-04-30');
  });

  it('kpiStart anchor with no start → pending', () => {
    const r = resolveRelativeTargetDate(relative('kpiStart', 6), ctx, null);
    expect(r.pending).toBe(true);
  });

  it('parentDueDate anchor at the root (no parent) → pending', () => {
    const rootCtx: RelativeTargetContext = { issue: ctx.issue };
    const r = resolveRelativeTargetDate(relative('parentDueDate', 1), rootCtx, null);
    expect(r.pending).toBe(true);
  });
});
