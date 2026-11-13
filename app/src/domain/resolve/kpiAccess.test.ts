import { describe, it, expect } from 'vitest';
import { kpiNotVisibleMessage, kpiPermissionMessage, kpiSpaceNoAccessMessage } from './kpiAccess';

describe('kpiPermissionMessage', () => {
  it('names the action, the Jira permission, the project, and who can fix it', () => {
    expect(kpiPermissionMessage('add', 'KPIs (KPI)')).toBe(
      'Adding a KPI needs Create Issues permission on the KPIs (KPI) project. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('record', 'KPIs (KPI)', 'KPI-3')).toBe(
      'Recording a value on KPI-3 needs Edit Issues permission on the KPIs (KPI) project. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('view', 'KPIs (KPI)', 'KPI-7')).toBe(
      'Viewing KPI-7 needs Browse Projects permission on the KPIs (KPI) project. Ask a Jira admin.',
    );
    expect(kpiPermissionMessage('nest', 'KPIs (KPI)')).toBe(
      'Nesting a KPI under another needs Link Issues permission on the KPIs (KPI) project. Ask a Jira admin.',
    );
  });

  it('falls back to a generic project name', () => {
    expect(kpiPermissionMessage('add')).toBe(
      'Adding a KPI needs Create Issues permission on the KPI space project. Ask a Jira admin.',
    );
  });
});

describe('kpiSpaceNoAccessMessage', () => {
  it('says the space is off-limits and what to ask for', () => {
    expect(kpiSpaceNoAccessMessage('KPI')).toBe(
      "You don't have permission to view the KPI space (KPI). Ask a Jira admin for Browse Projects permission on that project.",
    );
    expect(kpiSpaceNoAccessMessage()).toMatch(/^You don't have permission to view the KPI space\. /);
  });
});

describe('kpiNotVisibleMessage', () => {
  it('covers both "deleted" and "no permission" (Jira answers 404 for both)', () => {
    expect(kpiNotVisibleMessage('KPI-7', 'KPIs (KPI)')).toBe(
      "KPI-7 doesn't exist, or you don't have permission to view it. Viewing KPIs needs Browse Projects permission on the KPIs (KPI) project. Ask a Jira admin.",
    );
  });
});
