import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, screen } from '@storybook/test';
import Button from '@atlaskit/button/new';
import { DisabledReason } from './DisabledReason.js';

const REASON = 'Adding a KPI needs Create Issues permission on the KPI space project. Ask a Jira admin.';

const meta: Meta<typeof DisabledReason> = {
  component: DisabledReason,
  title: 'Components/DisabledReason',
};
export default meta;
type Story = StoryObj<typeof DisabledReason>;

/** No reason: the control renders untouched. */
export const Allowed: Story = {
  render: () => (
    <DisabledReason reason={null}>
      <Button appearance="primary">Add KPI</Button>
    </DisabledReason>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Add KPI' })).toBeEnabled();
    await expect(canvasElement.querySelector('[data-disabled-reason]')).toBeNull();
  },
};

/** Disabled with a reason: hovering (or focusing) the control explains why. */
export const Disabled: Story = {
  render: () => (
    <DisabledReason reason={REASON}>
      <Button appearance="primary" isDisabled>
        Add KPI
      </Button>
    </DisabledReason>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Add KPI' })).toBeDisabled();
    const wrapper = canvasElement.querySelector('[data-disabled-reason]') as HTMLElement;
    await userEvent.hover(wrapper);
    await expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  },
};
