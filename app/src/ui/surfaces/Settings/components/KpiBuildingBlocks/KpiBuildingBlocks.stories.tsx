import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useKpiSetupData, type KpiSetupApi } from '@ui/data/useKpiSetupData/index.js';
import { createKpiSetupSim, type KpiSetupScenario, type KpiSetupSimOptions } from '@harness/fixtures/kpiSetup.js';
import { KpiBuildingBlocks } from './KpiBuildingBlocks.js';

/**
 * KPI building blocks scenarios (spec 11 · 04 Step 5), each on its own
 * in-memory site (`createKpiSetupSim`), so creating and picking really change
 * what's shown.
 */
function Blocks({ scenario, options }: { scenario: KpiSetupScenario; options?: KpiSetupSimOptions }) {
  const [api] = useState<KpiSetupApi>(() => createKpiSetupSim(scenario, options));
  const { setup, apply } = useKpiSetupData(api);
  return setup ? <KpiBuildingBlocks setup={setup} api={api} apply={apply} /> : <p>Loading…</p>;
}

const meta: Meta<typeof Blocks> = {
  component: Blocks,
  title: 'Surfaces/Settings/KpiBuildingBlocks',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Blocks>;

const step = (canvas: HTMLElement, title: string) => within(within(canvas).getByRole('group', { name: title }));

/** A fresh install: nothing chosen, the site has no KPI type. */
export const FreshInstall: Story = {
  args: { scenario: 'fresh' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Not set up')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Set up everything…' })).toBeInTheDocument();
    await expect(step(canvasElement, 'KPI work type').getByRole('button', { name: 'Create “KPI” work type' })).toBeInTheDocument();
    await expect(step(canvasElement, 'KPI fields').getByRole('button', { name: 'Create fields' })).toBeInTheDocument();
  },
};

export const CreateWorkType: Story = {
  args: { scenario: 'fresh' },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('Not set up');
    const workType = step(canvasElement, 'KPI work type');
    await userEvent.click(workType.getByRole('button', { name: 'Create “KPI” work type' }));
    await waitFor(() => expect(workType.getByText('In use')).toBeInTheDocument());
    await expect(workType.getByText('KPI')).toBeInTheDocument();
    await expect(workType.getByRole('button', { name: 'Change…' })).toBeInTheDocument();
  },
};

/** "Set up everything" lists what it will do, then does it. */
export const SetUpEverything: Story = {
  args: { scenario: 'fresh' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Set up everything…' }));
    await expect(c.getByText('Create a work type named KPI (with a target icon).')).toBeInTheDocument();
    await expect(c.getByText(/Create the central space/)).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Set it up' }));
    await waitFor(() => expect(c.getByText('Ready')).toBeInTheDocument());
    await expect(c.queryByRole('button', { name: 'Set up everything…' })).not.toBeInTheDocument();
    await expect(within(step(canvasElement, 'KPI fields').getByLabelText('Chosen fields')).getByText('KPI Direction')).toBeInTheDocument();
  },
};

/** An upgraded install: the KPI type comes from the older version; fields aren't chosen yet. */
export const UpgradedInstall: Story = {
  args: { scenario: 'upgraded' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Not set up')).toBeInTheDocument();
    await expect(step(canvasElement, 'KPI work type').getByText('In use')).toBeInTheDocument();
    await expect(step(canvasElement, 'KPI fields').getByText('To do')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Set up everything…' }));
    // Only what's left: the fields (the work type and space are kept).
    await expect(c.queryByText('Create a work type named KPI (with a target icon).')).not.toBeInTheDocument();
    await expect(c.getByText(/Create the fields KPI Unit/)).toBeInTheDocument();
  },
};

/** Pick existing fields: a short text for unit, a dropdown for direction with its options mapped. */
export const UseExistingFields: Story = {
  args: { scenario: 'upgraded' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await c.findByText('Not set up');
    const fields = step(canvasElement, 'KPI fields');
    await userEvent.click(fields.getByRole('button', { name: 'Use existing…' }));
    await userEvent.click(fields.getByRole('combobox', { name: /^Unit/ }));
    await userEvent.click(await c.findByText('Metric unit (short text)'));
    await userEvent.click(fields.getByRole('combobox', { name: /^Direction/ }));
    await userEvent.click(await c.findByText('Polarity (dropdown)'));
    // "Up" / "Down" are mapped from their names.
    await waitFor(() => expect(fields.getByText('Up')).toBeInTheDocument());
    await expect(fields.getByText('Down')).toBeInTheDocument();
    await userEvent.click(fields.getByRole('button', { name: 'Use these' }));
    await waitFor(() => expect(fields.getByText('In use')).toBeInTheDocument());
    await expect(within(fields.getByLabelText('Chosen fields')).getByText('Metric unit')).toBeInTheDocument();
    await expect(fields.getByText('(“Up” = higher is better, “Down” = lower is better)')).toBeInTheDocument();
    await expect(c.getByText('Ready')).toBeInTheDocument();
  },
};

/** Everything chosen; changing a block warns that existing KPIs aren't moved (Q8). */
export const FullyConfigured: Story = {
  args: { scenario: 'configured' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Ready')).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: 'Set up everything…' })).not.toBeInTheDocument();
    const fields = step(canvasElement, 'KPI fields');
    await expect(within(fields.getByLabelText('Chosen fields')).getByText('KPI Unit')).toBeInTheDocument();
    await userEvent.click(fields.getByRole('button', { name: 'Change…' }));
    await expect(fields.getByRole('note')).toHaveTextContent('Existing KPIs keep their unit and direction in the old fields');
    await userEvent.click(step(canvasElement, 'KPI work type').getByRole('button', { name: 'Change…' }));
    await expect(step(canvasElement, 'KPI work type').getByRole('note')).toHaveTextContent('Existing KPIs stay work items of KPI');
  },
};

/** The direction field was deleted in Jira: the block is broken, with a fix. */
export const BrokenBlock: Story = {
  args: { scenario: 'broken' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Needs attention')).toBeInTheDocument();
    const fields = step(canvasElement, 'KPI fields');
    await expect(fields.getByText('Field deleted')).toBeInTheDocument();
    await expect(fields.getByText(/The direction field \(customfield_\d+\) no longer exists/)).toBeInTheDocument();
    await userEvent.click(fields.getByRole('button', { name: 'Create fields' }));
    await waitFor(() => expect(c.getByText('Ready')).toBeInTheDocument());
  },
};

/** Jira refuses a change: the block says why and stays as it was. */
export const WriteRefused: Story = {
  args: { scenario: 'upgraded', options: { failWrites: 'Only Jira admins can change KPI settings.' } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('Not set up');
    const fields = step(canvasElement, 'KPI fields');
    await userEvent.click(fields.getByRole('button', { name: 'Create fields' }));
    await expect(await fields.findByRole('alert')).toHaveTextContent('Only Jira admins can change KPI settings.');
    await expect(fields.getByText('To do')).toBeInTheDocument();
  },
};

export const FreshInstallDark: Story = { args: { scenario: 'fresh' }, globals: { theme: 'dark' } };
export const BrokenBlockDark: Story = { args: { scenario: 'broken' }, globals: { theme: 'dark' } };
