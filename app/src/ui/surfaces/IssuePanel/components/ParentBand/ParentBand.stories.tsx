import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, waitFor, screen } from '@storybook/test';
import { TYPE_ICONS } from '@harness/fixtures/typeIcons.js';
import { ParentBand } from './ParentBand.js';

const meta: Meta<typeof ParentBand> = {
  component: ParentBand,
  title: 'Surfaces/IssuePanel/ParentBand',
  args: {
    item: { id: '40045', key: 'PROG-45', summary: 'Frictionless checkout', typeName: 'Epic', typeIconUrl: TYPE_ICONS.Epic },
    first: true,
  },
  decorators: [(Story) => <div style={{ width: 620 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof ParentBand>;

/** A parent work item's band: not an option (not selectable); its icon's tooltip names the type. */
export const Epic: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('PROG-45')).toBeInTheDocument();
    await expect(c.queryByRole('option')).toBeNull();
    await userEvent.hover(c.getByRole('img', { name: 'Epic' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Epic'));
  },
};
export const EpicDark: Story = { ...Epic, globals: { theme: 'dark' } };

export const Initiative: Story = {
  args: { item: { id: '40007', key: 'PORT-7', summary: 'FY27 growth', typeName: 'Initiative', typeIconUrl: TYPE_ICONS.Initiative }, first: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Initiative' })).toBeInTheDocument();
  },
};
