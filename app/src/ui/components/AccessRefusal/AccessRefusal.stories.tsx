import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn } from '@storybook/test';
import { kpiPermissionMessage } from '@domain/index.js';
import { AccessRefusal } from './AccessRefusal.js';

const REASON = kpiPermissionMessage('record', 'Portfolio', 'PORT-2');
const dismiss = fn();

const meta: Meta<typeof AccessRefusal> = {
  component: AccessRefusal,
  title: 'Components/AccessRefusal',
  args: { message: REASON, onDismiss: dismiss },
};
export default meta;
type Story = StoryObj<typeof AccessRefusal>;

/** A refused KPI action: the reason names the KPI's own space; Dismiss closes it. */
export const Refused: Story = {
  play: async ({ canvasElement }) => {
    dismiss.mockClear();
    const alert = within(canvasElement).getByRole('alert');
    await expect(alert).toHaveTextContent(
      'Recording a value on PORT-2 needs Edit Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    await expect(dismiss).toHaveBeenCalledTimes(1);
  },
};

export const RefusedDark: Story = { ...Refused, globals: { theme: 'dark' } };
