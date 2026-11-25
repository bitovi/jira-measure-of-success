import {
  encodeReadingValue,
  REFS_VERSION,
  type Assignment,
  type StoredAssignment,
  type StoredAssignments,
  type IssueLinkTypeInfo,
  type KpiDirection,
  type KpiFieldsConfig,
  type RollupConfig,
} from '../../domain/index';

/**
 * Scale fixture + mock Jira REST API for backend performance tests
 * (specs/06-timeline-performance, "Instrumentation and test harness").
 *
 * Builds a deterministic site — a KPI space plus an Initiative > Epic > Story >
 * Subtask work hierarchy where every Epic carries one KPI target — and serves
 * it through `requestJira(route, init)` the way Jira Cloud would: enhanced JQL
 * search with `nextPageToken` paging and `maxResults` caps, issue properties,
 * the changelog bulk fetch, `/field`, and issue-type icons. Every call is
 * answered from memory; tests assert on the resolver's own request trace.
 */

export interface ScaleOptions {
  kpis: number;
  initiatives: number;
  epicsPerInitiative: number;
  storiesPerEpic: number;
  subtasksPerStory: number;
  readingsPerKpi: number;
  /** every Nth epic has no own due date, so its date must roll up from stories */
  undatedEpicEvery: number;
  /** every Nth story has no own due date */
  undatedStoryEvery: number;
  rollup: RollupConfig;
  /** artificial per-request latency (ms) so stage timings reflect round trips */
  latencyMs: number;
  /**
   * How targets reference KPIs (spec 11 · 03): `migrated` = ids + keys, stamped
   * `refsVersion` (what this version writes); `keys` = keys only (pre-migration data).
   */
  refs: 'migrated' | 'keys';
}

export const DEFAULT_SCALE: ScaleOptions = {
  kpis: 40,
  initiatives: 50,
  epicsPerInitiative: 40, // 2,000 contributing epics
  storiesPerEpic: 3, // 6,000 stories
  subtasksPerStory: 1, // 6,000 subtasks → 12,000+ descendants
  readingsPerKpi: 8,
  undatedEpicEvery: 3,
  undatedStoryEvery: 5,
  rollup: { dueDateRollup: {} },
  latencyMs: 0,
  refs: 'migrated',
};

export const KPI_PROJECT = { key: 'KPI', id: '10000', name: 'KPIs (KPI)' };
export const RANK_FIELD_ID = 'customfield_10019';
/** The app-created hierarchy link type (labels per DEFAULT_KPI_LINK_TYPE: parent on the inward end). */
export const KPI_HIERARCHY_LINK_TYPE = {
  id: '10500',
  name: 'KPI Hierarchy',
  inward: 'is a child KPI of',
  outward: 'is the parent KPI of',
};
const SITE_LINK_TYPES = [
  { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
  KPI_HIERARCHY_LINK_TYPE,
];
export const READING_FIELD_ID = 'customfield_10837';
const WORK_PROJECTS = ['APP', 'WEB', 'OPS'];

export interface FixtureIssue {
  id: string;
  key: string;
  type: 'KPI' | 'Initiative' | 'Epic' | 'Story' | 'Subtask';
  summary: string;
  parentId: string | null;
  due: string | null;
  start: string | null;
  /** KPI-space only: parent KPI via a KPI Hierarchy issue link */
  kpiParentId?: string | null;
  /**
   * KPI-space only: more hierarchy links on which another issue is the parent
   * (Jira allows several; the app expects one). Listed after `kpiParentId`'s link.
   */
  extraKpiParentIds?: string[];
  rank?: string;
  /** keys the issue had before it moved; Jira still resolves them (01 D1) */
  formerKeys?: string[];
  /** created moments ago: readable by id/key, but not in search results yet (index lag) */
  unindexed?: boolean;
  /** link ids by parent id, overriding `kpiLinkId` / `extraKpiLinkId` (to test the lowest-id rule) */
  kpiParentLinkIds?: Record<string, string>;
  /**
   * The work type's id when it isn't the site-wide type of that name: a
   * team-managed space's own "KPI" type (spec 11 · 06; never matches `issuetype = {KPI id}`).
   */
  typeId?: string;
  properties: Record<string, unknown>;
  /** values of `fixture.customFields`, as Jira returns them (text: string; select: `{ self, id, value }`) */
  fieldValues?: Record<string, unknown>;
}

/** Who a mock request runs as — mirrors `api.asUser()` / `api.asApp()`. */
export type MockPrincipal = 'user' | 'app';

/** The invoking user's project permissions in the mock (Jira project permission keys). */
export interface MockProjectAccess {
  browse: boolean;
  create: boolean;
  edit: boolean;
  link: boolean;
}

/**
 * What the invoking user may see and do. App requests ignore this entirely,
 * like `asApp()`; user requests are filtered and permission-checked like Jira.
 * Defaults allow everything, so tests that don't care see no difference.
 */
export interface MockUserView {
  accountId: string;
  /** global ADMINISTER (Administer Jira) */
  isAdmin: boolean;
  /** per project key; projects not listed get full access */
  access: Record<string, MockProjectAccess>;
  /** issue ids hidden from the user (stands in for issue security levels) */
  hidden: Set<string>;
}

export const MOCK_USER_ACCOUNT_ID = 'acc-1';
export const MOCK_APP_ACCOUNT_ID = 'app-measure-of-success';
export const FULL_ACCESS: MockProjectAccess = { browse: true, create: true, edit: true, link: true };

export interface ReadingChangeEntry {
  created: number;
  to: string;
  /** changelog author account id (absent for fixture-seeded history) */
  by?: string;
}

export interface ScaleFixture {
  options: ScaleOptions;
  issues: Map<string, FixtureIssue>;
  childrenOf: Map<string, string[]>;
  kpiIds: string[];
  /** contributing (target-carrying) issue ids, in creation order */
  contributorIds: string[];
  readingChanges: Map<string, ReadingChangeEntry[]>;
  kvs: Map<string, unknown>;
  /** the site's issue link types (global in Jira) */
  linkTypes: IssueLinkTypeInfo[];
  userView: MockUserView;
  /** projects by key, for KPI-space provisioning (`issueTypeNames` = types in its scheme) */
  projects: Map<string, FixtureProject>;
  /** the site's issue types (global in Jira) */
  issueTypes: Array<{
    id: string;
    name: string;
    hierarchyLevel?: number;
    iconUrl?: string;
    avatarId?: number;
    /** a team-managed space's own type */
    scope?: { type: 'PROJECT'; project: { id: string } };
  }>;
  /** custom fields beyond the built-in three (spec 11 · 04); a select's options live in its global context */
  customFields: FixtureCustomField[];
  /** field schemes: project id → scheme id, and scheme id → field id → the work type ids it's restricted to ([] = every type) */
  fieldSchemeOf: Map<string, string>;
  fieldSchemes: Map<string, Map<string, string[]>>;
  /** project id → its work type screen scheme (`mappings`: issue type id or `default` → screen scheme id) */
  screenSchemeOf: Map<string, { id: string; mappings: Record<string, string> }>;
  /** screen scheme id → screens by kind (`default`, `edit`, …) */
  screenSchemes: Map<string, Record<string, number>>;
  /** screen id → its tabs, each with the field ids on it */
  screens: Map<string, Array<{ id: number; name: string; fields: string[] }>>;
  /** avatars uploaded for issue types (`owner` = the type id) */
  avatars: Array<{ id: string; owner: string; contentType: string; size: number }>;
}

export interface FixtureProject {
  id: string;
  name: string;
  issueTypeNames: string[];
  /** company-managed (`classic`, the default) or team-managed (`next-gen`) */
  style?: 'classic' | 'next-gen';
}

export interface FixtureCustomField {
  id: string;
  name: string;
  /** Jira's custom field type key */
  custom: string;
  options?: Array<{ id: string; value: string }>;
}

export const TEXT_FIELD_TYPE = 'com.atlassian.jira.plugin.system.customfieldtypes:textfield';
export const SELECT_FIELD_TYPE = 'com.atlassian.jira.plugin.system.customfieldtypes:select';
/** A company-managed work space sharing the KPI space's field scheme and screens. */
export const TEAM_PROJECT = { key: 'TEAM', id: '10100', name: 'Team space' };
/** The shared "Default Field Scheme" and its screens, as on bitovi-training (01 B1). */
export const DEFAULT_FIELD_SCHEME_ID = '5';
export const DEFAULT_SCREEN_SCHEME_ID = '1';

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 1);
const isoDay = (offsetDays: number): string => new Date(BASE + offsetDays * DAY).toISOString().slice(0, 10);

export function buildScaleFixture(overrides: Partial<ScaleOptions> = {}): ScaleFixture {
  const options = { ...DEFAULT_SCALE, ...overrides };
  const issues = new Map<string, FixtureIssue>();
  const childrenOf = new Map<string, string[]>();
  const add = (issue: FixtureIssue) => {
    issues.set(issue.id, issue);
    if (issue.parentId) {
      const list = childrenOf.get(issue.parentId) ?? [];
      list.push(issue.id);
      childrenOf.set(issue.parentId, list);
    }
  };

  // KPI space: groups of 5, the first of each group is a root.
  const kpiIds: string[] = [];
  const readingChanges = new Map<string, ReadingChangeEntry[]>();
  for (let k = 0; k < options.kpis; k += 1) {
    const id = String(1000 + k);
    const direction: KpiDirection = k % 2 === 0 ? 'increase' : 'decrease';
    kpiIds.push(id);
    issues.set(id, {
      id,
      key: `KPI-${k + 1}`,
      type: 'KPI',
      summary: `KPI ${k + 1}`,
      parentId: null,
      due: null,
      start: null,
      kpiParentId: k % 5 === 0 ? null : String(1000 + k - (k % 5)),
      rank: `0|i${String(options.kpis - k).padStart(5, '0')}:`,
      properties: { 'kpi-meta': { unit: k % 3 === 0 ? '%' : 'count', direction } },
    });
    const changes: ReadingChangeEntry[] = [];
    for (let r = 0; r < options.readingsPerKpi; r += 1) {
      const date = isoDay(-300 + r * 45);
      changes.push({ created: BASE + r * DAY, to: encodeReadingValue(date, 100 + k + r * (k % 2 === 0 ? 5 : -3)) });
    }
    readingChanges.set(id, changes);
  }

  // Work hierarchy.
  const contributorIds: string[] = [];
  let epicN = 0;
  let storyN = 0;
  let subtaskN = 0;
  for (let i = 0; i < options.initiatives; i += 1) {
    const initId = String(100_000 + i);
    add({
      id: initId,
      key: `INIT-${i + 1}`,
      type: 'Initiative',
      summary: `Initiative ${i + 1}`,
      parentId: null,
      due: null,
      start: null,
      properties: {},
    });
    for (let e = 0; e < options.epicsPerInitiative; e += 1) {
      const epicId = String(200_000 + epicN);
      const project = WORK_PROJECTS[epicN % WORK_PROJECTS.length];
      const undated = epicN % options.undatedEpicEvery === 0;
      const kpi = { id: String(1000 + (epicN % options.kpis)), key: `KPI-${(epicN % options.kpis) + 1}` };
      add({
        id: epicId,
        key: `${project}-${epicN + 1}`,
        type: 'Epic',
        summary: `Epic ${epicN + 1}`,
        parentId: initId,
        due: undated ? null : isoDay(30 + (epicN % 330)),
        start: null,
        properties: { 'kpi-assignments': assignmentProperty(kpi, epicN, options.refs) },
      });
      contributorIds.push(epicId);
      for (let s = 0; s < options.storiesPerEpic; s += 1) {
        const storyId = String(300_000 + storyN);
        add({
          id: storyId,
          key: `${project}-${10_000 + storyN}`,
          type: 'Story',
          summary: `Story ${storyN + 1}`,
          parentId: epicId,
          due: storyN % options.undatedStoryEvery === 0 ? null : isoDay(20 + ((storyN * 7) % 360)),
          start: null,
          properties: {},
        });
        for (let t = 0; t < options.subtasksPerStory; t += 1) {
          const subId = String(400_000 + subtaskN);
          add({
            id: subId,
            key: `${project}-${50_000 + subtaskN}`,
            type: 'Subtask',
            summary: `Subtask ${subtaskN + 1}`,
            parentId: storyId,
            due: subtaskN % 2 === 0 ? isoDay(10 + ((subtaskN * 11) % 370)) : null,
            start: null,
            properties: {},
          });
          subtaskN += 1;
        }
        storyN += 1;
      }
      epicN += 1;
    }
  }

  const kvs = new Map<string, unknown>([
    ['kpi:space', { key: KPI_PROJECT.key, projectId: KPI_PROJECT.id, name: KPI_PROJECT.name }],
    ['kpi:config:rollup', options.rollup],
    ['kpi:hierarchy', { linkTypeId: KPI_HIERARCHY_LINK_TYPE.id, parentEnd: 'inward' }],
  ]);
  const linkTypes = SITE_LINK_TYPES.map((t) => ({ ...t }));
  const userView: MockUserView = { accountId: MOCK_USER_ACCOUNT_ID, isAdmin: true, access: {}, hidden: new Set() };
  const projects = new Map<string, FixtureProject>([
    [KPI_PROJECT.key, { id: KPI_PROJECT.id, name: KPI_PROJECT.name, issueTypeNames: ['KPI'] }],
    [TEAM_PROJECT.key, { id: TEAM_PROJECT.id, name: TEAM_PROJECT.name, issueTypeNames: ['Epic', 'Story'] }],
    ['TMP', { id: '10200', name: 'Team-managed space', issueTypeNames: ['Story'], style: 'next-gen' }],
  ]);
  const sharedScreens = { id: '1', mappings: { default: DEFAULT_SCREEN_SCHEME_ID } };
  const issueTypes = (Object.keys(ICON_ID) as Array<FixtureIssue['type']>).map((name) => ({
    id: String(ICON_ID[name]),
    name,
    hierarchyLevel: HIERARCHY_LEVEL[name],
  }));
  return {
    options,
    issues,
    childrenOf,
    kpiIds,
    contributorIds,
    readingChanges,
    kvs,
    linkTypes,
    userView,
    projects,
    issueTypes,
    customFields: [],
    fieldSchemeOf: new Map([
      [KPI_PROJECT.id, DEFAULT_FIELD_SCHEME_ID],
      [TEAM_PROJECT.id, DEFAULT_FIELD_SCHEME_ID],
    ]),
    fieldSchemes: new Map([[DEFAULT_FIELD_SCHEME_ID, new Map([['summary', []], [READING_FIELD_ID, []]])]]),
    screenSchemeOf: new Map([
      [KPI_PROJECT.id, sharedScreens],
      [TEAM_PROJECT.id, sharedScreens],
    ]),
    screenSchemes: new Map([[DEFAULT_SCREEN_SCHEME_ID, { default: 1, edit: 2 }]]),
    screens: new Map([
      ['1', [{ id: 10000, name: 'Field Tab', fields: ['summary'] }]],
      ['2', [{ id: 10001, name: 'Field Tab', fields: ['summary'] }, { id: 10002, name: 'More', fields: [] }]],
    ]),
    avatars: [],
  };
}

/** One target per epic, cycling absolute / relative-to-own-due / relative-to-parent-due / percent. */
function assignmentProperty(kpi: { id: string; key: string }, n: number, refs: ScaleOptions['refs']): StoredAssignments {
  const variant = n % 4;
  const assignment: Assignment = {
    kpiId: kpi.key,
    inheritFromParent: false,
    target: variant === 3 ? 10 : 150 + (n % 50),
    targetType: variant === 3 ? 'percent' : 'absolute',
    timing: {
      start: null,
      due:
        variant === 0
          ? { mode: 'absolute', absolute: isoDay(60 + (n % 300)), anchor: 'issueDueDate', offsetMonths: 0 }
          : variant === 2
            ? { mode: 'relative', absolute: null, anchor: 'parentDueDate', offsetMonths: 1 }
            : { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: variant === 3 ? 3 : 0 },
    },
    updatedBy: 'fixture',
    updatedAt: BASE,
  };
  return storedTargets([{ ...assignment, ...(refs === 'migrated' ? { kpiIssueId: kpi.id } : {}) }], refs === 'migrated');
}

/** A `kpi-assignments` value with its index arrays, as the app writes it (`stamp` = `refsVersion`). */
export function storedTargets(assignments: StoredAssignment[], stamp: boolean): StoredAssignments {
  return {
    assignments,
    kpiIssueIds: [...new Set(assignments.flatMap((a) => (a.kpiIssueId ? [a.kpiIssueId] : [])))],
    kpiIds: [...new Set(assignments.map((a) => a.kpiId))],
    ...(stamp ? { refsVersion: REFS_VERSION } : {}),
  };
}

/** A plain absolute target, for tests that build `kpi-assignments` by hand. */
export function fixtureTarget(kpiId: string, over: Partial<StoredAssignment> = {}): StoredAssignment {
  return {
    kpiId,
    inheritFromParent: false,
    target: 42,
    targetType: 'absolute',
    timing: { start: null, due: { mode: 'absolute', absolute: '2026-09-30', anchor: 'issueDueDate', offsetMonths: 0 } },
    updatedBy: 'fixture',
    updatedAt: BASE,
    ...over,
  };
}

/** A key no issue has: a KPI deleted before the migration ran. */
export const DELETED_KPI_KEY = 'KPI-404';

export interface RefEdgeCases {
  /** a KPI whose key changed (it moved); its old key still resolves */
  moved: { id: string; oldKey: string; newKey: string };
  /** a KPI hidden from the user (the app can see it) */
  hiddenKpiId: string;
  /** a work item targeting a deleted KPI next to its live target */
  mixedIssueId: string;
  /** a work item whose only target is on a deleted KPI */
  deletedOnlyIssueId: string;
}

/**
 * The reference edge cases of spec 11 · 03 on top of a built fixture, in the
 * fixture's `refs` shape: a moved KPI (the 3rd), a KPI hidden from the user
 * (the 4th), and a deleted KPI's key next to a live target (1st contributor)
 * and alone (2nd contributor). Deleted references are key-only in both shapes.
 */
export function addRefEdgeCases(fixture: ScaleFixture): RefEdgeCases {
  const migrated = fixture.options.refs === 'migrated';
  const movedIssue = fixture.issues.get(fixture.kpiIds[2])!;
  const moved = { id: movedIssue.id, oldKey: movedIssue.key, newKey: `${KPI_PROJECT.key}-${900 + fixture.kpiIds.length}` };
  movedIssue.formerKeys = [moved.oldKey];
  movedIssue.key = moved.newKey;

  const hiddenKpiId = fixture.kpiIds[3];
  fixture.userView.hidden.add(hiddenKpiId);

  const [mixedIssueId, deletedOnlyIssueId] = fixture.contributorIds;
  const mixed = fixture.issues.get(mixedIssueId)!;
  const live = (mixed.properties['kpi-assignments'] as StoredAssignments).assignments;
  mixed.properties['kpi-assignments'] = storedTargets([...live, fixtureTarget(DELETED_KPI_KEY)], migrated);
  fixture.issues.get(deletedOnlyIssueId)!.properties['kpi-assignments'] = storedTargets(
    [fixtureTarget(DELETED_KPI_KEY)],
    migrated,
  );
  return { moved, hiddenKpiId, mixedIssueId, deletedOnlyIssueId };
}

// ── KPIs in many spaces (spec 11 · 06) ───────────────────────────────────────

export const PORTFOLIO_PROJECT = { key: 'PORT', id: '10400', name: 'Portfolio' };
export const GROWTH_PROJECT = { key: 'GROW', id: '10401', name: 'Growth' };
export const TEAM_MANAGED_PROJECT = { key: 'TMP', id: '10200' };
/** The team-managed space's own "KPI" work type (private to it, its own id). */
export const TEAM_MANAGED_KPI_TYPE_ID = '10399';

export interface KpiSpaces {
  /** PORT-1 (a root) and PORT-2 (under PORT-1) */
  portRootId: string;
  portChildId: string;
  /** GROW-1, under the central space's KPI-1 */
  growUnderCentralId: string;
  /**
   * GROW-2: linked under PORT-1 AND (by an older, lower-id link listed second)
   * under KPI-1, so it shows under KPI-1 and is flagged (one-parent rule)
   */
  growTwoParentsId: string;
  /** GROW-3, under PORT-2 only (top-level for a user who can't browse PORT) */
  growUnderPortChildId: string;
  /** a team-managed space's own "KPI" issue (TMP-1): never a KPI */
  teamManagedKpiId: string;
  /** a Story in the central space: not a KPI */
  centralStoryId: string;
  /** the work item targeting GROW-1 and PORT-2 */
  crossSpaceTargetIssueId: string;
}

/**
 * The multi-space site of spec 11 · 06 on top of a built fixture: two more
 * company-managed spaces with KPIs (Portfolio, Growth) next to the central
 * KPI space, all sharing the field scheme; KPIs nested across spaces; a KPI
 * with two parent links; a team-managed space with its own "KPI" type; a
 * Story in the central space; readings; and a work item targeting KPIs in two
 * spaces (migrated id references). Call before `chooseKpiFields` so the new
 * KPIs take the chosen shape too. Users without Browse (or Edit) in a space
 * are set per test through `userView.access`.
 */
export function addKpiSpaces(fixture: ScaleFixture): KpiSpaces {
  for (const p of [PORTFOLIO_PROJECT, GROWTH_PROJECT]) {
    fixture.projects.set(p.key, { id: p.id, name: p.name, issueTypeNames: ['KPI', 'Story'] });
    fixture.fieldSchemeOf.set(p.id, DEFAULT_FIELD_SCHEME_ID);
    fixture.screenSchemeOf.set(p.id, { id: `itss-${p.id}`, mappings: { default: DEFAULT_SCREEN_SCHEME_ID } });
  }
  fixture.projects.get(KPI_PROJECT.key)!.issueTypeNames.push('Story');
  fixture.projects.get(TEAM_MANAGED_PROJECT.key)!.issueTypeNames.push('KPI');
  // Listed first, as Jira may: deriving the work type by name must skip it.
  fixture.issueTypes.unshift({
    id: TEAM_MANAGED_KPI_TYPE_ID,
    name: 'KPI',
    hierarchyLevel: 0,
    scope: { type: 'PROJECT', project: { id: TEAM_MANAGED_PROJECT.id } },
  });

  const kpi = (
    id: string,
    key: string,
    summary: string,
    kpiParentId: string | null,
    rank: string,
    unit: string,
    over: Partial<FixtureIssue> = {},
  ) => {
    fixture.issues.set(id, {
      id,
      key,
      type: 'KPI',
      summary,
      parentId: null,
      due: null,
      start: null,
      kpiParentId,
      rank,
      properties: { 'kpi-meta': { unit, direction: 'increase' } },
      ...over,
    });
    fixture.readingChanges.set(id, [
      { created: BASE, to: encodeReadingValue(isoDay(-90), 10) },
      { created: BASE + DAY, to: encodeReadingValue(isoDay(-30), 12) },
    ]);
  };
  const centralRoot = fixture.kpiIds[0];
  kpi('5000', 'PORT-1', 'Portfolio value', null, '0|i90000:', 'USD');
  kpi('5001', 'PORT-2', 'Portfolio margin', '5000', '0|i90001:', '%');
  kpi('5100', 'GROW-1', 'Growth signups', centralRoot, '0|i90002:', 'users');
  kpi('5101', 'GROW-2', 'Growth retention', '5000', '0|i90003:', '%', {
    extraKpiParentIds: [centralRoot],
    kpiParentLinkIds: { [centralRoot]: '100' },
  });
  kpi('5102', 'GROW-3', 'Growth referrals', '5001', '0|i90004:', 'count');
  kpi('5200', 'TMP-1', 'Team-managed KPI', null, '0|i90005:', 'count', { typeId: TEAM_MANAGED_KPI_TYPE_ID });
  fixture.issues.set('5300', {
    id: '5300',
    key: 'KPI-500',
    type: 'Story',
    summary: 'Not a KPI',
    parentId: null,
    due: null,
    start: null,
    properties: {},
  });

  const crossSpaceTargetIssueId = fixture.contributorIds[2];
  const target = fixture.issues.get(crossSpaceTargetIssueId)!;
  const existing = (target.properties['kpi-assignments'] as StoredAssignments).assignments;
  target.properties['kpi-assignments'] = storedTargets(
    [
      ...existing,
      fixtureTarget('GROW-1', { kpiIssueId: '5100', target: 20 }),
      fixtureTarget('PORT-2', { kpiIssueId: '5001', target: 15 }),
    ],
    true,
  );
  return {
    portRootId: '5000',
    portChildId: '5001',
    growUnderCentralId: '5100',
    growTwoParentsId: '5101',
    growUnderPortChildId: '5102',
    teamManagedKpiId: '5200',
    centralStoryId: '5300',
    crossSpaceTargetIssueId,
  };
}

// ── KPI fields (spec 11 · 05) ────────────────────────────────────────────────

/** The unit/direction fields as on bitovi-training (dev). */
export const KPI_UNIT_FIELD_ID = 'customfield_10910';
export const KPI_DIRECTION_FIELD_ID = 'customfield_10911';
export const KPI_DIRECTION_OPTION_IDS = { increase: '10652', decrease: '10653' } as const;
/** The fixture's KPI work type id (`issuetype = …`; the KPI entry of `ICON_ID`, declared below). */
export const KPI_WORK_TYPE_ID = '10300';

/**
 * How far the fixture's KPIs are along once the fields are chosen. Not calling
 * `chooseKpiFields` at all is the **not configured** shape (`fields: null`).
 * - `pre-migration`: fields empty, `kpi-meta` unmarked (what an upgraded site has)
 * - `migrated`: fields hold the values, `kpi-meta` marked
 * - `mixed`: even-indexed KPIs migrated, odd ones not
 * - `field-edited`: pre-migration, but KPI-2's unit field was set in Jira to
 *   something else (`FIELD_EDITED_UNIT`) before the migration ran
 */
export type KpiFieldsShape = 'pre-migration' | 'migrated' | 'mixed' | 'field-edited';
export const FIELD_EDITED_UNIT = 'orders';

/** A unit/direction as Jira returns the fields' values (the mock's stored format). */
export function kpiFieldValues(
  cfg: KpiFieldsConfig,
  meta: { unit: string; direction: KpiDirection | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.unit) out[cfg.unit.fieldId] = meta.unit;
  if (meta.direction) {
    const d = cfg.direction;
    out[d.fieldId] =
      d.kind === 'text'
        ? meta.direction
        : {
            self: `https://site/rest/api/3/customFieldOption/${d.optionIds[meta.direction]}`,
            id: d.optionIds[meta.direction],
            value: meta.direction === 'increase' ? 'Increase' : 'Decrease',
          };
  }
  return out;
}

/**
 * Choose the unit/direction fields on the fixture site (spec 11 · 04's saved
 * config): creates them, puts them in the KPI space's field scheme for the KPI
 * type, saves `kpi:config:site`, and puts the KPIs in `shape`.
 */
export function chooseKpiFields(
  fixture: ScaleFixture,
  shape: KpiFieldsShape,
  options: { direction?: 'select' | 'text' } = {},
): KpiFieldsConfig {
  const select = (options.direction ?? 'select') === 'select';
  const cfg: KpiFieldsConfig = {
    unit: { fieldId: KPI_UNIT_FIELD_ID },
    direction: select
      ? { fieldId: KPI_DIRECTION_FIELD_ID, kind: 'select', optionIds: { ...KPI_DIRECTION_OPTION_IDS } }
      : { fieldId: KPI_DIRECTION_FIELD_ID, kind: 'text' },
  };
  fixture.customFields.push(
    { id: KPI_UNIT_FIELD_ID, name: 'KPI Unit', custom: TEXT_FIELD_TYPE },
    select
      ? {
          id: KPI_DIRECTION_FIELD_ID,
          name: 'KPI Direction',
          custom: SELECT_FIELD_TYPE,
          options: [
            { id: KPI_DIRECTION_OPTION_IDS.increase, value: 'Increase' },
            { id: KPI_DIRECTION_OPTION_IDS.decrease, value: 'Decrease' },
          ],
        }
      : { id: KPI_DIRECTION_FIELD_ID, name: 'KPI Direction', custom: TEXT_FIELD_TYPE },
  );
  const scheme = fixture.fieldSchemes.get(DEFAULT_FIELD_SCHEME_ID)!;
  scheme.set(KPI_UNIT_FIELD_ID, [KPI_WORK_TYPE_ID]);
  scheme.set(KPI_DIRECTION_FIELD_ID, [KPI_WORK_TYPE_ID]);
  fixture.kvs.set('kpi:config:site', { workType: { id: KPI_WORK_TYPE_ID, name: 'KPI' }, fields: cfg, schemes: {} });

  const kpis = [...fixture.issues.values()].filter((i) => i.type === 'KPI' && !i.typeId);
  kpis.forEach((issue, index) => {
    const meta = issue.properties['kpi-meta'] as { unit: string; direction: KpiDirection | null } | undefined;
    if (!meta) return;
    const migrated = shape === 'migrated' || (shape === 'mixed' && index % 2 === 0);
    if (migrated) {
      issue.fieldValues = kpiFieldValues(cfg, meta);
      issue.properties['kpi-meta'] = { ...meta, fields: true };
    }
    if (shape === 'field-edited' && index === 1) {
      issue.fieldValues = kpiFieldValues(cfg, { unit: FIELD_EDITED_UNIT, direction: null });
    }
  });
  return cfg;
}

// ── Mock Jira REST API ───────────────────────────────────────────────────────

interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function respond(status: number, body: unknown = {}, contentType = 'application/json'): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer as ArrayBuffer,
  };
}

const ICON_BASE = 'https://api.atlassian.com/ex/jira/cloud-id/rest/api/2/universal_avatar/view/type/issuetype/avatar';
const ICON_ID: Record<FixtureIssue['type'], number> = {
  KPI: 10300,
  Initiative: 10301,
  Epic: 10302,
  Story: 10303,
  Subtask: 10304,
};
/** Jira `issuetype.hierarchyLevel` per fixture type (KPI is a base-level type). */
const HIERARCHY_LEVEL: Record<FixtureIssue['type'], number> = {
  KPI: 0,
  Initiative: 2,
  Epic: 1,
  Story: 0,
  Subtask: -1,
};

/** How the fixture's KPI parent links read back: the configured type, parent on the configured end. */
interface FixtureLinkShape {
  type: IssueLinkTypeInfo;
  parentEnd: 'inward' | 'outward';
}

function kpiLinkShape(fixture: ScaleFixture): FixtureLinkShape {
  const cfg = fixture.kvs.get('kpi:hierarchy') as { linkTypeId?: string; parentEnd?: string } | undefined;
  const type = fixture.linkTypes.find((t) => t.id === cfg?.linkTypeId) ?? KPI_HIERARCHY_LINK_TYPE;
  return { type, parentEnd: cfg?.parentEnd === 'outward' ? 'outward' : 'inward' };
}

/** A child's (numeric, like Jira's) parent link id is derived from its issue id. */
export const kpiLinkId = (childIssueId: string): string => String(50_000_000 + Number(childIssueId));
/** The link id of one of a child's `extraKpiParentIds`. */
export const extraKpiLinkId = (childIssueId: string, parentId: string): string => `${kpiLinkId(childIssueId)}-${parentId}`;

/** The id of the link from `issue` up to `parentId` (`primary` = its `kpiParentId` link). */
const parentLinkId = (issue: FixtureIssue, parentId: string, primary: boolean): string =>
  issue.kpiParentLinkIds?.[parentId] ?? (primary ? kpiLinkId(issue.id) : extraKpiLinkId(issue.id, parentId));

/** The work type id an issue is of (a team-managed type has its own). */
const typeIdOf = (issue: FixtureIssue): string => issue.typeId ?? String(ICON_ID[issue.type]);

/** How `issueJson` sees the rest of the site: keys, projects, and which issues the caller may see. */
interface IssueJsonSite {
  issue: (id: string) => FixtureIssue | undefined;
  project: (issue: FixtureIssue) => { id: string; key: string; name: string };
  visible: (issue: FixtureIssue) => boolean;
  /** issues linked under this one as KPI children (the other end of their parent links) */
  kpiChildren: (id: string) => Array<{ child: FixtureIssue; linkId: string }>;
}

function issueJson(
  issue: FixtureIssue,
  fields: string[],
  properties: string[],
  link: FixtureLinkShape,
  site: IssueJsonSite,
  customFieldIds: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const parentEnd = link.parentEnd === 'outward' ? 'outwardIssue' : 'inwardIssue';
  const childEnd = link.parentEnd === 'outward' ? 'inwardIssue' : 'outwardIssue';
  const parentLinks = [
    ...(issue.kpiParentId ? [{ id: parentLinkId(issue, issue.kpiParentId, true), parentId: issue.kpiParentId }] : []),
    ...(issue.extraKpiParentIds ?? []).map((parentId) => ({ id: parentLinkId(issue, parentId, false), parentId })),
  ];
  const all: Record<string, unknown> = {
    summary: issue.summary,
    project: site.project(issue),
    issuetype: {
      id: typeIdOf(issue),
      name: issue.type,
      hierarchyLevel: HIERARCHY_LEVEL[issue.type],
      iconUrl: `${ICON_BASE}/${ICON_ID[issue.type]}?size=medium`,
    },
    duedate: issue.due,
    customfield_10015: issue.start,
    status: { statusCategory: { key: 'indeterminate' } },
    parent: issue.parentId ? { id: issue.parentId } : undefined,
    // Like Jira (01 C2), a link to an issue the caller can't see is left out.
    issuelinks: fields.includes('issuelinks')
      ? [
          ...parentLinks.flatMap((l) => {
            const parent = site.issue(l.parentId);
            if (parent && !site.visible(parent)) return [];
            return [
              {
                id: l.id,
                type: link.type,
                [parentEnd]: {
                  id: l.parentId,
                  key: parent?.key,
                  ...(parent ? { fields: { issuetype: { id: typeIdOf(parent), name: parent.type } } } : {}),
                },
              },
            ];
          }),
          ...site
            .kpiChildren(issue.id)
            .filter(({ child }) => site.visible(child))
            .map(({ child, linkId }) => ({
              id: linkId,
              type: link.type,
              [childEnd]: { id: child.id, key: child.key, fields: { issuetype: { id: typeIdOf(child), name: child.type } } },
            })),
        ]
      : undefined,
    [RANK_FIELD_ID]: issue.rank ?? null,
  };
  const picked: Record<string, unknown> = {};
  for (const f of fields) if (f in all && all[f] !== undefined) picked[f] = all[f];
  // Jira returns a requested custom field even when it's empty (null).
  for (const f of fields) if (customFieldIds.has(f)) picked[f] = issue.fieldValues?.[f] ?? null;
  const out: Record<string, unknown> = { id: issue.id, key: issue.key, fields: picked };
  if (properties.length > 0) {
    const props: Record<string, unknown> = {};
    for (const p of properties) if (p in issue.properties) props[p] = issue.properties[p];
    out.properties = props;
  }
  return out;
}

/** The `kpi-assignments` property paths the manifest indexes, as JQL clauses can test them. */
const TARGETS_CLAUSE = /^issue\.property\[kpi-assignments\]\.(kpiIds|kpiIssueIds|refsVersion)\s+IS\s+(NOT\s+)?EMPTY$/i;

function targetsClauseMatches(issue: FixtureIssue, clause: string): boolean | null {
  const m = TARGETS_CLAUSE.exec(clause.trim());
  if (!m) return null;
  const value = (issue.properties['kpi-assignments'] as Record<string, unknown> | undefined)?.[m[1]];
  const empty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  return m[2] ? !empty : empty;
}

function runJql(fixture: ScaleFixture, jql: string): FixtureIssue[] | null {
  const [where, orderBy] = jql.trim().split(/\s+ORDER\s+BY\s+/i);
  const q = where.trim();
  const get = (id: string): FixtureIssue | undefined => fixture.issues.get(id);
  const inList = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const childrenOf = (id: string) =>
    (fixture.childrenOf.get(id) ?? []).map(get).filter((i): i is FixtureIssue => !!i);

  let m = /^id\s+in\s*\(([^)]*)\)/i.exec(q);
  if (m) return inList(m[1]).map(get).filter((i): i is FixtureIssue => !!i);
  m = /^parent\s+in\s*\(([^)]*)\)/i.exec(q);
  if (m) return inList(m[1]).flatMap(childrenOf);
  m = /^parent\s*=\s*(\S+)/i.exec(q);
  if (m) return childrenOf(m[1]);
  m = /^project\s*=\s*(\w+)/i.exec(q);
  if (m && m[1] === KPI_PROJECT.key) return fixture.kpiIds.map(get).filter((i): i is FixtureIssue => !!i);
  // Spec 11 · 05/06: every issue of a work type (by id or name), site-wide, ANDed
  // with `project in (…)`, `id in (…)` and `summary ~ "text*"` (06's KPI search).
  m = /^issuetype\s*=\s*"?([^"\s]+)"?((?:\s+AND\s+.+)?)$/i.exec(q);
  if (m) {
    const type = fixture.issueTypes.find((t) => t.id === m![1] || t.name === m![1]);
    const tests: Array<(i: FixtureIssue) => boolean> = [];
    for (const clause of m[2].split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean)) {
      let c = /^project\s+in\s*\(([^)]*)\)$/i.exec(clause);
      if (c) {
        const keys = new Set(inList(c[1]).map((k) => k.replace(/"/g, '')));
        tests.push((i) => keys.has(i.key.split('-')[0]));
        continue;
      }
      c = /^id\s+in\s*\(([^)]*)\)$/i.exec(clause);
      if (c) {
        const ids = new Set(inList(c[1]));
        tests.push((i) => ids.has(i.id));
        continue;
      }
      c = /^summary\s*~\s*"(.*)\*"$/i.exec(clause);
      if (c) {
        const prefix = c[1].replace(/\\(.)/g, '$1').toLowerCase();
        tests.push((i) => i.summary.toLowerCase().split(/\s+/).some((w) => w.startsWith(prefix)) || i.summary.toLowerCase().startsWith(prefix));
        continue;
      }
      return null;
    }
    const matched = type
      ? [...fixture.issues.values()].filter((i) => !i.unindexed && typeIdOf(i) === type.id && tests.every((t) => t(i)))
      : [];
    return orderBy && /^id\s+ASC$/i.test(orderBy.trim()) ? matched.sort((a, b) => Number(a.id) - Number(b.id)) : matched;
  }
  // 03's exact "who targets KPI X" lookup (no tokenising, 01 D3).
  m = /^issue\.property\[kpi-assignments\]\.kpiIssueIds\s*=\s*"(\d+)"$/i.exec(q);
  if (m) {
    const id = m[1];
    return [...fixture.issues.values()].filter((i) =>
      ((i.properties['kpi-assignments'] as { kpiIssueIds?: string[] } | undefined)?.kpiIssueIds ?? []).includes(id),
    );
  }
  // `kpi-assignments` index clauses, ANDed: matched against the stored property (no index lag).
  const clauses = q.split(/\s+AND\s+/i);
  if (clauses.every((c) => TARGETS_CLAUSE.test(c.trim()))) {
    const matched = [...fixture.issues.values()].filter((i) => clauses.every((c) => targetsClauseMatches(i, c)));
    return orderBy && /^id\s+ASC$/i.test(orderBy.trim()) ? matched.sort((a, b) => Number(a.id) - Number(b.id)) : matched;
  }
  return null;
}

export interface MockJira {
  fixture: ScaleFixture;
  /** `as` defaults to `'app'` (no user filtering), matching the pre-identity behavior */
  requestJira(
    route: unknown,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
    as?: MockPrincipal,
  ): Promise<MockResponse>;
  /** requests that hit no mock handler (should stay empty) */
  unhandled: string[];
  /** every non-GET request, in order (`METHOD path`) */
  writes: string[];
  /**
   * Answer a request before the mock handlers do (return undefined to fall
   * through) — e.g. to make a write fail.
   */
  intercept?: (
    method: string,
    path: string,
    body: unknown,
    raw: string,
    as: MockPrincipal,
  ) => { status: number; body?: unknown } | undefined;
}

export { respond as mockResponse };

/** Jira project key an issue belongs to: its key's prefix (a moved issue's key is its new one). */
function projectKeyOf(issue: FixtureIssue): string {
  return issue.key.split('-')[0];
}

/** Jira project-permission key → MockProjectAccess flag. */
const PROJECT_PERMISSION: Record<string, keyof MockProjectAccess> = {
  BROWSE_PROJECTS: 'browse',
  CREATE_ISSUES: 'create',
  EDIT_ISSUES: 'edit',
  LINK_ISSUES: 'link',
};

/** Writes that Jira only allows for Administer Jira (KPI-space provisioning). */
const ADMIN_ONLY_WRITES: Array<[string, RegExp]> = [
  ['POST', /^\/rest\/api\/3\/project$/],
  ['POST', /^\/rest\/api\/3\/issuetype$/],
  ['PUT', /^\/rest\/api\/3\/issuetypescheme\/[^/]+\/issuetype$/],
  ['POST', /^\/rest\/api\/3\/issueLinkType$/],
  ['PUT', /^\/rest\/api\/3\/issuetype\/[^/]+$/],
  ['POST', /^\/rest\/api\/3\/universal_avatar\//],
  ['POST', /^\/rest\/api\/3\/field$/],
  ['POST', /^\/rest\/api\/3\/field\/[^/]+\/context\/[^/]+\/option$/],
  ['PUT', /^\/rest\/api\/3\/config\/fieldschemes\/fields$/],
  ['POST', /^\/rest\/api\/3\/screens\/[^/]+\/tabs\/[^/]+\/fields$/],
];

export function createMockJira(fixture: ScaleFixture): MockJira {
  const unhandled: string[] = [];
  const writes: string[] = [];
  const findIssue = (idOrKey: string) =>
    fixture.issues.get(idOrKey) ??
    [...fixture.issues.values()].find((i) => i.key === idOrKey) ??
    [...fixture.issues.values()].find((i) => i.formerKeys?.includes(idOrKey));
  /** An issue's project as Jira returns it (work projects aren't in `fixture.projects`). */
  const projectOf = (issue: FixtureIssue): { id: string; key: string; name: string } => {
    const key = projectKeyOf(issue);
    const p = fixture.projects.get(key);
    return p ? { id: p.id, key, name: p.name } : { id: `work-${key}`, key, name: key };
  };
  const siteFor = (as: MockPrincipal): IssueJsonSite => {
    let children: Map<string, Array<{ child: FixtureIssue; linkId: string }>> | null = null;
    return {
      issue: (id) => fixture.issues.get(id),
      project: projectOf,
      visible: (issue) => visible(issue, as),
      kpiChildren: (id) => {
        if (!children) {
          children = new Map();
          for (const i of fixture.issues.values()) {
            if (i.type !== 'KPI') continue;
            const parents = [
              ...(i.kpiParentId ? [{ parentId: i.kpiParentId, primary: true }] : []),
              ...(i.extraKpiParentIds ?? []).map((parentId) => ({ parentId, primary: false })),
            ];
            for (const { parentId, primary } of parents) {
              children.set(parentId, [...(children.get(parentId) ?? []), { child: i, linkId: parentLinkId(i, parentId, primary) }]);
            }
          }
        }
        return children.get(id) ?? [];
      },
    };
  };
  const customFieldIds = () => new Set(fixture.customFields.map((f) => f.id));
  /**
   * The custom field values a create/edit sets, as Jira stores them, or the
   * 400 Jira answers: a field not in the space's field scheme for the work
   * type can't be set (01 A4), and a select takes an existing option.
   */
  const customFieldWrites = (
    typeId: string,
    projectId: string,
    reqFields: Record<string, unknown> | undefined,
  ): { values: Record<string, unknown> } | { error: MockResponse } => {
    const values: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(reqFields ?? {})) {
      const field = fixture.customFields.find((f) => f.id === id);
      if (!field) continue;
      const types = fixture.fieldSchemes.get(fixture.fieldSchemeOf.get(projectId) ?? '')?.get(id);
      if (!types || (types.length > 0 && !types.includes(typeId))) {
        return {
          error: respond(400, {
            errorMessages: [],
            errors: { [id]: `Field '${id}' cannot be set. It is not on the appropriate screen, or unknown.` },
          }),
        };
      }
      if (value === null) {
        values[id] = null;
      } else if (field.custom === SELECT_FIELD_TYPE) {
        const ref = value as { id?: string; value?: string };
        const option = (field.options ?? []).find((o) => o.id === ref.id || o.value === ref.value);
        if (!option) return { error: respond(400, { errorMessages: [], errors: { [id]: `Option id '${ref.id}' is not valid` } }) };
        values[id] = { self: `https://site/rest/api/3/customFieldOption/${option.id}`, id: option.id, value: option.value };
      } else {
        values[id] = String(value);
      }
    }
    return { values };
  };
  const applyFieldValues = (issue: FixtureIssue, values: Record<string, unknown>) => {
    const next = { ...issue.fieldValues };
    for (const [id, value] of Object.entries(values)) {
      if (value === null) delete next[id];
      else next[id] = value;
    }
    issue.fieldValues = next;
  };
  let nextIssueId = 900_000;
  let nextOptionId = 10_650;
  let clock = Date.UTC(2026, 6, 1);

  const accessTo = (projectKey: string): MockProjectAccess => fixture.userView.access[projectKey] ?? FULL_ACCESS;
  /** Can this principal see the issue at all? (Jira answers 404 when not.) */
  const visible = (issue: FixtureIssue, as: MockPrincipal): boolean =>
    as === 'app' || (!fixture.userView.hidden.has(issue.id) && accessTo(projectKeyOf(issue)).browse);
  const may = (issue: FixtureIssue, as: MockPrincipal, permission: keyof MockProjectAccess): boolean =>
    as === 'app' || accessTo(projectKeyOf(issue))[permission];
  const notFound = () => respond(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
  const forbidden = (what: string) => respond(403, { errorMessages: [`You do not have permission to ${what}.`] });

  const handle = (
    method: string,
    raw: string,
    body: unknown,
    as: MockPrincipal,
    headers: Record<string, string> = {},
  ): MockResponse => {
    const [path, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    if (method !== 'GET') writes.push(`${method} ${path}`);
    const intercepted = mock.intercept?.(method, path, body, raw, as);
    if (intercepted) return respond(intercepted.status, intercepted.body ?? {});

    if (as === 'user' && !fixture.userView.isAdmin && ADMIN_ONLY_WRITES.some(([m, re]) => m === method && re.test(path))) {
      return forbidden('administer Jira');
    }

    if (method === 'GET' && path === '/rest/api/3/mypermissions') {
      const keys = (params.get('permissions') ?? '').split(',').filter(Boolean);
      const issueRef = params.get('issueId') ?? params.get('issueKey');
      const issue = issueRef ? findIssue(issueRef) : undefined;
      if (issueRef && (!issue || !visible(issue, as))) return notFound();
      const byId = params.get('projectId');
      const projectKey = issue
        ? projectKeyOf(issue)
        : (params.get('projectKey') ?? [...fixture.projects.entries()].find(([, p]) => p.id === byId)?.[0] ?? null);
      if (byId && !projectKey) return respond(404, { errorMessages: ['No project could be found.'] });
      const permissions: Record<string, { key: string; havePermission: boolean }> = {};
      for (const key of keys) {
        let have: boolean;
        if (as === 'app') have = true;
        else if (key === 'ADMINISTER') have = fixture.userView.isAdmin;
        else if (PROJECT_PERMISSION[key] && projectKey) have = accessTo(projectKey)[PROJECT_PERMISSION[key]];
        else have = false;
        permissions[key] = { key, havePermission: have };
      }
      return respond(200, { permissions });
    }

    if (method === 'GET' && path === '/rest/api/3/field') {
      return respond(200, [
        { id: 'summary', name: 'Summary' },
        { id: RANK_FIELD_ID, name: 'Rank', schema: { custom: 'com.pyxis.greenhopper.jira:gh-lexo-rank' } },
        { id: READING_FIELD_ID, key: 'app-key__kpi-reading', name: 'KPI Reading' },
        ...fixture.customFields.map((f) => ({
          id: f.id,
          key: f.id,
          name: f.name,
          custom: true,
          schema: { type: f.custom === SELECT_FIELD_TYPE ? 'option' : 'string', custom: f.custom },
        })),
      ]);
    }

    if (method === 'GET' && path === '/rest/api/3/search/jql') {
      const jql = params.get('jql') ?? '';
      const project = /^project\s*=\s*(\w+)/i.exec(jql.trim())?.[1];
      // Jira rejects JQL naming a project the user can't browse, rather than returning no issues.
      if (as === 'user' && project && !accessTo(project).browse) {
        return respond(400, { errorMessages: [`The value '${project}' does not exist for the field 'project'.`] });
      }
      const matched = runJql(fixture, jql);
      if (!matched) return respond(400, { errorMessages: [`Unsupported JQL: ${jql}`] });
      const seen = matched.filter((i) => visible(i, as));
      const fields = (params.get('fields') ?? '').split(',').filter(Boolean);
      const properties = (params.get('properties') ?? '').split(',').filter(Boolean);
      const maxResults = Number(params.get('maxResults') ?? 50);
      const offset = Number(params.get('nextPageToken') ?? 0);
      const page = seen.slice(offset, offset + maxResults);
      const more = offset + maxResults < seen.length;
      return respond(200, {
        issues: page.map((i) => issueJson(i, fields, properties, kpiLinkShape(fixture), siteFor(as), customFieldIds())),
        isLast: !more,
        ...(more ? { nextPageToken: String(offset + maxResults) } : {}),
      });
    }

    if (method === 'POST' && path === '/rest/api/3/search/approximate-count') {
      const { jql } = JSON.parse(String(body)) as { jql: string };
      const matched = runJql(fixture, jql);
      if (!matched) return respond(400, { errorMessages: [`Unsupported JQL: ${jql}`] });
      return respond(200, { count: matched.filter((i) => visible(i, as)).length });
    }

    const single = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(path);
    if (single && method === 'GET') {
      const issue = findIssue(decodeURIComponent(single[1]));
      if (!issue || !visible(issue, as)) return notFound();
      const fields = (params.get('fields') ?? '').split(',').filter(Boolean);
      const properties = (params.get('properties') ?? '').split(',').filter(Boolean);
      return respond(200, issueJson(issue, fields, properties, kpiLinkShape(fixture), siteFor(as), customFieldIds()));
    }

    const prop = /^\/rest\/api\/3\/issue\/([^/]+)\/properties\/([^/]+)$/.exec(path);
    if (prop && method === 'GET') {
      const issue = findIssue(decodeURIComponent(prop[1]));
      const key = decodeURIComponent(prop[2]);
      if (!issue || !visible(issue, as) || !(key in issue.properties)) return notFound();
      return respond(200, { key, value: issue.properties[key] });
    }

    if (method === 'POST' && path === '/rest/api/3/changelog/bulkfetch') {
      const req = JSON.parse(String(body)) as { issueIdsOrKeys: string[] };
      // Jira silently leaves out issues the caller can't see.
      const ids = req.issueIdsOrKeys.filter((id) => {
        const issue = findIssue(id);
        return issue ? visible(issue, as) : true;
      });
      return respond(200, {
        issueChangeLogs: ids.map((id) => ({
          issueId: id,
          changeHistories: (fixture.readingChanges.get(id) ?? []).map((c) => ({
            created: c.created,
            ...(c.by ? { author: { accountId: c.by } } : {}),
            items: [{ fieldId: READING_FIELD_ID, to: c.to, toString: c.to }],
          })),
        })),
      });
    }

    if (prop && method === 'PUT') {
      const issue = findIssue(decodeURIComponent(prop[1]));
      if (!issue || !visible(issue, as)) return notFound();
      if (!may(issue, as, 'edit')) return forbidden(`edit ${issue.key}`);
      issue.properties[decodeURIComponent(prop[2])] = JSON.parse(String(body));
      return respond(200);
    }

    // Standard issue edit — the KPI Reading field is user-editable (spec 10, Path A).
    if (single && method === 'PUT') {
      const issue = findIssue(decodeURIComponent(single[1]));
      if (!issue || !visible(issue, as)) return notFound();
      if (!may(issue, as, 'edit')) return forbidden(`edit ${issue.key}`);
      const req = JSON.parse(String(body)) as {
        fields?: Record<string, unknown>;
        update?: Record<string, unknown>;
        properties?: Array<{ key: string; value: unknown }>;
      };
      if (!req.fields && !req.update) {
        return respond(400, { errorMessages: ["one of 'fields' or 'update' required"], errors: {} });
      }
      const custom = customFieldWrites(typeIdOf(issue), projectOf(issue).id, req.fields);
      if ('error' in custom) return custom.error;
      applyFieldValues(issue, custom.values);
      if (typeof req.fields?.summary === 'string') issue.summary = req.fields.summary;
      for (const p of req.properties ?? []) issue.properties[p.key] = p.value;
      const reading = req.fields?.[READING_FIELD_ID];
      if (typeof reading === 'string') {
        const changes = fixture.readingChanges.get(issue.id) ?? [];
        clock += 1000;
        changes.push({
          created: clock,
          to: reading,
          by: as === 'user' ? fixture.userView.accountId : MOCK_APP_ACCOUNT_ID,
        });
        fixture.readingChanges.set(issue.id, changes);
      }
      return respond(204);
    }

    if (method === 'POST' && path === '/rest/api/3/issue') {
      const req = JSON.parse(String(body)) as {
        fields: {
          summary: string;
          project?: { id?: string; key?: string };
          issuetype?: { id?: string; name?: string };
          [field: string]: unknown;
        };
        properties?: Array<{ key: string; value: unknown }>;
      };
      const ref = req.fields.project?.id ?? req.fields.project?.key ?? KPI_PROJECT.id;
      const entry = [...fixture.projects.entries()].find(([key, p]) => p.id === ref || key === ref);
      if (!entry) return respond(400, { errorMessages: [], errors: { project: 'valid project is required' } });
      const [projectKey, project] = entry;
      if (as === 'user' && !accessTo(projectKey).browse) {
        return respond(400, { errorMessages: [], errors: { project: 'valid project is required' } });
      }
      if (as === 'user' && !accessTo(projectKey).create) return forbidden('create issues in this project');
      // Like Jira, the work type must be in the space's scheme.
      const reqType = req.fields.issuetype;
      const type = fixture.issueTypes.find((t) => t.id === reqType?.id || (!reqType?.id && t.name === reqType?.name));
      if (!type || !project.issueTypeNames.includes(type.name) || project.style === 'next-gen') {
        return respond(400, { errorMessages: [], errors: { issuetype: 'Specify a valid issue type' } });
      }
      const custom = customFieldWrites(type.id, project.id, req.fields);
      if ('error' in custom) return custom.error;
      const id = String(nextIssueId++);
      const inProject = [...fixture.issues.values()].filter((i) => projectKeyOf(i) === projectKey).length;
      const key = projectKey === KPI_PROJECT.key ? `${KPI_PROJECT.key}-${fixture.kpiIds.length + 1}` : `${projectKey}-${inProject + 1}`;
      fixture.issues.set(id, {
        id,
        key,
        type: 'KPI',
        summary: req.fields.summary,
        parentId: null,
        due: null,
        start: null,
        kpiParentId: null,
        properties: Object.fromEntries((req.properties ?? []).map((p) => [p.key, p.value])),
      });
      applyFieldValues(fixture.issues.get(id)!, custom.values);
      fixture.kpiIds.push(id);
      return respond(201, { id, key });
    }

    if (method === 'POST' && path === '/rest/api/3/issueLink') {
      type End = { id?: string; key?: string };
      const req = JSON.parse(String(body)) as { type: { id?: string }; outwardIssue: End; inwardIssue: End };
      const ref = (end: End) => end.id ?? end.key ?? '';
      if (!fixture.linkTypes.some((t) => t.id === req.type?.id)) {
        return respond(404, { errorMessages: [`No issue link type with id '${req.type?.id}' found.`] });
      }
      const cfg = fixture.kvs.get('kpi:hierarchy') as { parentEnd?: string } | undefined;
      const parentOnOutward = cfg?.parentEnd === 'outward';
      const parent = findIssue(ref(parentOnOutward ? req.outwardIssue : req.inwardIssue));
      const child = findIssue(ref(parentOnOutward ? req.inwardIssue : req.outwardIssue));
      if (!parent || !child || !visible(parent, as) || !visible(child, as)) {
        return respond(404, { errorMessages: ['Issue does not exist'] });
      }
      if (!may(child, as, 'link')) return forbidden('link issues');
      // Like Jira, linking a KPI that already has a parent adds a second link.
      if (!child.kpiParentId) child.kpiParentId = parent.id;
      else if (child.kpiParentId !== parent.id && !child.extraKpiParentIds?.includes(parent.id)) {
        (child.extraKpiParentIds ??= []).push(parent.id);
      }
      return respond(201);
    }

    const linkById = /^\/rest\/api\/3\/issueLink\/([^/]+)$/.exec(path);
    if (linkById && method === 'DELETE') {
      const linkId = decodeURIComponent(linkById[1]);
      const owns = (i: FixtureIssue) =>
        (!!i.kpiParentId && parentLinkId(i, i.kpiParentId, true) === linkId) ||
        (i.extraKpiParentIds ?? []).some((p) => parentLinkId(i, p, false) === linkId);
      const child = [...fixture.issues.values()].find(owns);
      if (!child || !visible(child, as)) return respond(404, { errorMessages: ['No issue link with that id.'] });
      if (!may(child, as, 'link')) return forbidden('link issues');
      if (child.kpiParentId && parentLinkId(child, child.kpiParentId, true) === linkId) child.kpiParentId = null;
      else child.extraKpiParentIds = child.extraKpiParentIds!.filter((p) => parentLinkId(child, p, false) !== linkId);
      return respond(204);
    }

    if (method === 'GET' && path === '/rest/api/3/issueLinkType') {
      return respond(200, { issueLinkTypes: fixture.linkTypes });
    }

    if (method === 'POST' && path === '/rest/api/3/issueLinkType') {
      const req = JSON.parse(String(body)) as Omit<IssueLinkTypeInfo, 'id'>;
      const created = { id: String(10_600 + fixture.linkTypes.length), ...req };
      fixture.linkTypes.push(created);
      return respond(201, created);
    }

    if (single && method === 'DELETE') {
      const issue = findIssue(decodeURIComponent(single[1]));
      if (!issue || !visible(issue, as)) return notFound();
      // Delete Issues is admin-only in the default scheme; the app's rollback runs asApp.
      if (as === 'user' && !fixture.userView.isAdmin) return forbidden(`delete ${issue.key}`);
      fixture.issues.delete(issue.id);
      fixture.kpiIds = fixture.kpiIds.filter((id) => id !== issue.id);
      return respond(204);
    }

    if (method === 'PUT' && path === `/rest/api/3/app/field/${READING_FIELD_ID}/value`) {
      // Only the owning app may call the app custom field value API.
      if (as === 'user') return forbidden('update app custom field values');
      return respond(204);
    }

    // ── KPI-space provisioning (Settings) ──
    const project = /^\/rest\/api\/3\/project\/([^/]+)$/.exec(path);
    /** A space's type by name: a team-managed space's own type, else the site-wide one. */
    const typeNamed = (name: string, p: FixtureProject) =>
      fixture.issueTypes.find((t) => t.name === name && (p.style === 'next-gen' ? t.scope?.project.id === p.id : !t.scope)) ??
      fixture.issueTypes.find((t) => t.name === name && !t.scope);
    const projectJson = (key: string, p: FixtureProject) => ({
      id: p.id,
      key,
      name: p.name,
      style: p.style ?? 'classic',
      issueTypes: p.issueTypeNames.map((name) => ({ id: typeNamed(name, p)?.id, name })),
    });
    if (project && project[1] !== 'search' && method === 'GET') {
      const ref = decodeURIComponent(project[1]);
      const entry = [...fixture.projects.entries()].find(([key, p]) => key === ref || p.id === ref);
      if (!entry) return respond(404, { errorMessages: ['No project could be found.'] });
      return respond(200, projectJson(...entry));
    }
    if (method === 'GET' && path === '/rest/api/3/project/search') {
      const query = (params.get('query') ?? '').toLowerCase();
      const all = [...fixture.projects.entries()]
        .filter(([key, p]) => !query || key.toLowerCase().includes(query) || p.name.toLowerCase().includes(query))
        .filter(([key]) => as === 'app' || accessTo(key).browse)
        .sort(([a], [b]) => (params.get('orderBy') === 'key' ? (a < b ? -1 : a > b ? 1 : 0) : 0))
        .map(([key, p]) => projectJson(key, p));
      const startAt = Number(params.get('startAt') ?? 0);
      const max = Number(params.get('maxResults') ?? 50);
      return respond(200, { values: all.slice(startAt, startAt + max), isLast: startAt + max >= all.length });
    }
    if (method === 'POST' && path === '/rest/api/3/project') {
      const req = JSON.parse(String(body)) as { key: string; name: string };
      const id = String(20_000 + fixture.projects.size);
      fixture.projects.set(req.key, { id, name: req.name, issueTypeNames: [] });
      // Like a project made without a template: the shared field scheme, its own copy of the default screens.
      fixture.fieldSchemeOf.set(id, DEFAULT_FIELD_SCHEME_ID);
      fixture.screenSchemeOf.set(id, { id: `itss-${id}`, mappings: { default: DEFAULT_SCREEN_SCHEME_ID } });
      return respond(201, { id, key: req.key });
    }
    if (method === 'GET' && path === '/rest/api/3/issuetype') {
      return respond(200, fixture.issueTypes);
    }
    if (method === 'POST' && path === '/rest/api/3/issuetype') {
      const req = JSON.parse(String(body)) as { name: string };
      const created = { id: String(30_000 + fixture.issueTypes.length), name: req.name, hierarchyLevel: 0 };
      fixture.issueTypes.push(created);
      return respond(201, created);
    }
    if (method === 'GET' && path === '/rest/api/3/issuetypescheme/project') {
      const projectId = params.get('projectId');
      // One scheme per project in the mock; its id is the project id. Team-managed spaces have none.
      const teamManaged = [...fixture.projects.values()].some((p) => p.id === projectId && p.style === 'next-gen');
      return respond(200, { values: projectId && !teamManaged ? [{ issueTypeScheme: { id: projectId } }] : [] });
    }
    const scheme = /^\/rest\/api\/3\/issuetypescheme\/(\d+)\/issuetype$/.exec(path);
    if (scheme && method === 'PUT') {
      const p = [...fixture.projects.values()].find((x) => x.id === scheme[1]);
      if (!p) return respond(404, { errorMessages: ['No issue type scheme'] });
      const req = JSON.parse(String(body)) as { issueTypeIds: string[] };
      for (const id of req.issueTypeIds) {
        const t = fixture.issueTypes.find((x) => x.id === id);
        if (t && !p.issueTypeNames.includes(t.name)) p.issueTypeNames.push(t.name);
      }
      return respond(204);
    }

    const typeById = /^\/rest\/api\/3\/issuetype\/([^/]+)$/.exec(path);
    if (typeById && method === 'PUT') {
      const type = fixture.issueTypes.find((t) => t.id === typeById[1]);
      if (!type) return respond(404, { errorMessages: ['Issue type not found.'] });
      const req = JSON.parse(String(body)) as { avatarId?: number };
      if (req.avatarId !== undefined) {
        type.avatarId = req.avatarId;
        type.iconUrl = `${ICON_BASE}/${req.avatarId}?size=medium`;
      }
      return respond(200, type);
    }
    const avatarFor = /^\/rest\/api\/3\/universal_avatar\/type\/issuetype\/owner\/([^/]+)$/.exec(path);
    if (avatarFor && method === 'POST') {
      const contentType = headers['Content-Type'] ?? '';
      if (contentType !== 'image/png') return respond(400, { errorMessages: ['Not a supported image format.'] });
      const id = String(40_000 + fixture.avatars.length);
      fixture.avatars.push({ id, owner: avatarFor[1], contentType, size: (body as ArrayBuffer | undefined)?.byteLength ?? 0 });
      return respond(201, { id });
    }

    // ── Fields, field schemes and screens (spec 11 · 04) ──
    if (method === 'POST' && path === '/rest/api/3/field') {
      const req = JSON.parse(String(body)) as { name: string; type: string };
      const id = `customfield_${11_000 + fixture.customFields.length}`;
      fixture.customFields.push({ id, name: req.name, custom: req.type, ...(req.type === SELECT_FIELD_TYPE ? { options: [] } : {}) });
      return respond(201, { id, name: req.name });
    }
    const fieldContext = /^\/rest\/api\/3\/field\/([^/]+)\/context$/.exec(path);
    if (fieldContext && method === 'GET') {
      const i = fixture.customFields.findIndex((f) => f.id === fieldContext[1]);
      if (i < 0) return respond(404, { errorMessages: ['The custom field was not found.'] });
      return respond(200, { values: [{ id: String(20_000 + i), isGlobalContext: true, isAnyIssueType: true }], isLast: true });
    }
    const fieldOptions = /^\/rest\/api\/3\/field\/([^/]+)\/context\/([^/]+)\/option$/.exec(path);
    if (fieldOptions) {
      const i = fixture.customFields.findIndex((f) => f.id === fieldOptions[1]);
      const field = fixture.customFields[i];
      if (!field || fieldOptions[2] !== String(20_000 + i)) return respond(404, { errorMessages: ['Context not found.'] });
      if (!field.options) return respond(400, { errorMessages: ['This field has no options.'] });
      if (method === 'GET') return respond(200, { values: field.options, isLast: true });
      if (method === 'POST') {
        const req = JSON.parse(String(body)) as { options: Array<{ value: string }> };
        const added = req.options.map((o) => ({ id: String(nextOptionId++), value: o.value }));
        field.options.push(...added);
        return respond(200, { options: added });
      }
    }
    if (method === 'GET' && path === '/rest/api/3/config/fieldschemes/projects') {
      const values = params
        .getAll('projectId')
        .filter((id) => fixture.fieldSchemeOf.has(id))
        .map((id) => ({ projectId: Number(id), schemeId: Number(fixture.fieldSchemeOf.get(id)) }));
      return respond(200, { values, isLast: true });
    }
    const schemeFields = /^\/rest\/api\/3\/config\/fieldschemes\/([^/]+)\/fields$/.exec(path);
    if (schemeFields && method === 'GET') {
      const scheme = fixture.fieldSchemes.get(schemeFields[1]);
      if (!scheme) return respond(404, { errorMessages: ['Field scheme not found.'] });
      if (Number(params.get('maxResults') ?? 50) > 50) return respond(400, { errorMessages: ['maxResults must be ≤ 50.'] });
      const wanted = params.getAll('fieldId');
      const values = [...scheme.entries()]
        .filter(([fieldId]) => wanted.length === 0 || wanted.includes(fieldId))
        .map(([fieldId, types]) => ({ fieldId, ...(types.length > 0 ? { restrictedToWorkTypes: types } : {}) }));
      return respond(200, { values, isLast: true });
    }
    if (method === 'PUT' && path === '/rest/api/3/config/fieldschemes/fields') {
      const req = JSON.parse(String(body)) as Record<string, Array<{ schemeIds: number[]; restrictedToWorkTypes?: number[] }>>;
      const results: Array<{ fieldId: string; schemeId: number; success: boolean; workTypeIds: number[] }> = [];
      for (const [fieldId, items] of Object.entries(req)) {
        for (const item of items) {
          for (const schemeId of item.schemeIds) {
            const scheme = fixture.fieldSchemes.get(String(schemeId));
            scheme?.set(fieldId, (item.restrictedToWorkTypes ?? []).map(String));
            results.push({ fieldId, schemeId, success: !!scheme, workTypeIds: item.restrictedToWorkTypes ?? [] });
          }
        }
      }
      return respond(200, { results });
    }
    if (method === 'GET' && path === '/rest/api/3/issuetypescreenscheme/project') {
      const projectId = params.get('projectId') ?? '';
      const itss = fixture.screenSchemeOf.get(projectId);
      return respond(200, { values: itss ? [{ issueTypeScreenScheme: { id: itss.id }, projectIds: [projectId] }] : [], isLast: true });
    }
    if (method === 'GET' && path === '/rest/api/3/issuetypescreenscheme/mapping') {
      const itssId = params.get('issueTypeScreenSchemeId');
      const itss = [...fixture.screenSchemeOf.values()].find((x) => x.id === itssId);
      const values = Object.entries(itss?.mappings ?? {}).map(([issueTypeId, screenSchemeId]) => ({
        issueTypeScreenSchemeId: itssId,
        issueTypeId,
        screenSchemeId,
      }));
      return respond(200, { values, isLast: true });
    }
    if (method === 'GET' && path === '/rest/api/3/screenscheme') {
      const id = params.get('id') ?? '';
      const screens = fixture.screenSchemes.get(id);
      return respond(200, { values: screens ? [{ id: Number(id), screens }] : [], isLast: true });
    }
    const screenTabs = /^\/rest\/api\/3\/screens\/([^/]+)\/tabs$/.exec(path);
    if (screenTabs && method === 'GET') {
      const tabs = fixture.screens.get(screenTabs[1]);
      if (!tabs) return respond(404, { errorMessages: ['Screen not found.'] });
      return respond(200, tabs.map((t) => ({ id: t.id, name: t.name })));
    }
    const tabFields = /^\/rest\/api\/3\/screens\/([^/]+)\/tabs\/([^/]+)\/fields$/.exec(path);
    if (tabFields) {
      const tab = fixture.screens.get(tabFields[1])?.find((t) => String(t.id) === tabFields[2]);
      if (!tab) return respond(404, { errorMessages: ['Tab not found.'] });
      if (method === 'GET') return respond(200, tab.fields.map((id) => ({ id, name: id })));
      if (method === 'POST') {
        const { fieldId } = JSON.parse(String(body)) as { fieldId: string };
        const onScreen = fixture.screens.get(tabFields[1])!.some((t) => t.fields.includes(fieldId));
        if (onScreen) return respond(400, { errorMessages: [`Field ${fieldId} already exists on the screen.`] });
        tab.fields.push(fieldId);
        // Like Jira (seen live, spec 11 · 01 B9): putting a field on a screen
        // resets its field scheme entries to every work type.
        for (const scheme of fixture.fieldSchemes.values()) if (scheme.has(fieldId)) scheme.set(fieldId, []);
        return respond(200, { id: fieldId, name: fieldId });
      }
    }

    if (method === 'GET' && path.startsWith('/rest/api/2/universal_avatar/')) {
      return respond(200, {}, 'image/svg+xml');
    }

    unhandled.push(`${method} ${raw}`);
    return respond(404, { errorMessages: [`[mockJira] unhandled ${method} ${path}`] });
  };

  const mock: MockJira = {
    fixture,
    unhandled,
    writes,
    async requestJira(route, init, as = 'app') {
      if (fixture.options.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fixture.options.latencyMs));
      }
      const raw = typeof route === 'string' ? route : String((route as { value: string }).value);
      return handle((init?.method ?? 'GET').toUpperCase(), raw, init?.body, as, init?.headers);
    },
  };
  return mock;
}

/**
 * `@forge/api`'s default export for tests: `asUser()` / `asApp()` both route to
 * the mock Jira, tagged with the principal so user requests get Jira's
 * permission filtering. `onRequest` sees every route (e.g. to log them).
 */
export function mockForgeApi(
  getJira: () => MockJira,
  onRequest?: (route: unknown, as: MockPrincipal) => void,
): { asUser: () => { requestJira: MockJira['requestJira'] }; asApp: () => { requestJira: MockJira['requestJira'] } } {
  const requester = (as: MockPrincipal) => ({
    requestJira: (route: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      onRequest?.(route, as);
      return getJira().requestJira(route, init, as);
    },
  });
  return { asUser: () => requester('user'), asApp: () => requester('app') };
}

/** `@forge/api` stand-ins that build routes like the real module (query params URI-encoded). */
export const forgeRouteHelpers = {
  route: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    value: strings.reduce((acc, s, i) => {
      if (i >= values.length) return acc + s;
      const v = values[i];
      const isRoute = typeof v === 'object' && v !== null && 'value' in v;
      return acc + s + (isRoute ? String((v as { value: string }).value) : encodeURIComponent(String(v)));
    }, ''),
  }),
  routeFromAbsolute: (absolute: string) => {
    const u = new URL(absolute);
    return { value: `${u.pathname}${u.search}` };
  },
  assumeTrustedRoute: (path: string) => ({ value: path }),
  /** Outside Forge there is no app context (the real call throws too). */
  getAppContext: (): never => {
    throw new Error('getAppContext: not running in Forge');
  },
};
