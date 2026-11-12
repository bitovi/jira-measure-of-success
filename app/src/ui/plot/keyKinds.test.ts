import { describe, expect, it } from 'vitest';
import type { TimelineNodeDto, TimelineTargetDto } from '@domain/index.js';
import { flattenNodes, summarizeKey, targetKeyKinds, undatedKeyKinds } from './keyKinds.js';

const DATA_ICON = 'data:image/svg+xml,%3Csvg%2F%3E';

const target = (over: Partial<TimelineTargetDto> = {}): TimelineTargetDto => ({
  date: '2026-09-30',
  value: 10,
  status: 'upcoming',
  provisional: false,
  source: { issue: 'A-1', type: 'Epic', title: 'Bet', iconUrl: DATA_ICON },
  ...over,
});

const node = (id: string, over: Partial<TimelineNodeDto> = {}): TimelineNodeDto => ({
  id,
  kpiId: id,
  issueKey: id,
  name: id,
  unit: 'u',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
  readings: [],
  children: [],
  ...over,
});

describe('targetKeyKinds', () => {
  it('uses the status for hit / missed (even while still an estimate)', () => {
    expect(targetKeyKinds(target({ status: 'hit' }))).toEqual(['hit', 'type:Epic']);
    expect(targetKeyKinds(target({ status: 'missed', provisional: true }))).toEqual(['missed', 'type:Epic']);
  });

  it('splits upcoming into fixed vs relative by whether the value is an estimate', () => {
    expect(targetKeyKinds(target())).toEqual(['upcoming-fixed', 'type:Epic']);
    expect(targetKeyKinds(target({ provisional: true }))).toEqual(['upcoming-relative', 'type:Epic']);
  });

  it('puts undated targets under "undated" plus their type', () => {
    expect(undatedKeyKinds(target({ date: null, provisional: true }))).toEqual(['undated', 'type:Epic']);
  });
});

describe('flattenNodes', () => {
  it('includes every descendant, regardless of collapse state', () => {
    const tree = [node('a', { children: [node('b', { children: [node('c')] })] }), node('d')];
    expect(flattenNodes(tree).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('summarizeKey', () => {
  it('counts targets by key kind and lists issue types by count', () => {
    const story = { issue: 'S-1', type: 'Story', title: 's', iconUrl: 'https://remote/icon.png' };
    const summary = summarizeKey([
      node('a', {
        readings: [
          { date: '2026-01-01', value: 1 },
          { date: '2026-02-01', value: 2 },
        ],
        targets: [
          target({ status: 'hit' }),
          target({ status: 'missed', source: story }),
          target({ provisional: true }),
          target({ provisional: true, source: story }),
          target({ source: story }),
        ],
        undated: [target({ date: null, provisional: true, source: story })],
      }),
      node('b', { readings: [{ date: '2026-01-01', value: 1 }] }),
    ]);

    expect(summary.recorded).toBe(true);
    expect(summary.projection).toBe(true);
    expect(summary.counts).toEqual({ hit: 1, missed: 1, 'upcoming-fixed': 1, 'upcoming-relative': 2, undated: 1 });
    expect(summary.types).toEqual([
      // a remote (non-`data:`) icon can't be tinted, so no icon is offered
      { type: 'Story', iconUrl: null, count: 4 },
      { type: 'Epic', iconUrl: DATA_ICON, count: 2 },
    ]);
  });

  it('reports no projection with fewer than 2 values, and nothing for an empty tree', () => {
    expect(summarizeKey([node('a', { readings: [{ date: '2026-01-01', value: 1 }] })]).projection).toBe(false);
    expect(summarizeKey([])).toEqual({
      recorded: false,
      projection: false,
      counts: { hit: 0, missed: 0, 'upcoming-fixed': 0, 'upcoming-relative': 0, undated: 0 },
      types: [],
    });
  });
});
