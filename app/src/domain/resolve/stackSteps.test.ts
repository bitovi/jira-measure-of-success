import { describe, it, expect } from 'vitest';
import { baselineAt, stackedBaselineAt, type StackStep } from './baseline.js';
import { resolveRelativeTargetValue } from './relativeTargetValue.js';
import { resolveStackSteps, stackChain } from './stackSteps.js';
import type { KpiTargetContribution } from './timelineTargets.js';
import type { Assignment, DueTiming } from '../models/index.js';

const FLAT = [{ date: '2026-10-01', value: 1000 }, { date: '2027-01-01', value: 1000 }];

function step(issueKey: string, date: string, change: number, targetType: StackStep['targetType'] = 'percent', level: number | null = 2): StackStep {
  return { issueKey, issueType: 'Initiative', level, date, targetType, change };
}

function relative(offsetMonths: number): DueTiming {
  return { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths };
}

function contribution(key: string, due: string | null, level: number | null | undefined, over: Partial<Assignment> = {}): KpiTargetContribution {
  return {
    assignment: {
      kpiId: 'k',
      inheritFromParent: false,
      target: 1,
      targetType: 'percent',
      timing: { start: null, due: relative(1) },
      updatedBy: 'acc',
      updatedAt: 0,
      ...over,
    },
    source: { key, type: 'Initiative', title: key, iconUrl: null, due, hierarchyLevel: level },
  };
}

/** The spec's worked example: four quarterly Initiatives at +1%, one Outcome at +5%. */
const EXAMPLE = [
  contribution('A', '2027-03-31', 2),
  contribution('B', '2027-06-30', 2),
  contribution('C', '2027-09-30', 2),
  contribution('D', '2027-12-31', 2),
  contribution('OUT', '2027-12-31', 3, { target: 5 }),
];

function valueOf(key: string, contributions = EXAMPLE, readings = FLAT) {
  const c = contributions.find((x) => x.source.key === key)!;
  const steps = stackChain(resolveStackSteps(contributions), { issueKey: key, level: c.source.hierarchyLevel });
  return resolveRelativeTargetValue(c.assignment, { dueDate: c.source.due, readings, steps });
}

describe('stackedBaselineAt (spec 09)', () => {
  it('with no steps is baselineAt', () => {
    for (const due of [null, '2026-10-01', '2026-11-15', '2027-06-30']) {
      expect(stackedBaselineAt(FLAT, due)).toEqual({ ...baselineAt(FLAT, due), stackedFrom: [], unstackedValue: baselineAt(FLAT, due).value });
    }
    expect(stackedBaselineAt([], '2027-06-30', [step('A', '2027-04-30', 1)])).toEqual({
      ...baselineAt([], '2027-06-30'),
      stackedFrom: [],
      unstackedValue: null,
    });
  });

  it('percent compounds, amount adds', () => {
    const b = stackedBaselineAt(FLAT, '2027-12-31', [step('A', '2027-04-30', 10), step('B', '2027-07-31', 10)]);
    expect(b.value).toBeCloseTo(1210, 9);
    expect(b.state).toBe('provisional');
    expect(stackedBaselineAt(FLAT, '2027-12-31', [step('A', '2027-04-30', 5, 'relative'), step('B', '2027-07-31', 10)]).value).toBeCloseTo(1105.5, 9);
  });

  it('absolute resets the chain and later steps apply on top of it', () => {
    const b = stackedBaselineAt(FLAT, '2027-12-31', [
      step('A', '2027-04-30', 10),
      step('B', '2027-05-31', 2000, 'absolute'),
      step('C', '2027-07-31', 10),
    ]);
    expect(b.value).toBeCloseTo(2200, 9);
    expect(b.stackedFrom.map((s) => s.issueKey)).toEqual(['A', 'B', 'C']);
  });

  it('applies only steps in (last reading, due date]', () => {
    const b = stackedBaselineAt(FLAT, '2027-06-30', [
      step('before', '2026-12-01', 50),
      step('onLast', '2027-01-01', 50),
      step('in', '2027-04-30', 10),
      step('onDue', '2027-06-30', 10),
      step('after', '2027-07-01', 50),
    ]);
    expect(b.stackedFrom.map((s) => s.issueKey)).toEqual(['in', 'onDue']);
    expect(b.value).toBeCloseTo(1210, 9);
  });

  it('a measured or interpolated baseline ignores every step', () => {
    const steps = [step('A', '2026-10-15', 50)];
    expect(stackedBaselineAt(FLAT, '2027-01-01', steps)).toMatchObject({ kind: 'measured', value: 1000, stackedFrom: [] });
    expect(stackedBaselineAt(FLAT, '2026-11-15', steps)).toMatchObject({ kind: 'interpolated', value: 1000, stackedFrom: [] });
  });

  it('a pending due date applies no steps (flat "assume due today")', () => {
    const b = stackedBaselineAt(FLAT, null, [step('A', '2027-02-01', 50)]);
    expect(b).toMatchObject({ kind: 'carried', value: 1000, stackedFrom: [] });
  });

  it('same-date steps give the same result in any input order', () => {
    const steps = [step('A', '2027-04-30', 10), step('B', '2027-04-30', 100, 'relative'), step('C', '2027-04-30', 1500, 'absolute')];
    const a = stackedBaselineAt(FLAT, '2027-12-31', steps);
    const b = stackedBaselineAt(FLAT, '2027-12-31', [...steps].reverse());
    const c = stackedBaselineAt(FLAT, '2027-12-31', [steps[1], steps[2], steps[0]]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

describe('resolveStackSteps + stackChain (spec 09)', () => {
  it('resolves target dates like the markers do and drops pending dates and unknown levels', () => {
    const steps = resolveStackSteps([
      contribution('A', '2027-03-31', 2),
      contribution('undated', null, 2),
      contribution('noLevel', '2027-03-31', null),
      contribution('absentLevel', '2027-03-31', undefined),
      contribution('noTarget', '2027-03-31', 2, { target: null }),
    ]);
    expect(steps).toEqual([{ issueKey: 'A', issueType: 'Initiative', level: 2, date: '2027-04-30', targetType: 'percent', change: 1 }]);
  });

  it('a chain is the other steps at the same level', () => {
    const steps = [step('A', '2027-04-30', 1), step('B', '2027-07-31', 1), step('OUT', '2027-05-31', 5, 'percent', 3)];
    expect(stackChain(steps, { issueKey: 'B', level: 2 }).map((s) => s.issueKey)).toEqual(['A']);
    expect(stackChain(steps, { issueKey: 'OUT', level: 3 })).toEqual([]);
    expect(stackChain(steps, { issueKey: 'X', level: null })).toEqual([]);
  });
});

describe('resolveRelativeTargetValue with steps — the worked example (spec 09)', () => {
  it('Initiatives stair-step; the Outcome ignores them', () => {
    expect(valueOf('A').value).toBeCloseTo(1010, 6);
    expect(valueOf('A').stackedFrom).toBeUndefined();
    expect(valueOf('B').baseline).toBeCloseTo(1010, 6);
    expect(valueOf('B').value).toBeCloseTo(1020.1, 6);
    expect(valueOf('C').value).toBeCloseTo(1030.301, 6);
    expect(valueOf('C').stackedFrom!.map((s) => s.issueKey)).toEqual(['A', 'B']);
    expect(valueOf('C').unstackedBaseline).toBe(1000);
    expect(valueOf('A').unstackedBaseline).toBeUndefined();
    expect(valueOf('D').baseline).toBeCloseTo(1030.301, 6);
    expect(valueOf('D').value).toBeCloseTo(1040.60401, 6);
    expect(valueOf('OUT').baseline).toBe(1000);
    expect(valueOf('OUT').value).toBeCloseTo(1050, 6);
    expect(valueOf('OUT').provisional).toBe(true);
  });

  it('a reading after A’s target date drops A from every chain', () => {
    const readings = [...FLAT, { date: '2027-05-15', value: 1010 }];
    expect(valueOf('B', EXAMPLE, readings).baseline).toBeCloseTo(1010, 6);
    expect(valueOf('B', EXAMPLE, readings).stackedFrom).toBeUndefined();
    expect(valueOf('C', EXAMPLE, readings).stackedFrom!.map((s) => s.issueKey)).toEqual(['B']);
    expect(valueOf('C', EXAMPLE, readings).value).toBeCloseTo(1030.301, 6);
  });

  it('zero readings still needs a baseline', () => {
    expect(valueOf('C', EXAMPLE, [])).toMatchObject({ value: null, state: 'needsBaseline' });
  });

  it('absolute targets resolve as before', () => {
    const c = contribution('X', '2027-03-31', 2, { targetType: 'absolute', target: 5 });
    expect(valueOf('X', [...EXAMPLE, c]).value).toBe(5);
  });
});
