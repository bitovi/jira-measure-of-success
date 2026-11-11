# Loading Jira issue-type icons in a Forge Custom UI (CORS workaround)

Source repo: https://github.com/bitovi/jira-measure-of-success (introduced in commit `7319b9a`).

## Problem

- A Forge **Custom UI** runs in an iframe on its own origin.
- Jira issue-type icons (`issuetype.iconUrl`) are hosted on `https://<site>.atlassian.net` (built-in types) or `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/universal_avatar/...` (custom types).
- Those hosts send **no `Access-Control-Allow-Origin`** header.
- A plain `<img src>` displays fine (once allowed in the manifest), but anything that needs a CORS-clean image fails silently. In our case that was CSS `mask-image`, which we use to tint the icon. Other examples are canvas reads and `fetch()` from the browser. The marker rendered blank, sometimes only intermittently because of browser caching.

## Fix: proxy the icon through the Forge backend as a `data:` URL

The Forge function (resolver, Node runtime on Atlassian's infra) fetches the icon bytes with `api.asUser().requestJira(...)`. That request isn't subject to browser CORS rules. The function then base64-encodes the bytes into a `data:` URL and returns it in the same resolver payload. The UI treats `data:` URLs as same-origin, so it can mask, tint, or read them freely.

```mermaid
sequenceDiagram
  participant UI as Custom UI (iframe)
  participant FN as Forge resolver (Node)
  participant J as Jira REST / icon host
  UI->>FN: invoke('getTimelineData')
  FN->>J: search issues (fields=issuetype → iconUrl)
  FN->>J: requestJira(icon path) per unique URL
  J-->>FN: icon bytes + content-type
  FN-->>UI: payload with iconUrl = data:<type>;base64,...
  UI->>UI: mask-image: url(data:...)
```

## Code references

### 1. Backend proxy — [app/src/backend/jira.ts](../app/src/backend/jira.ts#L257-L320)

```ts
import api, { assumeTrustedRoute, routeFromAbsolute } from '@forge/api';

// Custom issue types return an API-gateway URL
// (https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/universal_avatar/...).
// requestJira adds its own gateway prefix, so strip everything before `/rest/`
// or the request is double-prefixed and fails (NEEDS_AUTHENTICATION_ERR).
function toJiraRoute(absoluteUrl: string) {
  const { pathname, search } = new URL(absoluteUrl);
  const restIndex = pathname.indexOf('/rest/');
  if (restIndex <= 0) return routeFromAbsolute(absoluteUrl);
  return assumeTrustedRoute(`${pathname.slice(restIndex)}${search}`);
}

// Best-effort: null on any failure so the UI can fall back.
export async function fetchIconDataUrl(iconUrl: string): Promise<string | null> {
  try {
    const res = await api.asUser().requestJira(toJiraRoute(iconUrl));
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

// Deduped batch: many issues share the same issue-type icon.
export async function inlineIssueTypeIcons(
  urls: ReadonlyArray<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter((u): u is string => !!u && !u.startsWith('data:')))];
  const resolved = await Promise.all(unique.map(async (u) => [u, await fetchIconDataUrl(u)] as const));
  const map = new Map<string, string>();
  for (const [u, data] of resolved) if (data) map.set(u, data);
  return map;
}
```

The icon URL itself comes from a normal issue search with `fields=...,issuetype` → `issue.fields.issuetype.iconUrl` ([jira.ts](../app/src/backend/jira.ts#L576-L587)).

### 2. Resolver wiring — [app/src/backend/resolver.ts](../app/src/backend/resolver.ts#L375-L380)

```ts
const iconByUrl = await inlineIssueTypeIcons(
  contributions.issues.map((ci) => ci.issueTypeIconUrl),
);
// ...later, when building each DTO (resolver.ts#L412):
iconUrl: (ci.issueTypeIconUrl && iconByUrl.get(ci.issueTypeIconUrl)) ?? ci.issueTypeIconUrl,
```

If the proxy fails for an icon, the original remote URL is kept so the UI can still decide what to do.

### 3. Manifest — [app/manifest.yml](../app/manifest.yml#L66-L79)

```yaml
permissions:
  scopes:
    - read:jira-work
    # Custom issue-type icons are served via GET /rest/api/2/universal_avatar/...,
    # which Forge gates behind this scope. Without it the proxy gets a non-OK
    # response and every custom type falls back. Built-in type icons need no scope.
    - read:avatar:jira
  # Lets a plain <img> in the Custom UI load the remote icon directly
  # (used for the true-color icon in the tooltip).
  external:
    images:
      - 'https://*.atlassian.net'
      - 'https://api.atlassian.com'
```

Adding a scope requires `forge deploy` + `forge install --upgrade`.

The resolver is a normal Forge function (`function: - key: resolver, handler: index.handler`) referenced by each Custom UI module via `resolver: { function: resolver }` ([manifest.yml](../app/manifest.yml#L1-L45)). Runtime is `nodejs22.x`, so `Buffer` is available.

### 4. UI consumer — [app/src/ui/plot/markers.tsx](../app/src/ui/plot/markers.tsx#L162-L210)

```tsx
const iconUrl = target.source.iconUrl;
// Only tint same-origin data: URLs; a mask over a remote icon fails silently.
const canTint = !!iconUrl && iconUrl.startsWith('data:');

{canTint ? (
  <div
    className={`h-4 w-4 ${color}`} // background color = the tint
    style={{
      WebkitMaskImage: `url(${iconUrl})`,
      maskImage: `url(${iconUrl})`,
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
    }}
  />
) : (
  <div className={`h-2.5 w-2.5 rotate-45 ${color}`} /> // fallback diamond
)}
```

### 5. Tests — [app/src/backend/jira.test.ts](../app/src/backend/jira.test.ts#L85-L127)

Mocks `@forge/api` (including `routeFromAbsolute` / `assumeTrustedRoute`) and asserts both URL shapes become plain site-relative paths:

- `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10322?size=medium` → `/rest/api/2/universal_avatar/view/type/issuetype/avatar/10322?size=medium`
- `https://<site>.atlassian.net/images/icons/issuetypes/epic.svg` → `/images/icons/issuetypes/epic.svg`

## Gotchas checklist

1. **CORS**: remote Atlassian icon hosts have no CORS headers. Proxy server-side and return `data:` URLs.
2. **Gateway URL double-prefix**: custom issue-type icon URLs include `/ex/jira/{cloudId}`. Strip everything before `/rest/` before calling `requestJira`.
3. **Scope**: `read:avatar:jira` is required for custom issue-type icons (`universal_avatar`). Without it the request fails silently.
4. **`external.images`**: only needed if you also render the remote URL directly with `<img>`.
5. **Dedupe + best-effort**: fetch each unique icon URL once, never fail the whole payload on an icon error, and keep a UI fallback.
