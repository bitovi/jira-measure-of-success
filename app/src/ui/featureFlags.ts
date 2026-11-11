import { setBooleanFeatureFlagResolver } from '@atlaskit/platform-feature-flags';

/*
 * Atlaskit gates behavior on platform feature flags, and without a resolver
 * it calls an uninitialized Statsig client. Everything stays at its default
 * except the Portal R18 fix: the legacy portal removes its container in an
 * effect cleanup and never re-adds it, so under React.StrictMode (dev) every
 * Modal mounts and immediately vanishes.
 */
const ENABLED_GATES = new Set(['platform_design_system_team_portal_logic_r18_fix']);

export function configureFeatureFlags(): void {
  setBooleanFeatureFlagResolver((flag) => ENABLED_GATES.has(flag));
}
