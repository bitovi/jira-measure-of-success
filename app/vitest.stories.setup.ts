import { setProjectAnnotations } from '@storybook/react';

/**
 * Load Storybook's project-level annotations so portable stories
 * (`composeStories`) render with the same config as the Storybook UI.
 * No global decorators today, so an empty set suffices (and avoids importing
 * the CSS pipeline into jsdom).
 */
setProjectAnnotations([]);
