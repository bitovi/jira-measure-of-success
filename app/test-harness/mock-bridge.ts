import {
  getPanelData,
  saveAssignment,
  removeAssignment,
  getHierarchyLevels,
  getRollupConfig,
  saveRollupConfig,
  getKpiSpace,
  saveKpiSpaceKey,
  createKpiSpace,
  getTimelineData,
  recordValue,
  createKpi,
} from './fixtures/mock-resolvers.js';

/**
 * Mock `@forge/bridge` — Vite aliases `@forge/bridge` to this module in the
 * harness build (see vite.config.ts). The SAME Custom UI components import
 * `@forge/bridge`; locally they hit these fixtures, in Jira they hit the real
 * runtime. The two seams we mock are `invoke` (our resolver) and `requestJira`
 * (Jira's REST API).
 */
type Handler = (payload: any) => unknown;

const resolvers: Record<string, Handler> = {
  // Issue panel
  getPanelData: (p) => getPanelData(p?.issueId ?? '10048'),
  saveAssignment: (p) => saveAssignment(p?.issueId, p?.assignment),
  removeAssignment: (p) => removeAssignment(p?.issueId, p?.kpiId),
  // Settings
  getHierarchyLevels: () => getHierarchyLevels(),
  getRollupConfig: () => getRollupConfig(),
  saveRollupConfig: (p) => saveRollupConfig(p?.config),
  getKpiSpace: () => getKpiSpace(),
  saveKpiSpaceKey: (p) => saveKpiSpaceKey(p?.key),
  createKpiSpace: (p) => createKpiSpace(p?.key),
  // Timeline
  getTimelineData: () => getTimelineData(),
  recordValue: (p) => recordValue(p?.kpiId, p?.date, p?.value),
  createKpi: (p) => createKpi(p),
};

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
    localId: 'harness',
  }),
  theme: { enable: async () => {} },
};

export const router = { open: (url: string) => console.info('[mock-bridge] open', url) };
export const showFlag = (opts: unknown) => console.info('[mock-bridge] flag', opts);
