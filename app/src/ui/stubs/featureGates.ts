/**
 * Build-time stand-in for `@atlaskit/feature-gate-js-client/feature-gates`
 * (aliased in the vite/vitest/storybook configs). The real client bundles
 * Statsig + network code (~200 kB) that Atlaskit components pull in through
 * `@atlaskit/platform-feature-flags`; in Forge Custom UI it is never
 * initialized, so every gate/experiment just resolves to its default.
 */
const FeatureGates = {
  checkGate: (_gate: string): boolean => false,
  initializeCompleted: (): boolean => false,
  getExperimentValue: <T>(_experiment: string, _param: string, defaultValue: T): T => defaultValue,
};

export default FeatureGates;
