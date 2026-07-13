import Resolver from '@forge/resolver';
import {
  effectiveTiming,
  groupByRelationship,
  isValidProjectKey,
  normalizeProjectKey,
  readingsFromChangelog,
  resolveRelativeTargetDate,
  type Assignment,
  type CatalogEntryDto,
  type CreateKpiInput,
  type KpiSpaceStatus,
  type PanelData,
  type PanelRowDto,
  type RelativeTargetContext,
  type ResolvedEndpoint,
  type TimelineData,
  type TimelineNodeDto,
} from '../domain/index';
import {
  fetchAssignments,
  fetchHierarchyLevels,
  fetchIssueMeta,
  fetchKpiMeta,
  fetchKpiSpaceIssues,
  fetchReadingChangelog,
  fetchSubtreeTimingNodes,
  findProjectByKey,
  createKpiIssue,
  createKpiProject,
  writeAssignments,
  writeReading,
  type KpiSpaceIssue,
} from './jira';
import {
  readCatalog,
  readKpiSpaceConfig,
  readRollupConfig,
  writeCatalogEntry,
  writeKpiSpaceConfig,
  writeRollupConfig,
} from './storage';

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

// ── KPI space (storage-model.md) ─────────────────────────────────────────────
async function kpiSpaceStatus(): Promise<KpiSpaceStatus> {
  const cfg = await readKpiSpaceConfig();
  if (!cfg.key) return { key: null, projectId: null, name: null, state: 'unset' };
  const project = await findProjectByKey(cfg.key);
  if (!project) return { key: cfg.key, projectId: null, name: null, state: 'missing' };
  return { key: cfg.key, projectId: project.id, name: project.name, state: 'ready' };
}

resolver.define('getKpiSpace', async () => kpiSpaceStatus());

resolver.define('saveKpiSpaceKey', async ({ payload }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  await writeKpiSpaceConfig({ key, projectId: null, name: null });
  return kpiSpaceStatus();
});

resolver.define('createKpiSpace', async ({ payload }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  const existing = await findProjectByKey(key);
  const project = existing ?? (await createKpiProject(key));
  await writeKpiSpaceConfig({ key, projectId: project.id, name: project.name });
  return { key, projectId: project.id, name: project.name, state: 'ready' } satisfies KpiSpaceStatus;
});

// The timeline enumerates KPI-space issues, reconstructs each KPI's reading
// series from its field changelog (Option B), and nests them by issue parent —
// mirroring the harness `getTimelineData`. Targets (authored on contributing
// issues) are a follow-up; the list + readings render today.
resolver.define('getTimelineData', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const space = await readKpiSpaceConfig();
  if (!space.key || !space.projectId) return { today, roots: [] } satisfies TimelineData;

  const issues = await fetchKpiSpaceIssues(space.key);
  if (issues.length === 0) return { today, roots: [] } satisfies TimelineData;

  const ids = issues.map((i) => i.id);
  const [changelogByIssue, metas] = await Promise.all([
    fetchReadingChangelog(ids),
    Promise.all(issues.map((i) => fetchKpiMeta(i.id))),
  ]);
  const metaById = new Map(issues.map((i, idx) => [i.id, metas[idx]]));

  // Adjacency restricted to KPI-space issues; issues whose parent is outside the
  // space (or absent) are roots.
  const idSet = new Set(ids);
  const childrenOf = new Map<string, KpiSpaceIssue[]>();
  const roots: KpiSpaceIssue[] = [];
  for (const issue of issues) {
    if (issue.parentId && idSet.has(issue.parentId)) {
      const siblings = childrenOf.get(issue.parentId) ?? [];
      siblings.push(issue);
      childrenOf.set(issue.parentId, siblings);
    } else {
      roots.push(issue);
    }
  }

  const toNode = (issue: KpiSpaceIssue, depth: number): TimelineNodeDto => {
    const meta = metaById.get(issue.id);
    const readings = readingsFromChangelog(changelogByIssue.get(issue.id) ?? []);
    return {
      id: issue.id,
      kpiId: issue.key,
      name: issue.name,
      unit: meta?.unit ?? '',
      direction: meta?.direction ?? null,
      depth,
      targets: [],
      readings: readings.map((r) => ({ date: r.date, value: r.value })),
      children: (childrenOf.get(issue.id) ?? []).map((c) => toNode(c, depth + 1)),
    };
  };

  return { today, roots: roots.map((r) => toNode(r, 0)) } satisfies TimelineData;
});
resolver.define('recordValue', async ({ payload }) => {
  const { kpiId, date, value } = payload as {
    kpiId: string;
    date: string;
    value: number | null;
  };
  // Readings are KPI-global (storage-model.md): kpiId identifies the KPI issue
  // whose reading-field changelog holds the series. value=null tombstones a date.
  await writeReading(kpiId, date, value);
  return { ok: true };
});

resolver.define('createKpi', async ({ payload }) => {
  const input = payload as CreateKpiInput;
  const space = await readKpiSpaceConfig();
  if (!space.projectId) throw new Error('KPI space is not set up — configure it in Settings first.');
  const kpiKey = await createKpiIssue(space.projectId, input);
  return { ok: true, kpiKey };
});

export const handler = resolver.getDefinitions();
