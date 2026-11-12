import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import type { IssueLinkTypeInfo, KpiHierarchyStatus } from '@domain/index.js';
import { KpiHierarchyCard } from './KpiHierarchyCard.js';

const BLOCKS: IssueLinkTypeInfo = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
const CLONERS: IssueLinkTypeInfo = { id: '10001', name: 'Cloners', inward: 'is cloned by', outward: 'clones' };
const DUPLICATE: IssueLinkTypeInfo = { id: '10002', name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' };
const RELATES: IssueLinkTypeInfo = { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' };
const KPI_HIER: IssueLinkTypeInfo = {
  id: '10500',
  name: 'KPI Hierarchy',
  inward: 'is a child KPI of',
  outward: 'is the parent KPI of',
};
/** Jira Cloud's out-of-the-box link types. */
const STOCK = [BLOCKS, CLONERS, DUPLICATE, RELATES];

const status = (over: Partial<KpiHierarchyStatus>): KpiHierarchyStatus => ({
  state: 'unset',
  linkType: null,
  linkTypeId: null,
  parentEnd: 'inward',
  available: STOCK,
  ...over,
});

const READY = status({ state: 'ready', linkType: KPI_HIER, linkTypeId: KPI_HIER.id, available: [...STOCK, KPI_HIER] });

const meta: Meta<typeof KpiHierarchyCard> = {
  component: KpiHierarchyCard,
  title: 'Surfaces/Settings/KpiHierarchyCard',
  parameters: { layout: 'padded' },
  args: {
    hierarchy: status({}),
    onSave: fn(async (input) => status({ state: 'ready', linkTypeId: input.linkTypeId, parentEnd: input.parentEnd })),
    onCreate: fn(async () => READY),
  },
};
export default meta;
type Story = StoryObj<typeof KpiHierarchyCard>;

/** Fresh site (stock link types only): offer to create the app's type. */
export const Unset: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Not set')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Create “KPI Hierarchy” link type' })).toBeInTheDocument();
  },
};

export const Ready: Story = {
  args: { hierarchy: READY },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Connected')).toBeInTheDocument();
    await expect(c.getByText('“Parent is the parent KPI of child”')).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  },
};

/** Reusing a stock type, child on the inward end. */
export const ReadyWithBlocks: Story = {
  args: { hierarchy: status({ state: 'ready', linkType: BLOCKS, linkTypeId: BLOCKS.id, parentEnd: 'outward' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('“Child blocks parent”')).toBeInTheDocument();
  },
};

export const Missing: Story = {
  args: { hierarchy: status({ state: 'missing', linkTypeId: '10999' }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Link type deleted')).toBeInTheDocument();
    await expect(c.getByText(/was deleted from Jira/)).toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  args: { hierarchy: status({ state: 'unavailable', available: [], message: 'Jira 404: Issue linking is disabled.' }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Unavailable')).toBeInTheDocument();
    await expect(c.getByText(/Issue linking is disabled/)).toBeInTheDocument();
    await expect(c.queryByRole('button')).not.toBeInTheDocument();
  },
};

/** A same-named type already exists (e.g. after a reinstall): adopt, don't duplicate. */
export const AppTypeAlreadyExists: Story = {
  args: { hierarchy: status({ available: [...STOCK, KPI_HIER] }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Use “KPI Hierarchy” link type' }),
    ).toBeInTheDocument();
  },
};

const createSpy = fn(async () => READY);
export const CreateInteraction: Story = {
  args: { onCreate: createSpy },
  play: async ({ canvasElement }) => {
    createSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Create “KPI Hierarchy” link type' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
  },
};

const saveSpy = fn(async () => READY);
/** Pick "Blocks", flip it to "Child blocks parent", save. Symmetric "Relates" isn't offered. */
export const UseExistingInteraction: Story = {
  args: { onSave: saveSpy },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('combobox', { name: 'Link type' }));
    await expect(c.queryByText('Relates')).not.toBeInTheDocument();
    await userEvent.click(await c.findByText('Blocks'));
    await expect(c.getByText(/Every/)).toHaveTextContent('Every Blocks link between two KPIs will be read as nesting');
    await userEvent.click(c.getByRole('combobox', { name: 'Direction' }));
    await userEvent.click(await c.findByText('Child blocks parent'));
    await userEvent.click(c.getByRole('button', { name: 'Use this link type' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ linkTypeId: '10000', parentEnd: 'outward' }));
  },
};

/** Changing a connected hierarchy warns that existing nesting is lost. */
export const ChangeInteraction: Story = {
  args: { hierarchy: READY },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Change' }));
    await expect(c.getByRole('button', { name: 'Use this link type' })).toBeDisabled();
    await userEvent.click(c.getByRole('combobox', { name: 'Link type' }));
    await userEvent.click(await c.findByText('Duplicate'));
    await expect(c.getByText(/will lose their nesting/)).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }));
    await expect(c.getByText('“Parent is the parent KPI of child”')).toBeInTheDocument();
    // Cancel discards the abandoned pick
    await userEvent.click(c.getByRole('button', { name: 'Change' }));
    await expect(c.getByRole('button', { name: 'Use this link type' })).toBeDisabled();
    await expect(c.queryByText(/will lose their nesting/)).not.toBeInTheDocument();
  },
};

/** Flipping only the direction warns that existing nesting is inverted, not lost. */
export const FlipDirectionInteraction: Story = {
  args: { hierarchy: READY },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Change' }));
    await userEvent.click(c.getByRole('combobox', { name: 'Direction' }));
    await userEvent.click(await c.findByText('Child is the parent KPI of parent'));
    await expect(c.getByText(/read the other way round/)).toBeInTheDocument();
    await expect(c.queryByText(/will lose their nesting/)).not.toBeInTheDocument();
  },
};

const failingSave = fn(async () => {
  throw new Error('Jira 403 while trying to create the "KPI Hierarchy" issue link type: Forbidden');
});
export const CreateError: Story = {
  args: { onCreate: failingSave },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Create “KPI Hierarchy” link type' }));
    await expect(await c.findByText(/Jira 403/)).toBeInTheDocument();
  },
};

/**
 * The "Use “KPI Hierarchy”" button switches the configuration in one click, so
 * it warns about what IT would change — not only what the picker would.
 */
export const DefaultButtonWarnsWhenSwitchingType: Story = {
  args: {
    hierarchy: status({ state: 'ready', linkType: BLOCKS, linkTypeId: BLOCKS.id, parentEnd: 'outward', available: [...STOCK, KPI_HIER] }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Change' }));
    // the picker still shows the current (Blocks) setting, so it has nothing to warn about…
    await expect(c.getByRole('button', { name: 'Use this link type' })).toBeDisabled();
    // …but the default button would switch to KPI Hierarchy
    await expect(c.getByRole('button', { name: 'Use “KPI Hierarchy” link type' })).toBeEnabled();
    await expect(
      c.getByText('Switching to “KPI Hierarchy”: KPIs already nested with Blocks links will lose their nesting.'),
    ).toBeInTheDocument();
  },
};

/** Already on KPI Hierarchy but the other way round: the default button would flip it back. */
export const DefaultButtonWarnsWhenResettingDirection: Story = {
  args: { hierarchy: { ...READY, parentEnd: 'outward' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Change' }));
    await expect(c.getByText(/This button also resets the direction/)).toBeInTheDocument();
    await expect(c.queryByText(/will lose their nesting/)).not.toBeInTheDocument();
  },
};

/** Already using exactly what the default button applies: it's disabled, with no warning. */
export const DefaultButtonAlreadyInUse: Story = {
  args: { hierarchy: READY },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Change' }));
    await expect(c.getByRole('button', { name: 'Use “KPI Hierarchy” link type' })).toBeDisabled();
    await expect(c.getByText(/Already in use/)).toBeInTheDocument();
    await expect(c.queryByText(/This button also resets|Switching to/)).not.toBeInTheDocument();
  },
};
