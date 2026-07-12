import { describe, it, expect } from 'vitest';
import { effectiveTiming, type TimingNode } from './effectiveTiming.js';
import type { RollupConfig, RollupMethod } from '../models/index.js';

function node(
  id: string,
  issueTypeName: string,
  ownStart: string | null,
  ownDue: string | null,
  childIds: string[] = [],
): TimingNode {
  return { id, issueKey: id.toUpperCase(), issueTypeName, ownStart, ownDue, childIds };
}

function graph(...nodes: TimingNode[]): Map<string, TimingNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function config(map: Record<string, RollupMethod>): RollupConfig {
  return { dueDateRollup: map };
}

// Requirements §6.2. Setup: parent own due 2026-06-30; three children with
// effective dues 2026-03-31, 2026-09-30, 2026-12-20. Starts mirror symmetric.
function withChildren(method: RollupMethod, ownDue: string | null, hasChildren: boolean) {
  const children = hasChildren
    ? [
        node('a', 'Initiative', '2026-01-05', '2026-03-31'),
        node('b', 'Initiative', '2026-02-10', '2026-09-30'),
        node('c', 'Initiative', '2026-03-15', '2026-12-20'),
      ]
    : [];
  const parent = node(
    'o',
    'Outcome',
    ownDue ? '2026-02-01' : null,
    ownDue,
    children.map((c) => c.id),
  );
  const g = graph(parent, ...children);
  const cfg = config({ Outcome: method, Initiative: 'parentOnly' });
  return effectiveTiming('o', g, cfg);
}

describe('effectiveTiming — due endpoint (requirements §6.2)', () => {
  it('DUE-1 childrenOnly with dated children → latest child, own ignored', () => {
    expect(withChildren('childrenOnly', '2026-06-30', true).due).toEqual({
      date: '2026-12-20',
      source: 'children',
      fromIssueKey: 'C',
    });
  });

  it('DUE-2 childrenOnly with no children → pending', () => {
    expect(withChildren('childrenOnly', '2026-06-30', false).due).toEqual({
      date: null,
      source: 'pending',
    });
  });

  it('DUE-3 childrenFirstThenParent with dated children → children win', () => {
    expect(withChildren('childrenFirstThenParent', '2026-06-30', true).due).toEqual({
      date: '2026-12-20',
      source: 'children',
      fromIssueKey: 'C',
    });
  });

  it('DUE-4 childrenFirstThenParent with no children → own date', () => {
    expect(withChildren('childrenFirstThenParent', '2026-06-30', false).due).toEqual({
      date: '2026-06-30',
      source: 'own',
    });
  });

  it('DUE-5 parentOnly with dated children → own date; never rolls up', () => {
    expect(withChildren('parentOnly', '2026-06-30', true).due).toEqual({
      date: '2026-06-30',
      source: 'own',
    });
  });

  it('DUE-6 parentFirstThenChildren with own date → own wins', () => {
    expect(withChildren('parentFirstThenChildren', '2026-06-30', true).due).toEqual({
      date: '2026-06-30',
      source: 'own',
    });
  });

  it('DUE-7 parentFirstThenChildren with no own date → children fill', () => {
    expect(withChildren('parentFirstThenChildren', null, true).due).toEqual({
      date: '2026-12-20',
      source: 'children',
      fromIssueKey: 'C',
    });
  });

  it('DUE-8 widestRange → latest across own + children', () => {
    expect(withChildren('widestRange', '2026-06-30', true).due).toEqual({
      date: '2026-12-20',
      source: 'children',
      fromIssueKey: 'C',
    });
  });

  it('DUE-9 no dates anywhere → pending', () => {
    const g = graph(node('o', 'Outcome', null, null, ['a']), node('a', 'Initiative', null, null));
    const r = effectiveTiming('o', g, config({ Outcome: 'childrenFirstThenParent', Initiative: 'parentOnly' }));
    expect(r.due).toEqual({ date: null, source: 'pending' });
    expect(r.start).toEqual({ date: null, source: 'pending' });
  });
});

describe('effectiveTiming — start endpoint rolls up symmetrically (earliest)', () => {
  it('childrenOnly → earliest child start', () => {
    expect(withChildren('childrenOnly', '2026-06-30', true).start).toEqual({
      date: '2026-01-05',
      source: 'children',
      fromIssueKey: 'A',
    });
  });

  it('widestRange → earliest across own start + children', () => {
    // own start 2026-02-01, earliest child start 2026-01-05 → child wins
    expect(withChildren('widestRange', '2026-06-30', true).start).toEqual({
      date: '2026-01-05',
      source: 'children',
      fromIssueKey: 'A',
    });
  });

  it('parentOnly → own start', () => {
    expect(withChildren('parentOnly', '2026-06-30', true).start).toEqual({
      date: '2026-02-01',
      source: 'own',
    });
  });
});

describe('effectiveTiming — recursion & guards', () => {
  it('resolves recursively bottom-up (grandchildren)', () => {
    const g = graph(
      node('o', 'Outcome', null, null, ['i']),
      node('i', 'Initiative', null, null, ['e']),
      node('e', 'Epic', '2026-01-01', '2027-01-15'),
    );
    const cfg = config({ Outcome: 'childrenOnly', Initiative: 'childrenOnly', Epic: 'parentOnly' });
    expect(effectiveTiming('o', g, cfg).due).toEqual({
      date: '2027-01-15',
      source: 'children',
      fromIssueKey: 'I',
    });
  });

  it('guards against cycles', () => {
    const g = graph(
      node('a', 'Outcome', '2026-01-01', '2026-01-01', ['b']),
      node('b', 'Initiative', '2026-02-02', '2026-02-02', ['a']),
    );
    const cfg = config({ Outcome: 'childrenOnly', Initiative: 'childrenOnly' });
    expect(() => effectiveTiming('a', g, cfg)).not.toThrow();
  });

  it('leaf defaults to parentOnly when config missing', () => {
    const g = graph(node('s', 'Story', '2026-01-01', '2026-04-01'));
    expect(effectiveTiming('s', g, config({})).due).toEqual({ date: '2026-04-01', source: 'own' });
  });
});
