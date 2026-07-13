import { composeStories } from '@storybook/react';
import { render } from '@testing-library/react';
import { describe, test } from 'vitest';
import * as stories from './IssuePanel.stories.js';

/**
 * Replays every IssuePanel story (and its `play` assertions) as a test.
 * The stories inject stub loader hooks, so this validates rendering + behavior
 * across data scenarios with no bridge. Runs under `npm run test:stories`.
 */
const composed = composeStories(stories);

describe('IssuePanel stories', () => {
  for (const [name, Story] of Object.entries(composed)) {
    test(name, async () => {
      const { container } = render(<Story />);
      await Story.play?.({ canvasElement: container });
    });
  }
});
