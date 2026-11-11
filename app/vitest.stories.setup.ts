import '@testing-library/jest-dom/vitest';
import { setProjectAnnotations } from '@storybook/react';
import { setBooleanFeatureFlagResolver } from '@atlaskit/platform-feature-flags';

/**
 * Load Storybook's project-level annotations so portable stories
 * (`composeStories`) render with the same config as the Storybook UI.
 * No global decorators today, so an empty set suffices (and avoids importing
 * the CSS pipeline into jsdom).
 */
setProjectAnnotations([]);

/*
 * jsdom gaps that Atlaskit components (tokens, tooltip, modal-dialog, select)
 * hit at import/render time. Polyfilled here so story tests stay unaware.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Atlaskit gates behavior on platform feature flags; without a resolver it
// calls an uninitialized Statsig client and logs an error per flag. All off.
setBooleanFeatureFlagResolver(() => false);
