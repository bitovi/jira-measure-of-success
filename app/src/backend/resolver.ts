import Resolver, { type ResolverFunction } from '@forge/resolver';
import type { ZodType, ZodTypeDef } from 'zod';
import {
  applyTargetContributions,
  assemblePanel,
  dateFieldSelection,
  effectiveTiming,
  isKpiIssueId,
  isValidProjectKey,
  kpiNotVisibleMessage,
  kpiPermissionMessage,
  KPI_SPACE_REQUIRED,
  KPI_WORK_TYPE_NOT_SET_UP,
  needsParentDue,
  normalizeProjectKey,
  readingsFromChangelog,
  readStoredAssignments,
  type AddedTarget,
  type AddTargetInput,
  type Assignment,
  type CatalogEntryDto,
  type CreatedKpi,
  type CreateKpiInput,
  type GetKpiAccessInput,
  type IssueLinkTypeInfo,
  type KpiAccessResult,
  type KpiHierarchyStatus,
  type KpiSpaceAccess,
  type KpiSpaceRef,
  type KpiSpaceStatus,
  type ReadingChange,
  DEFAULT_KPI_LINK_TYPE,
  defaultParentEnd,
  isDirectionalLinkType,
  KPI_HIERARCHY_NOT_SET_UP,
  KpiHierarchyLink,
  KpiMetaProperty,
  kpiMetaWrite,
  type KpiMetaChange,
  SetUpCentralSpaceInput,
  SetUpKpiFieldsInput,
  SetUpKpiSpaceStepInput,
  SetUpKpiWorkTypeInput,
  type KpiSetupStatus,
  type KpiSiteConfig,
  hierarchyParentLinks,
  wouldCreateKpiCycle,
  UpdateKpiInput,
  type UpdatedKpi,
  type UpdateKpiResult,
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
  fetchStoredAssignments,
  fetchDateFieldCatalog,
  classifyUnlistedKpis,
  fetchHierarchyLevels,
  fetchIsJiraAdmin,
  fetchIssueWithAssignments,
  fetchKpi,
  fetchKpiAccess,
  fetchKpiIssueRef,
  fetchKpis,
  PermissionLookupError,
  fetchReadingChangelog,
  fetchSubtreeTimingNodes,
  fetchSubtreeTimingNodesForRoots,
  fetchTargetContributions,
  fetchTargetSourceIssue,
  findProject,
  findProjectByKey,
  createKpiIssue,
  createKpiProject,
  deleteIssueLink,
  fetchKpiIssueForEdit,
  linkKpiParent,
  updateKpiDefinition,
  ensureKpiHierarchyLinkType,
  listIssueLinkTypes,
  inlineIssueTypeIcons,
  JiraForbiddenError,
  KPI_ISSUE_TYPE,
  searchIssuePicker,
  writeAssignments,
  writeReading,
  warmFieldIds,
  type KpiIssue,
  type KpiIssueForEdit,
  type KpiReadConfig,
} from './jira';
import { listMigrations, retryMigration, runMigrationBatch } from './migrations/runner';
import { loadKpiSiteConfig, readKpiSiteConfig, writeKpiSiteConfig } from './kpiConfig';
import {
  applyKpiSpaceStep,
  ensureKpiFields,
  ensureKpiWorkType,
  kpiSetupStatus,
  kpiSpaceSetupStatus,
  listKpiFieldChoices,
  listKpiFieldOptions,
  listKpiSpaceChoices,
  listKpiWorkTypeChoices,
  makeSpaceUsableForKpis,
} from './kpiSetup';
import { stage, traced } from './requestLog';
import {
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
  let isAdmin: boolean;
  try {
    isAdmin = await fetchIsJiraAdmin();
  } catch (error) {
    // Still refuse the write, but don't tell an admin they aren't one.
    if (error instanceof PermissionLookupError) {
      throw new Error("Couldn't check whether you're a Jira admin, so the change wasn't saved. Try again.");
    }
    throw error;
  }
  if (!isAdmin) throw new Error('Only Jira admins can change KPI settings.');
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
 * The panel's "Set a KPI target" list, TEMPORARILY every KPI the user can
 * browse (by work type, spec 11 · 06 Q1), capped, until 07's KPI browser
 * replaces it. Each issue's id is the KPI id (its key is only for display,
 * spec 11 · 03); unit/direction come from the KPI fields or `kpi-meta`.
 */
const PANEL_CATALOG_LIMIT = 500;

/** Sibling order: native LexoRank (as a backlog drag sets it); KPIs without a rank keep search order. */
const byRank = (a: KpiIssue, b: KpiIssue): number => {
  if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  if (a.rank) return -1;
  if (b.rank) return 1;
  return 0;
};

/** The loaded KPIs as a forest: a KPI whose parent wasn't loaded is a root. */
function kpiForest(issues: KpiIssue[]): { roots: KpiIssue[]; childrenOf: Map<string, KpiIssue[]> } {
  const idSet = new Set(issues.map((i) => i.id));
  const childrenOf = new Map<string, KpiIssue[]>();
  const roots: KpiIssue[] = [];
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
  return { roots, childrenOf };
}

/**
 * The KPI catalog, ordered + indented depth-first by KPI nesting (the same
 * forest the timeline draws) so the picker can show the hierarchy.
 * `currentValue` needs readings, so it arrives with the panel's Phase 2
 * (`assemblePanel` fills it in).
 */
function buildKpiCatalog(issues: KpiIssue[]): CatalogEntryDto[] {
  const { roots, childrenOf } = kpiForest(issues);
  const out: CatalogEntryDto[] = [];
  const walk = (issue: KpiIssue, depth: number) => {
    out.push({
      id: issue.id,
      key: issue.key,
      name: issue.name,
      unit: issue.meta?.unit ?? '',
      direction: issue.meta?.direction ?? null,
      currentValue: null,
      depth,
      ...(issue.space ? { space: issue.space } : {}),
    });
    for (const c of childrenOf.get(issue.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

/** One KPI as a timeline row: its readings, no targets yet (`resolving`), its children. */
function kpiNode(
  issue: KpiIssue,
  depth: number,
  changelogByIssue: Map<string, ReadingChange[]>,
  childrenOf: Map<string, KpiIssue[]> = new Map(),
): TimelineNodeDto {
  return {
    id: issue.id,
    kpiId: issue.id,
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
    children: (childrenOf.get(issue.id) ?? []).map((c) => kpiNode(c, depth + 1, changelogByIssue, childrenOf)),
    resolving: true,
    ...(issue.space ? { space: issue.space } : {}),
  };
}

/**
 * What a KPI read needs from the site configuration, or null when no KPI work
 * type is configured (then there are no KPIs). Read once per invocation; on an
 * install with nothing saved the work type is derived (one `GET /issuetype`).
 */
async function kpiReadConfig(): Promise<KpiReadConfig | null> {
  const { workType, hierarchy, fields } = await readKpiSiteConfig();
  return workType ? { workTypeId: workType.id, hierarchy, kpiFields: fields } : null;
}

/** An issue IS a KPI when its work type is the KPI work type (spec 11 · 06). */
function isKpiIssue(typeId: string | null | undefined, cfg: KpiReadConfig | null): boolean {
  return !!cfg && !!typeId && typeId === cfg.workTypeId;
}

/** Mark a speculatively started request as observed, so returning early can't leave an unhandled rejection. */
function observed<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/**
 * The user's permissions in one KPI space (spec 10), or null when Jira
 * couldn't answer the lookup. Null means "unknown": the UI disables nothing up
 * front and Jira's own refusals (403s) explain any denied action.
 */
function kpiAccessOrNull(projectKey: string | null | undefined): Promise<KpiSpaceAccess | null> {
  if (!projectKey) return Promise.resolve(null);
  return stage('access', () => fetchKpiAccess(projectKey)).catch((error: unknown) => {
    if (error instanceof PermissionLookupError) return null;
    throw error;
  });
}

/** What the panel's invocation context says about the issue it's open on (Forge `jira:issuePanel`). */
interface PanelIssueHint {
  /** the issue's work type id, when the context names the issue being loaded */
  typeId: string | null;
}

/**
 * Whether the panel's issue is a KPI, as soon as it's known: from the context's
 * work type when it names this issue (no wait), else from the issue's own GET.
 */
function isKpiPanel(
  cfgP: Promise<KpiReadConfig | null>,
  issueP: Promise<{ issueTypeId: string | null }>,
  hint: PanelIssueHint | null,
): Promise<boolean> {
  const typeIdP = hint?.typeId ? Promise.resolve(hint.typeId) : issueP.then((i) => i.issueTypeId);
  return Promise.all([cfgP, typeIdP]).then(([cfg, typeId]) => isKpiIssue(typeId, cfg));
}

/**
 * Phase 1 of the issue panel (spec 07): the issue's own targets, its parent's
 * targets (for grouping) and the KPI catalog — everything the target list and
 * the "Set a KPI target" form need. Requests start as soon as their input is
 * known: the issue (with its targets in the same GET) and the config at t=0,
 * the catalog search once the issue is known not to be a KPI, the parent's
 * targets once the issue says who the parent is. No readings, no rollup walk
 * (that's Phase 2), and no permission lookup (spec 11 · 06: per space, when an
 * action needs it).
 *
 * A KPI issue gets its complete panel (the KPI chart, `buildKpiViewPanel`) instead.
 */
async function buildPanelList(issueId: string, hint: PanelIssueHint | null = null): Promise<PanelListData> {
  const issueP = stage('issue', () => fetchIssueWithAssignments(issueId));
  const cfgP = observed(stage('config', () => kpiReadConfig()));
  const isKpiP = observed(isKpiPanel(cfgP, issueP, hint));
  const kpiIssuesP = observed(
    stage('kpis', async () => {
      const [cfg, isKpi] = await Promise.all([cfgP, isKpiP]);
      return cfg && !isKpi ? fetchKpis({ limit: PANEL_CATALOG_LIMIT }, cfg) : [];
    }),
  );
  const parentKpiIdsP = observed(
    stage('parentTargets', async () => {
      const { parentId } = await issueP;
      return parentId ? (await fetchAssignments(parentId)).map((a) => a.kpiId) : [];
    }),
  );

  const [issue, cfg, isKpi] = await Promise.all([issueP, cfgP, isKpiP]);
  if (isKpi && cfg) {
    const panel = await buildKpiViewPanel(issueId, issue, cfg);
    if (panel) return { panel };
  }

  const [kpiIssues, parentKpiIds] = await Promise.all([kpiIssuesP, parentKpiIdsP]);
  const catalog = buildKpiCatalog(kpiIssues);
  const known = new Set(catalog.map((c) => c.id));
  // Only check the (rare) targeted KPIs the catalog doesn't list: they may be
  // deleted, hidden from this user (spec 10), too new for the search index, or
  // past the catalog's cap.
  const unlisted = [...issue.assignments.map((a) => a.kpiId), ...parentKpiIds].filter((id) => !known.has(id));
  const { deleted: deletedKpiIds, noAccess: noAccessKpiIds, keys: kpiKeys } = unlisted.length
    ? await stage('unlistedKpis', () => classifyUnlistedKpis(unlisted))
    : { deleted: [], noAccess: [], keys: {} };
  return {
    basis: {
      issueKey: issue.issueKey,
      closed: issue.closed,
      own: issue.assignments,
      parentKpiIds: [...new Set(parentKpiIds)],
      catalog,
      ...(deletedKpiIds.length ? { deletedKpiIds } : {}),
      ...(noAccessKpiIds.length ? { noAccessKpiIds } : {}),
      ...(Object.keys(kpiKeys).length ? { kpiKeys } : {}),
    },
  };
}

/**
 * A KPI's own panel (the KPI View, spec 11 · 06 Step 5): loads ONLY this KPI —
 * its definition (one GET), its readings, the work items that target it
 * (`kpiIssueIds = "{id}"`, 03) with the rollup their dates need, and its
 * space's access — and builds the same `TimelineNodeDto` the Timeline would,
 * with the same pure helpers (`kpiNode`, `applyTargetContributions`). null when
 * the KPI can't be read after all (the caller falls back to the work-item panel).
 */
async function buildKpiViewPanel(
  issueId: string,
  issue: { issueKey: string; project: KpiSpaceRef | null },
  cfg: KpiReadConfig,
): Promise<PanelData | null> {
  const today = new Date().toISOString().slice(0, 10);
  const kpiP = observed(stage('kpi', () => fetchKpi(issueId, cfg)));
  // Readings and targets are keyed by issue id; a key in the payload waits for the KPI's id.
  const idP = isKpiIssueId(issueId) ? Promise.resolve(issueId) : kpiP.then((k) => k?.id ?? issueId);
  const [kpi, changelog, targets, access] = await Promise.all([
    kpiP,
    stage('readings', async () => fetchReadingChangelog([await idP])),
    (async () => buildTargetContributionsByKpi(await idP))(),
    kpiAccessOrNull(issue.project?.key),
  ]);
  if (!kpi) return null;
  const timeline = applyTargetContributions({ today, roots: [kpiNode(kpi, 0, changelog)] }, targets.contributions);
  const node = timeline.roots[0];
  const [shown] = kpi.parentLinks;
  return {
    issueKey: issue.issueKey,
    rows: [],
    catalog: [],
    issueDueDate: null,
    issueDueRolledUp: false,
    // The raw targets ride along so recording a value can rebuild the markers client-side.
    kpiView: {
      node,
      today,
      contributions: targets.contributions[node.kpiId] ?? [],
      ...(kpi.parentLinks.length > 1 ? { parentLinks: { count: kpi.parentLinks.length, shownKey: shown.key ?? shown.id } } : {}),
    },
    ...(access ? { access } : {}),
  };
}

/**
 * Phase 2 of the issue panel (spec 07): the issue's rolled-up due date and the
 * catalog KPIs' readings — what the estimate lines, status pills and dates
 * need. The rollup walk covers the issue's OWN subtree. The parent's subtree is
 * walked only when one of the issue's targets is dated relative to the parent's
 * due date, the only thing the parent's date is used for. A KPI's panel needs
 * none of it (Phase 1 delivers the chart), so no KPI search is made for one.
 */
async function buildPanelValues(issueId: string, hint: PanelIssueHint | null = null): Promise<PanelValuesData> {
  const today = new Date().toISOString().slice(0, 10);
  const configP = readRollupConfig();
  const selectionP = configP.then((c) => dateFieldSelection(c));
  const issueP = stage('issue', () => fetchIssueWithAssignments(issueId));
  const cfgP = observed(stage('config', () => kpiReadConfig()));
  const isKpiP = observed(isKpiPanel(cfgP, issueP, hint));
  const ownWalkP = observed(
    stage('rollupWalk', async () => fetchSubtreeTimingNodes(issueId, await selectionP)),
  );
  const readingsP = observed(
    stage('readings', async () => {
      const [cfg, isKpi] = await Promise.all([cfgP, isKpiP]);
      if (!cfg || isKpi) return {};
      const kpiIssues = await fetchKpis({ limit: PANEL_CATALOG_LIMIT }, cfg);
      const changelog = await fetchReadingChangelog(kpiIssues.map((i) => i.id));
      const readings: PanelValuesData['readings'] = {};
      for (const k of kpiIssues) {
        readings[k.id] = readingsFromChangelog(changelog.get(k.id) ?? []).map((r) => ({ date: r.date, value: r.value }));
      }
      return readings;
    }),
  );

  const [issue, isKpi] = await Promise.all([issueP, isKpiP]);
  // A KPI issue's panel is the KPI chart, which Phase 1 delivers complete.
  if (isKpi) {
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
async function buildPanelData(issueId: string, hint: PanelIssueHint | null = null): Promise<PanelData> {
  const { list, values } = await buildPanelParts(issueId, hint);
  return list.panel ?? assemblePanel(list.basis, values);
}

/** Both phases of the panel, unassembled — what save/remove return (see PanelParts). */
async function buildPanelParts(issueId: string, hint: PanelIssueHint | null = null): Promise<PanelParts> {
  const [list, values] = await Promise.all([buildPanelList(issueId, hint), buildPanelValues(issueId, hint)]);
  return { list, values };
}

type PanelContext = { extension?: { issue?: { id?: string | number; typeId?: string | number } } } | undefined;

/**
 * The panel's issue: the payload's `issueId`, else the issue the panel is open
 * on (Forge puts it in the invocation context for `jira:issuePanel`), so the
 * client can start loading before it has read its own context.
 */
function panelIssueId(payload: unknown, context: unknown): string {
  const fromPayload = (payload as { issueId?: string | number } | undefined)?.issueId;
  const fromContext = (context as PanelContext)?.extension?.issue?.id;
  return String(fromPayload ?? fromContext ?? '');
}

/** The context's work type for `issueId`, when the context is about that issue. */
function panelIssueHint(issueId: string, context: unknown): PanelIssueHint | null {
  const issue = (context as PanelContext)?.extension?.issue;
  return issue?.typeId !== undefined && String(issue.id) === issueId ? { typeId: String(issue.typeId) } : null;
}

const EMPTY_PANEL: PanelData = { issueKey: '', rows: [], catalog: [], issueDueDate: null, issueDueRolledUp: false };

define('getPanelData', async ({ payload, context }) => {
  const issueId = panelIssueId(payload, context);
  return issueId ? buildPanelData(issueId, panelIssueHint(issueId, context)) : EMPTY_PANEL;
});

define('getPanelList', async ({ payload, context }) => {
  const issueId = panelIssueId(payload, context);
  return issueId
    ? buildPanelList(issueId, panelIssueHint(issueId, context))
    : ({ panel: EMPTY_PANEL } satisfies PanelListData);
});

define('getPanelValues', async ({ payload, context }) => {
  const issueId = panelIssueId(payload, context);
  if (!issueId) throw new Error('No issue to load KPI values for');
  return buildPanelValues(issueId, panelIssueHint(issueId, context));
});

/**
 * A space's KPI permissions, for the action the user is about to take (spec
 * 11 · 06): the Timeline and issue panel ask once per space and remember it.
 * `access: null` when Jira couldn't answer: the action goes ahead.
 */
define('getKpiAccess', async ({ payload }) => {
  const projectKey = normalizeProjectKey(String((payload as Partial<GetKpiAccessInput> | undefined)?.projectKey ?? ''));
  if (!isValidProjectKey(projectKey)) throw new Error(`Invalid space key: "${projectKey}"`);
  const result: KpiAccessResult = { projectKey, access: await kpiAccessOrNull(projectKey) };
  return result;
});

/**
 * A target may only point at a KPI the user can see (spec 10): an issue of the
 * KPI work type, in any space (spec 11 · 06). Looked up as the USER, so Jira
 * applies Browse Projects + issue security. Returns the KPI's id (what the
 * target stores) and current key.
 */
async function requireTargetableKpi(kpiId: string): Promise<{ id: string; key: string }> {
  const [kpi, cfg] = await Promise.all([fetchKpiIssueRef(kpiId), kpiReadConfig()]);
  if (!kpi) throw new Error(kpiNotVisibleMessage(kpiId));
  if (!isKpiIssue(kpi.typeId, cfg)) throw new Error(`${kpi.key} isn't a KPI, so it can't be targeted.`);
  return { id: kpi.id, key: kpi.key };
}

/** `assignment` replacing the target on the same KPI, or added. */
function withAssignment(existing: Assignment[], assignment: Assignment): Assignment[] {
  const idx = existing.findIndex((a) => a.kpiId === assignment.kpiId);
  const next = [...existing];
  if (idx >= 0) next[idx] = assignment;
  else next.push(assignment);
  return next;
}

define('saveAssignment', async ({ payload }) => {
  const { issueId, assignment } = payload as { issueId: string; assignment: Assignment };
  const [stored, kpi] = await Promise.all([fetchStoredAssignments(issueId), requireTargetableKpi(assignment.kpiId)]);
  const existing = stored ? readStoredAssignments(stored).assignments : [];
  const next = withAssignment(existing, { ...assignment, kpiId: kpi.id });
  await writeAssignments(issueId, next, stored, new Map([[kpi.id, kpi.key]]));
  return buildPanelParts(issueId);
});

define('removeAssignment', async ({ payload }) => {
  const { issueId, kpiId } = payload as { issueId: string; kpiId: string };
  const stored = await fetchStoredAssignments(issueId);
  const existing = stored ? readStoredAssignments(stored).assignments : [];
  await writeAssignments(issueId, existing.filter((a) => a.kpiId !== kpiId), stored);
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
  // The project exists, but KPI issues can only be created if the KPI work type
  // is available in it — otherwise it's connected-but-not-usable.
  const { workType } = await readKpiSiteConfig();
  const hasType = workType ? project.issueTypeIds.includes(workType.id) : project.issueTypeNames.includes(KPI_ISSUE_TYPE);
  return { key: cfg.key, projectId: project.id, name: project.name, state: hasType ? 'ready' : 'misconfigured' };
}

define('getKpiSpace', async () => kpiSpaceStatus());

defineSettingsWrite('saveKpiSpaceKey', async ({ payload }) => {
  const key = normalizeProjectKey(String((payload as { key?: string })?.key ?? ''));
  if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
  const project = await findProjectByKey(key);
  await writeKpiSpaceConfig({ key, projectId: project?.id ?? null, name: project?.name ?? null });
  return kpiSpaceStatus();
});

/** The KPI work type, creating (or adopting) the app's `KPI` type when none is chosen yet. */
async function requireKpiWorkType(): Promise<NonNullable<KpiSiteConfig['workType']>> {
  const { workType } = await readKpiSiteConfig();
  if (workType) return workType;
  const created = await ensureKpiWorkType({ mode: 'create' });
  await writeKpiSiteConfig({ workType: created });
  return created;
}

/**
 * Create (or use) the central KPI space: the work type in its scheme, the
 * fields in its field scheme and on its screens, saved as the central space.
 * A new install also gets KPI nesting set up (best effort, as before).
 */
async function setUpCentralSpace(input: SetUpCentralSpaceInput, context: unknown): Promise<string[]> {
  let project: { id: string; key: string; name: string };
  if (input.mode === 'existing') {
    const found = await findProject(input.projectId);
    if (!found) throw new Error(`There's no space with id "${input.projectId}".`);
    project = found;
  } else {
    const key = normalizeProjectKey(input.key);
    if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
    const existing = await findProjectByKey(key);
    // The invoking admin (from context) leads a newly-created project. The
    // provisioning writes run as that user, so Jira requires Administer Jira for
    // each one (spec 10).
    const leadAccountId = (context as { accountId?: string })?.accountId;
    if (!existing && !leadAccountId) {
      throw new Error('Could not determine the current user to lead the new KPI project.');
    }
    project = existing ?? { key, ...(await createKpiProject(key, leadAccountId as string)) };
  }
  await requireKpiWorkType();
  await writeKpiSiteConfig({ centralSpace: { projectId: project.id, key: project.key, name: project.name } });
  const warnings = await makeSpaceUsableForKpis(project.id, await readKpiSiteConfig());
  // Best-effort: also set up KPI nesting so a fresh install works in one click.
  // If it fails (e.g. issue linking is disabled) the space is still usable and
  // the KPI hierarchy card in Settings shows why.
  if (!(await readKpiHierarchyConfig())) {
    await provisionDefaultHierarchy().catch((e: unknown) => {
      console.warn('[setUpCentralSpace] could not set up the KPI hierarchy link type:', (e as Error)?.message ?? e);
    });
  }
  return warnings;
}

defineSettingsWrite('createKpiSpace', async ({ payload, context }) => {
  const key = String((payload as { key?: string })?.key ?? '');
  await setUpCentralSpace({ mode: 'create', key: normalizeProjectKey(key) }, context);
  return kpiSpaceStatus();
});

// ── KPI building blocks (spec 11 · 04) ───────────────────────────────────────
// Settings → KPI building blocks, Central KPI space, Using KPIs in other spaces.
// Each write returns the new `KpiSetupStatus` (with `warnings` for optional
// steps that didn't finish).

function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`Invalid request: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return parsed.data;
}

async function setupStatusWith(warnings: string[]): Promise<KpiSetupStatus> {
  const status = await kpiSetupStatus();
  return warnings.length > 0 ? { ...status, warnings } : status;
}

/** After the work type or fields change, bring the central space up to date (warnings, not errors). */
async function syncCentralSpace(): Promise<string[]> {
  const config = await readKpiSiteConfig();
  if (!config.centralSpace) return [];
  try {
    return await makeSpaceUsableForKpis(config.centralSpace.projectId, config);
  } catch (e) {
    return [`The central space wasn't updated: ${(e as Error)?.message ?? e}`];
  }
}

define('getKpiSetup', async ({ context }) => {
  requireSettingsPage(context);
  return kpiSetupStatus();
});

define('getKpiWorkTypeChoices', async ({ context }) => {
  requireSettingsPage(context);
  return listKpiWorkTypeChoices();
});

define('getKpiFieldChoices', async ({ context }) => {
  requireSettingsPage(context);
  return listKpiFieldChoices();
});

define('getKpiFieldOptions', async ({ payload, context }) => {
  requireSettingsPage(context);
  const fieldId = String((payload as { fieldId?: string } | undefined)?.fieldId ?? '');
  if (!fieldId) throw new Error('No field to list the options of.');
  return listKpiFieldOptions(fieldId);
});

define('getKpiSpaceChoices', async ({ context }) => {
  requireSettingsPage(context);
  const { workType } = await readKpiSiteConfig();
  return listKpiSpaceChoices(workType?.id ?? null);
});

define('getKpiSpaceSetup', async ({ payload, context }) => {
  requireSettingsPage(context);
  const projectId = String((payload as { projectId?: string } | undefined)?.projectId ?? '');
  if (!projectId) throw new Error('No space to check.');
  return kpiSpaceSetupStatus(projectId, await readKpiSiteConfig());
});

defineSettingsWrite('setUpKpiWorkType', async ({ payload }) => {
  const workType = await ensureKpiWorkType(parseInput(SetUpKpiWorkTypeInput, payload));
  await writeKpiSiteConfig({ workType });
  return setupStatusWith(await syncCentralSpace());
});

defineSettingsWrite('setUpKpiFields', async ({ payload }) => {
  const fields = await ensureKpiFields(parseInput(SetUpKpiFieldsInput, payload));
  await writeKpiSiteConfig({ fields });
  return setupStatusWith(await syncCentralSpace());
});

defineSettingsWrite('setUpCentralSpace', async ({ payload, context }) =>
  setupStatusWith(await setUpCentralSpace(parseInput(SetUpCentralSpaceInput, payload), context)),
);

defineSettingsWrite('setUpKpiSpaceStep', async ({ payload }) => {
  const { projectId, step } = parseInput(SetUpKpiSpaceStepInput, payload);
  const config = await readKpiSiteConfig();
  await applyKpiSpaceStep(projectId, step, config);
  return kpiSpaceSetupStatus(projectId, config);
});

/**
 * "Set up everything": every block not chosen yet, with the app's defaults, in
 * order: work type → fields → central space (created with `key`, default KPI)
 * → its field scheme and screens → KPI nesting. Chosen blocks are kept.
 */
defineSettingsWrite('setUpEverything', async ({ payload, context }) => {
  const { config } = await loadKpiSiteConfig();
  if (!config.workType) await writeKpiSiteConfig({ workType: await ensureKpiWorkType({ mode: 'create' }) });
  if (!config.fields) {
    await writeKpiSiteConfig({ fields: await ensureKpiFields({ unit: { mode: 'create' }, direction: { mode: 'create' } }) });
  }
  let warnings: string[];
  if (config.centralSpace) {
    warnings = await syncCentralSpace();
    if (!(await readKpiHierarchyConfig())) {
      await provisionDefaultHierarchy().catch((e: unknown) => {
        warnings.push(`KPI nesting wasn't set up: ${(e as Error)?.message ?? e}`);
      });
    }
  } else {
    const key = String((payload as { key?: string } | undefined)?.key ?? 'KPI');
    warnings = await setUpCentralSpace({ mode: 'create', key }, context);
  }
  return setupStatusWith(warnings);
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

// ── Data migrations (spec 11 · 02) ──────────────────────────────────────────
// Settings → Upgrade data. The client loops `runMigrationBatch` until the
// returned record's cursor is null.
const accountIdOf = (context: unknown): string | null => (context as { accountId?: string } | undefined)?.accountId ?? null;
const migrationIdOf = (payload: unknown): string => String((payload as { id?: string } | undefined)?.id ?? '');

define('getMigrations', async ({ context }) => {
  requireSettingsPage(context);
  return listMigrations(accountIdOf(context));
});

defineSettingsWrite('runMigrationBatch', async ({ payload, context }) =>
  runMigrationBatch(migrationIdOf(payload), accountIdOf(context)),
);

defineSettingsWrite('retryMigration', async ({ payload }) => retryMigration(migrationIdOf(payload)));

/**
 * Phase 1 of the timeline (spec 06 P4): the KPI tree — every KPI the user can
 * browse, by work type (spec 11 · 06), in every space — each KPI's space and
 * unit/direction (in the search) and its reading series (one bulk changelog
 * call). Every node is `resolving` with no targets yet — the contributing-issue
 * search, the rollup walk and the icons are Phase 2. No permission lookup: a
 * space's access is fetched when an action needs it (`getKpiAccess`).
 */
async function buildTimelineSkeleton(): Promise<TimelineData> {
  const today = new Date().toISOString().slice(0, 10);
  // The shared `/field` lookup (rank + reading field ids) is independent of the
  // configuration, so start both together.
  const [site] = await Promise.all([stage('config', () => readKpiSiteConfig()), stage('fields', () => warmFieldIds())]);
  const centralSpace = site.centralSpace
    ? { id: site.centralSpace.projectId, key: site.centralSpace.key, name: site.centralSpace.name }
    : null;
  const cfg = await kpiReadConfig();
  if (!cfg) return { today, roots: [], centralSpace, noWorkType: true } satisfies TimelineData;

  const issues = await stage('kpis', () => fetchKpis({}, cfg));
  if (issues.length === 0) return { today, roots: [], centralSpace } satisfies TimelineData;

  const changelogByIssue = await stage('readings', () => fetchReadingChangelog(issues.map((i) => i.id)));
  const { roots, childrenOf } = kpiForest(issues);
  return { today, roots: roots.map((r) => kpiNode(r, 0, changelogByIssue, childrenOf)), centralSpace } satisfies TimelineData;
}

/**
 * Phase 2 of the timeline: the raw target contributions per KPI. Aggregates the
 * targets authored on contributing issues (issue `kpi-assignments` properties,
 * discovered via the `kpiIssueIds` search index), resolving each source issue's
 * rolled-up due date. The caller turns them into markers with
 * `applyTargetContributions`, which needs the KPI readings Phase 1 delivered.
 * Given `kpiId`, only the work items targeting that one KPI (its own panel).
 */
async function buildTargetContributionsByKpi(kpiId?: string): Promise<TimelineTargetsData> {
  const [contributions, rollupConfig] = await Promise.all([
    stage('contributions', () => fetchTargetContributions(kpiId)),
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

  // Group every contributing issue's targets by the KPI they point at (its
  // issue id). Each contribution carries the source issue's own/parent
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
  // Spec 10: the KPI must be visible to the user AND a KPI (the field exists on
  // every issue), and the write runs as the user so Jira requires Edit Issues
  // in the KPI's own space (spec 11 · 06).
  const [cfg, kpi] = await Promise.all([kpiReadConfig(), fetchKpiIssueRef(kpiId)]);
  if (!kpi) throw new Error(kpiNotVisibleMessage(kpiId));
  if (!isKpiIssue(kpi.typeId, cfg)) throw new Error(`${kpi.key} isn't a KPI, so values can't be recorded on it.`);
  try {
    await writeReading(kpi.id, date, value);
  } catch (e) {
    if (e instanceof JiraForbiddenError) {
      throw new Error(kpiPermissionMessage('record', kpi.project?.name ?? kpi.projectKey, kpi.key));
    }
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
// re-discover targets through the `kpiIssueIds` search index, which lags this write.
define('addTarget', async ({ payload, context }) => {
  const input = payload as AddTargetInput;
  const [issue, kpi] = await Promise.all([fetchTargetSourceIssue(input.issueId), requireTargetableKpi(input.kpiId)]);
  const assignment: Assignment = {
    kpiId: kpi.id,
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
  const next = withAssignment(issue.assignments, assignment);
  // The marker's icon is inlined (see buildTargetContributionsByKpi) alongside the write.
  const [, iconByUrl] = await Promise.all([
    writeAssignments(input.issueId, next, issue.stored, new Map([[kpi.id, kpi.key]])),
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
// and no full timeline rebuild. The space is required (spec 11 · 06): until 08's
// space chooser, the Timeline sends the central space (or the only space).
define('createKpi', async ({ payload }) => {
  const input = payload as CreateKpiInput;
  const projectId = String(input?.projectId ?? '').trim();
  if (!projectId) throw new Error(`${KPI_SPACE_REQUIRED}.`);
  // Spec 10: say which permission is missing before Jira refuses the create (or,
  // worse, accepts the create and refuses the link), asked about the new KPI's
  // own space; nesting needs Link Issues there too (Q2: the child's space).
  const accessP = observed(stage('access', () => fetchKpiAccess(projectId)));
  const parentP = observed(input.parentKpiId ? fetchKpiIssueRef(input.parentKpiId) : Promise.resolve(null));
  const [site, project] = await Promise.all([readKpiSiteConfig(), findProject(projectId)]);
  if (!site.workType) throw new Error(`${KPI_WORK_TYPE_NOT_SET_UP} — choose one in Settings first.`);
  if (!project) throw new Error(`There's no space with id "${projectId}".`);
  if (!project.issueTypeIds.includes(site.workType.id)) {
    throw new Error(
      `KPIs can't be created in ${project.name}: its work types don't include ${site.workType.name}. A Jira admin can add it (Settings → Using KPIs in other spaces).`,
    );
  }
  // If Jira can't answer, refuse without blaming permissions.
  const access = await accessP.catch((error: unknown) => {
    if (error instanceof PermissionLookupError) {
      throw new Error(`Couldn't check your permissions on the ${project.name} space, so the KPI wasn't created. Try again.`);
    }
    throw error;
  });
  if (!access.create) throw new Error(kpiPermissionMessage('add', project.name));
  if (input.parentKpiId) {
    if (!access.link) throw new Error(kpiPermissionMessage('nest', project.name));
    const parent = await parentP;
    if (!parent) throw new Error(kpiNotVisibleMessage(input.parentKpiId));
    if (parent.typeId !== site.workType.id) {
      throw new Error(`${parent.key} isn't a KPI: KPIs can only be nested under KPIs.`);
    }
  }
  const hierarchy = site.hierarchy;
  // A deleted link type would otherwise create the issue, fail the link with a
  // raw Jira 404 and roll back — catch it up front with the actionable error.
  if (input.parentKpiId && hierarchy) {
    const types = await listIssueLinkTypes();
    if (!types.some((t) => t.id === hierarchy.linkTypeId)) {
      throw new Error(`${KPI_HIERARCHY_NOT_SET_UP} — the link type KPIs nest with was deleted; choose another in Settings.`);
    }
  }
  const created = await createKpiIssue(project.id, input, hierarchy, site.workType, site.fields);
  return { ...created, space: { id: project.id, key: project.key, name: project.name } } satisfies CreatedKpi;
});

// Edit a KPI: rename it, change its unit/direction, and/or move it (with its
// children) under another parent or to the root. Only the fields sent change
// (UpdateKpiInput), so an out-of-date timeline can't undo someone else's edit.
// Everything is checked before the first write, from direct issue reads rather
// than the KPI search, which lags behind recent creates and moves: the KPI's
// current parents and, for a move, every ancestor of the new parent. KPIs are
// issues of the KPI work type in any space (spec 11 · 06); permissions are the
// KPI's own space's (Link Issues on the child's space for a move, Q2). The move
// runs first and is undone if any link write fails; then the name, unit and
// direction go in one issue edit. If that edit fails after a move, the result
// carries the moved KPI and the error, so the timeline shows what Jira now holds.
define('updateKpi', async ({ payload }) => {
  const parsed = UpdateKpiInput.safeParse(payload);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid KPI edit.');
  const input = parsed.data;

  const site = await readKpiSiteConfig();
  if (!site.workType) throw new Error(`${KPI_WORK_TYPE_NOT_SET_UP} — choose one in Settings first.`);
  const workTypeId = site.workType.id;
  const { hierarchy, fields: kpiFields } = site;

  // Each issue is read at most once (the KPI, its parents, the new parent's ancestors).
  const reads = new Map<string, Promise<KpiIssueForEdit | null>>();
  const read = (idOrKey: string): Promise<KpiIssueForEdit | null> => {
    let pending = reads.get(idOrKey);
    if (!pending) {
      pending = fetchKpiIssueForEdit(idOrKey, kpiFields);
      reads.set(idOrKey, pending);
    }
    return pending;
  };
  // Only a KPI the user can see counts as a parent (a reused link type may link to work issues).
  const readKpi = async (id: string) => {
    const issue = await read(id);
    return issue && issue.typeId === workTypeId ? issue : null;
  };

  const kpi = await read(input.kpiId);
  if (!kpi) throw new Error(kpiNotVisibleMessage(input.kpiId));
  if (kpi.typeId !== workTypeId) throw new Error(`${kpi.key} isn't a KPI, so it can't be edited here.`);
  const spaceLabel = kpi.project?.name ?? kpi.projectKey;
  const access = await stage('access', () => fetchKpiAccess(kpi.projectKey ?? kpi.project?.id ?? '')).catch(
    (error: unknown) => {
      if (error instanceof PermissionLookupError) {
        throw new Error(`Couldn't check your permissions on the ${spaceLabel ?? "KPI's"} space, so the KPI wasn't saved. Try again.`);
      }
      throw error;
    },
  );
  reads.set(kpi.id, Promise.resolve(kpi));
  reads.set(kpi.key, Promise.resolve(kpi));

  const currentMeta: KpiMetaProperty = { unit: kpi.meta?.unit ?? '', direction: kpi.meta?.direction ?? null };
  const name = input.name ?? kpi.name;
  const meta: KpiMetaProperty = {
    unit: input.unit ?? currentMeta.unit,
    direction: input.direction !== undefined ? input.direction : currentMeta.direction,
  };
  const nameChanged = name !== kpi.name;
  const metaChange: KpiMetaChange = {
    ...(meta.unit !== currentMeta.unit ? { unit: meta.unit } : {}),
    ...(meta.direction !== currentMeta.direction ? { direction: meta.direction } : {}),
  };
  const metaChanged = Object.keys(metaChange).length > 0;
  if ((nameChanged || metaChanged) && !access.edit) throw new Error(kpiPermissionMessage('edit', spaceLabel, kpi.key));

  // Work out the move (only when the parent was sent) from the KPI's current links.
  type ParentLink = { linkId: string; parent: KpiIssueForEdit };
  let currentParents: ParentLink[] = [];
  let target: KpiIssueForEdit | null = null;
  let move: { hierarchy: KpiHierarchyLink; unlink: ParentLink[]; link: boolean } | null = null;
  if (input.parentKpiId !== undefined) {
    if (!hierarchy) {
      if (input.parentKpiId !== null) throw new Error(`${KPI_HIERARCHY_NOT_SET_UP} — choose how KPIs nest in Settings first.`);
    } else {
      const linked = await Promise.all(
        hierarchyParentLinks(kpi.links, hierarchy).map(async (l) => ({ linkId: l.linkId, parent: await readKpi(l.parentId) })),
      );
      currentParents = linked.filter((l): l is ParentLink => l.parent !== null);
      if (input.parentKpiId !== null) {
        target = await read(input.parentKpiId);
        if (!target) throw new Error(kpiNotVisibleMessage(input.parentKpiId));
        if (target.typeId !== workTypeId) {
          throw new Error(`${target.key} isn't a KPI: KPIs can only be nested under KPIs.`);
        }
      }
      const targetId = target?.id ?? null;
      // Every other parent link goes, which also clears a duplicate parent (one-parent rule).
      const unlink = currentParents.filter((l) => l.parent.id !== targetId);
      const link = target !== null && !currentParents.some((l) => l.parent.id === targetId);
      if (unlink.length > 0 || link) {
        if (!access.link) throw new Error(kpiPermissionMessage('nest', spaceLabel));
        if (target && link) {
          if (target.id === kpi.id) throw new Error(`${kpi.key} can't be nested under itself.`);
          const parentsOf = async (id: string) => {
            const issue = await readKpi(id);
            return issue ? hierarchyParentLinks(issue.links, hierarchy).map((l) => l.parentId) : [];
          };
          let cycle: boolean;
          try {
            cycle = await wouldCreateKpiCycle(kpi.id, target.id, parentsOf);
          } catch (e) {
            throw new Error(`Couldn't check that ${target.key} isn't nested under ${kpi.key}, so nothing was saved: ${(e as Error).message}.`);
          }
          if (cycle) throw new Error(`${kpi.key} can't be nested under ${target.key}: ${target.key} is nested under ${kpi.key}.`);
          const types = await listIssueLinkTypes();
          if (!types.some((t) => t.id === hierarchy.linkTypeId)) {
            throw new Error(`${KPI_HIERARCHY_NOT_SET_UP} — the link type KPIs nest with was deleted; choose another in Settings.`);
          }
        }
        move = { hierarchy, unlink, link };
      }
    }
  }

  const asSaved = (over: Partial<UpdatedKpi> = {}): UpdatedKpi => ({
    id: kpi.id,
    kpiId: kpi.id,
    issueKey: kpi.key,
    name: kpi.name,
    unit: currentMeta.unit,
    direction: currentMeta.direction,
    ...over,
  });
  const parentSet = input.parentKpiId === undefined ? {} : { parentKpiId: target?.id ?? null };

  if (move) {
    const { hierarchy: linkType, unlink, link } = move;
    const removed: ParentLink[] = [];
    try {
      for (const old of unlink) {
        await deleteIssueLink(old.linkId);
        removed.push(old);
      }
      if (link && target) await linkKpiParent(linkType, target.key, kpi.key);
    } catch (err) {
      const restored = await Promise.all(
        removed.map((old) => linkKpiParent(linkType, old.parent.key, kpi.key).then(() => true, () => false)),
      );
      const lost = removed.filter((_, i) => !restored[i]);
      if (lost.length === 0) throw err;
      // Some old links couldn't be put back: say so, and show the KPI where Jira now has it.
      const lostIds = new Set(lost.map((l) => l.parent.id));
      const remaining = currentParents.find((l) => !lostIds.has(l.parent.id));
      const result: UpdateKpiResult = {
        kpi: asSaved({ parentKpiId: remaining?.parent.id ?? null }),
        error: `${(err as Error).message}. ${kpi.key} was taken off ${lost.map((l) => l.parent.key).join(', ')}; nest it again in Jira.`,
      };
      return result;
    }
  }

  if (nameChanged || metaChanged) {
    try {
      await updateKpiDefinition(kpi.id, {
        ...(nameChanged ? { name } : {}),
        // Spec 11 · 05: the changed fields + the whole kpi-meta, rebuilt from what's stored.
        ...(metaChanged ? kpiMetaWrite(kpiFields, kpi.storedMeta, currentMeta, metaChange) : {}),
      });
    } catch (e) {
      const message = e instanceof JiraForbiddenError ? kpiPermissionMessage('edit', spaceLabel, kpi.key) : (e as Error).message;
      if (!move) throw new Error(message);
      const result: UpdateKpiResult = {
        kpi: asSaved(parentSet),
        error: `${kpi.key} was moved, but its name, unit and direction weren't saved: ${message}`,
      };
      return result;
    }
  }

  const result: UpdateKpiResult = {
    kpi: asSaved({ name, unit: meta.unit, direction: meta.direction, ...parentSet }),
    error: null,
  };
  return result;
});

export const handler = resolver.getDefinitions();
