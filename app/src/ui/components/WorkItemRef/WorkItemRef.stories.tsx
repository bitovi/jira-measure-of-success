import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, waitFor, screen } from '@storybook/test';
import { WorkItemRef } from './WorkItemRef.js';
import { TYPE_ICONS } from '@harness/fixtures/typeIcons.js';

const meta: Meta<typeof WorkItemRef> = {
  component: WorkItemRef,
  title: 'Components/WorkItemRef',
  args: { typeIconUrl: TYPE_ICONS.KPI, typeName: 'KPI', itemKey: 'TEAM-501', summary: 'Checkout conversion' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof WorkItemRef>;

/** `{type icon} {key} {summary}`; the icon's tooltip names the type. */
export const Kpi: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('TEAM-501')).toBeInTheDocument();
    await expect(canvas.getByText('Checkout conversion')).toBeInTheDocument();
    await userEvent.hover(canvas.getByRole('img', { name: 'KPI' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('KPI'));
  },
};

export const KpiDark: Story = { ...Kpi, globals: { theme: 'dark' } };

/** A parent work item; a long summary truncates. */
export const Epic: Story = {
  args: {
    typeIconUrl: TYPE_ICONS.Epic,
    typeName: 'Epic',
    itemKey: 'PROG-45',
    summary: 'Frictionless checkout across every storefront, app and partner channel',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Epic' })).toBeInTheDocument();
  },
};

/** No icon could be fetched: a neutral square, still named for screen readers. */
export const NoIcon: Story = {
  args: { typeIconUrl: null, typeName: 'Initiative', itemKey: 'PORT-7', summary: 'FY27 growth' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Initiative' })).toBeInTheDocument();
  },
};

/** Search text is marked in the key and summary. */
export const Highlighted: Story = {
  args: { highlight: 'conv' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('mark')).toHaveTextContent('conv');
  },
};
