import {
  kpiNotVisibleMessage,
  kpiPermissionMessage,
  type KpiSpaceAccess,
  type PanelListData,
  type PanelValuesData,
  type TimelineData,
  type TimelineNodeDto,
} from '@domain/index.js';

/**
 * Harness `?access=` modes (spec 10) — what the real backend returns for a user
 * with limited KPI-space permissions, layered over the normal fixtures:
 * - `none`: no Browse on the KPI project — no KPIs, no readings, every targeted
 *   KPI is "no permission", and KPI writes are refused;
 * - `readonly`: Browse only — everything shows, Add KPI / nesting / recording are refused;
 * - `hiddenKpi`: full access, but one targeted KPI is hidden by issue security.
 * Without the param (or any other value) nothing changes.
 */
export type AccessMode = 'none' | 'readonly' | 'hiddenKpi';

const ACCESS: Record<AccessMode, KpiSpaceAccess> = {
  none: { browse: false, create: false, edit: false, link: false },
  readonly: { browse: true, create: false, edit: false, link: false },
  hiddenKpi: { browse: true, create: true, edit: true, link: true },
};

export function accessMode(search: string = globalThis.location?.search ?? ''): AccessMode | null {
  const mode = new URLSearchParams(search).get('access');
  return mode === 'none' || mode === 'readonly' || mode === 'hiddenKpi' ? mode : null;
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
  if (mode === 'none') return { today: data.today, roots: [], access: ACCESS.none };
  const roots = mode === 'hiddenKpi' && hiddenKpiId ? withoutKpi(data.roots, hiddenKpiId) : data.roots;
  return { ...data, roots, access: ACCESS[mode] };
}

export function applyAccessToPanelList(
  data: PanelListData,
  mode: AccessMode | null,
  hiddenKpiId: string | null,
): PanelListData {
  if (!mode) return data;
  if (data.panel) return { panel: { ...data.panel, access: ACCESS[mode] } };
  const basis = data.basis;
  const targeted = [...new Set([...basis.own.map((a) => a.kpiId), ...basis.parentKpiIds])];
  const hidden =
    mode === 'none' ? targeted : mode === 'hiddenKpi' && hiddenKpiId ? targeted.filter((k) => k === hiddenKpiId) : [];
  const catalog = mode === 'none' ? [] : basis.catalog.filter((c) => !hidden.includes(c.id));
  return {
    basis: {
      ...basis,
      catalog,
      ...(hidden.length ? { noAccessKpiIds: hidden } : {}),
      access: ACCESS[mode],
    },
  };
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

/** Throw what the real backend throws for a KPI write this mode forbids; otherwise return. */
export function assertKpiWriteAllowed(
  action: 'add' | 'nest' | 'record' | 'target',
  mode: AccessMode | null,
  kpiId: string | null,
  hiddenKpiId: string | null,
): void {
  if (!mode) return;
  const access = ACCESS[mode];
  const hidden = mode === 'none' || (mode === 'hiddenKpi' && kpiId !== null && kpiId === hiddenKpiId);
  if ((action === 'record' || action === 'target') && hidden && kpiId) throw new Error(kpiNotVisibleMessage(kpiId));
  if (action === 'add' && !access.create) throw new Error(kpiPermissionMessage('add'));
  if (action === 'nest' && !access.link) throw new Error(kpiPermissionMessage('nest'));
  if (action === 'record' && !access.edit) throw new Error(kpiPermissionMessage('record', undefined, kpiId ?? undefined));
}
