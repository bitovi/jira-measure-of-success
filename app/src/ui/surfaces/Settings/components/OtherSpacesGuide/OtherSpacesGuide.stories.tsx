import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useKpiSetupData, type KpiSetupApi } from '@ui/data/useKpiSetupData/index.js';
import { createKpiSetupSim, type KpiSetupScenario } from '@harness/fixtures/kpiSetup.js';
import { OtherSpacesGuide } from './OtherSpacesGuide.js';
import { guideText } from './guideText.js';

/** "Using KPIs in other spaces" scenarios (spec 11 · 04 Step 5), each on its own in-memory site. */
function Guide({ scenario }: { scenario: KpiSetupScenario }) {
  const [api] = useState<KpiSetupApi>(() => createKpiSetupSim(scenario));
  const { setup } = useKpiSetupData(api);
  return setup ? <OtherSpacesGuide setup={setup} api={api} /> : <p>Loading…</p>;
}

const meta: Meta<typeof Guide> = {
  component: Guide,
  title: 'Surfaces/Settings/OtherSpacesGuide',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Guide>;

/** Fields not chosen yet (an upgraded install): the steps wait for them. */
export const BlocksNotReady: Story = {
  args: { scenario: 'upgraded' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Finish the KPI work type and KPI fields first. These steps refer to them.')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Copy instructions' })).toBeDisabled();
    await expect(c.queryByText('Do it for a space')).not.toBeInTheDocument();
  },
};

/** The steps name the site's real work type and fields. */
export const Configured: Story = {
  args: { scenario: 'configured' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText("Add the KPI work type to the space's work type scheme.")).toBeInTheDocument();
    await expect(c.getByText("Add KPI Unit and KPI Direction to the space's field scheme, for the KPI work type only.")).toBeInTheDocument();
    await expect(c.getByText(/AND issuetype != "KPI"/)).toBeInTheDocument();
    await expect(c.getAllByText('Jira admin')).toHaveLength(3);
  },
};

/** A Jira admin picks a space and has the app do each step for it. */
export const DoItForASpace: Story = {
  args: { scenario: 'configured' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('combobox', { name: 'Space' }));
    await userEvent.click(await c.findByText('Mobile app (MOBILE)'));
    const steps = within(await c.findByRole('list', { name: 'Steps for MOBILE' }));
    const buttons = steps.getAllByRole('button', { name: 'Do it for MOBILE' });
    await expect(buttons).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(steps.getAllByRole('button', { name: 'Do it for MOBILE' })[0]);
      await waitFor(() => expect(steps.getAllByText('Done')).toHaveLength(i + 1));
    }
  },
};

/** A space the central space's setup already covered shows its steps as done. */
export const SpaceAlreadySetUp: Story = {
  args: { scenario: 'configured' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('combobox', { name: 'Space' }));
    await userEvent.click(await c.findByText('E-commerce (ECOM)'));
    const steps = within(await c.findByRole('list', { name: 'Steps for ECOM' }));
    await expect(steps.getAllByText('Done')).toHaveLength(3);
  },
};

/** The copyable text matches what's shown. */
export const CopyText: Story = {
  args: { scenario: 'configured' },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('Do it for a space');
    const setup = await createKpiSetupSim('configured').getKpiSetup();
    const text = guideText(setup);
    await expect(text).toContain("1. [Jira admin] Add the KPI work type to the space's work type scheme.");
    await expect(text).toContain('4. [Space admin] Optional: keep KPIs off boards');
  },
};

export const ConfiguredDark: Story = { args: { scenario: 'configured' }, globals: { theme: 'dark' } };
