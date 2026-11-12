import Resolver, { type ResolverFunction } from '@forge/resolver';
import {
  applyTargetContributions,
  assemblePanel,
  dateFieldSelection,
  effectiveTiming,
  isValidProjectKey,
  needsParentDue,
  normalizeProjectKey,
  projectKeyOfIssueKey,
  readingsFromChangelog,
  type AddedTarget,
  type AddTargetInput,
  type Assignment,
  type CatalogEntryDto,
  type CreateKpiInput,
  type KpiSpaceStatus,
  type PanelData,
  type PanelListData,
  type PanelParts,
  type PanelValuesData,
  type RecordValueInput,
  type ResolvedEndpoint,
  type TargetContributionsByKpi,
  type TargetSourceIssue,
  type TimelineData,
  type TimelineNodeDto,
  type TimelineTargetsData,
} from '../domain/index';
import {
  fetchAssignments,
  fetchDateFieldCatalog,
  fetchHierarchyLevels,
  fetchIssueWithAssignments,
  fetchKpiSpaceIssues,
  fetchReadingChangelog,
  fetchSubtreeTimingNodes,
  fetchSubtreeTimingNodesForRoots,
  fetchTargetContributions,
  fetchTargetSourceIssue,
  findProjectByKey,
  createKpiIssue,
  createKpiProject,
  ensureKpiIssueTypeOnProject,
  inlineIssueTypeIcons,
  KPI_ISSUE_TYPE,
  searchIssuePicker,
  writeAssignments,
  writeReading,
  warmFieldIds,
  type KpiSpaceIssue,
} from './jira';
import { stage, traced } from './requestLog';
import {
  type KpiSpaceConfig,
  readKpiSpaceConfig,
  readRollupConfig,
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
 * `resolver.define`, but every call runs inside a request/stage trace that is
 * logged once per invocation (specs/06-timeline-performance, Instrumentation).
 */
const define = (functionKey: string, cb: ResolverFunction<unknown, unknown>): void => {
  resolver.define(functionKey, (request) => traced(functionKey, async () => cb(request)));
};

/**
 * The KPI picker catalog is sourced from the KPI space (KPIs are Jira issues),
 * NOT the legacy KVS catalog: each issue's key is the KPI id and its unit/
 * direction come from the `kpi-meta` entity property. Empty when the space is
 * unset or has no KPIs yet — the panel then shows a "define a KPI first" prompt.
 * `currentValue` needs readings, so it arrives with the panel's Phase 2
 * (`assemblePanel` fills it in).
 */
function buildKpiCatalog(issues: KpiSpaceIssue[]): CatalogEntryDto[] {
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
    out.push({
      id: issue.key,
      name: issue.name,
      unit: issue.meta?.unit ?? '',
      direction: issue.meta?.direction ?? null,
      currentValue: null,
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

/** An issue in the KPI space IS a KPI (Feature 04); the space only holds KPI issues. */
function isKpiIssue(issueKey: string, spaceKey: string | null): boolean {
  return !!spaceKey && normalizeProjectKey(projectKeyOfIssueKey(issueKey)) === normalizeProjectKey(spaceKey);
}

/** Mark a speculatively started request as observed, so returning early can't leave an unhandled rejection. */
function observed<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/**
 * Phase 1 of the issue panel (spec 07): the issue's own targets, its parent's
 * targets (for grouping) and the KPI catalog — everything the target list and
 * the "Set a KPI target" form need. Every request starts as soon as its input
 * is known: the issue (with its targets in the same GET), the space config and
 * the KPI-space search at t=0, the parent's targets as soon as the issue says
 * who the parent is. No readings and no rollup walk (that's Phase 2).
 *
 * A KPI issue gets its complete panel (the KPI chart) instead — unchanged from
 * before spec 07, it still builds the whole timeline.
 */
async function buildPanelList(issueId: string): Promise<PanelListData> {
  const issueP = stage('issue', () => fetchIssueWithAssignments(issueId));
  const spaceP = readKpiSpaceConfig();
  const kpiIssuesP = observed(
    stage('kpiSpaceIssues', async () => {
      const space = await spaceP;
      return space.key ? fetchKpiSpaceIssues(space.key) : [];
    }),
  );
  const parentKpiIdsP = observed(
    stage('parentTargets', async () => {
      const { parentId } = await issueP;
      return parentId ? (await fetchAssignments(parentId)).map((a) => a.kpiId) : [];
    }),
  );

  const [issue, space] = await Promise.all([issueP, spaceP]);
  if (isKpiIssue(issue.issueKey, space.key)) {
    const [{ skeleton, contributions }, kpiIssues] = await Promise.all([buildTimelineParts(), kpiIssuesP]);
    const timeline = applyTargetContributions(skeleton, contributions);
    const node = findTimelineNodeByIssueKey(timeline.roots, issue.issueKey);
    if (node) {
      return {
        panel: {
          issueKey: issue.issueKey,
          rows: [],
          catalog: buildKpiCatalog(kpiIssues),
          issueDueDate: null,
          issueDueRolledUp: false,
          // The raw targets ride along so recording a value can rebuild the markers client-side.
          kpiView: { node, today: timeline.today, contributions: contributions[node.kpiId] ?? [] },
        },
      };
    }
  }

  const [kpiIssues, parentKpiIds] = await Promise.all([kpiIssuesP, parentKpiIdsP]);
  return {
    basis: {
      issueKey: issue.issueKey,
      closed: issue.closed,
      own: issue.assignments,
      parentKpiIds: [...new Set(parentKpiIds)],
      catalog: buildKpiCatalog(kpiIssues),
    },
  };
}

/**
 * Phase 2 of the issue panel (spec 07): the issue's rolled-up due date and every
 * KPI's readings — what the estimate lines, status pills and dates need. The
 * rollup walk covers the issue's OWN subtree. The parent's subtree is walked only
 * when one of the issue's targets is dated relative to the parent's due date,
 * the only thing the parent's date is used for.
 */
async function buildPanelValues(issueId: string): Promise<PanelValuesData> {
  const today = new Date().toISOString().slice(0, 10);
  const configP = readRollupConfig();
  const selectionP = configP.then((c) => dateFieldSelection(c));
  const spaceP = readKpiSpaceConfig();
  const issueP = stage('issue', () => fetchIssueWithAssignments(issueId));
  const ownWalkP = observed(
    stage('rollupWalk', async () => fetchSubtreeTimingNodes(issueId, await selectionP)),
  );
  const readingsP = observed(
    stage('readings', async () => {
      const space = await spaceP;
      const kpiIssues = space.key ? await fetchKpiSpaceIssues(space.key) : [];
      const changelog = await fetchReadingChangelog(kpiIssues.map((i) => i.id));
      const readings: PanelValuesData['readings'] = {};
      for (const k of kpiIssues) {
        readings[k.key] = readingsFromChangelog(changelog.get(k.id) ?? []).map((r) => ({ date: r.date, value: r.value }));
      }
      return readings;
    }),
  );

  const [issue, space] = await Promise.all([issueP, spaceP]);
  // A KPI issue's panel is the KPI chart, which Phase 1 delivers complete.
  if (isKpiIssue(issue.issueKey, space.key)) {
    return { today, issueDue: { date: null, source: 'pending' }, parent: null, readings: {} };
  }

  const parentId = issue.parentId && needsParentDue(issue.assignments) ? issue.parentId : null;
  const parentWalkP = parentId
    ? stage('parentRollupWalk', async () => fetchSubtreeTimingNodes(parentId, await selectionP))
    : Promise.resolve(null);
  const [config, ownNodes, parentNodes, readings] = await Promise.all([configP, ownWalkP, parentWalkP, readingsP]);

  const memo = new Map<string, ResolvedEndpoint>();
  const issueDue = effectiveTiming(issueId, ownNodes, config, memo).due;
  const parentNode = parentId ? parentNodes?.get(parentId) : undefined;
  const parent =
    parentId && parentNodes && parentNode
      ? { issueKey: parentNode.issueKey, due: effectiveTiming(parentId, parentNodes, config, new Map()).due }
      : null;
  return { today, issueDue, parent, readings };
}

/**
 * The complete panel in one call — `getPanelData` and what the mutations return.
 * Both phases run at once and are merged with the same `assemblePanel` the
 * client uses for the progressive load.
 */
async function buildPanelData(issueId: string): Promise<PanelData> {
  const { list, values } = await buildPanelParts(issueId);
  return list.panel ?? assemblePanel(list.basis, values);
}

/** Both phases of the panel, unassembled — what save/remove return (see PanelParts). */
async function buildPanelParts(issueId: string): Promise<PanelParts> {
  const [list, values] = await Promise.all([buildPanelList(issueId), buildPanelValues(issueId)]);
  return { list, values };
}

/**
 * The panel's issue: the payload's `issueId`, else the issue the panel is open
 * on (Forge puts it in the invocation context for `jira:issuePanel`), so the
 * client can start loading before it has read its own context.
 */
function panelIssueId(payload: unknown, context: unknown): string {
  const fromPayload = (payload as { issueId?: string | number } | undefined)?.issueId;
  const fromContext = (context as { extension?: { issue?: { id?: string | number } } } | undefined)?.extension
    ?.issue?.id;
  return String(fromPayload ?? fromContext ?? '');
}

const EMPTY_PANEL: PanelData = { issueKey: '', rows: [], catalog: [], issueDueDate: null, issueDueRolledUp: false };

define('getPanelData', async ({ payload, context }) => {
  const issueId = panelIssueId(payload, context);
  return issueId ? buildPanelData(issueId) : EMPTY_PANEL;
});

define('getPanelList', async ({ payload, context }) => {
  const issueId = panelIssueId(payload, context);
  return issueId ? buildPanelList(issueId) : ({ panel: EMPTY_PANEL } satisfies PanelListData);
});

define('getPanelValues', async ({ payload, context }) => {
  const issueId = panelIssueId(payload, context);
  if (!issueId) throw new Error('No issue to load KPI values for');
  return buildPanelValues(issueId);
});

define('saveAssignment', async ({ payload }) => {
  const { issueId, assignment } = payload as { issueId: string; assignment: Assignment };
  const existing = await fetchAssignments(issueId);
  const idx = existing.findIndex((a) => a.kpiId === assignment.kpiId);
  const next = [...existing];
  if (idx >= 0) next[idx] = assignment;
  else next.push(assignment);
  await writeAssignments(issueId, next);
  return buildPanelParts(issueId);
});

define('removeAssignment', async ({ payload }) => {
  const { issueId, kpiId } = payload as { issueId: string; kpiId: string };
  const existing = await fetchAssignments(issueId);
  await writeAssignments(issueId, existing.filter((a) => a.kpiId !== kpiId));
  return buildPanelParts(issueId);
});

define('getHierarchyLevels', async () => fetchHierarchyLevels());
define('getRollupConfig', async () => readRollupConfig());
define('getDateFields', async () => fetchDateFieldCatalog());
define('saveRollupConfig', async ({ payload }) => {
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

define('getKpiSpace', async () => kpiSpaceStatus());

/**
 * Read the KPI space config, resolving + persisting the project id/name when
 * only the key is stored (spaces connected via `saveKpiSpaceKey` before it
 * resolved the project). Without the id the timeline/createKpi treat the space
 * as unset.
 */
async function readResolvedKpiSpaceConfig(): Promise<KpiSpaceConfig> {
  const cfg = await readKpiSpaceConfig();
  if (!cfg.key || cfg.projectId) return cfg;
  const project = await findProjectByKey(cfg.key);
  if (!project) return cfg;
  const resolved = { key: cfg.key, projectId: project.id, name: project.name };
  await writeKpiSpaceConfig(resolved);
  return resolved;
}

define('saveKpiSpaceKey', async ({ payload }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  const project = await findProjectByKey(key);
  await writeKpiSpaceConfig({ key, projectId: project?.id ?? null, name: project?.name ?? null });
  return kpiSpaceStatus();
});

define('createKpiSpace', async ({ payload, context }) => {
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

/**
 * Order siblings by native LexoRank (same order a backlog drag produces); issues
 * without a rank keep their created-ASC enumeration order (sort is stable).
 */
const byRank = (a: KpiSpaceIssue, b: KpiSpaceIssue): number => {
  if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  if (a.rank) return -1;
  if (b.rank) return 1;
  return 0;
};

/**
 * Phase 1 of the timeline (spec 06 P4): the KPI tree, each KPI's unit/direction
 * (`kpi-meta`, included in the KPI-space search) and its reading series (one
 * bulk changelog call). Every node is `resolving` with no targets yet — the
 * contributing-issue search, the rollup walk and the icons are Phase 2.
 */
async function buildTimelineSkeleton(): Promise<TimelineData> {
  const today = new Date().toISOString().slice(0, 10);
  // The shared `/field` lookup (rank + reading field ids) is independent of the
  // space config, so start both together.
  const [space] = await Promise.all([
    stage('config', () => readResolvedKpiSpaceConfig()),
    stage('fields', () => warmFieldIds()),
  ]);
  if (!space.key || !space.projectId) return { today, roots: [] } satisfies TimelineData;
  const spaceKey = space.key;

  const issues = await stage('kpiSpaceIssues', () => fetchKpiSpaceIssues(spaceKey));
  if (issues.length === 0) return { today, roots: [] } satisfies TimelineData;

  const changelogByIssue = await stage('readings', () => fetchReadingChangelog(issues.map((i) => i.id)));

  // Adjacency restricted to KPI-space issues; issues whose parent is outside the
  // space (or absent) are roots.
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
  roots.sort(byRank);
  for (const siblings of childrenOf.values()) siblings.sort(byRank);

  const toNode = (issue: KpiSpaceIssue, depth: number): TimelineNodeDto => ({
    id: issue.id,
    kpiId: issue.key,
    issueKey: issue.key,
    name: issue.name,
    unit: issue.meta?.unit ?? '',
    direction: issue.meta?.direction ?? null,
    depth,
    targets: [],
    undated: [],
    readings: readingsFromChangelog(changelogByIssue.get(issue.id) ?? []).map((r) => ({
      date: r.date,
      value: r.value,
    })),
    children: (childrenOf.get(issue.id) ?? []).map((c) => toNode(c, depth + 1)),
    resolving: true,
  });

  return { today, roots: roots.map((r) => toNode(r, 0)) } satisfies TimelineData;
}

/**
 * Phase 2 of the timeline: the raw target contributions per KPI. Aggregates the
 * targets authored on contributing issues (issue `kpi-assignments` properties,
 * discovered via the `kpiIds` search index), resolving each source issue's
 * rolled-up due date. The caller turns them into markers with
 * `applyTargetContributions`, which needs the KPI readings Phase 1 delivered.
 */
async function buildTargetContributionsByKpi(): Promise<TimelineTargetsData> {
  const [contributions, rollupConfig] = await Promise.all([
    stage('contributions', () => fetchTargetContributions()),
    stage('rollupConfig', () => readRollupConfig()),
  ]);

  // Proxy remote issue-type icons into same-origin `data:` URLs so the UI can
  // tint the target markers via CSS mask (remote icon hosts are CORS-blocked in
  // the iframe — see jira.ts inlineIssueTypeIcons). Deduped across contributors.
  const iconByUrl = await stage('icons', () =>
    inlineIssueTypeIcons(contributions.issues.map((ci) => ci.issueTypeIconUrl)),
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
  const selection = dateFieldSelection(rollupConfig);
  const rollupNodes = await stage('rollupWalk', () =>
    fetchSubtreeTimingNodesForRoots([...idsNeedingRollup], selection),
  );
  const rolledDueById = new Map<string, string | null>();
  for (const id of idsNeedingRollup) {
    rolledDueById.set(id, effectiveTiming(id, rollupNodes, rollupConfig, new Map()).due.date);
  }

  // Group every contributing issue's targets by the KPI they point at (a KPI's
  // id is its issue key). Each contribution carries the source issue's own/parent
  // due (rolled up) so relative target dates resolve at read time.
  const byKpi: TargetContributionsByKpi = {};
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
      (byKpi[a.kpiId] ??= []).push({ assignment: a, source });
    }
  }
  return { contributions: byKpi };
}

/** Both timeline phases, run at once and left unmerged. */
async function buildTimelineParts(): Promise<{ skeleton: TimelineData; contributions: TargetContributionsByKpi }> {
  const [skeleton, targets] = await Promise.all([buildTimelineSkeleton(), buildTargetContributionsByKpi()]);
  return { skeleton, contributions: targets.contributions };
}

/**
 * The complete timeline (skeleton + targets) in one call. Merged with the same
 * `applyTargetContributions` the client uses for progressive loading, so the
 * two paths can't drift apart.
 */
async function buildTimelineData(): Promise<TimelineData> {
  const { skeleton, contributions } = await buildTimelineParts();
  return applyTargetContributions(skeleton, contributions);
}

define('getTimelineSkeleton', async () => buildTimelineSkeleton());
define('getTimelineTargets', async () => buildTargetContributionsByKpi());
define('getTimelineData', async () => buildTimelineData());

// Returns nothing: readings are last-write-wins per date, so the client applies
// the same edit to the series it already holds (applyReadingEdits) instead of
// waiting on a rebuilt timeline or panel.
define('recordValue', async ({ payload }) => {
  const { kpiId, date, value } = payload as RecordValueInput;
  // Readings are KPI-global (storage-model.md): kpiId identifies the KPI issue
  // whose reading-field changelog holds the series. value=null tombstones a date.
  await writeReading(kpiId, date, value);
  return null;
});

// Type-ahead issue search for the Add Target picker (Jira's issue-picker
// endpoint) — the same source the native Parent field uses.
define('searchIssues', async ({ payload }) => {
  const query = String((payload as { query?: string })?.query ?? '');
  return searchIssuePicker(query);
});

// Add a target to a KPI, held as an assignment (due on an absolute date) on the
// chosen contributing work issue. One assignment per (issue, KPI) — updates in
// place if the issue already targets this KPI. Mirrors the harness `addTarget`.
//
// Returns just the saved contribution, not a rebuilt timeline: the client already
// holds the KPI's readings, so it builds the marker itself. A rebuild would also
// re-discover targets through the `kpiIds` search index, which lags this write.
define('addTarget', async ({ payload, context }) => {
  const input = payload as AddTargetInput;
  const issue = await fetchTargetSourceIssue(input.issueId);
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
  const idx = issue.assignments.findIndex((a) => a.kpiId === input.kpiId);
  const next = [...issue.assignments];
  if (idx >= 0) next[idx] = assignment;
  else next.push(assignment);
  // The marker's icon is inlined (see buildTargetContributionsByKpi) alongside the write.
  const [, iconByUrl] = await Promise.all([
    writeAssignments(input.issueId, next),
    inlineIssueTypeIcons([issue.typeIconUrl]),
  ]);
  const added: AddedTarget = {
    assignment,
    source: {
      key: issue.key,
      type: issue.typeName,
      title: issue.summary,
      iconUrl: (issue.typeIconUrl && iconByUrl.get(issue.typeIconUrl)) ?? issue.typeIconUrl,
      due: issue.due,
    },
  };
  return added;
});

// Returns just the new KPI (see CreatedKpi): it has no readings or targets, so the
// client splices it into its tree — no waiting on Jira's search index to list it
// and no full timeline rebuild.
define('createKpi', async ({ payload }) => {
  const input = payload as CreateKpiInput;
  const space = await readResolvedKpiSpaceConfig();
  if (!space.key || !space.projectId)
    throw new Error('KPI space is not set up — configure it in Settings first.');
  return createKpiIssue(space.projectId, input);
});

export const handler = resolver.getDefinitions();
