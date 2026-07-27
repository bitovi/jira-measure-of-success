import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor } from '@storybook/test';
import type {
  CatalogEntryDto,
  PanelData,
  PanelRowDto,
  TimelineNodeDto,
} from '@domain/index.js';
import { IssuePanel } from './IssuePanel.js';
import type { PanelController, UsePanel } from '@ui/data/usePanelData/index.js';

/**
 * Scenario stories for the Issue panel. Each story injects a STUB loader hook
 * (`usePanel`) returning canned data, so every branch — loading / error / empty
 * / pending date / all groups — renders deterministically with no bridge.
 * The `*.test.tsx` sibling replays these same stories as assertions.
 */
// Ordered + depth-first to mirror the KPI tree (revenue > orders > stores;
// costs is a separate root) so the associate-form picker can indent options
// to show the parent/child relationship.
const CATALOG: CatalogEntryDto[] = [
  { id: 'revenue', name: 'Revenue', unit: 'USD', direction: 'increase', depth: 0 },
  { id: 'orders', name: '# of Orders', unit: 'count', direction: 'increase', depth: 1 },
  { id: 'stores', name: 'Number of Stores', unit: 'count', direction: 'increase', depth: 2 },
  { id: 'costs', name: 'Costs', unit: 'USD', direction: 'decrease', depth: 0 },
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
  resolvedValue: { value: 100, baseline: null, baselineDate: null, baselineFrom: null, state: 'baselined', provisional: false },
  displayState: 'baselined',
  warning: null,
  frozen: false,
  dueDate: '2026-10-31',
  dueDateRolledUp: false,
  actual: null,
  ...over,
});

const ALL_GROUPS: PanelData = {
  issueKey: 'INIT-48',
  catalog: CATALOG,
  issueDueDate: '2026-09-30',
  issueDueRolledUp: false,
  rows: [
    row({
      kpiId: 'revenue',
      name: 'Revenue',
      target: 100_000,
      relationship: 'shared',
      dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 1 },
      targetDate: { date: '2026-10-31', pending: false, source: '+1 mo after INIT-48 due, own date' },
      dueDate: '2026-09-30',
    }),
    row({ kpiId: 'stores', name: 'Number of Stores', unit: 'count', target: 250, relationship: 'onlyHere', targetDate: { date: '2026-09-30', pending: false, source: 'absolute date' } }),
    row({ kpiId: 'costs', name: 'Costs', unit: 'USD', direction: 'decrease', target: null, targetType: null, targetDate: null, dueTiming: null, relationship: 'onParentNotTracked', resolvedValue: null, displayState: null, dueDate: null }),
  ],
};

const PENDING_DATE: PanelData = {
  issueKey: 'OUT-12',
  catalog: CATALOG,
  issueDueDate: null,
  issueDueRolledUp: false,
  rows: [
    row({
      kpiId: 'revenue',
      name: 'Revenue',
      target: 1_500_000,
      relationship: 'onlyHere',
      dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
      targetDate: { date: null, pending: true, source: 'due date pending' },
      displayState: 'provisional',
      dueDate: null,
    }),
  ],
};

const EMPTY: PanelData = { issueKey: 'STORY-1', catalog: CATALOG, issueDueDate: '2026-09-30', issueDueRolledUp: false, rows: [] };

const NO_CATALOG: PanelData = { issueKey: 'STORY-1', catalog: [], issueDueDate: null, issueDueRolledUp: false, rows: [] };

/** A saved PERCENT-change target row (Number of Stores, +10%) in a given state. */
const deltaRow = (over: Partial<PanelRowDto> & { displayState: PanelRowDto['displayState'] }): PanelRowDto =>
  row({
    kpiId: 'stores',
    name: 'Number of Stores',
    unit: 'count',
    target: 10,
    targetType: 'delta',
    relationship: 'onlyHere',
    dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
    targetDate: { date: '2027-04-15', pending: false, source: '+3 mo after INIT-48 due' },
    dueDate: '2027-01-15',
    dueDateRolledUp: true,
    ...over,
  });

const provisionalRV = { baseline: 250, value: 275, baselineDate: '2027-01-15', baselineFrom: '2026-06-30', state: 'provisional' as const, provisional: true };
const baselinedRV = { baseline: 258, value: 284, baselineDate: '2026-06-01', baselineFrom: '2026-06-01', state: 'baselined' as const, provisional: false };

const SAVED_STATES: PanelData = {
  issueKey: 'INIT-48',
  catalog: CATALOG,
  issueDueDate: '2027-01-15',
  issueDueRolledUp: true,
  rows: [
    deltaRow({ displayState: 'projected', resolvedValue: provisionalRV, warning: null }),
    deltaRow({ displayState: 'provisional', targetDate: { date: null, pending: true, source: 'pending' }, dueDate: null, resolvedValue: { ...provisionalRV, baselineDate: null }, warning: null }),
    deltaRow({ displayState: 'baselined', dueDate: '2026-06-01', dueDateRolledUp: false, targetDate: { date: '2026-09-01', pending: false, source: '' }, resolvedValue: baselinedRV, warning: null }),
    deltaRow({ displayState: 'needsMeasurement', dueDate: '2026-06-01', dueDateRolledUp: false, targetDate: { date: '2026-09-01', pending: false, source: '' }, resolvedValue: provisionalRV, warning: 'staleBaseline' }),
    deltaRow({ displayState: 'met', dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' }, resolvedValue: { ...baselinedRV, baseline: 250, value: 275 }, actual: 281, warning: null }),
    deltaRow({ displayState: 'missed', dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' }, resolvedValue: { ...baselinedRV, baseline: 250, value: 275 }, actual: 268, warning: null }),
    deltaRow({ displayState: 'resultUnknown', dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' }, resolvedValue: { ...baselinedRV, baseline: 250, value: 275 }, actual: null, warning: 'unconfirmedResult' }),
    deltaRow({ displayState: 'needsBaseline', resolvedValue: { baseline: null, value: null, baselineDate: '2027-01-15', baselineFrom: null, state: 'needsBaseline', provisional: true }, warning: 'needsBaseline' }),
  ],
};

/** Build a stub loader hook returning a fixed controller. */
// This issue IS a KPI (lives in the KPI space): the panel renders the single-KPI
// chart (KpiView) instead of the associate/target-editor form (Feature 04).
const KPI_NODE: TimelineNodeDto = {
  id: 'n1',
  kpiId: 'revenue',
  issueKey: 'KPI-1',
  name: 'Revenue',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  readings: [
    { date: '2026-01-03', value: 1_000_000 },
    { date: '2026-05-05', value: 1_129_000 },
    { date: '2026-07-06', value: 1_243_000 },
  ],
  targets: [
    {
      date: '2026-09-30',
      value: 1_400_000,
      status: 'upcoming',
      provisional: false,
      source: { issue: 'OUT-12', type: 'Outcome', title: 'Grow Revenue', iconUrl: null },
    },
  ],
  undated: [],
  children: [],
};

const KPI_VIEW: PanelData = {
  issueKey: 'KPI-1',
  catalog: CATALOG,
  issueDueDate: null,
  issueDueRolledUp: false,
  rows: [],
  kpiView: { node: KPI_NODE, today: '2026-07-10' },
};

function stub(over: Partial<PanelController> & { data: PanelData | null }): UsePanel {
  return () => ({
    data: over.data,
    pending: over.pending ?? false,
    error: over.error ?? null,
    busy: over.busy ?? false,
    save: over.save ?? (() => {}),
    remove: over.remove ?? (() => {}),
    record: over.record ?? (() => {}),
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
    await expect(c.getByText('1 month after due date')).toBeInTheDocument();
    // "Set a KPI target" picker indents options by KPI-tree depth (orders is
    // nested under revenue in CATALOG; costs is a root alongside revenue).
    const orderedOption = canvasElement.querySelector('option[value="orders"]') as HTMLOptionElement;
    const rootOption = canvasElement.querySelector('option[value="costs"]') as HTMLOptionElement;
    await expect(orderedOption.style.paddingLeft).toBe('12px');
    await expect(rootOption.style.paddingLeft).toBe('0px');
  },
};

/** The eight FR-26 saved-target states for a percent-change target. */
export const SavedStates: Story = {
  args: { usePanel: stub({ data: SAVED_STATES }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Projected')).toBeInTheDocument();
    await expect(c.getByText('Baselined')).toBeInTheDocument();
    await expect(c.getByText('Needs measurement')).toBeInTheDocument();
    await expect(c.getByText('Met ✓')).toBeInTheDocument();
    await expect(c.getByText('Missed ✗')).toBeInTheDocument();
    await expect(c.getByText('Result unknown')).toBeInTheDocument();
    await expect(c.getByText('Needs baseline')).toBeInTheDocument();
    // provisional baseline note + warnings render
    await expect(c.getAllByText(/baseline \(provisional from/i).length).toBeGreaterThan(0);
    await expect(c.getByText(/baseline may be stale/i)).toBeInTheDocument();
    await expect(c.getByText(/needs at least one reading/i)).toBeInTheDocument();
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

/**
 * Feature 04: when this issue IS a KPI, the panel renders ONLY the single-KPI
 * chart (KpiView) — no group list, no "Set a KPI target" associate form.
 */
const kpiRecordSpy = fn();
export const KpiIssue: Story = {
  args: { usePanel: stub({ data: KPI_VIEW, record: kpiRecordSpy }) },
  play: async ({ canvasElement }) => {
    kpiRecordSpy.mockClear();
    const c = within(canvasElement);
    // The chart header + its record action render...
    await expect(c.getByRole('link', { name: 'Revenue' })).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Record a value' })).toBeInTheDocument();
    // ...and the associate/target form is NOT present.
    await expect(c.queryByText(/Associate a KPI/i)).not.toBeInTheDocument();
    await expect(c.queryByText(/Set a KPI target/i)).not.toBeInTheDocument();
    // Recording a value flows through the panel's `record` action.
    await userEvent.click(c.getByRole('button', { name: 'Record a value' }));
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(kpiRecordSpy).toHaveBeenCalledWith('revenue', '2026-07-10', 1_300_000));
  },
};
