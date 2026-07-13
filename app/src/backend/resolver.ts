import Resolver from '@forge/resolver';
import {
  effectiveTiming,
  groupByRelationship,
  resolveRelativeTargetDate,
  type Assignment,
  type CatalogEntryDto,
  type PanelData,
  type PanelRowDto,
  type RelativeTargetContext,
  type ResolvedEndpoint,
  type TimelineData,
} from '@domain/index.js';
import {
  appendReading,
  fetchAssignments,
  fetchHierarchyLevels,
  fetchIssueMeta,
  fetchSubtreeTimingNodes,
  writeAssignments,
} from './jira.js';
import {
  readCatalog,
  readRollupConfig,
  writeCatalogEntry,
  writeRollupConfig,
} from './storage.js';

/**
 * Forge backend resolver — the real counterpart to test-harness/mock-bridge.ts.
 * Function KEYS and return SHAPES match the mock exactly (src/domain/contracts)
 * so Custom UI surfaces behave identically locally and in Jira. All KPI logic is
 * delegated to the pure @domain layer; this file only wires Jira/KVS I/O to it.
 *
 * NOTE: the Jira-dependent paths (panel timing rollup, readings, discovery) are
 * verified via `forge tunnel` on a dev site (plan Phase 5, deferred) — the daily
 * loop uses the mock bridge.
 */
const resolver = new Resolver();

function catalogDto(catalog: Awaited<ReturnType<typeof readCatalog>>): CatalogEntryDto[] {
  return catalog.map((k) => ({ id: k.id, name: k.name, unit: k.unit, direction: k.direction }));
}

async function buildPanelData(issueId: string): Promise<PanelData> {
  const [meta, own, catalog, config] = await Promise.all([
    fetchIssueMeta(issueId),
    fetchAssignments(issueId),
    readCatalog(),
    readRollupConfig(),
  ]);
  const parentId = meta.parentId;
  const parentAssignments = parentId ? await fetchAssignments(parentId) : [];
  const grouped = groupByRelationship(own, parentAssignments, catalog);

  // Timing rollup needs the subtree; root at the parent so we can resolve both.
  const nodes = await fetchSubtreeTimingNodes(parentId ?? issueId);
  const memo = new Map<string, ResolvedEndpoint>();
  const dueOf = (id: string): ResolvedEndpoint => effectiveTiming(id, nodes, config, memo).due;

  const ctx: RelativeTargetContext = {
    issue: { issueKey: meta.issueKey, due: dueOf(issueId) },
  };
  if (parentId && nodes.has(parentId)) {
    ctx.parent = { issueKey: nodes.get(parentId)!.issueKey, due: dueOf(parentId) };
  }

  const rows: PanelRowDto[] = [];
  const push = (kpiId: string, relationship: PanelRowDto['relationship'], a?: Assignment) => {
    const def = catalog.find((k) => k.id === kpiId);
    rows.push({
      kpiId,
      name: def?.name ?? kpiId,
      unit: def?.unit ?? '',
      direction: def?.direction ?? null,
      target: a?.target ?? null,
      targetType: a?.targetType ?? null,
      targetDate: a ? resolveRelativeTargetDate(a.timing.due, ctx, a.timing.start) : null,
      dueTiming: a?.timing.due ?? null,
      start: a?.timing.start ?? null,
      relationship,
    });
  };
  for (const r of grouped.sharedWithParent) push(r.kpiId, 'shared', r.assignment);
  for (const r of grouped.onlyHere) push(r.kpiId, 'onlyHere', r.assignment);
  for (const r of grouped.onParentNotTracked) push(r.kpiId, 'onParentNotTracked');

  return { issueKey: meta.issueKey, rows, catalog: catalogDto(catalog) };
}

resolver.define('getPanelData', async ({ payload }) => {
  const issueId = String((payload as { issueId?: string })?.issueId ?? '');
  if (!issueId) return { issueKey: '', rows: [], catalog: [] } satisfies PanelData;
  return buildPanelData(issueId);
});

resolver.define('saveAssignment', async ({ payload }) => {
  const { issueId, assignment } = payload as { issueId: string; assignment: Assignment };
  const existing = await fetchAssignments(issueId);
  const idx = existing.findIndex((a) => a.kpiId === assignment.kpiId);
  const next = [...existing];
  if (idx >= 0) next[idx] = assignment;
  else next.push(assignment);
  await writeAssignments(issueId, next);
  return buildPanelData(issueId);
});

resolver.define('removeAssignment', async ({ payload }) => {
  const { issueId, kpiId } = payload as { issueId: string; kpiId: string };
  const existing = await fetchAssignments(issueId);
  await writeAssignments(issueId, existing.filter((a) => a.kpiId !== kpiId));
  return buildPanelData(issueId);
});

resolver.define('defineKpi', async ({ payload }) => {
  const saved = await writeCatalogEntry((payload as { definition?: unknown })?.definition);
  return { ok: true, saved };
});

resolver.define('getHierarchyLevels', async () => fetchHierarchyLevels());
resolver.define('getRollupConfig', async () => readRollupConfig());
resolver.define('saveRollupConfig', async ({ payload }) => {
  const saved = await writeRollupConfig((payload as { config?: unknown })?.config);
  return { ok: true, saved };
});

// The timeline aggregates across many issues, which requires a project-scoped
// enumeration wired during the Forge integration pass (Phase 5).
resolver.define('getTimelineData', async () => ({ today: new Date().toISOString().slice(0, 10), roots: [] }) satisfies TimelineData);

resolver.define('recordValue', async ({ payload }) => {
  const { issueId, kpiId, date, value } = payload as {
    issueId: string;
    kpiId: string;
    date: string;
    value: number;
  };
  await appendReading(issueId, kpiId, { date, value, recordedBy: 'me', recordedAt: Date.now() });
  return { ok: true };
});

export const handler = resolver.getDefinitions();
