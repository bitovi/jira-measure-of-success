import {
  getPanelData,
  getPanelList,
  getPanelValues,
  saveAssignment,
  removeAssignment,
  getHierarchyLevels,
  getRollupConfig,
  getDateFields,
  saveRollupConfig,
  getKpiSpace,
  saveKpiSpaceKey,
  createKpiSpace,
  getKpiHierarchy,
  saveKpiHierarchy,
  createKpiHierarchyLinkType,
  getTimelineData,
  getTimelineSkeleton,
  getTimelineTargets,
  recordValue,
  createKpi,
  kpiEditTouches,
  updateKpi,
  searchIssues,
  addTarget,
  getMigrations,
  runMigrationBatch,
  retryMigration,
  kpiKeyOf,
  kpiSetup,
  spaceOfKey,
} from './fixtures/mock-resolvers.js';
import { KPI_SPACES } from './fixtures/hierarchy.js';
import {
  accessMode,
  applyAccessToPanelList,
  applyAccessToPanelParts,
  applyAccessToPanelValues,
  applyAccessToTimeline,
  assertKpiWriteAllowed,
  kpiAccessResult,
} from './access-modes.js';

/**
 * Mock `@forge/bridge` — Vite aliases `@forge/bridge` to this module in the
 * harness build (see vite.config.ts). The SAME Custom UI components import
 * `@forge/bridge`; locally they hit these fixtures, in Jira they hit the real
 * runtime. The two seams we mock are `invoke` (our resolver) and `requestJira`
 * (Jira's REST API).
 */
type Handler = (payload: any) => unknown;

/**
 * `?access=none|readonly|split|lookupFails|hiddenKpi` (spec 10, per space since
 * spec 11 · 06): answer as the backend would for a user with limited
 * permissions — see access-modes.ts. `hiddenKpi`
 * hides the first KPI targeted on the default panel issue (10048), picked once
 * at load so removing that target doesn't hide a different KPI.
 */
const HIDDEN_KPI_ID: string | null = accessMode() === 'hiddenKpi' ? (getPanelList('10048').basis?.own[0]?.kpiId ?? null) : null;
const hiddenKpiId = (): string | null => HIDDEN_KPI_ID;
/** A KPI's space, for permission messages (spec 11 · 06). */
const kpiSpace = (kpiId: string | null | undefined) => spaceOfKey(kpiKeyOf(kpiId) ?? 'KPI');

const resolvers: Record<string, Handler> = {
  // Issue panel
  getPanelData: (p) => getPanelData(p?.issueId ?? '10048'),
  getPanelList: (p) => applyAccessToPanelList(getPanelList(p?.issueId ?? '10048'), accessMode(), hiddenKpiId()),
  // `?valuesDelayMs=3000` slows Phase 2 so the progressive load is visible in
  // the harness (estimates shimmer first); `?valuesFail=1` makes it reject.
  getPanelValues: async (p) => {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const delay = Number(params.get('valuesDelayMs') ?? 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (params.get('valuesFail') === '1') throw new Error('Simulated Phase 2 failure');
    return applyAccessToPanelValues(getPanelValues(p?.issueId ?? '10048'), accessMode(), hiddenKpiId());
  },
  saveAssignment: (p) => {
    assertKpiWriteAllowed('target', accessMode(), p?.assignment?.kpiId ?? null, hiddenKpiId());
    return applyAccessToPanelParts(saveAssignment(p?.issueId, p?.assignment), accessMode(), hiddenKpiId());
  },
  removeAssignment: (p) =>
    applyAccessToPanelParts(removeAssignment(p?.issueId, p?.kpiId), accessMode(), hiddenKpiId()),
  // Settings
  getHierarchyLevels: () => getHierarchyLevels(),
  getRollupConfig: () => getRollupConfig(),
  getDateFields: () => getDateFields(),
  saveRollupConfig: (p) => saveRollupConfig(p?.config),
  getKpiSpace: () => getKpiSpace(),
  saveKpiSpaceKey: (p) => saveKpiSpaceKey(p?.key),
  createKpiSpace: (p) => createKpiSpace(p?.key),
  getKpiHierarchy: () => getKpiHierarchy(),
  saveKpiHierarchy: (p) => saveKpiHierarchy(p),
  createKpiHierarchyLinkType: () => createKpiHierarchyLinkType(),
  // KPI building blocks (spec 11 · 04). `?setup=fresh|upgraded|blocks|configured|broken`
  // picks the site; writes take `?mutationDelayMs=` and fail with `?mutationFail=1`.
  getKpiSetup: () => kpiSetup.getKpiSetup(),
  getKpiWorkTypeChoices: () => kpiSetup.getKpiWorkTypeChoices(),
  getKpiFieldChoices: () => kpiSetup.getKpiFieldChoices(),
  getKpiFieldOptions: (p) => kpiSetup.getKpiFieldOptions(p?.fieldId),
  getKpiSpaceChoices: () => kpiSetup.getKpiSpaceChoices(),
  getKpiSpaceSetup: (p) => kpiSetup.getKpiSpaceSetup(p?.projectId),
  setUpKpiWorkType: async (p) => {
    await simulateMutation();
    return kpiSetup.setUpKpiWorkType(p);
  },
  setUpKpiFields: async (p) => {
    await simulateMutation();
    return kpiSetup.setUpKpiFields(p);
  },
  setUpCentralSpace: async (p) => {
    await simulateMutation();
    return kpiSetup.setUpCentralSpace(p);
  },
  setUpKpiSpaceStep: async (p) => {
    await simulateMutation();
    return kpiSetup.setUpKpiSpaceStep(p);
  },
  setUpEverything: async (p) => {
    await simulateMutation();
    return kpiSetup.setUpEverything(p);
  },
  // Data migrations (spec 11 · 02). `?migrations=pending|running|done|failed`
  // picks the starting state; each batch takes `?migrationDelayMs=` (default 800).
  getMigrations: () => getMigrations(),
  runMigrationBatch: async (p) => {
    await migrationDelay();
    return runMigrationBatch(p?.id);
  },
  retryMigration: (p) => retryMigration(p?.id),
  // Timeline
  getTimelineData: () => applyAccessToTimeline(getTimelineData(), accessMode(), hiddenKpiId()),
  getTimelineSkeleton: () => applyAccessToTimeline(getTimelineSkeleton(), accessMode(), hiddenKpiId()),
  // `?targetsDelayMs=3000` slows Phase 2 so the progressive load is visible in
  // the harness (rows shimmer first); `?targetsFail=1` makes it reject.
  getTimelineTargets: async () => {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const delay = Number(params.get('targetsDelayMs') ?? 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (params.get('targetsFail') === '1') throw new Error('Simulated Phase 2 failure');
    return getTimelineTargets();
  },
  recordValue: async (p) => {
    await simulateMutation();
    assertKpiWriteAllowed('record', accessMode(), p?.kpiId ?? null, hiddenKpiId(), kpiKeyOf(p?.kpiId), kpiSpace(p?.kpiId));
    return recordValue(p?.kpiId, p?.date, p?.value);
  },
  // Spec 11 · 06: one space's permissions, asked when an action needs them.
  getKpiAccess: async (p) => {
    await simulateAccessLookup();
    return kpiAccessResult(String(p?.projectKey ?? ''), accessMode());
  },
  // `?mutationDelayMs=3000` slows the modal saves (createKpi / updateKpi / addTarget /
  // recordValue) so the saving state is visible; `?mutationFail=1` makes them
  // reject (error shown in the modal).
  createKpi: async (p) => {
    await simulateMutation();
    const space = Object.values(KPI_SPACES).find((sp) => sp.id === p?.projectId);
    assertKpiWriteAllowed('add', accessMode(), null, null, null, space);
    if (p?.parentKpiId) assertKpiWriteAllowed('nest', accessMode(), null, null, null, space);
    return createKpi(p);
  },
  searchIssues: (p) => searchIssues(p?.query ?? ''),
  updateKpi: async (p) => {
    await simulateMutation();
    const touches = kpiEditTouches(p);
    if (touches.definition) {
      assertKpiWriteAllowed('edit', accessMode(), p?.kpiId ?? null, hiddenKpiId(), kpiKeyOf(p?.kpiId), kpiSpace(p?.kpiId));
    }
    if (touches.parent) {
      assertKpiWriteAllowed('nest', accessMode(), p?.kpiId ?? null, hiddenKpiId(), kpiKeyOf(p?.kpiId), kpiSpace(p?.kpiId));
    }
    return updateKpi(p);
  },
  addTarget: async (p) => {
    await simulateMutation();
    assertKpiWriteAllowed('target', accessMode(), p?.kpiId ?? null, hiddenKpiId());
    return addTarget(p);
  },
};

async function simulateMutation(): Promise<void> {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const delay = Number(params.get('mutationDelayMs') ?? 0);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (params.get('mutationFail') === '1') throw new Error('Simulated save failure');
}

/** `?accessDelayMs=1500` slows `getKpiAccess` so the busy state is visible. */
async function simulateAccessLookup(): Promise<void> {
  const delay = Number(new URLSearchParams(globalThis.location?.search ?? '').get('accessDelayMs') ?? 300);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

async function migrationDelay(): Promise<void> {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const delay = Number(params.get('migrationDelayMs') ?? 800);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function invoke<T = unknown>(key: string, payload?: unknown): Promise<T> {
  const handler = resolvers[key];
  if (!handler) throw new Error(`[mock-bridge] no resolver registered for "${key}"`);
  // simulate async round-trip
  await Promise.resolve();
  return handler(payload) as T;
}

export async function requestJira(route: string): Promise<Response> {
  // Minimal stub — extend per surface as needed.
  return new Response(JSON.stringify({ mock: true, route }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export const view = {
  getContext: async () => ({
    extension: { issue: { id: '10048', key: 'INIT-48' } },
    siteUrl: 'https://example.atlassian.net',
    localId:
      'ari:cloud:ecosystem::extension/f92bb5d3-136d-4f6d-9245-fc31f4e8fdec/69a5cdec-507a-4dbe-a84f-0f37b35c1e3e/static/kpi-timeline-page',
  }),
  theme: { enable: async () => {} },
};

export const router = {
  open: (url: unknown) => console.info('[mock-bridge] open', url),
  navigate: async (url: unknown) => console.info('[mock-bridge] navigate', url),
};
export const showFlag = (opts: unknown) => console.info('[mock-bridge] flag', opts);
