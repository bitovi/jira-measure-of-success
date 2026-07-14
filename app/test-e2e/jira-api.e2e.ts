import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import forgeApi, { route } from './forge-api-shim';
import {
  createKpiIssue,
  createKpiProject,
  ensureKpiIssueTypeOnProject,
  fetchAssignments,
  fetchChildren,
  fetchHierarchyLevels,
  fetchIssueMeta,
  fetchKpiMeta,
  fetchKpiSpaceIssues,
  fetchReadingChangelog,
  fetchSubtreeTimingNodes,
  findProjectByKey,
  writeAssignments,
  KPI_ISSUE_TYPE,
} from '../src/backend/jira';
import type { Assignment } from '../src/domain/index';

/**
 * API E2E — drives every Jira REST capability in `src/backend/jira.ts` against a
 * LIVE site using a personal API token (via the Basic-auth `@forge/api` shim).
 * It provisions a throwaway KPI space FROM SCRATCH each run so a regression in
 * any endpoint (project creation, issue-type scheme, JQL search, entity
 * properties, bulk changelog, …) surfaces as a failing test.
 *
 * ⚠️ DESTRUCTIVE: deletes + recreates the `E2E_PROJECT_KEY` project on
 * `JIRA_BASE_URL`. It uses a DEDICATED disposable key (default `MOSE2E`) — NOT
 * the real configured KPI space — so real KPI data is never touched.
 *
 * Run: `npm run test:e2e` (auto-skips when creds are absent).
 * Requires in `.env`: FORGE_EMAIL, FORGE_API_TOKEN, JIRA_BASE_URL (optional),
 * E2E_PROJECT_KEY (optional, default MOSE2E). The API token needs Jira admin
 * rights (project create/delete + issue-type scheme management).
 */

const BASE_URL = process.env.JIRA_BASE_URL || 'https://bitovi-training.atlassian.net';
const PROJECT_KEY = (process.env.E2E_PROJECT_KEY || 'MOSE2E').toUpperCase();
const HAS_CREDS = Boolean(process.env.FORGE_EMAIL && process.env.FORGE_API_TOKEN);

if (!HAS_CREDS) {
  console.warn(
    '\n[test:e2e] SKIPPED — set FORGE_EMAIL and FORGE_API_TOKEN in .env to run the live API E2E test.\n',
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry `fn` until `ok(result)` or attempts run out — for JQL index lag. */
async function pollFor<T>(
  fn: () => Promise<T>,
  ok: (value: T) => boolean,
  { tries = 15, waitMs = 2000 }: { tries?: number; waitMs?: number } = {},
): Promise<T> {
  let last = await fn();
  for (let i = 0; i < tries && !ok(last); i += 1) {
    await delay(waitMs);
    last = await fn();
  }
  return last;
}

/** Permanently delete the E2E project (skip trash) and wait until it's gone. */
async function deleteProjectIfExists(key: string): Promise<void> {
  if (!(await findProjectByKey(key))) return;
  const res = await forgeApi
    .asApp()
    .requestJira(route`/rest/api/3/project/${key}?enableUndo=false`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete project "${key}" (${res.status}): ${await res.text()}`);
  }
  // Project deletion is asynchronous — poll until the key stops resolving.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await findProjectByKey(key))) return;
    await delay(2000);
  }
  throw new Error(`Project "${key}" still present after delete — try purging Jira trash.`);
}

// State threaded across the ordered steps (vitest runs a file's tests in order).
const ctx: {
  leadAccountId?: string;
  projectId?: string;
  rootKey?: string;
  rootId?: string;
  childKey?: string;
} = {};

const suite = HAS_CREDS ? describe : describe.skip;

suite(`API E2E against ${BASE_URL} (project ${PROJECT_KEY})`, () => {
  beforeAll(async () => {
    // Resolve the current user (also proves auth works) — used as project lead.
    const res = await forgeApi.asApp().requestJira(route`/rest/api/3/myself`);
    if (!res.ok) {
      throw new Error(`Auth check failed (GET /myself → ${res.status}). Check FORGE_EMAIL/TOKEN.`);
    }
    const me = (await res.json()) as { accountId?: string };
    ctx.leadAccountId = me.accountId;
    expect(ctx.leadAccountId, 'GET /myself returned no accountId').toBeTruthy();

    // Start from scratch.
    await deleteProjectIfExists(PROJECT_KEY);
  });

  afterAll(async () => {
    // Best-effort cleanup — leave no trace, but don't fail the run on teardown.
    try {
      await deleteProjectIfExists(PROJECT_KEY);
    } catch {
      /* ignore */
    }
  });

  it('findProjectByKey → null for a fresh key', async () => {
    expect(await findProjectByKey(PROJECT_KEY)).toBeNull();
  });

  it('createKpiProject → provisions the KPI space shell', async () => {
    const project = await createKpiProject(PROJECT_KEY, ctx.leadAccountId!);
    expect(project.id).toBeTruthy();
    ctx.projectId = project.id;
  });

  it('ensureKpiIssueTypeOnProject → associates the KPI issue type', async () => {
    expect(ctx.projectId, 'requires createKpiProject to have succeeded').toBeTruthy();
    await ensureKpiIssueTypeOnProject(ctx.projectId!);
    const project = await findProjectByKey(PROJECT_KEY);
    expect(project?.issueTypeNames).toContain(KPI_ISSUE_TYPE);
  });

  it('createKpiIssue → creates a root KPI (+ writeKpiMeta)', async () => {
    expect(ctx.projectId, 'requires createKpiProject to have succeeded').toBeTruthy();
    ctx.rootKey = await createKpiIssue(ctx.projectId!, {
      name: 'E2E Revenue',
      unit: '$',
      direction: 'increase',
    });
    expect(ctx.rootKey).toBeTruthy();
  });

  it('fetchKpiMeta → round-trips unit/direction', async () => {
    expect(ctx.rootKey, 'requires createKpiIssue (root) to have succeeded').toBeTruthy();
    const meta = await fetchKpiMeta(ctx.rootKey!);
    expect(meta).toEqual({ unit: '$', direction: 'increase' });
  });

  it('createKpiIssue → nests a child KPI via a Parent link', async () => {
    expect(ctx.rootKey, 'requires createKpiIssue (root) to have succeeded').toBeTruthy();
    ctx.childKey = await createKpiIssue(ctx.projectId!, {
      name: 'E2E Regional Revenue',
      unit: '$',
      direction: 'increase',
      parentKpiId: ctx.rootKey,
    });
    expect(ctx.childKey).toBeTruthy();
  });

  it('fetchKpiSpaceIssues → enumerates + nests the space (links + JQL)', async () => {
    // JQL search reads a search index that trails issue creation (and link
    // indexing) by a few seconds — poll until the child is present AND its
    // parent has resolved from the Parent link.
    const rootPresent = (list: Awaited<ReturnType<typeof fetchKpiSpaceIssues>>) =>
      list.find((i) => i.key === ctx.rootKey);
    const issues = await pollFor(
      () => fetchKpiSpaceIssues(PROJECT_KEY),
      (list) => {
        const root = rootPresent(list);
        return Boolean(root && list.some((i) => i.key === ctx.childKey && i.parentId === root!.id));
      },
    );
    const root = issues.find((i) => i.key === ctx.rootKey);
    expect(root, `root KPI ${ctx.rootKey} not found in space enumeration`).toBeTruthy();
    ctx.rootId = root!.id;
    const child = issues.find((i) => i.key === ctx.childKey);
    expect(child, `child KPI ${ctx.childKey} not found`).toBeTruthy();
    expect(child!.parentId, 'child should nest under the root via the Parent link').toBe(ctx.rootId);
  });

  it('fetchIssueMeta → reads issue key/type/dates', async () => {
    expect(ctx.rootId, 'requires fetchKpiSpaceIssues to have resolved the root id').toBeTruthy();
    const meta = await fetchIssueMeta(ctx.rootId!);
    expect(meta.issueKey).toBe(ctx.rootKey);
    expect(meta.issueTypeName).toBe(KPI_ISSUE_TYPE);
  });

  it('fetchChildren → lists children via JQL parent=', async () => {
    expect(ctx.rootId, 'requires fetchKpiSpaceIssues to have resolved the root id').toBeTruthy();
    const children = await fetchChildren(ctx.rootId!);
    expect(Array.isArray(children)).toBe(true);
  });

  it('fetchSubtreeTimingNodes → builds the timing-node map', async () => {
    expect(ctx.rootId, 'requires fetchKpiSpaceIssues to have resolved the root id').toBeTruthy();
    const nodes = await fetchSubtreeTimingNodes(ctx.rootId!);
    expect(nodes.has(ctx.rootId!)).toBe(true);
  });

  it('fetchHierarchyLevels → returns the site issue-type hierarchy', async () => {
    const levels = await fetchHierarchyLevels();
    expect(levels.length).toBeGreaterThan(0);
  });

  it('writeAssignments + fetchAssignments → entity-property round-trip', async () => {
    expect(ctx.rootId, 'requires fetchKpiSpaceIssues to have resolved the root id').toBeTruthy();
    const assignment: Assignment = {
      kpiId: ctx.rootKey!,
      inheritFromParent: false,
      target: 100,
      targetType: 'absolute',
      timing: {
        start: null,
        due: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 },
      },
      updatedBy: ctx.leadAccountId!,
      updatedAt: Date.now(),
    };
    await writeAssignments(ctx.rootId!, [assignment]);
    const read = await fetchAssignments(ctx.rootId!);
    expect(read).toHaveLength(1);
    expect(read[0].kpiId).toBe(ctx.rootKey);
    expect(read[0].target).toBe(100);
  });

  it('fetchReadingChangelog → reaches the bulk changelog endpoint', async () => {
    expect(ctx.rootId, 'requires fetchKpiSpaceIssues to have resolved the root id').toBeTruthy();
    // Exercises getReadingFieldId() (GET /field → find `kpi-reading`) + the bulk
    // changelog POST. Empty series is expected (nothing written yet); the point
    // is the call resolves without throwing.
    const byIssue = await fetchReadingChangelog([ctx.rootId!]);
    expect(byIssue).toBeInstanceOf(Map);
  });

  // writeReading targets the app-managed, read-only `kpi-reading` custom field.
  // Only the DEPLOYED Forge app identity can write it — a personal API token
  // (any user) is structurally forbidden, so there is nothing meaningful to
  // assert here. Verify the reading WRITE path via `forge tunnel` on a dev site.
  it.skip('writeReading → app-managed read-only field; verify via forge tunnel', () => {});
});
