# Bug: "KPI space is not set up" uncaught promise rejection on Timeline

## Symptom (real Forge site)

On the KPI Timeline global page, clicking **+ Add KPI** (or recording a value)
before the KPI space is configured produced an **uncaught promise rejection**:

```
Uncaught (in promise) Error: There was an error invoking the function -
KPI space is not set up — configure it in Settings first.
```

## Root cause

- Backend guard: `app/src/backend/resolver.ts` `createKpi` throws
  `KPI space is not set up — configure it in Settings first.` when
  `space.projectId` is unset (record/other space-dependent resolvers can throw
  the same class of error).
- The Timeline loader hook (`app/src/ui/data/useTimelineData/useTimelineData.ts`)
  invoked the mutations as `void createKpi(input)` / `void record(...)` with **no
  `.catch`**, so the rejected promise surfaced as an unhandled rejection.

## Fix (shipped)

1. **Hook** — wrapped `record` and `createKpi` in `try/catch` and added a
   dedicated mutation-error channel (`actionError` + `clearActionError`) on
   `TimelineController`, kept separate from the initial-load `error` (which still
   drives the full-screen "Failed to load" state). The specific space-not-set-up
   error is detected by matching the message substring `KPI space is not set up`
   and represented as `{ kind: 'space-not-set-up', message }`; everything else is
   `{ kind: 'generic', message }`.
2. **Surface** — `Timeline.tsx` renders a dismissible inline `role="alert"`
   banner from `actionError`. For `space-not-set-up` it shows an **Open Settings**
   action; for `generic` it shows the plain error message (no action).
3. **Router seam** — `app/src/ui/bridge.ts` exposes `openKpiSettings()` which
   derives the admin URL at runtime and calls `router.navigate(...)`. Router
   access stays behind the bridge seam; the harness/story mock
   (`app/test-harness/mock-bridge.ts`) provides a `router.navigate` stub and a
   realistic `view.getContext().localId`. The surface takes an injectable
   `onOpenSettings` prop (defaulted to `openKpiSettings`) so stories/tests spy on
   it.

## RESOLVED — exact adminPage deep-link (derived at runtime, no hardcoding)

The KPI Settings page is a `jira:adminPage` (manifest module key
`kpi-settings-page`, title "KPI Settings"). Confirmed on the live site, its URL
is:

```
/jira/settings/apps/{appId}/{environmentId}
```

e.g. for the `bitovi-training` dev site:

```
https://bitovi-training.atlassian.net/jira/settings/apps/f92bb5d3-136d-4f6d-9245-fc31f4e8fdec/69a5cdec-507a-4dbe-a84f-0f37b35c1e3e
```

where `f92bb5d3-…` is the app id (matches manifest `app.id`,
`ari:cloud:ecosystem::app/f92bb5d3-136d-4f6d-9245-fc31f4e8fdec`) and
`69a5cdec-…` is the environment id.

Both ids are derived **at runtime** from the Forge bridge context — no
environment-specific value is hardcoded. `view.getContext().localId` is an ARI
of the form:

```
ari:cloud:ecosystem::extension/{appId}/{environmentId}/static/{moduleKey}
```

so parsing `localId` yields both ids. Implemented in `app/src/ui/bridge.ts`:

```ts
// app/src/ui/bridge.ts
export function parseAppEnv(localId: string) {
  if (!localId) return null;
  const marker = '::extension/';
  const idx = localId.indexOf(marker);
  if (idx === -1) return null;
  const [appId, environmentId] = localId.slice(idx + marker.length).split('/');
  if (!appId || !environmentId) return null;
  return { appId, environmentId };
}

export async function openKpiSettings() {
  const ctx = await view.getContext();
  const parsed = parseAppEnv(ctx?.localId ?? '');
  if (!parsed) {
    console.warn('[openKpiSettings] could not derive appId/environmentId …');
    return; // graceful no-op, never crashes the UI
  }
  await router.navigate(
    `/jira/settings/apps/${parsed.appId}/${parsed.environmentId}`,
  );
}
```

`parseAppEnv` is a pure exported helper unit-tested in
`app/src/ui/bridge.test.ts` (well-formed ARI → ids; `'harness'`/empty/short →
`null`). The old `KPI_SETTINGS_ADMIN_PATH` hardcoded constant was removed. The
harness mock (`app/test-harness/mock-bridge.ts`) returns a realistic
`localId` so the harness logs the real-looking URL
`/jira/settings/apps/f92bb5d3-…/69a5cdec-…`.

**Fallback:** if `localId` is missing/malformed, `openKpiSettings` logs a warning
and no-ops (no navigation, no throw) so the UI never crashes.
