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
  it('maps an absolute target with source info + status (not provisional)', () => {
    // Recorded 120 by the 2026-06-30 target (increase KPI) → hit.
    const { dated, undated } = buildKpiTargets(
      [contribution({}, assignment({ kpiId: 'revenue', target: 100, timing: { start: null, due: absolute('2026-06-30') } }))],
      [{ date: '2026-06-01', value: 120 }],
      'increase',
      TODAY,
    );
    expect(undated).toEqual([]);
    expect(dated).toEqual([
      {
        date: '2026-06-30',
        value: 100,
        status: 'hit',
        provisional: false,
        source: { issue: 'INIT-48', type: 'Initiative', title: 'Multi-store support', iconUrl: null },
      },
    ]);
  });

  it('resolves a relative target date from the issue own due', () => {
    const { dated } = buildKpiTargets(
      [contribution({ due: '2026-09-30' }, assignment({ kpiId: 'revenue', timing: { start: null, due: relative('issueDueDate', 1) } }))],
      [],
      'increase',
      TODAY,
    );
    expect(dated[0]?.date).toBe('2026-10-31'); // 2026-09-30 + 1mo, EOM-preserving
  });

  it('resolves parentDueDate from the parent own due', () => {
    const { dated } = buildKpiTargets(
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
    expect(dated[0]?.date).toBe('2026-12-31');
  });

  it('resolves a percent target to a provisional estimate marker (FR-22/23)', () => {
    // +10% of the baseline carried from the last reading (200) = 220, provisional.
    const { dated } = buildKpiTargets(
      [contribution({ due: '2026-06-30' }, assignment({ kpiId: 'r', targetType: 'percent', target: 10, timing: { start: null, due: relative('issueDueDate', 0) } }))],
      [{ date: '2026-05-01', value: 200 }],
      'increase',
      TODAY,
    );
    expect(dated[0]?.value).toBeCloseTo(220, 6);
    expect(dated[0]?.provisional).toBe(true);
  });

  it('resolves a relative (additive) target to baseline + amount, provisional', () => {
    // +100 on the baseline carried from the last reading (200) = 300, provisional.
    const { dated } = buildKpiTargets(
      [contribution({ due: '2026-06-30' }, assignment({ kpiId: 'r', targetType: 'relative', target: 100, timing: { start: null, due: relative('issueDueDate', 0) } }))],
      [{ date: '2026-05-01', value: 200 }],
      'increase',
      TODAY,
    );
    expect(dated[0]?.value).toBe(300);
    expect(dated[0]?.provisional).toBe(true);
  });

  it('routes a pending-date target into the undated lane (FR-24)', () => {
    const { dated, undated } = buildKpiTargets(
      [contribution({ due: null }, assignment({ kpiId: 'r', targetType: 'percent', target: 10, timing: { start: null, due: relative('issueDueDate', 1) } }))],
      [{ date: '2026-05-01', value: 200 }],
      'increase',
      TODAY,
    );
    expect(dated).toEqual([]);
    expect(undated).toHaveLength(1);
    expect(undated[0]?.date).toBeNull();
    expect(undated[0]?.provisional).toBe(true);
    expect(undated[0]?.value).toBeCloseTo(220, 6);
  });

  it('skips null-value targets and percent/relative targets with no baseline reading', () => {
    const { dated, undated } = buildKpiTargets(
      [
        contribution({}, assignment({ kpiId: 'r', target: null })),
        contribution({}, assignment({ kpiId: 'r', targetType: 'percent', target: 50 })),
        contribution({}, assignment({ kpiId: 'r', targetType: 'relative', target: 50 })),
      ],
      [],
      'increase',
      TODAY,
    );
    expect(dated).toEqual([]);
    expect(undated).toEqual([]);
  });

  it('sorts dated targets chronologically', () => {
    const { dated } = buildKpiTargets(
      [
        contribution({ key: 'A-1' }, assignment({ kpiId: 'r', timing: { start: null, due: absolute('2026-12-31') } })),
        contribution({ key: 'B-2' }, assignment({ kpiId: 'r', timing: { start: null, due: absolute('2026-03-31') } })),
      ],
      [],
      'increase',
      TODAY,
    );
    expect(dated.map((t) => t.date)).toEqual(['2026-03-31', '2026-12-31']);
    expect(dated.map((t) => t.source.issue)).toEqual(['B-2', 'A-1']);
  });
});
