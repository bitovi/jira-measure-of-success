import {
  effectiveTiming,
  encodeReadingValue,
  groupByRelationship,
  isValidProjectKey,
  normalizeProjectKey,
  readingsFromChangelog,
  resolveRelativeTargetDate,
  resolvePanelTarget,
  targetStatus,
  type AddTargetInput,
  type CatalogEntryDto,
  type CreateKpiInput,
  type IssuePickerItem,
  type KpiSpaceStatus,
  type PanelData,
  type PanelRowDto,
  type ReadingChange,
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
  issueTypeIconUri,
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

// ── Reading storage — Option B (changelog of a per-KPI field) ────────────────
// The harness models each KPI issue's reading-field changelog: every recorded
// value is an embedded-date entry, and the series is reconstructed with the SAME
// domain reducer the Forge backend uses. Seeded from the fixture readings so the
// timeline renders identically while exercising the real encode/reduce path.
const readingChangelog = new Map<string, ReadingChange[]>();
(function seedReadingChangelog() {
  const walk = (nodes: KpiTreeNode[]) => {
    for (const n of nodes) {
      readingChangelog.set(
        n.kpiId,
        n.readings.map((r) => ({
          created: r.recordedAt,
          to: encodeReadingValue(r.date, r.value),
          by: r.recordedBy,
        })),
      );
      if (n.children) walk(n.children);
    }
  };
  walk(kpiTree);
})();

function readingsFor(kpiId: string) {
  return readingsFromChangelog(readingChangelog.get(kpiId) ?? []);
}

function findIssue(id: string): FixtureIssue | undefined {
  return issues.find((i) => i.id === id) ?? issueById(id);
}

// Ordered depth-first over the KPI tree (not CATALOG's declaration order) so
// the picker can indent options to show the parent/child relationship, same
// hierarchy the Timeline nests by.
function catalogDto(): CatalogEntryDto[] {
  const out: CatalogEntryDto[] = [];
  const walk = (nodes: KpiTreeNode[], depth: number) => {
    for (const n of nodes) {
      const readings = readingsFor(n.kpiId);
      const latest = readings.length ? readings[readings.length - 1].value : null;
      out.push({ id: n.kpiId, name: n.name, unit: n.unit, direction: n.direction, currentValue: latest, depth });
      if (n.children) walk(n.children, depth + 1);
    }
  };
  walk(kpiTree, 0);
  return out;
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

/**
 * The endpoint the baseline is measured at — the DUE date the timing anchors to
 * (FR-4), before the offset. v1 only offers the `issueDueDate` anchor; other
 * anchors fall back to the resolved target date so absolute/fixed targets still
 * resolve a sensible baseline date.
 */
function baselineDueEndpoint(
  assignment: Assignment,
  ctx: RelativeTargetContext,
  targetDate: string | null,
): ResolvedEndpoint {
  const due = assignment.timing.due;
  if (due.mode === 'relative' && due.anchor === 'issueDueDate') return ctx.issue.due;
  if (due.mode === 'relative' && due.anchor === 'parentDueDate') {
    return ctx.parent?.due ?? { date: null, source: 'pending' };
  }
  return { date: targetDate, source: 'own' };
}

// ── Issue panel ─────────────────────────────────────────────────────────────

/** Find a KPI tree node by its KPI id OR its Jira issue key (KPI-N). */
function findKpiByRef(nodes: KpiTreeNode[], ref: string): KpiTreeNode | undefined {
  for (const n of nodes) {
    if (n.kpiId === ref || n.issueKey === ref) return n;
    const found = n.children && findKpiByRef(n.children, ref);
    if (found) return found;
  }
  return undefined;
}

export function getPanelData(issueId: string): PanelData {
  // Feature 04: when the panel is opened ON a KPI issue (its id/key names a KPI
  // in the KPI space), return the single-KPI chart payload instead of the
  // associate/target-editor rows. In the harness, open it via
  // `?surface=issue&issueId=KPI-1` (or the KPI id, e.g. `revenue`).
  const kpiNode = findKpiByRef(kpiTree, issueId);
  if (kpiNode) {
    timelineIdSeq = 1;
    return {
      issueKey: kpiNode.issueKey,
      rows: [],
      catalog: catalogDto(),
      issueDueDate: null,
      issueDueRolledUp: false,
      kpiView: { node: toTimelineNode(kpiNode, 0), today: TODAY },
    };
  }

  const issue = findIssue(issueId);
  if (!issue)
    return {
      issueKey: issueId,
      rows: [],
      catalog: catalogDto(),
      issueDueDate: null,
      issueDueRolledUp: false,
    };

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
    if (!assignment) {
      rows.push({
        kpiId,
        name: def?.name ?? kpiId,
        unit: def?.unit ?? '',
        direction: def?.direction ?? null,
        target: null,
        targetType: null,
        targetDate: null,
        dueTiming: null,
        start: null,
        relationship,
        resolvedValue: null,
        displayState: null,
        warning: null,
        frozen: false,
        dueDate: null,
        dueDateRolledUp: false,
        actual: null,
      });
      return;
    }

    const targetDate = resolveDate(assignment, ctx);
    const dueEndpoint = baselineDueEndpoint(assignment, ctx, targetDate.date);
    const resolved = resolvePanelTarget({
      assignment,
      dueDate: dueEndpoint.date,
      targetDate: targetDate.date,
      readings: readingsFor(kpiId),
      direction: def?.direction ?? null,
      closed: issue.closed ?? false,
      today: TODAY,
    });
    rows.push({
      kpiId,
      name: def?.name ?? kpiId,
      unit: def?.unit ?? '',
      direction: def?.direction ?? null,
      target: assignment.target,
      targetType: assignment.targetType,
      targetDate,
      dueTiming: assignment.timing.due,
      start: assignment.timing.start,
      relationship,
      resolvedValue: resolved.resolvedValue,
      displayState: resolved.displayState,
      warning: resolved.warning,
      frozen: resolved.frozen,
      dueDate: dueEndpoint.date,
      dueDateRolledUp: dueEndpoint.source === 'children',
      actual: resolved.actual,
    });
  };

  for (const r of grouped.sharedWithParent) pushRow(r.kpiId, 'shared', r.assignment);
  for (const r of grouped.onlyHere) pushRow(r.kpiId, 'onlyHere', r.assignment);
  for (const r of grouped.onParentNotTracked) pushRow(r.kpiId, 'onParentNotTracked');

  return {
    issueKey: issue.key,
    rows,
    catalog: catalogDto(),
    issueDueDate: ctx.issue.due.date,
    issueDueRolledUp: ctx.issue.due.source === 'children',
  };
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

// ── KPI space (storage-model.md) ─────────────────────────────────────────────
// Admin sets a project key; the app creates/connects the KPI project. The
// harness models the state machine in memory (starts unset).
let kpiSpace: KpiSpaceStatus = { key: null, projectId: null, name: null, state: 'unset' };

export function getKpiSpace(): KpiSpaceStatus {
  return kpiSpace;
}

export function saveKpiSpaceKey(rawKey: string): KpiSpaceStatus {
  const key = normalizeProjectKey(rawKey ?? '');
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${rawKey}"`);
  // Setting a key we've already provisioned keeps it ready; otherwise it's missing.
  kpiSpace =
    kpiSpace.state === 'ready' && kpiSpace.key === key
      ? kpiSpace
      : { key, projectId: null, name: null, state: 'missing' };
  return kpiSpace;
}

export function createKpiSpace(rawKey: string): KpiSpaceStatus {
  const key = normalizeProjectKey(rawKey ?? '');
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${rawKey}"`);
  kpiSpace = { key, projectId: `proj-${key}`, name: `KPIs (${key})`, state: 'ready' };
  return kpiSpace;
}

// ── Timeline ────────────────────────────────────────────────────────────────
let timelineIdSeq = 1;
function toTimelineNode(node: KpiTreeNode, depth: number): TimelineNodeDto {
  const readings = readingsFor(node.kpiId);
  const dated: TimelineNodeDto['targets'] = [];
  const undated: TimelineNodeDto['undated'] = [];
  for (const t of node.targets) {
    const src = { ...t.source, iconUrl: t.source.iconUrl ?? issueTypeIconUri(t.source.type) };
    if (t.date === null) {
      undated.push({ date: null, value: t.value, status: 'upcoming', provisional: t.provisional ?? false, source: src });
    } else {
      dated.push({
        date: t.date,
        value: t.value,
        status: targetStatus({ date: t.date, value: t.value }, readings, node.direction, TODAY),
        provisional: t.provisional ?? false,
        source: src,
      });
    }
  }
  return {
    id: `n${timelineIdSeq++}`,
    kpiId: node.kpiId,
    issueKey: node.issueKey,
    name: node.name,
    unit: node.unit,
    direction: node.direction,
    depth,
    targets: dated,
    undated,
    readings: readings.map((r) => ({ date: r.date, value: r.value })),
    children: (node.children ?? []).map((c) => toTimelineNode(c, depth + 1)),
  };
}

export function getTimelineData(): TimelineData {
  timelineIdSeq = 1;
  return { today: TODAY, roots: kpiTree.map((n) => toTimelineNode(n, 0)) };
}

/**
 * Record (or, with value=null, tombstone) a KPI reading. Appends one entry to
 * that KPI's field changelog — Option B: append-only, last-write-wins per date.
 */
export function recordValue(kpiId: string, date: string, value: number | null): TimelineData {
  const log = readingChangelog.get(kpiId) ?? [];
  log.push({ created: Date.now(), to: encodeReadingValue(date, value), by: 'acc-jm' });
  readingChangelog.set(kpiId, log);
  return getTimelineData();
}

function findKpiNode(nodes: KpiTreeNode[], kpiId: string): KpiTreeNode | undefined {
  for (const n of nodes) {
    if (n.kpiId === kpiId) return n;
    const found = n.children && findKpiNode(n.children, kpiId);
    if (found) return found;
  }
  return undefined;
}

function slugifyKpi(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kpi';
}

function uniqueKpiId(base: string): string {
  let id = base;
  let n = 2;
  while (findKpiNode(kpiTree, id)) id = `${base}-${n++}`;
  return id;
}

/** Generate a fresh, plausible KPI issue key (KPI-N) for a newly created KPI. */
function nextIssueKey(): string {
  let count = 0;
  const walk = (nodes: KpiTreeNode[]) => {
    for (const n of nodes) {
      count++;
      if (n.children) walk(n.children);
    }
  };
  walk(kpiTree);
  return `KPI-${count + 1}`;
}

/**
 * Create a KPI (an issue in the KPI space). Appends a new tree node at the root
 * or under `parentKpiId`, with an empty reading changelog. Returns the timeline.
 */
export function createKpi(input: CreateKpiInput): TimelineData {
  const kpiId = uniqueKpiId(slugifyKpi(input.name));
  const node: KpiTreeNode = {
    kpiId,
    issueKey: nextIssueKey(),
    name: input.name.trim() || 'Untitled KPI',
    unit: input.unit.trim(),
    direction: input.direction ?? null,
    targets: [],
    readings: [],
    children: [],
  };
  readingChangelog.set(kpiId, []);
  const parent = input.parentKpiId ? findKpiNode(kpiTree, input.parentKpiId) : undefined;
  if (parent) (parent.children ??= []).push(node);
  else kpiTree.push(node);
  return getTimelineData();
}

// ── Add target (issue picker) ────────────────────────────────────────────────
/**
 * Type-ahead over the fixture issues — the harness stand-in for Jira's
 * issue-picker endpoint. Matches on key or summary; empty query returns recents.
 */
export function searchIssues(query: string): IssuePickerItem[] {
  const q = query.trim().toLowerCase();
  const matches =
    q === ''
      ? issues
      : issues.filter(
          (i) => i.key.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q),
        );
  return matches
    .slice(0, 8)
    .map((i) => ({
      id: i.id,
      key: i.key,
      summary: i.summary,
      issueType: i.issueTypeName,
      iconUrl: issueTypeIconUri(i.issueTypeName),
    }));
}

/**
 * Add a target to a KPI, held on the chosen contributing issue. Pushes the
 * target onto the KPI's timeline row (recomputing its status) and keeps the
 * issue's assignment in sync so the panel stays consistent.
 */
export function addTarget(input: AddTargetInput): TimelineData {
  const node = findKpiNode(kpiTree, input.kpiId);
  if (node) {
    node.targets = [
      ...node.targets.filter(
        (t) => !(t.date === input.date && t.source.issue === input.issueKey),
      ),
      {
        date: input.date,
        value: input.value,
        source: {
          issue: input.issueKey,
          type: input.issueType ?? 'Issue',
          title: input.issueSummary,
          iconUrl: input.issueTypeIconUrl ?? issueTypeIconUri(input.issueType ?? 'Issue'),
        },
      },
    ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

    const issue = findIssue(input.issueId);
    if (issue) {
      const assignment: Assignment = {
        kpiId: input.kpiId,
        inheritFromParent: false,
        target: input.value,
        targetType: 'absolute',
        timing: {
          start: null,
          due: { mode: 'absolute', absolute: input.date, anchor: 'issueDueDate', offsetMonths: 0 },
        },
        updatedBy: 'acc-jm',
        updatedAt: Date.now(),
      };
      const idx = issue.assignments.findIndex((a) => a.kpiId === input.kpiId);
      if (idx >= 0) issue.assignments[idx] = assignment;
      else issue.assignments.push(assignment);
    }
  }
  return getTimelineData();
}
