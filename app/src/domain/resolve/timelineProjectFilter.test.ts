import { describe, expect, it } from 'vitest';
import type { TimelineNodeDto, TimelineTargetDto } from '../contracts';
import { collectContributingProjects, filterTimelineByProjects } from './timelineProjectFilter';

/**
 * Timeline project filter — contributing issues (which hold KPI targets) can
 * live in any Jira project, unlike the single dedicated KPI space project.
 * Subtree match: a KPI row is kept if IT or ANY descendant has a target from a
 * selected project; non-matching nodes are removed (not dimmed).
 */

function target(issue: string, over: Partial<TimelineTargetDto> = {}): TimelineTargetDto {
  return {
    date: '2026-06-30',
    value: 100,
    status: 'upcoming',
    provisional: false,
    source: { issue, type: 'Story', title: 'x' },
    ...over,
  };
}

function node(over: Partial<TimelineNodeDto> & { id: string; kpiId: string; name: string }): TimelineNodeDto {
  return {
    issueKey: 'KPI-0',
    unit: 'USD',
    direction: 'increase',
    depth: 0,
    targets: [],
    undated: [],
    readings: [],
    children: [],
    ...over,
  };
}

describe('collectContributingProjects', () => {
  it('collects distinct project keys from own targets, undated targets, and descendants', () => {
    const roots: TimelineNodeDto[] = [
      node({
        id: 'n1',
        kpiId: 'revenue',
        name: 'Revenue',
        targets: [target('OUT-12'), target('OUT-14')],
        undated: [target('ECOM-9')],
        children: [node({ id: 'n2', kpiId: 'stores', name: 'Stores', targets: [target('POS-201')] })],
      }),
    ];
    expect(collectContributingProjects(roots)).toEqual(['ECOM', 'OUT', 'POS']);
  });

  it('returns an empty list for a tree with no targets', () => {
    const roots: TimelineNodeDto[] = [node({ id: 'n1', kpiId: 'revenue', name: 'Revenue' })];
    expect(collectContributingProjects(roots)).toEqual([]);
  });
});

describe('filterTimelineByProjects', () => {
  const tree: TimelineNodeDto[] = [
    node({
      id: 'root',
      kpiId: 'revenue',
      name: 'Revenue',
      targets: [target('OUT-12')],
      children: [
        node({ id: 'leaf-ecom', kpiId: 'ecom-rev', name: 'Ecom Revenue', targets: [target('ECOM-1')] }),
        node({ id: 'leaf-pos', kpiId: 'pos-rev', name: 'POS Revenue', targets: [target('POS-201')] }),
      ],
    }),
  ];

  it('returns the tree unchanged when selection is null or empty', () => {
    expect(filterTimelineByProjects(tree, null)).toBe(tree);
    expect(filterTimelineByProjects(tree, new Set())).toBe(tree);
  });

  it('keeps an ancestor when only a descendant matches (subtree match), stripping its own non-matching targets', () => {
    const result = filterTimelineByProjects(tree, new Set(['ECOM']));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('root');
    expect(result[0].targets).toEqual([]);
    expect(result[0].children.map((c) => c.id)).toEqual(['leaf-ecom']);
  });

  it('narrows a node with a mix of matching and non-matching own targets to just the matching ones', () => {
    const mixed: TimelineNodeDto[] = [
      node({
        id: 'n1',
        kpiId: 'revenue',
        name: 'Revenue',
        targets: [target('OUT-12'), target('ECOM-9')],
      }),
    ];
    const result = filterTimelineByProjects(mixed, new Set(['ECOM']));
    expect(result[0].targets.map((t) => t.source.issue)).toEqual(['ECOM-9']);
  });

  it('keeps a root match even when no children match, dropping non-matching children', () => {
    const result = filterTimelineByProjects(tree, new Set(['OUT']));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('root');
    expect(result[0].children).toEqual([]);
  });

  it('matches on an undated target source', () => {
    const withUndated: TimelineNodeDto[] = [
      node({ id: 'n1', kpiId: 'revenue', name: 'Revenue', undated: [target('ECOM-9', { date: null })] }),
    ];
    const result = filterTimelineByProjects(withUndated, new Set(['ECOM']));
    expect(result.map((n) => n.id)).toEqual(['n1']);
  });

  it('drops everything when nothing matches', () => {
    expect(filterTimelineByProjects(tree, new Set(['ZZZ']))).toEqual([]);
  });
});
