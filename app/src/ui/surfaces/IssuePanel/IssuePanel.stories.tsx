import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor } from '@storybook/test';
import type {
  CatalogEntryDto,
  PanelData,
  PanelRowDto,
} from '@domain/index.js';
import { IssuePanel } from './IssuePanel.js';
import type { PanelController, UsePanel } from '@ui/data/usePanelData/index.js';

/**
 * Scenario stories for the Issue panel. Each story injects a STUB loader hook
 * (`usePanel`) returning canned data, so every branch — loading / error / empty
 * / pending date / all groups — renders deterministically with no bridge.
 * The `*.test.tsx` sibling replays these same stories as assertions.
 */
const CATALOG: CatalogEntryDto[] = [
  { id: 'revenue', name: 'Revenue', unit: 'USD', direction: 'increase' },
  { id: 'stores', name: 'Number of Stores', unit: 'count', direction: 'increase' },
  { id: 'costs', name: 'Costs', unit: 'USD', direction: 'decrease' },
  { id: 'orders', name: '# of Orders', unit: 'count', direction: 'increase' },
];

const row = (over: Partial<PanelRowDto> & { kpiId: string }): PanelRowDto => ({
  name: over.kpiId,
  unit: 'USD',
  direction: 'increase',
  target: 100,
  targetType: 'absolute',
  targetDate: { date: '2026-10-31', pending: false, source: 'absolute date' },
  dueTiming: { mode: 'absolute', absolute: '2026-10-31', anchor: 'issueDueDate', offsetMonths: 0 },
  start: null,
  relationship: 'onlyHere',
  ...over,
});

const ALL_GROUPS: PanelData = {
  issueKey: 'INIT-48',
  catalog: CATALOG,
  rows: [
    row({
      kpiId: 'revenue',
      name: 'Revenue',
      target: 100_000,
      relationship: 'shared',
      dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 1 },
      targetDate: { date: '2026-10-31', pending: false, source: '+1 mo after INIT-48 due, own date' },
    }),
    row({ kpiId: 'stores', name: 'Number of Stores', unit: 'count', target: 250, relationship: 'onlyHere', targetDate: { date: '2026-09-30', pending: false, source: 'absolute date' } }),
    row({ kpiId: 'costs', name: 'Costs', unit: 'USD', direction: 'decrease', target: null, targetType: null, targetDate: null, dueTiming: null, relationship: 'onParentNotTracked' }),
  ],
};

const PENDING_DATE: PanelData = {
  issueKey: 'OUT-12',
  catalog: CATALOG,
  rows: [
    row({
      kpiId: 'revenue',
      name: 'Revenue',
      target: 1_500_000,
      relationship: 'onlyHere',
      dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
      targetDate: { date: null, pending: true, source: 'due date pending' },
    }),
  ],
};

const EMPTY: PanelData = { issueKey: 'STORY-1', catalog: CATALOG, rows: [] };

const NO_CATALOG: PanelData = { issueKey: 'STORY-1', catalog: [], rows: [] };

/** Build a stub loader hook returning a fixed controller. */
function stub(over: Partial<PanelController> & { data: PanelData | null }): UsePanel {
  return () => ({
    data: over.data,
    pending: over.pending ?? false,
    error: over.error ?? null,
    busy: over.busy ?? false,
    save: over.save ?? (() => {}),
    remove: over.remove ?? (() => {}),
  });
}

const meta: Meta<typeof IssuePanel> = {
  component: IssuePanel,
  title: 'Surfaces/IssuePanel',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof IssuePanel>;

export const AllGroups: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Shared with parent')).toBeInTheDocument();
    await expect(c.getByText('Only on this issue')).toBeInTheDocument();
    await expect(c.getByText('On parent, not tracked here')).toBeInTheDocument();
    await expect(c.getByText('+1 mo after INIT-48 due, own date')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { usePanel: stub({ data: EMPTY }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/No KPIs tracked/i)).toBeInTheDocument();
  },
};

export const NoCatalog: Story = {
  args: { usePanel: stub({ data: NO_CATALOG }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/KPIs are not defined yet/i)).toBeInTheDocument();
    await expect(c.queryByText('Associate a KPI')).not.toBeInTheDocument();
    await expect(c.getByRole('button', { name: /define a KPI/i })).toBeInTheDocument();
  },
};

export const PendingTargetDate: Story = {
  args: { usePanel: stub({ data: PENDING_DATE }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('pending')).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { usePanel: stub({ data: null, pending: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Loading KPIs/i)).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: { usePanel: stub({ data: null, error: 'boom' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Failed to load KPIs/i)).toBeInTheDocument();
  },
};

/** Interaction: editing a row's target value calls `save` with the new value. */
const editSaveSpy = fn();
export const EditRoundTrip: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS, save: editSaveSpy }) },
  play: async ({ canvasElement }) => {
    editSaveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Edit' })[0]);
    // the edit row's value input precedes the associate form's (same placeholder)
    const valueInput = c.getAllByPlaceholderText('e.g. 250')[0];
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, '123456');
    await userEvent.click(c.getByRole('button', { name: '✓ Save' }));
    await waitFor(() => expect(editSaveSpy).toHaveBeenCalledTimes(1));
  },
};
