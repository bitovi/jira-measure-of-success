import { describe, it, expect } from 'vitest';
import { effectiveTiming, type TimingNode } from './effectiveTiming.js';
import type { RollupConfig, RollupMethod } from '../models/index.js';

function node(
  id: string,
  issueTypeName: string,
  ownDue: string | null,
  childIds: string[] = [],
): TimingNode {
  return { id, issueKey: id.toUpperCase(), issueTypeName, ownStart: null, ownDue, childIds };
}

function config(map: Record<string, RollupMethod>, depthCap?: number | null): RollupConfig {
  return { dueDateRollup: map, depthCap };
}

// o (own null) → a (own null) → b (own 2027-12-01)
const graph = new Map<string, TimingNode>([
  ['o', node('o', 'Outcome', null, ['a'])],
  ['a', node('a', 'Initiative', null, ['b'])],
  ['b', node('b', 'Epic', '2027-12-01')],
]);

const cfg = (depthCap?: number | null) =>
  config(
    { Outcome: 'widestRange', Initiative: 'widestRange', Epic: 'parentOnly' },
    depthCap,
  );

describe('effectiveTiming — rollup depth cap (FR-19)', () => {
  it('no cap → rolls all the way down to the deepest dated descendant', () => {
    expect(effectiveTiming('o', graph, cfg()).due).toEqual({
      date: '2027-12-01',
      source: 'children',
      fromIssueKey: 'A',
    });
  });

  it('cap 0 → own date only; never descends → pending', () => {
    expect(effectiveTiming('o', graph, cfg(0)).due).toEqual({ date: null, source: 'pending' });
  });

  it('cap 1 → descends one level; still pending (dated node is 2 levels down)', () => {
    expect(effectiveTiming('o', graph, cfg(1)).due).toEqual({ date: null, source: 'pending' });
  });

  it('cap 2 → descends two levels; reaches the dated Epic', () => {
    expect(effectiveTiming('o', graph, cfg(2)).due).toEqual({
      date: '2027-12-01',
      source: 'children',
      fromIssueKey: 'A',
    });
  });
});
