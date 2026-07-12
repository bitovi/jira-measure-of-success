import {
  effectiveTiming,
  groupByRelationship,
  resolveRelativeTargetDate,
  targetStatus,
  type CatalogEntryDto,
  type PanelData,
  type PanelRowDto,
  type RelativeTargetContext,
  type ResolvedEndpoint,
  type TimelineData,
  type TimelineNodeDto,
  type TimingNode,
  type Assignment,
  type RollupConfig,
} from '@domain/index.js';
import {
  CATALOG,
  HIERARCHY_LEVELS,
  ISSUES,
  KPI_TREE,
  ROLLUP_CONFIG,
  issueById,
  type FixtureIssue,
  type KpiTreeNode,
} from './hierarchy.js';

/**
 * Mock resolver functions — the local stand-in for the Forge backend resolver.
 * These produce the SAME contract payloads (src/domain/contracts.ts) the real
 * `invoke(...)` handlers will return, built from the same pure domain functions.
 * The harness holds mutable in-memory copies so save/record/remove round-trip.
 */

let config: RollupConfig = structuredClone(ROLLUP_CONFIG);
const issues: FixtureIssue[] = structuredClone(ISSUES);
const kpiTree: KpiTreeNode[] = structuredClone(KPI_TREE);

const TODAY = '2026-07-10';

function findIssue(id: string): FixtureIssue | undefined {
  return issues.find((i) => i.id === id) ?? issueById(id);
}

function catalogDto(): CatalogEntryDto[] {
  return CATALOG.map((k) => ({ id: k.id, name: k.name, unit: k.unit, direction: k.direction }));
}

// ── Timing engine over the issue tree ───────────────────────────────────────
function timingNodes(): Map<string, TimingNode> {
  return new Map(
    issues.map((i) => [
      i.id,
      {
        id: i.id,
        issueKey: i.key,
        issueTypeName: i.issueTypeName,
        ownStart: i.ownStart,
        ownDue: i.ownDue,
        childIds: issues.filter((c) => c.parentId === i.id).map((c) => c.id),
      } satisfies TimingNode,
    ]),
  );
}

function dueOf(issueId: string, nodes: Map<string, TimingNode>, memo: Map<string, ResolvedEndpoint>): ResolvedEndpoint {
  return effectiveTiming(issueId, nodes, config, memo).due;
}

function targetContext(
  issue: FixtureIssue,
  nodes: Map<string, TimingNode>,
  memo: Map<string, ResolvedEndpoint>,
): RelativeTargetContext {
  const ctx: RelativeTargetContext = {
    issue: { issueKey: issue.key, due: dueOf(issue.id, nodes, memo) },
  };
  if (issue.parentId) {
    const parent = findIssue(issue.parentId);
    if (parent) ctx.parent = { issueKey: parent.key, due: dueOf(parent.id, nodes, memo) };
  }
  return ctx;
}

function resolveDate(assignment: Assignment, ctx: RelativeTargetContext) {
  return resolveRelativeTargetDate(assignment.timing.due, ctx, assignment.timing.start);
}

// ── Issue panel ─────────────────────────────────────────────────────────────
export function getPanelData(issueId: string): PanelData {
  const issue = findIssue(issueId);
  if (!issue) return { issueKey: issueId, rows: [], catalog: catalogDto() };

  const parent = issue.parentId ? findIssue(issue.parentId) : undefined;
  const grouped = groupByRelationship(issue.assignments, parent?.assignments ?? [], CATALOG);

  const nodes = timingNodes();
  const memo = new Map<string, ResolvedEndpoint>();
  const ctx = targetContext(issue, nodes, memo);

  const rows: PanelRowDto[] = [];
  const pushRow = (
    kpiId: string,
    relationship: PanelRowDto['relationship'],
    assignment?: Assignment,
  ) => {
    const def = CATALOG.find((k) => k.id === kpiId);
    rows.push({
      kpiId,
      name: def?.name ?? kpiId,
      unit: def?.unit ?? '',
      direction: def?.direction ?? null,
      target: assignment?.target ?? null,
      targetType: assignment?.targetType ?? null,
      targetDate: assignment ? resolveDate(assignment, ctx) : null,
      relationship,
    });
  };

  for (const r of grouped.sharedWithParent) pushRow(r.kpiId, 'shared', r.assignment);
  for (const r of grouped.onlyHere) pushRow(r.kpiId, 'onlyHere', r.assignment);
  for (const r of grouped.onParentNotTracked) pushRow(r.kpiId, 'onParentNotTracked');

  return { issueKey: issue.key, rows, catalog: catalogDto() };
}

export function saveAssignment(issueId: string, assignment: Assignment): PanelData {
  const issue = findIssue(issueId);
  if (issue) {
    const idx = issue.assignments.findIndex((a) => a.kpiId === assignment.kpiId);
    if (idx >= 0) issue.assignments[idx] = assignment;
    else issue.assignments.push(assignment);
  }
  return getPanelData(issueId);
}

export function removeAssignment(issueId: string, kpiId: string): PanelData {
  const issue = findIssue(issueId);
  if (issue) issue.assignments = issue.assignments.filter((a) => a.kpiId !== kpiId);
  return getPanelData(issueId);
}

// ── Settings ────────────────────────────────────────────────────────────────
export function getHierarchyLevels(): string[] {
  return HIERARCHY_LEVELS;
}

export function getRollupConfig(): RollupConfig {
  return config;
}

export function saveRollupConfig(next: RollupConfig): { ok: true; saved: RollupConfig } {
  config = next;
  return { ok: true, saved: config };
}

// ── Timeline ────────────────────────────────────────────────────────────────
let timelineIdSeq = 1;
function toTimelineNode(node: KpiTreeNode, depth: number): TimelineNodeDto {
  return {
    id: `n${timelineIdSeq++}`,
    kpiId: node.kpiId,
    name: node.name,
    unit: node.unit,
    direction: node.direction,
    depth,
    targets: node.targets.map((t) => ({
      date: t.date,
      value: t.value,
      status: targetStatus(t, node.readings, node.direction, TODAY),
      source: t.source,
    })),
    readings: node.readings.map((r) => ({ date: r.date, value: r.value })),
    children: (node.children ?? []).map((c) => toTimelineNode(c, depth + 1)),
  };
}

export function getTimelineData(): TimelineData {
  timelineIdSeq = 1;
  return { today: TODAY, roots: kpiTree.map((n) => toTimelineNode(n, 0)) };
}

function findTreeNode(nodes: KpiTreeNode[], kpiId: string): KpiTreeNode | undefined {
  for (const n of nodes) {
    if (n.kpiId === kpiId) return n;
    if (n.children) {
      const found = findTreeNode(n.children, kpiId);
      if (found) return found;
    }
  }
  return undefined;
}

export function recordValue(kpiId: string, date: string, value: number): TimelineData {
  const node = findTreeNode(kpiTree, kpiId);
  if (node) {
    node.readings.push({ date, value, recordedBy: 'acc-jm', recordedAt: Date.now() });
    node.readings.sort((a, b) => a.date.localeCompare(b.date));
  }
  return getTimelineData();
}
