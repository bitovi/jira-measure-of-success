import Resolver from '@forge/resolver';
import {
  effectiveTiming,
  groupByRelationship,
  isValidProjectKey,
  normalizeProjectKey,
  projectKeyOfIssueKey,
  readingsFromChangelog,
  resolveRelativeTargetDate,
  resolvePanelTarget,
  buildKpiTargets,
  type AddTargetInput,
  type Assignment,
  type CatalogEntryDto,
  type CreateKpiInput,
  type KpiSpaceStatus,
  type KpiTargetContribution,
  type PanelData,
  type PanelRowDto,
  type RelativeTargetContext,
  type ResolvedEndpoint,
  type TargetSourceIssue,
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
  fetchSubtreeTimingNodesForRoots,
  fetchTargetContributions,
  findProjectByKey,
  createKpiIssue,
  createKpiProject,
  ensureKpiIssueTypeOnProject,
  inlineIssueTypeIcons,
  KPI_ISSUE_TYPE,
  searchIssuePicker,
  writeAssignments,
  writeReading,
  type KpiSpaceIssue,
} from './jira';
import {
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

/**
 * The KPI picker catalog is sourced from the KPI space (KPIs are Jira issues),
 * NOT the legacy KVS catalog: each issue's key is the KPI id and its unit/
 * direction come from the `kpi-meta` entity property. Empty when the space is
 * unset or has no KPIs yet — the panel then shows a "define a KPI first" prompt.
 */
async function buildKpiCatalog(): Promise<CatalogEntryDto[]> {
  const space = await readKpiSpaceConfig();
  if (!space.key) return [];
  const issues = await fetchKpiSpaceIssues(space.key);
  if (issues.length === 0) return [];
  // Reading changelogs (one bulk call) give each KPI its latest recorded value —
  // the authoring "Current value → targeting" note for a Percent change target
  // (FR-5). Mirrors the harness catalogDto + buildTimelineData reading path.
  const [metas, changelog] = await Promise.all([
    Promise.all(issues.map((i) => fetchKpiMeta(i.id))),
    fetchReadingChangelog(issues.map((i) => i.id)),
  ]);
  const metaById = new Map(issues.map((i, idx) => [i.id, metas[idx]]));

  // Order + indent depth-first by KPI parent/child nesting (same adjacency
  // buildTimelineData walks) so the picker can indent options to show the
  // hierarchy instead of an arbitrary issue-enumeration order.
  const idSet = new Set(issues.map((i) => i.id));
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
  const byRank = (a: KpiSpaceIssue, b: KpiSpaceIssue): number => {
    if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return 0;
  };
  roots.sort(byRank);
  for (const siblings of childrenOf.values()) siblings.sort(byRank);

  const out: CatalogEntryDto[] = [];
  const walk = (issue: KpiSpaceIssue, depth: number) => {
    const meta = metaById.get(issue.id);
    const readings = readingsFromChangelog(changelog.get(issue.id) ?? []);
    out.push({
      id: issue.key,
      name: issue.name,
      unit: meta?.unit ?? '',
      direction: meta?.direction ?? null,
      currentValue: readings.length ? readings[readings.length - 1].value : null,
      depth,
    });
    for (const c of childrenOf.get(issue.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

/** Find a KPI node (by its Jira issue key) in a built timeline tree — Feature 04. */
function findTimelineNodeByIssueKey(
  nodes: TimelineNodeDto[],
  issueKey: string,
): TimelineNodeDto | null {
  for (const n of nodes) {
    if (n.issueKey === issueKey) return n;
    const found = findTimelineNodeByIssueKey(n.children, issueKey);
    if (found) return found;
  }
  return null;
}

async function buildPanelData(issueId: string): Promise<PanelData> {
  const [meta, own, catalog, config, space] = await Promise.all([
    fetchIssueMeta(issueId),
    fetchAssignments(issueId),
    buildKpiCatalog(),
    readRollupConfig(),
    readKpiSpaceConfig(),
  ]);

  // Feature 04: if THIS issue lives in the KPI space (its project key === the
  // configured space key), it IS a KPI — return the single-KPI chart payload
  // (its own series) instead of the associate/target-editor rows. Project-key
  // match alone is enough (the space only holds KPI issues).
  if (
    space.key &&
    normalizeProjectKey(projectKeyOfIssueKey(meta.issueKey)) === normalizeProjectKey(space.key)
  ) {
    const timeline = await buildTimelineData();
    const node = findTimelineNodeByIssueKey(timeline.roots, meta.issueKey);
    if (node) {
      return {
        issueKey: meta.issueKey,
        rows: [],
        catalog,
        issueDueDate: null,
        issueDueRolledUp: false,
        kpiView: { node, today: timeline.today },
      };
    }
  }

  const parentId = meta.parentId;
  const parentAssignments = parentId ? await fetchAssignments(parentId) : [];
  // The catalog only attaches (unused) display metadata to grouped rows here;
  // rows below look KPIs up in `catalog` directly, so pass an empty list.
  const grouped = groupByRelationship(own, parentAssignments, []);

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

  // Readings for the assigned KPIs (Feature 03 baselines). KPI ids are KPI-issue
  // KEYS; map them to issue ids to fetch each KPI's reading changelog in one bulk
  // call, then reduce to a per-KPI series with the same domain reducer.
  const assignedKpiIds = [...new Set(own.map((a) => a.kpiId))];
  const spaceIssues = space.key ? await fetchKpiSpaceIssues(space.key) : [];
  const keyToId = new Map(spaceIssues.map((i) => [i.key, i.id] as const));
  const kpiIssueIds = assignedKpiIds.map((k) => keyToId.get(k)).filter((v): v is string => !!v);
  const changelog = await fetchReadingChangelog(kpiIssueIds);
  const readingsFor = (kpiId: string): { date: string; value: number }[] => {
    const id = keyToId.get(kpiId);
    return id ? readingsFromChangelog(changelog.get(id) ?? []) : [];
  };

  const rows: PanelRowDto[] = [];
  const push = (kpiId: string, relationship: PanelRowDto['relationship'], a?: Assignment) => {
    const def = catalog.find((k) => k.id === kpiId);
    if (!a) {
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
    const targetDate = resolveRelativeTargetDate(a.timing.due, ctx, a.timing.start);
    const dueEndpoint =
      a.timing.due.mode === 'relative' && a.timing.due.anchor === 'issueDueDate'
        ? ctx.issue.due
        : a.timing.due.mode === 'relative' && a.timing.due.anchor === 'parentDueDate'
          ? ctx.parent?.due ?? { date: null, source: 'pending' as const }
          : { date: targetDate.date, source: 'own' as const };
    const resolved = resolvePanelTarget({
      assignment: a,
      dueDate: dueEndpoint.date,
      targetDate: targetDate.date,
      readings: readingsFor(kpiId),
      direction: def?.direction ?? null,
      closed: meta.closed,
      today: new Date().toISOString().slice(0, 10),
    });
    rows.push({
      kpiId,
      name: def?.name ?? kpiId,
      unit: def?.unit ?? '',
      direction: def?.direction ?? null,
      target: a.target,
      targetType: a.targetType,
      targetDate,
      dueTiming: a.timing.due,
      start: a.timing.start,
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
  for (const r of grouped.sharedWithParent) push(r.kpiId, 'shared', r.assignment);
  for (const r of grouped.onlyHere) push(r.kpiId, 'onlyHere', r.assignment);
  for (const r of grouped.onParentNotTracked) push(r.kpiId, 'onParentNotTracked');

  return {
    issueKey: meta.issueKey,
    rows,
    catalog,
    issueDueDate: ctx.issue.due.date,
    issueDueRolledUp: ctx.issue.due.source === 'children',
  };
}

resolver.define('getPanelData', async ({ payload }) => {
  const issueId = String((payload as { issueId?: string })?.issueId ?? '');
  if (!issueId)
    return { issueKey: '', rows: [], catalog: [], issueDueDate: null, issueDueRolledUp: false } satisfies PanelData;
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
  // The project exists, but KPI issues can only be created if the KPI issue type
  // is available in it — otherwise it's connected-but-not-usable.
  const state = project.issueTypeNames.includes(KPI_ISSUE_TYPE) ? 'ready' : 'misconfigured';
  return { key: cfg.key, projectId: project.id, name: project.name, state };
}

resolver.define('getKpiSpace', async () => kpiSpaceStatus());

resolver.define('saveKpiSpaceKey', async ({ payload }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  await writeKpiSpaceConfig({ key, projectId: null, name: null });
  return kpiSpaceStatus();
});

resolver.define('createKpiSpace', async ({ payload, context }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  const existing = await findProjectByKey(key);
  // The invoking user (from context) leads a newly-created project — this keeps
  // provisioning a pure `asApp` flow with no 3LO/`asUser` consent prompt.
  const leadAccountId = (context as { accountId?: string })?.accountId;
  if (!existing && !leadAccountId) {
    throw new Error('Could not determine the current user to lead the new KPI project.');
  }
  const project = existing ?? (await createKpiProject(key, leadAccountId as string));
  // Provision + associate the KPI issue type (also repairs a 'misconfigured' space).
  await ensureKpiIssueTypeOnProject(project.id);
  await writeKpiSpaceConfig({ key, projectId: project.id, name: project.name });
  return kpiSpaceStatus();
});

// The timeline enumerates KPI-space issues, reconstructs each KPI's reading
// series from its field changelog (Option B), nests them by issue parent, and
// aggregates the targets authored on contributing issues (issue `kpi-assignments`
// properties, discovered via the `kpiIds` search index) onto each KPI row —
// mirroring the harness `getTimelineData`.
async function buildTimelineData(): Promise<TimelineData> {
  const today = new Date().toISOString().slice(0, 10);
  const space = await readKpiSpaceConfig();
  if (!space.key || !space.projectId) return { today, roots: [] } satisfies TimelineData;

  const issues = await fetchKpiSpaceIssues(space.key);
  if (issues.length === 0) return { today, roots: [] } satisfies TimelineData;

  const ids = issues.map((i) => i.id);
  const [changelogByIssue, metas, contributions, rollupConfig] = await Promise.all([
    fetchReadingChangelog(ids),
    Promise.all(issues.map((i) => fetchKpiMeta(i.id))),
    fetchTargetContributions(),
    readRollupConfig(),
  ]);
  const metaById = new Map(issues.map((i, idx) => [i.id, metas[idx]]));

  // Proxy remote issue-type icons into same-origin `data:` URLs so the UI can
  // tint the target markers via CSS mask (remote icon hosts are CORS-blocked in
  // the iframe — see jira.ts inlineIssueTypeIcons). Deduped across contributors.
  const iconByUrl = await inlineIssueTypeIcons(
    contributions.issues.map((ci) => ci.issueTypeIconUrl),
  );

  // A contributing issue's OWN due date may be unset (rolled up from children,
  // same as the issue panel's "Rolled up due date"). Resolve each contributing
  // (and parent) issue's EFFECTIVE due via the same rollup engine the panel
  // uses, so a target whose anchor issue only has a rolled-up due date still
  // plots on its resolved date instead of falling into the Undated lane.
  const idsNeedingRollup = new Set<string>();
  for (const ci of contributions.issues) {
    idsNeedingRollup.add(ci.issueId);
    if (ci.parentId) idsNeedingRollup.add(ci.parentId);
  }
  // One shared, level-batched traversal across ALL rollup roots (instead of a
  // separate per-root subtree walk) — overlapping ancestors/subtrees between
  // contributing issues are fetched once. See jira.ts fetchSubtreeTimingNodesForRoots.
  const rollupNodes = await fetchSubtreeTimingNodesForRoots([...idsNeedingRollup]);
  const rolledDueById = new Map<string, string | null>();
  for (const id of idsNeedingRollup) {
    rolledDueById.set(id, effectiveTiming(id, rollupNodes, rollupConfig, new Map()).due.date);
  }


  // Group every contributing issue's targets by the KPI they point at (a KPI's
  // id is its issue key). Each contribution carries the source issue's own/parent
  // due (rolled up) so relative target dates resolve at read time.
  const contributionsByKpi = new Map<string, KpiTargetContribution[]>();
  for (const ci of contributions.issues) {
    const parent = ci.parentId ? contributions.parentById.get(ci.parentId) : undefined;
    const source: TargetSourceIssue = {
      key: ci.issueKey,
      type: ci.issueTypeName,
      title: ci.title,
      iconUrl: (ci.issueTypeIconUrl && iconByUrl.get(ci.issueTypeIconUrl)) ?? ci.issueTypeIconUrl,
      // rolledDueById always has an entry for ci.issueId/ci.parentId (populated
      // above); the map value may legitimately be `null` (still pending), so
      // don't `??`-fall back to the raw own-due once the key is present.
      due: rolledDueById.get(ci.issueId) ?? null,
      parent: parent ? { key: parent.key, due: rolledDueById.get(ci.parentId!) ?? null } : undefined,
    };
    for (const a of ci.assignments) {
      const list = contributionsByKpi.get(a.kpiId) ?? [];
      list.push({ assignment: a, source });
      contributionsByKpi.set(a.kpiId, list);
    }
  }

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

  // Order siblings by native LexoRank (same order a backlog drag produces);
  // issues without a rank keep their created-ASC enumeration order (sort is
  // stable). Applied to roots and every children list.
  const byRank = (a: KpiSpaceIssue, b: KpiSpaceIssue): number => {
    if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return 0;
  };
  roots.sort(byRank);
  for (const siblings of childrenOf.values()) siblings.sort(byRank);

  const toNode = (issue: KpiSpaceIssue, depth: number): TimelineNodeDto => {
    const meta = metaById.get(issue.id);
    const readings = readingsFromChangelog(changelogByIssue.get(issue.id) ?? []);
    const readingPoints = readings.map((r) => ({ date: r.date, value: r.value }));
    const built = buildKpiTargets(
      contributionsByKpi.get(issue.key) ?? [],
      readingPoints,
      meta?.direction ?? null,
      today,
    );
    return {
      id: issue.id,
      kpiId: issue.key,
      issueKey: issue.key,
      name: issue.name,
      unit: meta?.unit ?? '',
      direction: meta?.direction ?? null,
      depth,
      targets: built.dated,
      undated: built.undated,
      readings: readingPoints,
      children: (childrenOf.get(issue.id) ?? []).map((c) => toNode(c, depth + 1)),
    };
  };

  return { today, roots: roots.map((r) => toNode(r, 0)) } satisfies TimelineData;
}

resolver.define('getTimelineData', async () => buildTimelineData());

resolver.define('recordValue', async ({ payload }) => {
  const { kpiId, date, value } = payload as {
    kpiId: string;
    date: string;
    value: number | null;
  };
  // Readings are KPI-global (storage-model.md): kpiId identifies the KPI issue
  // whose reading-field changelog holds the series. value=null tombstones a date.
  await writeReading(kpiId, date, value);
  return buildTimelineData();
});

// Type-ahead issue search for the Add Target picker (Jira's issue-picker
// endpoint) — the same source the native Parent field uses.
resolver.define('searchIssues', async ({ payload }) => {
  const query = String((payload as { query?: string })?.query ?? '');
  return searchIssuePicker(query);
});

// Add a target to a KPI, held as an assignment (due on an absolute date) on the
// chosen contributing work issue. One assignment per (issue, KPI) — updates in
// place if the issue already targets this KPI. Mirrors the harness `addTarget`.
resolver.define('addTarget', async ({ payload, context }) => {
  const input = payload as AddTargetInput;
  const existing = await fetchAssignments(input.issueId);
  const assignment: Assignment = {
    kpiId: input.kpiId,
    inheritFromParent: false,
    target: input.value,
    targetType: 'absolute',
    timing: {
      start: null,
      due: { mode: 'absolute', absolute: input.date, anchor: 'issueDueDate', offsetMonths: 0 },
    },
    updatedBy: (context as { accountId?: string })?.accountId ?? 'app',
    updatedAt: Date.now(),
  };
  const idx = existing.findIndex((a) => a.kpiId === input.kpiId);
  const next = [...existing];
  if (idx >= 0) next[idx] = assignment;
  else next.push(assignment);
  await writeAssignments(input.issueId, next);
  return buildTimelineData();
});

/**
 * Jira's JQL index lags issue creation by ~1–2s, so an immediate re-enumeration
 * misses the just-created KPI — leaving the timeline unchanged until a manual
 * refresh. Poll the lightweight KPI-space enumeration until the new key is
 * indexed (bounded) so the timeline built afterwards reliably includes it.
 */
async function waitForKpiIndexed(projectKey: string, kpiKey: string): Promise<void> {
  const attempts = 6;
  const delayMs = 400;
  for (let i = 0; i < attempts; i += 1) {
    const issues = await fetchKpiSpaceIssues(projectKey);
    if (issues.some((issue) => issue.key === kpiKey)) return;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

resolver.define('createKpi', async ({ payload }) => {
  const input = payload as CreateKpiInput;
  const space = await readKpiSpaceConfig();
  if (!space.key || !space.projectId)
    throw new Error('KPI space is not set up — configure it in Settings first.');
  const createdKey = await createKpiIssue(space.projectId, input);
  await waitForKpiIndexed(space.key, createdKey);
  return buildTimelineData();
});

export const handler = resolver.getDefinitions();
