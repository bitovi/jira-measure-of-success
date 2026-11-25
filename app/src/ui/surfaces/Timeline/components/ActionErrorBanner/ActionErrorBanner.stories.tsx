import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn } from '@storybook/test';
import { ActionErrorBanner } from './ActionErrorBanner.js';

const settings = fn();
const dismiss = fn();

const meta: Meta<typeof ActionErrorBanner> = {
  component: ActionErrorBanner,
  title: 'Timeline/ActionErrorBanner',
  args: { onOpenSettings: settings, onDismiss: dismiss },
};
export default meta;
type Story = StoryObj<typeof ActionErrorBanner>;

export const Generic: Story = {
  args: { error: { kind: 'generic', message: 'Jira 500' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('alert')).toHaveTextContent('Couldn’t save your changeJira 500');
    await userEvent.click(c.getByRole('button', { name: 'Dismiss' }));
    await expect(dismiss).toHaveBeenCalled();
  },
};

export const NeedsSettings: Story = {
  args: { error: { kind: 'hierarchy-not-set-up', message: 'KPI hierarchy is not set up' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Open Settings' }));
    await expect(settings).toHaveBeenCalled();
  },
};
export const NeedsSettingsDark: Story = { ...NeedsSettings, globals: { theme: 'dark' } };
