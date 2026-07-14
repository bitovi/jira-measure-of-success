import { describe, it, expect } from 'vitest';
import { buildKpiTargets, type KpiTargetContribution } from './timelineTargets.js';
import type { Assignment, DueTiming } from '../models/index.js';

const TODAY = '2026-07-14';

function relative(anchor: DueTiming['anchor'], offsetMonths: number): DueTiming {
  return { mode: 'relative', absolute: null, anchor, offsetMonths };
}
function absolute(date: string | null): DueTiming {
  return { mode: 'absolute', absolute: date, anchor: 'issueDueDate', offsetMonths: 0 };
}

function assignment(over: Partial<Assignment> & { kpiId: string }): Assignment {
  return {
    inheritFromParent: false,
    target: 100,
    targetType: 'absolute',
    timing: { start: null, due: absolute('2026-06-30') },
    updatedBy: 'acc',
    updatedAt: 0,
    ...over,
  };
}

function contribution(over: Partial<KpiTargetContribution['source']>, a: Assignment): KpiTargetContribution {
  return {
    assignment: a,
    source: { key: 'INIT-48', type: 'Initiative', title: 'Multi-store support', iconUrl: null, due: '2026-09-30', ...over },
  };
}

describe('buildKpiTargets', () => {
  it('maps an absolute target with source info + status', () => {
    // Recorded 120 by the 2026-06-30 target (increase KPI) → hit.
    const targets = buildKpiTargets(
      [contribution({}, assignment({ kpiId: 'revenue', target: 100, timing: { start: null, due: absolute('2026-06-30') } }))],
      [{ date: '2026-06-01', value: 120 }],
      'increase',
      TODAY,
    );
    expect(targets).toEqual([
      {
        date: '2026-06-30',
        value: 100,
        status: 'hit',
        source: { issue: 'INIT-48', type: 'Initiative', title: 'Multi-store support', iconUrl: null },
      },
    ]);
  });

  it('resolves a relative target date from the issue own due', () => {
    const targets = buildKpiTargets(
      [contribution({ due: '2026-09-30' }, assignment({ kpiId: 'revenue', timing: { start: null, due: relative('issueDueDate', 1) } }))],
      [],
      'increase',
      TODAY,
    );
    expect(targets[0]?.date).toBe('2026-10-31'); // 2026-09-30 + 1mo, EOM-preserving
  });

  it('resolves parentDueDate from the parent own due', () => {
    const targets = buildKpiTargets(
      [
        contribution(
          { due: '2026-09-30', parent: { key: 'OUT-12', due: '2026-12-31' } },
          assignment({ kpiId: 'revenue', timing: { start: null, due: relative('parentDueDate', 0) } }),
        ),
      ],
      [],
      'increase',
      TODAY,
    );
    expect(targets[0]?.date).toBe('2026-12-31');
  });

  it('skips delta targets, null-value targets, and unresolvable dates', () => {
    const targets = buildKpiTargets(
      [
        contribution({}, assignment({ kpiId: 'r', targetType: 'delta', target: 50 })),
        contribution({}, assignment({ kpiId: 'r', target: null })),
        contribution({ due: null }, assignment({ kpiId: 'r', timing: { start: null, due: relative('issueDueDate', 1) } })),
      ],
      [],
      'increase',
      TODAY,
    );
    expect(targets).toEqual([]);
  });

  it('sorts targets chronologically', () => {
    const targets = buildKpiTargets(
      [
        contribution({ key: 'A-1' }, assignment({ kpiId: 'r', timing: { start: null, due: absolute('2026-12-31') } })),
        contribution({ key: 'B-2' }, assignment({ kpiId: 'r', timing: { start: null, due: absolute('2026-03-31') } })),
      ],
      [],
      'increase',
      TODAY,
    );
    expect(targets.map((t) => t.date)).toEqual(['2026-03-31', '2026-12-31']);
    expect(targets.map((t) => t.source.issue)).toEqual(['B-2', 'A-1']);
  });
});
