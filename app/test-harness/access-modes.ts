import {
  kpiNotVisibleMessage,
  kpiPermissionMessage,
  type KpiAccessResult,
  type KpiOptionDto,
  type KpiRefLookup,
  type KpiSpaceAccess,
  type KpiSuggestionsDto,
  type SearchKpisResult,
  type PanelListData,
  type PanelParts,
  type PanelValuesData,
  type TimelineData,
  type TimelineNodeDto,
} from '@domain/index.js';

/**
 * Harness `?access=` modes (spec 10; per KPI space since spec 11 · 06) — what
 * the real backend returns for a user with limited permissions, layered over
 * the normal fixtures. Loads carry no access: the UI asks `getKpiAccess` for a
 * KPI's space when one of its actions is used (`accessFor`).
 * - `none`: no Browse in any KPI space — no KPIs, no readings, every targeted
 *   KPI is "no permission", and KPI writes are refused;
 * - `readonly`: Browse only, in every space — Add KPI / editing / nesting /
 *   recording are refused;
 * - `split`: full access in the central KPI space, Browse only in the others
 *   (Operations, Finance): recording on an Operations KPI is refused, naming it;
 * - `lookupFails`: Jira can't answer the permission lookup — actions go ahead;
 * - `hiddenKpi`: full access, but one targeted KPI is hidden by issue security.
 * Without the param (or any other value) nothing changes.
 */
export type AccessMode = 'none' | 'readonly' | 'split' | 'lookupFails' | 'hiddenKpi';

const FULL: KpiSpaceAccess = { browse: true, create: true, edit: true, link: true };
const READ_ONLY: KpiSpaceAccess = { browse: true, create: false, edit: false, link: false };
const NONE: KpiSpaceAccess = { browse: false, create: false, edit: false, link: false };
const CENTRAL_KEY = 'KPI';

export function accessMode(search: string = globalThis.location?.search ?? ''): AccessMode | null {
  const mode = new URLSearchParams(search).get('access');
  return mode === 'none' || mode === 'readonly' || mode === 'split' || mode === 'lookupFails' || mode === 'hiddenKpi'
    ? mode
    : null;
}

/** The user's access in one space under `mode`; null = Jira couldn't answer. */
export function accessFor(projectKey: string, mode: AccessMode | null): KpiSpaceAccess | null {
  if (mode === 'none') return NONE;
  if (mode === 'readonly') return READ_ONLY;
  if (mode === 'split') return projectKey === CENTRAL_KEY ? FULL : READ_ONLY;
  if (mode === 'lookupFails') return null;
  return FULL;
}

/** What `getKpiAccess` answers. */
export function kpiAccessResult(projectKey: string, mode: AccessMode | null): KpiAccessResult {
  return { projectKey, access: accessFor(projectKey, mode) };
}

/** Remove the node for `kpiId`, lifting its children into its place (as the real search would). */
function withoutKpi(nodes: TimelineNodeDto[], kpiId: string, depthShift = 0): TimelineNodeDto[] {
  return nodes.flatMap((n) => {
    if (n.kpiId === kpiId) return withoutKpi(n.children, kpiId, depthShift - 1);
    return [{ ...n, depth: n.depth + depthShift, children: withoutKpi(n.children, kpiId, depthShift) }];
  });
}

export function applyAccessToTimeline(data: TimelineData, mode: AccessMode | null, hiddenKpiId: string | null): TimelineData {
  if (!mode) return data;
  if (mode === 'none') return { ...data, roots: [] };
  const roots = mode === 'hiddenKpi' && hiddenKpiId ? withoutKpi(data.roots, hiddenKpiId) : data.roots;
  return { ...data, roots };
}

/** Jira's answer for an issue the user can't see (the same 404 as "doesn't exist"). */
const ISSUE_NOT_VISIBLE = 'Issue does not exist or you do not have permission to see it.';

export function applyAccessToPanelList(
  data: PanelListData,
  mode: AccessMode | null,
  hiddenKpiId: string | null,
): PanelListData {
  if (!mode) return data;
  const hiddenId = mode === 'hiddenKpi' ? hiddenKpiId : null;
  if (data.panel) {
    // A KPI issue's own panel: without Browse (or with this KPI hidden) Jira
    // wouldn't open the issue at all. Otherwise it carries its space's access.
    const kpiView = data.panel.kpiView;
    if (mode === 'none' || (hiddenId && kpiView?.node.kpiId === hiddenId)) throw new Error(ISSUE_NOT_VISIBLE);
    const access = kpiView?.node.space ? accessFor(kpiView.node.space.key, mode) : null;
    const { access: _previous, ...panel } = data.panel;
    void _previous;
    return { panel: { ...panel, ...(access ? { access } : {}) } };
  }
  const basis = data.basis;
  const targeted = [...new Set([...basis.own.map((a) => a.kpiId), ...basis.parentKpiIds])];
  // The real search never returns a hidden KPI, so it's in no list; only targets
  // on this issue (or its parent) are flagged "no permission".
  const hidden = mode === 'none' ? targeted : targeted.filter((k) => k === hiddenId);
  const kpis = mode === 'none' ? [] : basis.kpis.filter((c) => c.id !== hiddenId);
  // The backend's app lookup still finds a hidden KPI's key, for its label.
  const kpiKeys = Object.fromEntries(
    hidden.flatMap((id) => {
      const key = basis.kpis.find((c) => c.id === id)?.key;
      return key ? [[id, key]] : [];
    }),
  );
  const shown = (o: KpiOptionDto) => mode !== 'none' && o.id !== hiddenId;
  return {
    basis: {
      ...basis,
      kpis,
      ...(basis.picker ? { picker: filterSuggestions(basis.picker, shown) } : {}),
      ...(hidden.length ? { noAccessKpiIds: hidden } : {}),
      ...(Object.keys(kpiKeys).length ? { kpiKeys: { ...basis.kpiKeys, ...kpiKeys } } : {}),
    },
  };
}

/** The KPI browser's opening views without the KPIs `shown` rejects. */
function filterSuggestions(s: KpiSuggestionsDto, shown: (o: KpiOptionDto) => boolean): KpiSuggestionsDto {
  return {
    ...s,
    trackedByParents: s.trackedByParents
      .map((b) => ({
        ...b,
        targets: b.targets.filter((t) => shown(t.option)).map((t) => ({ ...t, subKpis: t.subKpis.filter(shown) })),
      }))
      .filter((b) => b.targets.length > 0),
    inThisSpace: s.inThisSpace.filter(shown),
  };
}

/** A picker list (a space, a search) as the backend answers this mode. */
export function applyAccessToOptions(options: KpiOptionDto[], mode: AccessMode | null, hiddenKpiId: string | null): KpiOptionDto[] {
  if (mode === 'none') return [];
  return mode === 'hiddenKpi' && hiddenKpiId ? options.filter((o) => o.id !== hiddenKpiId) : options;
}

export function applyAccessToSearch(result: SearchKpisResult, mode: AccessMode | null, hiddenKpiId: string | null): SearchKpisResult {
  return { ...result, kpis: applyAccessToOptions(result.kpis, mode, hiddenKpiId) };
}

/** A pasted key's lookup: a KPI the user may not see is "hidden" (Jira doesn't say which). */
export function applyAccessToLookup(result: KpiRefLookup, mode: AccessMode | null, hiddenKpiId: string | null): KpiRefLookup {
  if (result.kind !== 'kpi') return result;
  return applyAccessToOptions([result.option], mode, hiddenKpiId).length ? result : { kind: 'hidden' };
}

export function applyAccessToPanelValues(data: PanelValuesData, mode: AccessMode | null, hiddenKpiId: string | null): PanelValuesData {
  if (mode === 'none') return { ...data, readings: {} };
  if (mode === 'hiddenKpi' && hiddenKpiId) {
    const readings = { ...data.readings };
    delete readings[hiddenKpiId];
    return { ...data, readings };
  }
  return data;
}

/** A save/remove response (both panel phases), filtered the same way as the initial load. */
export function applyAccessToPanelParts(parts: PanelParts, mode: AccessMode | null, hiddenKpiId: string | null): PanelParts {
  return {
    list: applyAccessToPanelList(parts.list, mode, hiddenKpiId),
    values: applyAccessToPanelValues(parts.values, mode, hiddenKpiId),
  };
}

/**
 * Throw what the real backend throws for a KPI write this mode forbids in
 * `space` (the KPI's own space, or for `add` the new KPI's); otherwise return.
 * `kpiId` is the KPI's issue id; `kpiKey` names it in permission messages.
 */
export function assertKpiWriteAllowed(
  action: 'add' | 'nest' | 'record' | 'edit' | 'target',
  mode: AccessMode | null,
  kpiId: string | null,
  hiddenKpiId: string | null,
  kpiKey: string | null = kpiId,
  space: { key: string; name: string } = { key: CENTRAL_KEY, name: 'KPIs' },
): void {
  if (!mode) return;
  const hidden = mode === 'none' || (mode === 'hiddenKpi' && kpiId !== null && kpiId === hiddenKpiId);
  if ((action === 'record' || action === 'edit' || action === 'nest' || action === 'target') && hidden && kpiId) {
    throw new Error(kpiNotVisibleMessage(kpiId));
  }
  const access = accessFor(space.key, mode);
  if (!access) return;
  if (action === 'add' && !access.create) throw new Error(kpiPermissionMessage('add', space.name));
  if (action === 'nest' && !access.link) throw new Error(kpiPermissionMessage('nest', space.name));
  if (action === 'record' && !access.edit) throw new Error(kpiPermissionMessage('record', space.name, kpiKey ?? undefined));
  if (action === 'edit' && !access.edit) throw new Error(kpiPermissionMessage('edit', space.name, kpiKey ?? undefined));
}
