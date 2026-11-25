import { composeStories } from '@storybook/react';
import { render } from '@testing-library/react';
import { describe, test } from 'vitest';
import * as stories from './CentralSpaceCard.stories.js';

const composed = composeStories(stories);

describe('CentralSpaceCard stories', () => {
  for (const [name, Story] of Object.entries(composed)) {
    test(name, async () => {
      const { container } = render(<Story />);
      await Story.play?.({ canvasElement: container });
    });
  }
});
