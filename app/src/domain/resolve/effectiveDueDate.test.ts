import { describe, it, expect } from 'vitest';
import {
  effectiveDueDate,
  type HierarchyNode,
} from './effectiveDueDate.js';
import type { RollupConfig, RollupMethod } from '../models/index.js';

function node(
  id: string,
  issueTypeName: string,
  ownDueDate: string | null,
  childIds: string[] = [],
): HierarchyNode {
  return { id, issueKey: id.toUpperCase(), issueTypeName, ownDueDate, childIds };
}

function graph(...nodes: HierarchyNode[]): Map<string, HierarchyNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function config(map: Record<string, RollupMethod>): RollupConfig {
  return { dueDateRollup: map };
}

describe('effectiveDueDate (Brief §6.1)', () => {
  it('parentOnly: uses own date, ignores children', () => {
    const g = graph(
      node('o', 'Outcome', '2026-06-30', ['c']),
      node('c', 'Story', '2026-12-31'),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'parentOnly' }));
    expect(r).toEqual({ date: '2026-06-30', source: 'own' });
  });

  it('childrenOnly: latest child, ignores own date', () => {
    const g = graph(
      node('o', 'Outcome', '2026-06-30', ['a', 'b']),
      node('a', 'Initiative', '2026-03-31'),
      node('b', 'Initiative', '2026-09-30'),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'childrenOnly' }));
    expect(r).toEqual({ date: '2026-09-30', source: 'children', fromIssueKey: 'B' });
  });

  it('childrenOnly with no dated children: pending', () => {
    const g = graph(
      node('o', 'Outcome', '2026-06-30', ['a']),
      node('a', 'Initiative', null),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'childrenOnly', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: null, source: 'pending' });
  });

  it('childrenFirstThenParent: rolls up from dated children', () => {
    const g = graph(
      node('o', 'Outcome', '2026-06-30', ['a', 'b', 'c']),
      node('a', 'Initiative', '2026-01-31'),
      node('b', 'Initiative', '2026-11-30'),
      node('c', 'Initiative', '2026-05-31'),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'childrenFirstThenParent', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: '2026-11-30', source: 'children', fromIssueKey: 'B' });
  });

  it('childrenFirstThenParent: falls back to own date when no dated children', () => {
    const g = graph(
      node('o', 'Outcome', '2026-06-30', ['a']),
      node('a', 'Initiative', null),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'childrenFirstThenParent', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: '2026-06-30', source: 'own' });
  });

  it('parentFirstThenChildren: own date wins when present', () => {
    const g = graph(
      node('o', 'Outcome', '2026-06-30', ['a']),
      node('a', 'Initiative', '2026-12-31'),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'parentFirstThenChildren', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: '2026-06-30', source: 'own' });
  });

  it('parentFirstThenChildren: children fill the gap when own is null', () => {
    const g = graph(
      node('o', 'Outcome', null, ['a']),
      node('a', 'Initiative', '2026-12-31'),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'parentFirstThenChildren', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: '2026-12-31', source: 'children', fromIssueKey: 'A' });
  });

  it('widestRange: latest across own and all children', () => {
    const g = graph(
      node('o', 'Outcome', '2026-08-31', ['a', 'b']),
      node('a', 'Initiative', '2026-03-31'),
      node('b', 'Initiative', '2026-12-31'),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'widestRange', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: '2026-12-31', source: 'children', fromIssueKey: 'B' });
  });

  it('resolves recursively bottom-up (grandchildren)', () => {
    const g = graph(
      node('o', 'Outcome', null, ['i']),
      node('i', 'Initiative', null, ['e']),
      node('e', 'Epic', '2027-01-15'),
    );
    const cfg = config({
      Outcome: 'childrenOnly',
      Initiative: 'childrenOnly',
      Epic: 'parentOnly',
    });
    // o's date is determined by its DIRECT child (i), which itself rolled up from e
    expect(effectiveDueDate('o', g, cfg)).toEqual({
      date: '2027-01-15',
      source: 'children',
      fromIssueKey: 'I',
    });
  });

  it('no dates anywhere: pending', () => {
    const g = graph(
      node('o', 'Outcome', null, ['a']),
      node('a', 'Initiative', null),
    );
    const r = effectiveDueDate('o', g, config({ Outcome: 'childrenFirstThenParent', Initiative: 'parentOnly' }));
    expect(r).toEqual({ date: null, source: 'pending' });
  });

  it('guards against cycles without infinite recursion', () => {
    const g = graph(
      node('a', 'Outcome', '2026-01-01', ['b']),
      node('b', 'Initiative', '2026-02-02', ['a']), // cycle back to a
    );
    const cfg = config({ Outcome: 'childrenOnly', Initiative: 'childrenOnly' });
    expect(() => effectiveDueDate('a', g, cfg)).not.toThrow();
  });

  it('uses default method (leaf => parentOnly) when config missing', () => {
    const g = graph(node('s', 'Story', '2026-04-01'));
    const r = effectiveDueDate('s', g, config({}));
    expect(r).toEqual({ date: '2026-04-01', source: 'own' });
  });
});
