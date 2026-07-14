import { invoke, router, view } from '@forge/bridge';

/**
 * Typed wrapper over the Forge bridge `invoke`. The real bridge returns
 * `InvokeResponse<T>` (a union with a metadata variant); our resolvers always
 * return the payload directly, so we narrow to `T` here in one place. The
 * harness mock aliases `@forge/bridge` and returns `T` as-is.
 */
export async function call<T>(key: string, payload?: unknown): Promise<T> {
  return (await invoke<T>(key, payload as Parameters<typeof invoke>[1])) as T;
}

/**
 * Parse the app id and environment id out of a Forge `localId` ARI.
 *
 * `view.getContext().localId` is an ARI of the form:
 *   `ari:cloud:ecosystem::extension/{appId}/{environmentId}/static/{moduleKey}`
 *
 * The KPI Settings admin page lives at
 *   `/jira/settings/apps/{appId}/{environmentId}`
 * so those two ids are all we need to deep-link to it at runtime — no
 * hardcoding of environment-specific values.
 *
 * Returns `null` for a missing/malformed localId (e.g. the harness `'harness'`
 * placeholder) so callers can fall back gracefully instead of crashing the UI.
 */
export function parseAppEnv(
  localId: string,
): { appId: string; environmentId: string } | null {
  if (!localId) return null;
  const marker = '::extension/';
  const idx = localId.indexOf(marker);
  if (idx === -1) return null;
  const parts = localId.slice(idx + marker.length).split('/');
  const [appId, environmentId] = parts;
  if (!appId || !environmentId) return null;
  return { appId, environmentId };
}

/**
 * Deep link to the KPI Settings admin page (`jira:adminPage`, module key
 * `kpi-settings-page`). The URL is `/jira/settings/apps/{appId}/{environmentId}`
 * where both ids are derived at runtime from the bridge context `localId` ARI —
 * see specs/bug-fixes/kpi-space-not-set-up-error.md. Router/context access stays
 * behind this seam so stories/tests (which alias `@forge/bridge` to the mock
 * bridge) don't hit the real runtime.
 */
export async function openKpiSettings(): Promise<void> {
  const ctx = await view.getContext();
  const parsed = parseAppEnv((ctx as { localId?: string })?.localId ?? '');
  if (!parsed) {
    console.warn(
      '[openKpiSettings] could not derive appId/environmentId from context localId; skipping navigation',
    );
    return;
  }
  await router.navigate(
    `/jira/settings/apps/${parsed.appId}/${parsed.environmentId}`,
  );
}

/**
 * Deep link to a KPI's Jira issue (`/browse/{issueKey}`). KPIs are Jira issues
 * of type KPI in the KPI space, so the timeline can navigate straight to the
 * underlying issue. No-ops (with a warning) on an empty key so a KPI without a
 * resolvable issue key doesn't produce a broken navigation. Router access stays
 * behind this seam so stories/tests (which alias `@forge/bridge` to the mock
 * bridge) don't hit the real runtime.
 */
export async function openIssue(issueKey: string): Promise<void> {
  if (!issueKey) {
    console.warn('[openIssue] missing issueKey; skipping navigation');
    return;
  }
  await router.navigate(`/browse/${issueKey}`);
}
