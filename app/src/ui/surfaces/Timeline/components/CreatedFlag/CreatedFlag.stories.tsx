import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn } from '@storybook/test';
import { CreatedFlag } from './CreatedFlag.js';

const show = fn();
const open = fn();
const dismiss = fn();

const meta: Meta<typeof CreatedFlag> = {
  component: CreatedFlag,
  title: 'Timeline/CreatedFlag',
  args: { kpiKey: 'CHK-900', name: 'Express pay share', spaceLabel: 'Checkout (CHK)', hidden: false, onShow: show, onOpen: open, onDismiss: dismiss },
};
export default meta;
type Story = StoryObj<typeof CreatedFlag>;

export const Created: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const flag = c.getByRole('status');
    await expect(flag).toHaveTextContent('CHK-900 Express pay share created');
    await expect(flag).toHaveTextContent('In Checkout (CHK).');
    await expect(c.queryByRole('button', { name: 'Show it' })).toBeNull();
    await userEvent.click(c.getByRole('button', { name: 'Open KPI' }));
    await expect(open).toHaveBeenCalled();
  },
};

/** The KPI space filter hides the new KPI: say so, offer Show it. */
export const HiddenByFilter: Story = {
  args: { hidden: true },
  play: async ({ canvasElement }) => {
    show.mockClear();
    const c = within(canvasElement);
    await expect(c.getByRole('status')).toHaveTextContent('It’s hidden by the filters.');
    await userEvent.click(c.getByRole('button', { name: 'Show it' }));
    await expect(show).toHaveBeenCalled();
    await userEvent.click(c.getByRole('button', { name: 'Dismiss' }));
    await expect(dismiss).toHaveBeenCalled();
  },
};
export const HiddenByFilterDark: Story = { ...HiddenByFilter, globals: { theme: 'dark' } };
