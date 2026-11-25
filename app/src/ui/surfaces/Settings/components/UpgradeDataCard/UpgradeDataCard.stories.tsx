import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { useMigrationsData, type MigrationsApi, type UseMigrations } from '@ui/data/useMigrationsData/index.js';
import {
  createMockMigrations,
  mockMigrationsApi,
  SECOND_MIGRATION,
  type MigrationsMode,
  type MockMigrationsOptions,
} from '@harness/fixtures/mockMigrations.js';
import { UpgradeDataCard } from './UpgradeDataCard.js';

/**
 * Upgrade data scenarios (spec 11 · 04 Step 6). Each story runs the real loader
 * hook against its own in-memory migrations (03's and 05's stand-ins; the
 * second waits for the first), so Upgrade, Pause, Resume and Retry really run.
 */
function withMigrations(mode: MigrationsMode, options: MockMigrationsOptions = {}, delayMs = 0): UseMigrations {
  return function useStoryMigrations() {
    const [api] = useState<MigrationsApi>(() => mockMigrationsApi(createMockMigrations(mode, options), delayMs));
    return useMigrationsData(api);
  };
}

const FIELDS_NOT_CHOSEN: MockMigrationsOptions = {
  applicability: (id) =>
    id === SECOND_MIGRATION
      ? { applicable: false, reason: 'Choose the KPI fields in Settings first (KPI building blocks).' }
      : { applicable: true },
};

const row = (canvas: HTMLElement, title: string) => within(within(canvas).getByRole('listitem', { name: title }));

const meta: Meta<typeof UpgradeDataCard> = {
  component: UpgradeDataCard,
  title: 'Surfaces/Settings/UpgradeDataCard',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof UpgradeDataCard>;

/** After upgrading: two upgrades to run; the second waits for the first. */
export const Pending: Story = {
  args: { useMigrations: withMigrations('pending') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByRole('heading', { name: 'Upgrade data' })).toBeInTheDocument();
    await expect(c.getByText('2 upgrades to run')).toBeInTheDocument();
    await expect(row(canvasElement, 'Point targets at KPI ids').getByText('To do')).toBeInTheDocument();
    await expect(row(canvasElement, 'Point targets at KPI ids').getByText('59 work items left')).toBeInTheDocument();
    await expect(row(canvasElement, 'Move unit and direction into fields').getByText('Waiting')).toBeInTheDocument();
    await expect(c.getByText('Runs after Point targets at KPI ids.')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Upgrade' })).toBeEnabled();
  },
};

/** Upgrade runs both in order, batch by batch, then the card collapses to one line. */
export const RunToDone: Story = {
  args: { useMigrations: withMigrations('pending') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Upgrade' }));
    await waitFor(() => expect(c.getByText('All data is up to date.')).toBeInTheDocument(), { timeout: 3000 });
    await userEvent.click(c.getByRole('button', { name: 'Details' }));
    await expect(row(canvasElement, 'Point targets at KPI ids').getByText('59 upgraded · 1 skipped')).toBeInTheDocument();
    await expect(row(canvasElement, 'Move unit and direction into fields').getByText('Done')).toBeInTheDocument();
  },
};

/** Pause stops after the batch in flight; Resume carries on from there. */
export const PauseAndResume: Story = {
  args: { useMigrations: withMigrations('pending', {}, 30) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Upgrade' }));
    await userEvent.click(await c.findByRole('button', { name: 'Pause' }));
    const resume = await c.findByRole('button', { name: 'Resume' }, { timeout: 2000 });
    const first = row(canvasElement, 'Point targets at KPI ids');
    await expect(first.getByText('Paused')).toBeInTheDocument();
    await expect(first.getByText(/upgraded/)).toBeInTheDocument();
    await userEvent.click(resume);
    await waitFor(() => expect(c.getByText('All data is up to date.')).toBeInTheDocument(), { timeout: 3000 });
  },
};

/** Started earlier and left part-way: Resume. */
export const PartWay: Story = {
  args: { useMigrations: withMigrations('running') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await expect(row(canvasElement, 'Point targets at KPI ids').getByText('Paused')).toBeInTheDocument();
  },
};

/** A run that ended with failures lists them; Retry failed runs it again to done. */
export const RetryFailed: Story = {
  args: { useMigrations: withMigrations('failed') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await c.findByRole('listitem', { name: 'Point targets at KPI ids' });
    const first = row(canvasElement, 'Point targets at KPI ids');
    await expect(first.getByText('Failed')).toBeInTheDocument();
    await expect(first.getByText('APP-4')).toBeInTheDocument();
    await expect(first.getByText('APP-41')).toBeInTheDocument();
    // Nothing else can run: the second waits for the failed one.
    await expect(c.getByRole('button', { name: 'Upgrade' })).toBeDisabled();
    await userEvent.click(first.getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(c.getByText('All data is up to date.')).toBeInTheDocument(), { timeout: 3000 });
  },
};

/** 05's migration doesn't apply until the KPI fields are chosen: the run stops before it, with the reason. */
export const NotApplicable: Story = {
  args: { useMigrations: withMigrations('pending', FIELDS_NOT_CHOSEN) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Upgrade' }));
    const second = row(canvasElement, 'Move unit and direction into fields');
    await waitFor(() => expect(second.getByText('Not yet')).toBeInTheDocument(), { timeout: 3000 });
    await expect(second.getByText('Choose the KPI fields in Settings first (KPI building blocks).')).toBeInTheDocument();
    await expect(row(canvasElement, 'Point targets at KPI ids').getByText('Done')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Upgrade' })).toBeDisabled();
    await expect(c.getByText('1 upgrade to run')).toBeInTheDocument();
  },
};

/** Everything done: one collapsed line. */
export const AllDone: Story = {
  args: { useMigrations: withMigrations('done') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('All data is up to date.')).toBeInTheDocument();
    await expect(c.queryByRole('heading', { name: 'Upgrade data' })).not.toBeInTheDocument();
  },
};

const failingApi: MigrationsApi = {
  getMigrations: () => Promise.reject(new Error('Jira 503')),
  runMigrationBatch: () => Promise.reject(new Error('unused')),
  retryMigration: () => Promise.reject(new Error('unused')),
};

export const LoadError: Story = {
  args: { useMigrations: () => useMigrationsData(failingApi) },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Couldn’t check whether KPI data needs upgrading: Jira 503/)).toBeInTheDocument();
  },
};

/** A batch that throws stops the run and says why. */
export const RunError: Story = {
  args: {
    useMigrations: function useFailingRun() {
      const [api] = useState<MigrationsApi>(() => {
        const base = mockMigrationsApi(createMockMigrations('pending'));
        return { ...base, runMigrationBatch: () => Promise.reject(new Error('Only Jira admins can change KPI settings.')) };
      });
      return useMigrationsData(api);
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Upgrade' }));
    await expect(await c.findByRole('alert')).toHaveTextContent('Only Jira admins can change KPI settings.');
    await expect(await c.findByRole('button', { name: 'Upgrade' })).toBeEnabled();
  },
};

export const PendingDark: Story = {
  ...Pending,
  globals: { theme: 'dark' },
};

export const RetryFailedDark: Story = {
  args: { useMigrations: withMigrations('failed') },
  globals: { theme: 'dark' },
};
