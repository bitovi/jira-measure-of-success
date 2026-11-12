import { describe, it, expect } from 'vitest';
import {
  breakParentCycles,
  describeParentEnd,
  isDirectionalLinkType,
  kpiParentLinkBody,
  parentFromIssueLinks,
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

describe('isDirectionalLinkType / describeParentEnd', () => {
  it('rejects symmetric types like Relates', () => {
    expect(isDirectionalLinkType({ inward: 'relates to', outward: 'relates to' })).toBe(false);
    expect(isDirectionalLinkType({ inward: 'is blocked by', outward: 'blocks' })).toBe(true);
  });

  it('phrases each end with the outward label', () => {
    expect(describeParentEnd({ outward: 'blocks' }, 'inward')).toBe('Parent blocks child');
    expect(describeParentEnd({ outward: 'blocks' }, 'outward')).toBe('Child blocks parent');
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
