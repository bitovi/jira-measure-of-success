import { describe, it, expect } from 'vitest';
import { buildKpiTargets, type KpiTargetContribution } from './timelineTargets.js';
import { filterTimelineByProjects } from './timelineProjectFilter.js';
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
        relative: false,
        detail: expect.objectContaining({ target: 100, targetType: 'absolute', displayState: 'resultUnknown', actual: 120 }),
        source: { issue: 'INIT-48', type: 'Initiative', title: 'Multi-store support', iconUrl: null },
      },
    ]);
  });

  it('keeps the bet and its resolution on the marker for the tooltip', () => {
    const { dated } = buildKpiTargets(
      [contribution({ due: '2026-06-30' }, assignment({ kpiId: 'r', targetType: 'percent', target: 10, timing: { start: null, due: relative('issueDueDate', 3) } }))],
      [{ date: '2026-05-01', value: 200 }],
      'increase',
      TODAY,
    );
    expect(dated[0]?.detail).toMatchObject({
      target: 10,
      targetType: 'percent',
      dueTiming: relative('issueDueDate', 3),
      dueDate: '2026-06-30',
      targetDate: { date: '2026-09-30' },
      resolvedValue: { baseline: 200, provisional: true },
      displayState: 'needsMeasurement',
    });
  });

  it('marks the due date as rolled up when the source issue\'s due came from its children', () => {
    const bet = assignment({ kpiId: 'r', targetType: 'percent', target: 10, timing: { start: null, due: relative('issueDueDate', 3) } });
    const readings = [{ date: '2026-05-01', value: 200 }];
    const own = buildKpiTargets([contribution({ due: '2026-06-30' }, bet)], readings, 'increase', TODAY);
    const rolled = buildKpiTargets([contribution({ due: '2026-06-30', dueRolledUp: true }, bet)], readings, 'increase', TODAY);
    expect(own.dated[0]?.detail?.dueDateRolledUp).toBe(false);
    expect(rolled.dated[0]?.detail).toMatchObject({ dueDate: '2026-06-30', dueDateRolledUp: true });
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

  it('marks percent/relative targets `relative` even once the baseline is measured (no longer provisional)', () => {
    // +10% on the value at the issue's due date (Jun 30, recorded: 200), due 3 months later.
    const { dated } = buildKpiTargets(
      [contribution({ due: '2026-06-30' }, assignment({ kpiId: 'r', targetType: 'percent', target: 10, timing: { start: null, due: relative('issueDueDate', 3) } }))],
      [
        { date: '2026-06-30', value: 200 },
        { date: '2026-07-05', value: 205 },
      ],
      'increase',
      TODAY,
    );
    expect(dated[0]).toMatchObject({ date: '2026-09-30', status: 'upcoming', provisional: false, relative: true });
    expect(dated[0]?.value).toBeCloseTo(220, 6);
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

describe('buildKpiTargets — stacked targets (spec 09)', () => {
  const FLAT = [{ date: '2026-12-01', value: 1000 }, { date: '2027-01-01', value: 1000 }];
  const plusPercent = (kpiId: string, target: number) =>
    assignment({ kpiId, targetType: 'percent', target, timing: { start: null, due: relative('issueDueDate', 1) } });
  const quarter = (key: string, due: string) =>
    contribution({ key, type: 'Initiative', due, hierarchyLevel: 3 }, plusPercent('wau', 1));
  const contributions = [
    quarter('INIT-1', '2027-03-31'),
    quarter('INIT-2', '2027-06-30'),
    quarter('INIT-3', '2027-09-30'),
    quarter('INIT-4', '2027-12-31'),
    contribution({ key: 'OUT-1', type: 'Outcome', due: '2027-12-31', hierarchyLevel: 4 }, plusPercent('wau', 5)),
  ];
  const valueOf = (built: ReturnType<typeof buildKpiTargets>, key: string) =>
    built.dated.find((t) => t.source.issue === key)!;

  it('quarterly Initiatives step up; the Outcome does not move', () => {
    const built = buildKpiTargets(contributions, FLAT, 'increase', TODAY);
    expect(valueOf(built, 'INIT-1').value).toBeCloseTo(1010, 6);
    expect(valueOf(built, 'INIT-2').value).toBeCloseTo(1020.1, 6);
    expect(valueOf(built, 'INIT-3').value).toBeCloseTo(1030.301, 6);
    expect(valueOf(built, 'INIT-4').value).toBeCloseTo(1040.60401, 6);
    expect(valueOf(built, 'INIT-3').detail?.resolvedValue?.stackedFrom?.map((s) => s.issueKey)).toEqual(['INIT-1', 'INIT-2']);
    expect(valueOf(built, 'OUT-1').value).toBeCloseTo(1050, 6);
    expect(valueOf(built, 'OUT-1').detail?.resolvedValue?.stackedFrom).toBeUndefined();
    expect(built.dated.every((t) => t.provisional)).toBe(true);
  });

  it('a reading recorded after the first target date drops it from the chains', () => {
    const built = buildKpiTargets(contributions, [...FLAT, { date: '2027-05-15', value: 1012 }], 'increase', TODAY);
    expect(valueOf(built, 'INIT-2').value).toBeCloseTo(1012 * 1.01, 6);
    expect(valueOf(built, 'INIT-3').detail?.resolvedValue?.stackedFrom?.map((s) => s.issueKey)).toEqual(['INIT-2']);
    expect(valueOf(built, 'INIT-3').value).toBeCloseTo(1012 * 1.01 * 1.01, 6);
  });

  it('filtering to one project keeps a marker stacked on another project’s target', () => {
    const crossProject = [quarter('APP-1', '2027-03-31'), quarter('WEB-2', '2027-06-30')];
    const built = buildKpiTargets(crossProject, FLAT, 'increase', TODAY);
    const node = {
      id: 'n', kpiId: 'wau', issueKey: 'KPI-1', name: 'WAU', unit: 'users', direction: 'increase' as const, depth: 0,
      targets: built.dated, undated: built.undated, readings: FLAT, children: [],
    };
    const [filtered] = filterTimelineByProjects([node], new Set(['WEB']));
    expect(filtered.targets.map((t) => t.source.issue)).toEqual(['WEB-2']);
    expect(filtered.targets[0]).toBe(valueOf(built, 'WEB-2'));
    expect(filtered.targets[0].value).toBeCloseTo(1020.1, 6);
  });

  it('targets with no known level neither stack nor are stacked on', () => {
    const noLevel = contributions.map((c) => ({ ...c, source: { ...c.source, hierarchyLevel: undefined } }));
    const built = buildKpiTargets(noLevel, FLAT, 'increase', TODAY);
    for (const key of ['INIT-1', 'INIT-2', 'INIT-3', 'INIT-4']) expect(valueOf(built, key).value).toBeCloseTo(1010, 6);
  });
});
