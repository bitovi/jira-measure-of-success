import { describe, it, expect } from 'vitest';
import { parentFromIssueLinks, KPI_PARENT_LINK_TYPE, type IssueLinkRef } from './kpiLinks';

const inProject = new Set(['100', '200', '300']);

describe('parentFromIssueLinks', () => {
  it('returns the outward (parent) issue of a Parent link', () => {
    const links: IssueLinkRef[] = [
      { type: { name: KPI_PARENT_LINK_TYPE }, outwardIssue: { id: '100', key: 'KPI-1' } },
    ];
    expect(parentFromIssueLinks(links, inProject)).toBe('100');
  });

  it('returns null when there are no links', () => {
    expect(parentFromIssueLinks(undefined, inProject)).toBeNull();
    expect(parentFromIssueLinks([], inProject)).toBeNull();
  });

  it('ignores non-Parent link types', () => {
    const links: IssueLinkRef[] = [
      { type: { name: 'Blocks' }, outwardIssue: { id: '100' } },
      { type: { name: 'Relates' }, outwardIssue: { id: '200' } },
    ];
    expect(parentFromIssueLinks(links, inProject)).toBeNull();
  });

  it('ignores a Parent link whose parent is outside the KPI space', () => {
    const links: IssueLinkRef[] = [
      { type: { name: KPI_PARENT_LINK_TYPE }, outwardIssue: { id: '999' } },
    ];
    expect(parentFromIssueLinks(links, inProject)).toBeNull();
  });

  it('ignores the inward (child) direction — only outward is the parent', () => {
    // This is the shape seen on a PARENT issue (its child on the inward end).
    const links: IssueLinkRef[] = [
      { type: { name: KPI_PARENT_LINK_TYPE }, inwardIssue: { id: '200' } },
    ];
    expect(parentFromIssueLinks(links, inProject)).toBeNull();
  });

  it('picks the first qualifying in-project Parent link', () => {
    const links: IssueLinkRef[] = [
      { type: { name: 'Relates' }, outwardIssue: { id: '300' } },
      { type: { name: KPI_PARENT_LINK_TYPE }, outwardIssue: { id: '200' } },
      { type: { name: KPI_PARENT_LINK_TYPE }, outwardIssue: { id: '300' } },
    ];
    expect(parentFromIssueLinks(links, inProject)).toBe('200');
  });

  it('honors a custom link type name', () => {
    const links: IssueLinkRef[] = [
      { type: { name: 'KPI hierarchy' }, outwardIssue: { id: '300' } },
    ];
    expect(parentFromIssueLinks(links, inProject, 'KPI hierarchy')).toBe('300');
  });
});
