import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor } from '@storybook/test';
import type { RollupConfig } from '@domain/index.js';
import { Settings } from './Settings.js';
import type { SettingsController, UseSettings } from '@ui/data/useSettingsData/index.js';

/**
 * Scenario stories for Settings — inject a stub loader hook to render each data
 * shape deterministically (default / custom / shallow / single-level / loading /
 * error). The `*.test.tsx` sibling replays them as assertions.
 */
const LEVELS = ['Outcome', 'Initiative', 'Increment', 'Epic', 'Story'];

function stub(over: Partial<SettingsController>): UseSettings {
  return () => ({
    levels: over.levels ?? null,
    config: over.config ?? null,
    pending: over.pending ?? false,
    error: over.error ?? null,
    save: over.save ?? (async () => {}),
  });
}

const meta: Meta<typeof Settings> = {
  component: Settings,
  title: 'Surfaces/Settings',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Settings>;

export const Default: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Due Date Rollup')).toBeInTheDocument();
    await expect(c.getByText('Outcome')).toBeInTheDocument();
    await expect(c.getByText('no children to roll up')).toBeInTheDocument();
  },
};

export const CustomConfig: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: { dueDateRollup: { Outcome: 'childrenOnly', Initiative: 'parentOnly' } },
    }),
  },
};

export const ShallowHierarchy: Story = {
  args: { useSettings: stub({ levels: ['Epic', 'Story'], config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Epic')).toBeInTheDocument();
  },
};

export const SingleLevel: Story = {
  args: { useSettings: stub({ levels: ['Task'], config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    // the only level is the leaf → its note shows
    await expect(within(canvasElement).getByText('no children to roll up')).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { useSettings: stub({ levels: null, pending: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Loading settings/i)).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: { useSettings: stub({ levels: null, error: 'nope' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Failed to load settings/i)).toBeInTheDocument();
  },
};

/** Interaction: "Save settings" persists the current per-level config. */
const saveSpy = fn(async (_c: RollupConfig) => {});
export const SaveInteraction: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, save: saveSpy }) },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  },
};
