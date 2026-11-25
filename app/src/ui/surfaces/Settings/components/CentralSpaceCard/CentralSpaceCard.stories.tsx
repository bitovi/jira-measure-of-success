import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import type { KpiSetupStatus } from '@domain/index.js';
import { useKpiSetupData, type KpiSetupApi } from '@ui/data/useKpiSetupData/index.js';
import { createKpiSetupSim, type KpiSetupScenario } from '@harness/fixtures/kpiSetup.js';
import { CentralSpaceCard } from './CentralSpaceCard.js';

/** Central KPI space scenarios (spec 11 · 04 Step 5), each on its own in-memory site. */
function Central({ scenario, override }: { scenario: KpiSetupScenario; override?: Partial<KpiSetupStatus['centralSpace']> }) {
  const [api] = useState<KpiSetupApi>(() => createKpiSetupSim(scenario));
  const { setup, apply } = useKpiSetupData(api);
  if (!setup) return <p>Loading…</p>;
  const shown = override ? { ...setup, centralSpace: { ...setup.centralSpace, ...override } } : setup;
  return <CentralSpaceCard setup={shown} api={api} apply={apply} />;
}

const meta: Meta<typeof Central> = {
  component: Central,
  title: 'Surfaces/Settings/CentralSpaceCard',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Central>;

/** Building blocks done, no central space yet: create one. */
export const CreateSpace: Story = {
  args: { scenario: 'blocks' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('None')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Create space' }));
    await waitFor(() => expect(c.getByText(/KPIs are created as work items in/)).toBeInTheDocument());
    await expect(c.getAllByText('KPIs (KPI)').length).toBeGreaterThan(0);
  },
};

export const UseExistingSpace: Story = {
  args: { scenario: 'blocks' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Use existing…' }));
    await userEvent.click(c.getByRole('combobox', { name: 'Existing space' }));
    await userEvent.click(await c.findByText('E-commerce (ECOM)'));
    await userEvent.click(c.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(c.getByText('ECOM')).toBeInTheDocument());
  },
};

/** An upgraded install keeps its KPI project; changing it warns (Q8). */
export const UpgradedInstall: Story = {
  args: { scenario: 'upgraded' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText(/KPIs are created as work items in/)).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Change…' }));
    await expect(c.getByRole('note')).toHaveTextContent('KPIs already in KPIs (KPI) stay there');
  },
};

/** No KPI work type yet: the space waits for it. */
export const NeedsWorkType: Story = {
  args: { scenario: 'fresh' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('First: choose the KPI work type above.')).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: 'Create space' })).not.toBeInTheDocument();
  },
};

/** The space no longer offers the KPI work type: one click adds it back. */
export const Misconfigured: Story = {
  args: {
    scenario: 'upgraded',
    override: { state: 'misconfigured', problem: "KPIs (KPI) doesn't offer the KPI work type, so KPIs can't be created in it." },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Needs setup')).toBeInTheDocument();
    await expect(c.getByText(/doesn't offer the KPI work type/)).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Add KPI to KPI' })).toBeInTheDocument();
  },
};

/** The space was deleted: create or pick another. */
export const Deleted: Story = {
  args: { scenario: 'upgraded', override: { state: 'broken', problem: 'The space KPI no longer exists.' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Deleted')).toBeInTheDocument();
    await expect(c.getByText('The space KPI no longer exists.')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Create space' })).toBeInTheDocument();
  },
};

export const UpgradedInstallDark: Story = { args: { scenario: 'upgraded' }, globals: { theme: 'dark' } };
