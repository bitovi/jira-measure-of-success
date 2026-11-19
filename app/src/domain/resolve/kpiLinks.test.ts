import { describe, it, expect } from 'vitest';
import {
  breakParentCycles,
  defaultParentEnd,
  findAppLinkType,
  isDirectionalLinkType,
  kpiParentLinkBody,
  kpiParentLinks,
  linkLabelsForParentEnd,
  parentFromIssueLinks,
  wouldCreateKpiCycle,
  type IssueLinkRef,
} from './kpiLinks';
import type { KpiHierarchyLink } from '../models/kpiHierarchy';

const inProject = new Set(['100', '200', '300']);
const HIER: KpiHierarchyLink = { linkTypeId: '10500', parentEnd: 'inward' };
const BLOCKS_CHILD_BLOCKS_PARENT: KpiHierarchyLink = { linkTypeId: '10000', parentEnd: 'outward' };

describe('parentFromIssueLinks', () => {
  it('parentEnd inward: the parent is the inward issue on the child', () => {
    const links: IssueLinkRef[] = [{ type: { id: '10500' }, inwardIssue: { id: '100', key: 'KPI-1' } }];
    expect(parentFromIssueLinks(links, inProject, HIER)).toBe('100');
  });

  it('parentEnd outward: the parent is the outward issue on the child', () => {
    const links: IssueLinkRef[] = [{ type: { id: '10000', name: 'Blocks' }, outwardIssue: { id: '200' } }];
    expect(parentFromIssueLinks(links, inProject, BLOCKS_CHILD_BLOCKS_PARENT)).toBe('200');
  });

  it('ignores the child end (the shape seen on a PARENT issue)', () => {
    const links: IssueLinkRef[] = [{ type: { id: '10500' }, outwardIssue: { id: '200' } }];
    expect(parentFromIssueLinks(links, inProject, HIER)).toBeNull();
  });

  it('returns null when there are no links or no configured hierarchy', () => {
    expect(parentFromIssueLinks(undefined, inProject, HIER)).toBeNull();
    expect(parentFromIssueLinks([], inProject, HIER)).toBeNull();
    const links: IssueLinkRef[] = [{ type: { id: '10500' }, inwardIssue: { id: '100' } }];
    expect(parentFromIssueLinks(links, inProject, null)).toBeNull();
  });

  it('matches by type id, not name (renamed types keep working; same-named types are ignored)', () => {
    const links: IssueLinkRef[] = [
      { type: { id: '10001', name: 'KPI Hierarchy' }, inwardIssue: { id: '100' } },
      { type: { id: '10500', name: 'Renamed' }, inwardIssue: { id: '200' } },
    ];
    expect(parentFromIssueLinks(links, inProject, HIER)).toBe('200');
  });

  it('ignores a link whose parent is outside the KPI space', () => {
    const links: IssueLinkRef[] = [{ type: { id: '10500' }, inwardIssue: { id: '999' } }];
    expect(parentFromIssueLinks(links, inProject, HIER)).toBeNull();
  });

  it('picks the first qualifying in-project link', () => {
    const links: IssueLinkRef[] = [
      { type: { id: '10003' }, inwardIssue: { id: '300' } },
      { type: { id: '10500' }, inwardIssue: { id: '200' } },
      { type: { id: '10500' }, inwardIssue: { id: '300' } },
    ];
    expect(parentFromIssueLinks(links, inProject, HIER)).toBe('200');
  });
});

describe('kpiParentLinks', () => {
  it('lists every qualifying parent link with its id, skipping foreign types, child ends and outside parents', () => {
    const links: IssueLinkRef[] = [
      { id: 'l1', type: { id: '10500' }, inwardIssue: { id: '100' } },
      { id: 'l2', type: { id: '10003' }, inwardIssue: { id: '200' } },
      { id: 'l3', type: { id: '10500' }, outwardIssue: { id: '300' } },
      { id: 'l4', type: { id: '10500' }, inwardIssue: { id: '999' } },
      { id: 'l5', type: { id: '10500' }, inwardIssue: { id: '300' } },
    ];
    expect(kpiParentLinks(links, inProject, HIER)).toEqual([
      { linkId: 'l1', parentId: '100' },
      { linkId: 'l5', parentId: '300' },
    ]);
  });

  it('is empty without a configured hierarchy', () => {
    expect(kpiParentLinks([{ id: 'l1', type: { id: '10500' }, inwardIssue: { id: '100' } }], inProject, null)).toEqual([]);
  });
});

describe('wouldCreateKpiCycle', () => {
  // 1 ← 2 ← 3 (3's parent is 2, 2's parent is 1); 4 is a separate root.
  const parents: Record<string, string | null> = { '1': null, '2': '1', '3': '2', '4': null };
  const parentOf = (id: string) => parents[id];

  it('refuses the KPI itself or any of its descendants as the new parent', () => {
    expect(wouldCreateKpiCycle('1', '1', parentOf)).toBe(true);
    expect(wouldCreateKpiCycle('1', '3', parentOf)).toBe(true);
    expect(wouldCreateKpiCycle('2', '3', parentOf)).toBe(true);
  });

  it('allows ancestors, siblings and other trees', () => {
    expect(wouldCreateKpiCycle('3', '1', parentOf)).toBe(false);
    expect(wouldCreateKpiCycle('2', '4', parentOf)).toBe(false);
  });

  it('terminates on a pre-existing loop that does not involve the KPI', () => {
    const loop: Record<string, string> = { a: 'b', b: 'a' };
    expect(wouldCreateKpiCycle('x', 'a', (id) => loop[id])).toBe(false);
  });
});

describe('kpiParentLinkBody', () => {
  it('round-trips with parentFromIssueLinks for both ends', () => {
    // A link POSTed as { inwardIssue: A, outwardIssue: B } shows on B as inwardIssue A
    // and on A as outwardIssue B (Jira issue linking model).
    for (const hierarchy of [HIER, BLOCKS_CHILD_BLOCKS_PARENT]) {
      const body = kpiParentLinkBody(hierarchy, 'P', 'C');
      const onChild: IssueLinkRef =
        body.inwardIssue.key === 'C'
          ? { type: { id: hierarchy.linkTypeId }, outwardIssue: { id: '100' } }
          : { type: { id: hierarchy.linkTypeId }, inwardIssue: { id: '100' } };
      expect(body.type).toEqual({ id: hierarchy.linkTypeId });
      expect(parentFromIssueLinks([onChild], inProject, hierarchy)).toBe('100');
    }
  });

  it('parentEnd inward reads "parent <outward> child"', () => {
    expect(kpiParentLinkBody(HIER, 'P', 'C')).toMatchObject({ inwardIssue: { key: 'P' }, outwardIssue: { key: 'C' } });
  });
});

describe('isDirectionalLinkType / linkLabelsForParentEnd', () => {
  it('rejects symmetric types like Relates', () => {
    expect(isDirectionalLinkType({ inward: 'relates to', outward: 'relates to' })).toBe(false);
    expect(isDirectionalLinkType({ inward: 'is blocked by', outward: 'blocks' })).toBe(true);
  });

  it('names the label Jira shows on the parent and on the child', () => {
    const blocks = { inward: 'is blocked by', outward: 'blocks' };
    expect(linkLabelsForParentEnd(blocks, 'inward')).toEqual({ parent: 'blocks', child: 'is blocked by' });
    expect(linkLabelsForParentEnd(blocks, 'outward')).toEqual({ parent: 'is blocked by', child: 'blocks' });
  });
});

describe('breakParentCycles', () => {
  const ids = (items: Array<{ id: string; parentId: string | null }>) =>
    Object.fromEntries(items.map((i) => [i.id, i.parentId]));

  it('leaves a forest untouched (same objects)', () => {
    const items = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'outside' },
    ];
    const out = breakParentCycles(items);
    expect(out).toEqual(items);
    out.forEach((o, i) => expect(o).toBe(items[i]));
  });

  it('promotes the first member of a loop to a root, keeping the rest nested under it', () => {
    const items = [
      { id: 'x', parentId: null },
      { id: 'a', parentId: 'c' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'b' },
    ];
    expect(ids(breakParentCycles(items))).toEqual({ x: null, a: null, b: 'a', c: 'b', d: 'b' });
  });

  it('breaks self-links and two-node loops', () => {
    expect(ids(breakParentCycles([{ id: 'a', parentId: 'a' }]))).toEqual({ a: null });
    const two = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(ids(breakParentCycles(two))).toEqual({ a: null, b: 'a' });
  });
});

describe('defaultParentEnd / findAppLinkType', () => {
  it('puts the parent on the inward end of the app type, or outward when its labels are reversed', () => {
    expect(defaultParentEnd({ outward: 'is the parent KPI of' })).toBe('inward');
    expect(defaultParentEnd({ outward: ' Is a child KPI of ' })).toBe('outward');
    expect(defaultParentEnd(null)).toBe('inward');
  });

  it('finds the app type by name, case-insensitively', () => {
    const types = [{ id: '1', name: 'Blocks' }, { id: '2', name: 'kpi hierarchy' }];
    expect(findAppLinkType(types)).toEqual({ id: '2', name: 'kpi hierarchy' });
    expect(findAppLinkType([{ id: '1', name: 'Blocks' }])).toBeNull();
  });
});
