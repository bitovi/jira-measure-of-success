import type { Preview } from '@storybook/react';
import { enableTheme, type ColorMode } from '../src/ui/theme';
import '../src/ui/styles.css';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    layout: 'fullscreen',
  },
  globalTypes: {
    theme: {
      description: 'Atlaskit color mode',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, context) => {
      void enableTheme((context.globals.theme as ColorMode | undefined) ?? 'light');
      return Story();
    },
  ],
};

export default preview;
