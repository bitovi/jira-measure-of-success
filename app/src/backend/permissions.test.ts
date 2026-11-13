import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildScaleFixture, createMockJira, KPI_PROJECT, type MockJira, type MockPrincipal } from './testing/scaleFixture';

/**
 * The current user's permission lookups (spec 10): `fetchKpiSpaceAccess` and
 * `fetchIsJiraAdmin` must run as the USER, and a failed lookup must throw
 * `PermissionLookupError` rather than read as "no permission".
 */

const h = vi.hoisted(() => ({ jira: null as MockJira | null, calls: [] as Array<{ as: string; path: string }> }));

vi.mock('@forge/api', async () => {
  const { forgeRouteHelpers, mockForgeApi } = await import('./testing/scaleFixture');
  const api = mockForgeApi(
    () => h.jira!,
    (route, as: MockPrincipal) => h.calls.push({ as, path: String((route as { value: string }).value).split('?')[0] }),
  );
  return { default: api, ...forgeRouteHelpers };
});

import { fetchIsJiraAdmin, fetchKpiSpaceAccess, PermissionLookupError } from './jira';

const SMALL = { kpis: 3, initiatives: 1, epicsPerInitiative: 1, storiesPerEpic: 0, subtasksPerStory: 0 };

beforeEach(() => {
  h.jira = createMockJira(buildScaleFixture(SMALL));
  h.calls = [];
});

describe('fetchKpiSpaceAccess', () => {
  it('reports the user’s KPI-project permissions, asked as the user', async () => {
    h.jira!.fixture.userView.access[KPI_PROJECT.key] = { browse: true, create: false, edit: true, link: false };
    expect(await fetchKpiSpaceAccess(KPI_PROJECT.key)).toEqual({ browse: true, create: false, edit: true, link: false });
    expect(h.calls).toEqual([{ as: 'user', path: '/rest/api/3/mypermissions' }]);
  });

  it('throws PermissionLookupError when Jira refuses the lookup', async () => {
    h.jira!.intercept = (_method, path) => (path === '/rest/api/3/mypermissions' ? { status: 500 } : undefined);
    await expect(fetchKpiSpaceAccess(KPI_PROJECT.key)).rejects.toBeInstanceOf(PermissionLookupError);
  });

  it('throws PermissionLookupError when the lookup throws', async () => {
    h.jira!.requestJira = () => Promise.reject(new Error('network'));
    await expect(fetchKpiSpaceAccess(KPI_PROJECT.key)).rejects.toBeInstanceOf(PermissionLookupError);
  });
});

describe('fetchIsJiraAdmin', () => {
  it('is true for a Jira admin, asked as the user', async () => {
    expect(await fetchIsJiraAdmin()).toBe(true);
    expect(h.calls).toEqual([{ as: 'user', path: '/rest/api/3/mypermissions' }]);
  });

  it('is false for a non-admin', async () => {
    h.jira!.fixture.userView.isAdmin = false;
    expect(await fetchIsJiraAdmin()).toBe(false);
  });

  it('throws PermissionLookupError when the lookup fails', async () => {
    h.jira!.intercept = () => ({ status: 401 });
    await expect(fetchIsJiraAdmin()).rejects.toBeInstanceOf(PermissionLookupError);
  });
});
