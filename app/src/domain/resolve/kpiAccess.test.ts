import { describe, it, expect } from 'vitest';
import { kpiActionBlockedReason, kpiNotVisibleMessage, kpiPermissionMessage, NO_KPIS_MESSAGE } from './kpiAccess';

describe('kpiPermissionMessage', () => {
  it("names the action, the Jira permission, the KPI's space, and who can fix it", () => {
    expect(kpiPermissionMessage('add', 'Portfolio')).toBe(
      'Adding a KPI needs Create Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('record', 'Portfolio', 'PORT-3')).toBe(
      'Recording a value on PORT-3 needs Edit Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('view', 'KPIs (KPI)', 'KPI-7')).toBe(
      'Viewing KPI-7 needs Browse Projects permission on the KPIs (KPI) space. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('edit', 'Portfolio', 'PORT-3')).toBe(
      'Editing PORT-3 needs Edit Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('nest', 'Portfolio')).toBe(
      'Nesting a KPI under another needs Link Issues permission on the Portfolio space. Ask a Jira admin.',
    );
  });

  it("falls back to the KPI's space when its name isn't known, never \"the KPI space\"", () => {
    expect(kpiPermissionMessage('add')).toBe(
      "Adding a KPI needs Create Issues permission on the KPI's space. Ask a Jira admin.",
    );
    expect(kpiPermissionMessage('edit')).not.toMatch(/KPI space/);
  });
});

describe('kpiActionBlockedReason', () => {
  const readOnly = { browse: true, create: false, edit: false, link: false };
  it('is null when the access is unknown or allows the action', () => {
    expect(kpiActionBlockedReason('record', null)).toBeNull();
    expect(kpiActionBlockedReason('record', undefined)).toBeNull();
    expect(kpiActionBlockedReason('record', { ...readOnly, edit: true })).toBeNull();
  });

  it('maps each action to its permission and names the space', () => {
    expect(kpiActionBlockedReason('record', readOnly, 'Portfolio', 'PORT-1')).toBe(
      kpiPermissionMessage('record', 'Portfolio', 'PORT-1'),
    );
    expect(kpiActionBlockedReason('edit', readOnly, 'Portfolio')).toMatch(/Edit Issues/);
    expect(kpiActionBlockedReason('add', readOnly, 'Portfolio')).toMatch(/Create Issues/);
    expect(kpiActionBlockedReason('nest', readOnly, 'Portfolio')).toMatch(/Link Issues/);
  });
});

describe('NO_KPIS_MESSAGE', () => {
  it('covers "none yet" and "none you can see" without naming a space', () => {
    expect(NO_KPIS_MESSAGE).toBe("No KPIs to show. There may be none yet, or they're in spaces you can't access.");
  });
});

describe('kpiNotVisibleMessage', () => {
  it('covers both "deleted" and "no permission" (Jira answers 404 for both)', () => {
    expect(kpiNotVisibleMessage('KPI-7', 'KPIs (KPI)')).toBe(
      "KPI-7 doesn't exist, or you don't have permission to view it. Viewing KPIs needs Browse Projects permission on the KPIs (KPI) space. Ask a Jira admin.",
    );
    expect(kpiNotVisibleMessage('KPI-7')).toMatch(/on the KPI's space\./);
  });

  it('says "This KPI" for an issue id, whose key isn\'t known', () => {
    expect(kpiNotVisibleMessage('10234')).toMatch(/^This KPI doesn't exist, or you don't have permission/);
  });
});
