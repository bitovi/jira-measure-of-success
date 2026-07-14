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
    space: over.space ?? { key: null, projectId: null, name: null, state: 'unset' },
    pending: over.pending ?? false,
    error: over.error ?? null,
    save: over.save ?? (async () => {}),
    saveSpaceKey:
      over.saveSpaceKey ??
      (async (key) => ({ key, projectId: null, name: null, state: 'missing' })),
    createSpace:
      over.createSpace ??
      (async (key) => ({ key, projectId: `p-${key}`, name: `KPIs (${key})`, state: 'ready' })),
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
    await expect(c.getByText('Story')).toBeInTheDocument();
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
    // the only level is the leaf → it has no children to roll up, only its name shows
    await expect(within(canvasElement).getByText('Task')).toBeInTheDocument();
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

// ── KPI space ────────────────────────────────────────────────────────────────
export const SpaceUnset: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('KPI Space')).toBeInTheDocument();
    await expect(c.getByText('Not set')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: /Create space/i })).toBeInTheDocument();
  },
};

export const SpaceReady: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: { dueDateRollup: {} },
      space: { key: 'KPI', projectId: 'p-KPI', name: 'KPIs (KPI)', state: 'ready' },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Connected')).toBeInTheDocument();
    await expect(c.getByText('KPIs (KPI)')).toBeInTheDocument();
  },
};

/** Project exists but the KPI issue type isn't associated — offer to finish setup. */
export const SpaceMisconfigured: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: { dueDateRollup: {} },
      space: { key: 'KPI', projectId: 'p-KPI', name: 'KPIs (KPI)', state: 'misconfigured' },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Needs setup')).toBeInTheDocument();
    await expect(c.getByText(/missing the/i)).toBeInTheDocument();
    await expect(c.getByRole('button', { name: /Create space/i })).toBeInTheDocument();
  },
};

/** Interaction: entering a key + "Create space" provisions the KPI project. */
const createSpy = fn(async (key: string) => ({
  key,
  projectId: `p-${key}`,
  name: `KPIs (${key})`,
  state: 'ready' as const,
}));
export const CreateSpaceInteraction: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, createSpace: createSpy }) },
  play: async ({ canvasElement }) => {
    createSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Create space/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith('KPI'));
  },
};
