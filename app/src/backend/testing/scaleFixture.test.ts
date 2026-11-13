import { describe, it, expect } from 'vitest';
import {
  buildScaleFixture,
  createMockJira,
  forgeRouteHelpers,
  KPI_PROJECT,
  MOCK_APP_ACCOUNT_ID,
  MOCK_USER_ACCOUNT_ID,
  READING_FIELD_ID,
  type MockJira,
} from './scaleFixture';

const SMALL = { kpis: 5, initiatives: 1, epicsPerInitiative: 2, storiesPerEpic: 1, subtasksPerStory: 0 };
const KPI_1 = '1000';
const { route } = forgeRouteHelpers;

function setup(): MockJira {
  return createMockJira(buildScaleFixture(SMALL));
}

const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });

describe('mock Jira user view (spec 10)', () => {
  it('hides an issue from the user but not from the app', async () => {
    const jira = setup();
    jira.fixture.userView.hidden.add(KPI_1);
    expect((await jira.requestJira(route`/rest/api/3/issue/${KPI_1}`, undefined, 'user')).status).toBe(404);
    expect((await jira.requestJira(route`/rest/api/3/issue/${KPI_1}`, undefined, 'app')).status).toBe(200);
  });

  it('leaves hidden issues out of the user search and the changelog bulk fetch', async () => {
    const jira = setup();
    jira.fixture.userView.hidden.add(KPI_1);
    const search = await jira.requestJira(route`/rest/api/3/search/jql?jql=project=KPI&maxResults=100`, undefined, 'user');
    const ids = ((await search.json()) as { issues: Array<{ id: string }> }).issues.map((i) => i.id);
    expect(ids).not.toContain(KPI_1);
    expect(ids).toHaveLength(4);

    const bulk = await jira.requestJira(
      route`/rest/api/3/changelog/bulkfetch`,
      { method: 'POST', body: JSON.stringify({ issueIdsOrKeys: [KPI_1, '1001'] }) },
      'user',
    );
    const logs = ((await bulk.json()) as { issueChangeLogs: Array<{ issueId: string }> }).issueChangeLogs;
    expect(logs.map((l) => l.issueId)).toEqual(['1001']);
  });

  it('rejects JQL naming a project the user cannot browse', async () => {
    const jira = setup();
    jira.fixture.userView.access[KPI_PROJECT.key] = { browse: false, create: false, edit: false, link: false };
    const res = await jira.requestJira(route`/rest/api/3/search/jql?jql=project=KPI`, undefined, 'user');
    expect(res.status).toBe(400);
  });

  it('answers mypermissions from the user view (project, issue and global)', async () => {
    const jira = setup();
    jira.fixture.userView.access[KPI_PROJECT.key] = { browse: true, create: false, edit: true, link: false };
    jira.fixture.userView.isAdmin = false;
    const perms = async (query: string) => {
      const res = await jira.requestJira({ value: `/rest/api/3/mypermissions?${query}` }, undefined, 'user');
      const body = (await res.json()) as { permissions: Record<string, { havePermission: boolean }> };
      return Object.fromEntries(Object.entries(body.permissions).map(([k, v]) => [k, v.havePermission]));
    };
    expect(await perms('projectKey=KPI&permissions=BROWSE_PROJECTS,CREATE_ISSUES,EDIT_ISSUES,LINK_ISSUES')).toEqual({
      BROWSE_PROJECTS: true,
      CREATE_ISSUES: false,
      EDIT_ISSUES: true,
      LINK_ISSUES: false,
    });
    expect(await perms(`issueId=${KPI_1}&permissions=EDIT_ISSUES`)).toEqual({ EDIT_ISSUES: true });
    expect(await perms('permissions=ADMINISTER')).toEqual({ ADMINISTER: false });
  });

  it('refuses admin-only provisioning writes for a non-admin user', async () => {
    const jira = setup();
    jira.fixture.userView.isAdmin = false;
    const res = await jira.requestJira(
      route`/rest/api/3/issueLinkType`,
      { method: 'POST', body: JSON.stringify({ name: 'X', inward: 'a', outward: 'b' }) },
      'user',
    );
    expect(res.status).toBe(403);
    expect(
      (
        await jira.requestJira(
          route`/rest/api/3/issueLinkType`,
          { method: 'POST', body: JSON.stringify({ name: 'X', inward: 'a', outward: 'b' }) },
          'app',
        )
      ).status,
    ).toBe(201);
  });

  it('records the reading author: the user for a user edit, the app for an app edit', async () => {
    const jira = setup();
    const before = jira.fixture.readingChanges.get(KPI_1)!.length;
    expect(
      (await jira.requestJira(route`/rest/api/3/issue/${KPI_1}`, put({ fields: { [READING_FIELD_ID]: 'u' } }), 'user'))
        .status,
    ).toBe(204);
    expect(
      (await jira.requestJira(route`/rest/api/3/issue/${KPI_1}`, put({ fields: { [READING_FIELD_ID]: 'a' } }), 'app'))
        .status,
    ).toBe(204);
    const added = jira.fixture.readingChanges.get(KPI_1)!.slice(before);
    expect(added.map((c) => [c.to, c.by])).toEqual([
      ['u', MOCK_USER_ACCOUNT_ID],
      ['a', MOCK_APP_ACCOUNT_ID],
    ]);
  });

  it('refuses a user issue edit without Edit Issues', async () => {
    const jira = setup();
    jira.fixture.userView.access[KPI_PROJECT.key] = { browse: true, create: true, edit: false, link: true };
    const res = await jira.requestJira(
      route`/rest/api/3/issue/${KPI_1}`,
      put({ fields: { [READING_FIELD_ID]: 'x' } }),
      'user',
    );
    expect(res.status).toBe(403);
  });

  it('defaults to full access, so requests without a principal behave as before', async () => {
    const jira = setup();
    const res = await jira.requestJira(route`/rest/api/3/issue/${KPI_1}`);
    expect(res.status).toBe(200);
    expect(jira.unhandled).toEqual([]);
  });
});
