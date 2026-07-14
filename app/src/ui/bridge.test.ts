import { describe, it, expect, vi } from 'vitest';

// `bridge.ts` imports `@forge/bridge`, which throws on module init outside an
// Atlassian host. Stub it so we can unit-test the pure `parseAppEnv` helper.
vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  router: { navigate: vi.fn() },
  view: { getContext: vi.fn() },
}));

import { parseAppEnv } from './bridge.js';

describe('parseAppEnv', () => {
  it('parses appId and environmentId from a well-formed localId ARI', () => {
    const localId =
      'ari:cloud:ecosystem::extension/f92bb5d3-136d-4f6d-9245-fc31f4e8fdec/69a5cdec-507a-4dbe-a84f-0f37b35c1e3e/static/kpi-timeline-page';
    expect(parseAppEnv(localId)).toEqual({
      appId: 'f92bb5d3-136d-4f6d-9245-fc31f4e8fdec',
      environmentId: '69a5cdec-507a-4dbe-a84f-0f37b35c1e3e',
    });
  });

  it('returns null for the harness placeholder', () => {
    expect(parseAppEnv('harness')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseAppEnv('')).toBeNull();
  });

  it('returns null when the ARI is missing the environmentId segment', () => {
    expect(
      parseAppEnv('ari:cloud:ecosystem::extension/f92bb5d3-136d-4f6d-9245-fc31f4e8fdec'),
    ).toBeNull();
  });
});
