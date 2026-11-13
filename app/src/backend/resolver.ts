import Resolver, { type ResolverFunction } from '@forge/resolver';
import {
  applyTargetContributions,
  assemblePanel,
  dateFieldSelection,
  effectiveTiming,
  isValidProjectKey,
  kpiNotVisibleMessage,
  kpiPermissionMessage,
  needsParentDue,
  normalizeProjectKey,
  projectKeyOfIssueKey,
  readingsFromChangelog,
  type AddedTarget,
  type AddTargetInput,
  type Assignment,
  type CatalogEntryDto,
  type CreateKpiInput,
  type IssueLinkTypeInfo,
  type KpiHierarchyStatus,
  type KpiSpaceAccess,
  type KpiSpaceStatus,
  DEFAULT_KPI_LINK_TYPE,
  defaultParentEnd,
  isDirectionalLinkType,
  KPI_HIERARCHY_NOT_SET_UP,
  KpiHierarchyLink,
  type PanelData,
  type PanelListData,
  type PanelParts,
  type PanelValuesData,
  RecordValueInput,
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
  classifyUnlistedKpis,
  fetchHierarchyLevels,
  fetchIsJiraAdmin,
  fetchIssueWithAssignments,
  fetchKpiIssueRef,
  fetchKpiSpaceAccess,
  fetchKpiSpaceIssues,
  fetchReadingChangelog,
  fetchSubtreeTimingNodes,
  fetchSubtreeTimingNodesForRoots,
  fetchTargetContributions,
  fetchTargetSourceIssue,
  findProjectByKey,
  createKpiIssue,
  createKpiProject,
  ensureKpiHierarchyLinkType,
  listIssueLinkTypes,
  ensureKpiIssueTypeOnProject,
  inlineIssueTypeIcons,
  JiraForbiddenError,
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
  readKpiHierarchyConfig,
  readKpiSpaceConfig,
  readRollupConfig,
  writeKpiHierarchyConfig,
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

/** The `jira:adminPage` module (manifest.yml) — Jira only shows it to site/Jira admins. */
const SETTINGS_MODULE_KEY = 'kpi-settings-page';

/**
 * Every module shares this one resolver, so a write that changes app-wide or
 * site-wide configuration (rollup settings, the KPI space, the KPI hierarchy
 * link type) must come from the admin-only Settings page. `moduleKey` is set by
 * the Forge platform from the invoking extension, not by the client payload.
 */
function requireSettingsPage(context: unknown): void {
  const moduleKey = (context as { moduleKey?: string } | undefined)?.moduleKey;
  if (moduleKey !== SETTINGS_MODULE_KEY) {
    throw new Error('KPI settings can only be changed from the KPI Settings admin page.');
  }
}

/**
 * Every Settings write also requires the invoking user to be a Jira admin,
 * checked by Jira as the USER (spec 10). The page check above only says which
 * module made the call; this makes Jira the authority, including for writes that
 * only touch app storage (rollup config, KPI space key, hierarchy choice).
 */
async function requireJiraAdmin(): Promise<void> {
  if (!(await fetchIsJiraAdmin())) throw new Error('Only Jira admins can change KPI settings.');
}

/**
 * `define` for Settings writes: rejects calls from any module other than the
 * admin Settings page, and from anyone who isn't a Jira admin, before the
 * handler runs.
 */
const defineSettingsWrite = (functionKey: string, cb: ResolverFunction<unknown, unknown>): void => {
  define(functionKey, async (request) => {
    requireSettingsPage(request.context);
    await requireJiraAdmin();
    return cb(request);
  });
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
/** The user's KPI-space permissions (spec 10), or null when no space is set up. */
function kpiSpaceAccess(spaceKey: string | null): Promise<KpiSpaceAccess | null> {
  return spaceKey ? stage('access', () => fetchKpiSpaceAccess(spaceKey)) : Promise.resolve(null);
}

/**
 * The KPI-space issues the user may see. The permission lookup and the search
 * run at the same time (no extra round trip on the critical path); without
 * Browse the result is dropped — Jira refuses that search anyway, so nothing
 * leaks either way.
 */
async function visibleKpiSpaceIssues(
  spaceKey: string,
  hierarchy: KpiHierarchyLink | null,
  accessP: Promise<KpiSpaceAccess | null>,
): Promise<KpiSpaceIssue[]> {
  const search = fetchKpiSpaceIssues(spaceKey, hierarchy).then(
    (issues) => ({ issues }),
    (error: unknown) => ({ error }),
  );
  const [access, result] = await Promise.all([accessP, search]);
  if (!access?.browse) return [];
  if ('error' in result) throw result.error;
  return result.issues;
}

async function buildPanelList(issueId: string): Promise<PanelListData> {
  const issueP = stage('issue', () => fetchIssueWithAssignments(issueId));
  const spaceP = readKpiSpaceConfig();
  const hierarchyP = readKpiHierarchyConfig();
  const accessP = observed(spaceP.then((space) => kpiSpaceAccess(space.key)));
  const kpiIssuesP = observed(
    stage('kpiSpaceIssues', async () => {
      const [space, hierarchy] = await Promise.all([spaceP, hierarchyP]);
      return space.key ? visibleKpiSpaceIssues(space.key, hierarchy, accessP) : [];
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
    const [{ skeleton, contributions }, kpiIssues, access] = await Promise.all([
      buildTimelineParts(),
      kpiIssuesP,
      accessP,
    ]);
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
          ...(access ? { access } : {}),
        },
      };
    }
  }

  const [kpiIssues, parentKpiIds, access] = await Promise.all([kpiIssuesP, parentKpiIdsP, accessP]);
  const catalog = buildKpiCatalog(kpiIssues);
  const known = new Set(catalog.map((c) => c.id));
  // Only check the (rare) targeted KPIs the catalog doesn't list: they may be
  // deleted, hidden from this user (spec 10), or just too new for the search index.
  const unlisted = [...issue.assignments.map((a) => a.kpiId), ...parentKpiIds].filter((id) => !known.has(id));
  const { deleted: deletedKpiIds, noAccess: noAccessKpiIds } = unlisted.length
    ? await stage('unlistedKpis', () => classifyUnlistedKpis(unlisted, access?.browse ?? true))
    : { deleted: [], noAccess: [] };
  return {
    basis: {
      issueKey: issue.issueKey,
      closed: issue.closed,
      own: issue.assignments,
      parentKpiIds: [...new Set(parentKpiIds)],
      catalog,
      ...(deletedKpiIds.length ? { deletedKpiIds } : {}),
      ...(noAccessKpiIds.length ? { noAccessKpiIds } : {}),
      ...(access ? { access } : {}),
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
      const [space, hierarchy] = await Promise.all([spaceP, readKpiHierarchyConfig()]);
      const kpiIssues = space.key
        ? await visibleKpiSpaceIssues(space.key, hierarchy, kpiSpaceAccess(space.key))
        : [];
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

/**
 * A target may only point at a KPI the user can see, in the KPI space (spec 10).
 * Looked up as the USER, so Jira applies Browse Projects + issue security.
 */
async function requireTargetableKpi(kpiId: string): Promise<void> {
  const [kpi, space] = await Promise.all([fetchKpiIssueRef(kpiId), readKpiSpaceConfig()]);
  if (!kpi) throw new Error(kpiNotVisibleMessage(kpiId, space.name ?? space.key));
  if (!space.key || kpi.projectKey !== space.key) {
    throw new Error(`${kpi.key} isn't a KPI: targets can only point at KPIs in the KPI space.`);
  }
}

define('saveAssignment', async ({ payload }) => {
  const { issueId, assignment } = payload as { issueId: string; assignment: Assignment };
  const [existing] = await Promise.all([fetchAssignments(issueId), requireTargetableKpi(assignment.kpiId)]);
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
defineSettingsWrite('saveRollupConfig', async ({ payload }) => {
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

defineSettingsWrite('saveKpiSpaceKey', async ({ payload }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  const project = await findProjectByKey(key);
  await writeKpiSpaceConfig({ key, projectId: project?.id ?? null, name: project?.name ?? null });
  return kpiSpaceStatus();
});

defineSettingsWrite('createKpiSpace', async ({ payload, context }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  const existing = await findProjectByKey(key);
  // The invoking admin (from context) leads a newly-created project. The
  // provisioning writes run as that user, so Jira requires Administer Jira for
  // each one (spec 10).
  const leadAccountId = (context as { accountId?: string })?.accountId;
  if (!existing && !leadAccountId) {
    throw new Error('Could not determine the current user to lead the new KPI project.');
  }
  const project = existing ?? (await createKpiProject(key, leadAccountId as string));
  // Provision + associate the KPI issue type (also repairs a 'misconfigured' space).
  await ensureKpiIssueTypeOnProject(project.id);
  await writeKpiSpaceConfig({ key, projectId: project.id, name: project.name });
  // Best-effort: also set up KPI nesting so a fresh install works in one click.
  // If it fails (e.g. issue linking is disabled) the space is still usable and
  // the KPI hierarchy card in Settings shows why.
  if (!(await readKpiHierarchyConfig())) {
    await provisionDefaultHierarchy().catch((e: unknown) => {
      console.warn('[createKpiSpace] could not set up the KPI hierarchy link type:', (e as Error)?.message ?? e);
    });
  }
  return kpiSpaceStatus();
});

// ── KPI hierarchy link (resolve/kpiLinks) ────────────────────────────────────
async function kpiHierarchyStatus(): Promise<KpiHierarchyStatus> {
  const cfg = await readKpiHierarchyConfig();
  const parentEnd = cfg?.parentEnd ?? DEFAULT_KPI_LINK_TYPE.parentEnd;
  const linkTypeId = cfg?.linkTypeId ?? null;
  let available: IssueLinkTypeInfo[];
  try {
    available = await listIssueLinkTypes();
  } catch (e) {
    return { state: 'unavailable', linkType: null, linkTypeId, parentEnd, available: [], message: (e as Error).message };
  }
  const linkType = cfg ? (available.find((t) => t.id === cfg.linkTypeId) ?? null) : null;
  const state = !cfg ? 'unset' : linkType ? 'ready' : 'missing';
  return { state, linkType, linkTypeId, parentEnd, available };
}

/** Create (or adopt) the app's `KPI Hierarchy` link type and point the config at it. */
async function provisionDefaultHierarchy(): Promise<void> {
  const type = await ensureKpiHierarchyLinkType();
  await writeKpiHierarchyConfig({ linkTypeId: type.id, parentEnd: defaultParentEnd(type) });
}

define('getKpiHierarchy', async () => kpiHierarchyStatus());

defineSettingsWrite('saveKpiHierarchy', async ({ payload }) => {
  const parsed = KpiHierarchyLink.safeParse(payload);
  if (!parsed.success) throw new Error('Pick a link type and which end is the parent KPI.');
  const { linkTypeId, parentEnd } = parsed.data;
  const type = (await listIssueLinkTypes()).find((t) => t.id === linkTypeId);
  if (!type) throw new Error(`No issue link type with id "${linkTypeId}" on this site.`);
  if (!isDirectionalLinkType(type)) {
    throw new Error(`"${type.name}" reads "${type.outward}" both ways, so it can't tell a parent KPI from a child.`);
  }
  await writeKpiHierarchyConfig({ linkTypeId: type.id, parentEnd });
  return kpiHierarchyStatus();
});

defineSettingsWrite('createKpiHierarchyLinkType', async () => {
  await provisionDefaultHierarchy();
  return kpiHierarchyStatus();
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
  const [space, hierarchy] = await Promise.all([
    stage('config', () => readResolvedKpiSpaceConfig()),
    readKpiHierarchyConfig(),
    stage('fields', () => warmFieldIds()),
  ]);
  if (!space.key || !space.projectId) return { today, roots: [] } satisfies TimelineData;
  const spaceKey = space.key;

  const accessP = observed(kpiSpaceAccess(spaceKey));
  const issues = await stage('kpiSpaceIssues', () => visibleKpiSpaceIssues(spaceKey, hierarchy, accessP));
  const access = await accessP;
  const withAccess = access ? { access } : {};
  if (issues.length === 0) return { today, roots: [], ...withAccess } satisfies TimelineData;

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

  return { today, roots: roots.map((r) => toNode(r, 0)), ...withAccess } satisfies TimelineData;
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
  // Follow-up F1 (specs/09-stacked-targets/plan.md): every root is walked today,
  // including Done issues whose dates are long settled. Once frozen end dates are
  // saved, frozen issues use that date and only active items need this walk.
  // One shared, level-batched traversal across ALL rollup roots (instead of a
  // separate per-root subtree walk) — overlapping ancestors/subtrees between
  // contributing issues are fetched once. See jira.ts fetchSubtreeTimingNodesForRoots.
  const selection = dateFieldSelection(rollupConfig);
  const rollupNodes = await stage('rollupWalk', () =>
    fetchSubtreeTimingNodesForRoots([...idsNeedingRollup], selection),
  );
  const rolledDueById = new Map<string, ResolvedEndpoint>();
  for (const id of idsNeedingRollup) {
    rolledDueById.set(id, effectiveTiming(id, rollupNodes, rollupConfig, new Map()).due);
  }

  // Group every contributing issue's targets by the KPI they point at (a KPI's
  // id is its issue key). Each contribution carries the source issue's own/parent
  // due (rolled up) so relative target dates resolve at read time.
  const byKpi: TargetContributionsByKpi = {};
  for (const ci of contributions.issues) {
    const parent = ci.parentId ? contributions.parentById.get(ci.parentId) : undefined;
    // rolledDueById always has an entry for ci.issueId/ci.parentId (populated
    // above); its date may legitimately be `null` (still pending), so don't
    // fall back to the raw own-due once the key is present.
    const due = rolledDueById.get(ci.issueId);
    const parentDue = ci.parentId ? rolledDueById.get(ci.parentId) : undefined;
    const source: TargetSourceIssue = {
      key: ci.issueKey,
      type: ci.issueTypeName,
      title: ci.title,
      iconUrl: (ci.issueTypeIconUrl && iconByUrl.get(ci.issueTypeIconUrl)) ?? ci.issueTypeIconUrl,
      due: due?.date ?? null,
      dueRolledUp: due?.source === 'children',
      parent: parent
        ? { key: parent.key, due: parentDue?.date ?? null, dueRolledUp: parentDue?.source === 'children' }
        : undefined,
      hierarchyLevel: ci.hierarchyLevel,
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
  const { kpiId, date, value } = RecordValueInput.parse(payload);
  // Readings are KPI-global (storage-model.md): kpiId identifies the KPI issue
  // whose reading-field changelog holds the series. value=null tombstones a date.
  // Spec 10: the KPI must be visible to the user AND in the KPI space (the field
  // exists on every issue), and the write runs as the user so Jira requires
  // Edit Issues on it.
  const [space, kpi] = await Promise.all([readKpiSpaceConfig(), fetchKpiIssueRef(kpiId)]);
  const spaceLabel = space.name ?? space.key;
  if (!kpi) throw new Error(kpiNotVisibleMessage(kpiId, spaceLabel));
  if (!space.key || kpi.projectKey !== space.key) {
    throw new Error(`${kpi.key} isn't a KPI: values can only be recorded on KPIs in the KPI space.`);
  }
  try {
    await writeReading(kpi.id, date, value);
  } catch (e) {
    if (e instanceof JiraForbiddenError) throw new Error(kpiPermissionMessage('record', spaceLabel, kpi.key));
    throw e;
  }
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
  const [issue] = await Promise.all([fetchTargetSourceIssue(input.issueId), requireTargetableKpi(input.kpiId)]);
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
      hierarchyLevel: issue.hierarchyLevel,
    },
  };
  return added;
});

// Returns just the new KPI (see CreatedKpi): it has no readings or targets, so the
// client splices it into its tree — no waiting on Jira's search index to list it
// and no full timeline rebuild.
define('createKpi', async ({ payload }) => {
  const input = payload as CreateKpiInput;
  const [space, hierarchy] = await Promise.all([readResolvedKpiSpaceConfig(), readKpiHierarchyConfig()]);
  if (!space.key || !space.projectId)
    throw new Error('KPI space is not set up — configure it in Settings first.');
  // Spec 10: say which permission is missing before Jira refuses the create (or,
  // worse, accepts the create and refuses the link).
  const access = await fetchKpiSpaceAccess(space.key);
  const spaceLabel = space.name ?? space.key;
  if (!access.create) throw new Error(kpiPermissionMessage('add', spaceLabel));
  if (input.parentKpiId && !access.link) throw new Error(kpiPermissionMessage('nest', spaceLabel));
  // A deleted link type would otherwise create the issue, fail the link with a
  // raw Jira 404 and roll back — catch it up front with the actionable error.
  if (input.parentKpiId && hierarchy) {
    const types = await listIssueLinkTypes();
    if (!types.some((t) => t.id === hierarchy.linkTypeId)) {
      throw new Error(`${KPI_HIERARCHY_NOT_SET_UP} — the link type KPIs nest with was deleted; choose another in Settings.`);
    }
  }
  return createKpiIssue(space.projectId, input, hierarchy);
});

export const handler = resolver.getDefinitions();
