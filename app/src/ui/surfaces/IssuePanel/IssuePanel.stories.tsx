import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor, screen } from '@storybook/test';
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
const percentRow = (over: Partial<PanelRowDto> & { kpiId: string; displayState: PanelRowDto['displayState'] }): PanelRowDto =>
  row({
    name: 'Number of Stores',
    unit: 'count',
    target: 10,
    targetType: 'percent',
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
    percentRow({ kpiId: 'stores-1', displayState: 'projected', resolvedValue: provisionalRV, warning: null }),
    percentRow({ kpiId: 'stores-2', displayState: 'provisional', targetDate: { date: null, pending: true, source: 'pending' }, dueDate: null, resolvedValue: { ...provisionalRV, baselineDate: null }, warning: null }),
    percentRow({ kpiId: 'stores-3', displayState: 'baselined', dueDate: '2026-06-01', dueDateRolledUp: false, targetDate: { date: '2026-09-01', pending: false, source: '' }, resolvedValue: baselinedRV, warning: null }),
    percentRow({ kpiId: 'stores-4', displayState: 'needsMeasurement', dueDate: '2026-06-01', dueDateRolledUp: false, targetDate: { date: '2026-09-01', pending: false, source: '' }, resolvedValue: { ...provisionalRV, baselineDate: '2026-06-01', baselineFrom: '2026-04-30' }, warning: 'staleBaseline' }),
    percentRow({ kpiId: 'stores-5', displayState: 'met', dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' }, resolvedValue: { ...baselinedRV, baseline: 250, value: 275 }, actual: 281, warning: null }),
    percentRow({ kpiId: 'stores-6', displayState: 'missed', dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' }, resolvedValue: { ...baselinedRV, baseline: 250, value: 275 }, actual: 268, warning: null }),
    percentRow({ kpiId: 'stores-7', displayState: 'resultUnknown', dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' }, resolvedValue: { ...baselinedRV, baseline: 250, value: 275 }, actual: null, warning: 'unconfirmedResult' }),
    percentRow({ kpiId: 'stores-8', displayState: 'needsBaseline', resolvedValue: { baseline: null, value: null, baselineDate: '2027-01-15', baselineFrom: null, state: 'needsBaseline', provisional: true }, warning: 'needsBaseline' }),
  ],
};

/** Matches a whole estimate line, whose numbers/dates are separate spans. */
const estimateLine = (re: RegExp) => (_: string, el: Element | null) => el?.tagName === 'P' && re.test(el.textContent ?? '');

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
      relative: false,
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
    valuesPending: over.valuesPending ?? false,
    valuesError: over.valuesError ?? null,
    retryValues: over.retryValues ?? (() => {}),
    error: over.error ?? null,
    busy: over.busy ?? false,
    actionError: over.actionError ?? null,
    dismissActionError: over.dismissActionError ?? (() => {}),
    save: over.save ?? (() => {}),
    remove: over.remove ?? (() => {}),
    record: over.record ?? (async () => {}),
  });
}

/** ALL_GROUPS as Phase 1 delivers it (spec 07): targets and grouping, values still loading. */
const VALUES_LOADING: PanelData = {
  ...ALL_GROUPS,
  resolving: true,
  issueDueDate: null,
  issueDueRolledUp: false,
  catalog: ALL_GROUPS.catalog.map((c) => ({ ...c, currentValue: null })),
  rows: ALL_GROUPS.rows.map((r) =>
    r.relationship === 'onParentNotTracked'
      ? r
      : {
          ...r,
          targetDate: null,
          resolvedValue: null,
          displayState: null,
          warning: null,
          frozen: false,
          dueDate: null,
          dueDateRolledUp: false,
          actual: null,
          resolving: true,
        },
  ),
};

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
    await userEvent.click(c.getByRole('combobox', { name: 'KPI' }));
    const nested = await c.findByText('# of Orders');
    const root = (await c.findAllByText('Costs')).find((el) => el.style.paddingLeft !== '');
    await expect(nested.style.paddingLeft).toBe('12px');
    await expect(root?.style.paddingLeft).toBe('0px');
  },
};

/** The eight FR-26 saved-target states for a percent-change target (mock v3 wording). */
export const SavedStates: Story = {
  args: { usePanel: stub({ data: SAVED_STATES }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    // the bet, as typed, is the headline on every card
    await expect(c.getAllByText('+10%')).toHaveLength(8);
    await expect(c.getAllByText('3 months after due date')).toHaveLength(8);
    // one pill per card
    await expect(c.getAllByText('Upcoming')).toHaveLength(2);
    await expect(c.getByText('Pending')).toBeInTheDocument();
    await expect(c.getAllByText('In progress')).toHaveLength(2);
    await expect(c.getByText('Met')).toBeInTheDocument();
    await expect(c.getByText('Missed')).toBeInTheDocument();
    await expect(c.getByText('Not measured')).toBeInTheDocument();
    // locked vs estimated
    const lines = [...canvasElement.querySelectorAll('article p.text-sm')].map((p) => p.textContent);
    await expect(lines).toEqual([
      'Estimated target 275 by Apr 15, 2027 · from 250 now',
      'Estimated target 275 · from 250 now · no due date yet',
      'Target 284 by Sep 1, 2026 · from 258 on Jun 1',
      'Estimated target 275 by Sep 1, 2026 · from 250 on Apr 30',
      'Target 275 by Apr 15, 2026 · reached 281',
      'Target 275 by Apr 15, 2026 · reached 268',
      'Target 275 by Apr 15, 2026 · no reading',
      'Estimated target — by Apr 15, 2027 · no readings yet',
    ]);
    // missing readings become nudges with a Record action
    await expect(c.getByText(/record a value to lock in the target/i)).toBeInTheDocument();
    await expect(c.getByText(/can’t tell if it was met/i)).toBeInTheDocument();
    await expect(c.getByText('A % change needs a starting value.')).toBeInTheDocument();
    await expect(c.getAllByRole('button', { name: 'Record a value' })).toHaveLength(3);
  },
};

/** The nudge's "Record a value" opens the record modal and records against that KPI. */
const nudgeRecordSpy = fn();
export const RecordFromNudge: Story = {
  args: { usePanel: stub({ data: SAVED_STATES, record: nudgeRecordSpy }) },
  play: async ({ canvasElement }) => {
    nudgeRecordSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Record a value' })[0]!);
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '262');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(nudgeRecordSpy).toHaveBeenCalledWith('stores-4', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 262));
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
    await expect(c.getByText('Pending')).toBeInTheDocument();
    await expect(c.getByText(/no due date yet/)).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { usePanel: stub({ data: null, pending: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Loading KPIs/i)).toBeInTheDocument();
  },
};

/** Phase 1 arrived: every target and the form show; estimates and pills shimmer until Phase 2. */
export const ValuesLoading: Story = {
  args: { usePanel: stub({ data: VALUES_LOADING, valuesPending: true }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const tracked = VALUES_LOADING.rows.filter((r) => r.relationship !== 'onParentNotTracked');
    await expect(c.getByText('Shared with parent')).toBeInTheDocument();
    await expect(c.getByText('1 month after due date')).toBeInTheDocument();
    await expect(c.getAllByTestId('estimate-shimmer')).toHaveLength(tracked.length);
    await expect(c.getAllByText('Loading estimate…')).toHaveLength(tracked.length);
    // every card's estimate line is the placeholder, and no status pill shows yet
    const lines = [...canvasElement.querySelectorAll('article p.text-sm')].map((p) => p.textContent);
    await expect(lines).toEqual(tracked.map(() => 'Loading estimate…'));
    await expect(c.queryByText(/^(Upcoming|Pending|In progress|Met|Missed|Not measured)$/)).not.toBeInTheDocument();
    // the form is usable right away
    await expect(c.getByRole('combobox', { name: 'KPI' })).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Set KPI target' })).toBeInTheDocument();
  },
};

/** Phase 2 failed: the targets stay, the shimmer stops, and a banner offers a retry. */
const retryValuesSpy = fn();
export const ValuesFailed: Story = {
  args: {
    usePanel: stub({
      data: {
        ...VALUES_LOADING,
        resolving: undefined,
        rows: VALUES_LOADING.rows.map((r) => ({ ...r, resolving: undefined })),
      },
      valuesError: 'Request timed out',
      retryValues: retryValuesSpy,
    }),
  },
  play: async ({ canvasElement }) => {
    retryValuesSpy.mockClear();
    const c = within(canvasElement);
    await expect(c.getByRole('alert')).toHaveTextContent('Couldn’t load estimates');
    await expect(c.queryByTestId('estimate-shimmer')).not.toBeInTheDocument();
    await expect(c.getByText('1 month after due date')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Retry' }));
    await expect(retryValuesSpy).toHaveBeenCalledOnce();
  },
};

export const ErrorState: Story = {
  args: { usePanel: stub({ data: null, error: 'boom' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Failed to load KPIs/i)).toBeInTheDocument();
  },
};

/** A save / remove failed: the panel keeps its data and shows a dismissible alert. */
const dismissActionErrorSpy = fn();
export const ActionFailed: Story = {
  args: {
    usePanel: stub({ data: ALL_GROUPS, actionError: 'Network error', dismissActionError: dismissActionErrorSpy }),
  },
  play: async ({ canvasElement }) => {
    dismissActionErrorSpy.mockClear();
    const c = within(canvasElement);
    await expect(c.getByRole('alert')).toHaveTextContent('Couldn’t save your change');
    await expect(c.getByRole('alert')).toHaveTextContent('Network error');
    await expect(c.getByRole('group', { name: 'Revenue' })).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Dismiss' }));
    await expect(dismissActionErrorSpy).toHaveBeenCalledOnce();
  },
};

/** The KPI View variant surfaces a failed reading write too. */
export const KpiViewActionFailed: Story = {
  args: { usePanel: stub({ data: KPI_VIEW, actionError: 'Network error' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Couldn’t save your change');
  },
};

/** IP-8: the bet is readable by default (no row-level Edit mode) and edits in place. */
const editSaveSpy = fn();
export const EditRoundTrip: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS, save: editSaveSpy }) },
  play: async ({ canvasElement }) => {
    editSaveSpy.mockClear();
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await expect(card.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: /^Edit target: \$100K · 1 month after due date/ }));
    const valueInput = await card.findByRole('textbox', { name: 'Target value' });
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, '123456');
    // the estimate follows the draft before saving
    await expect(card.getByText(estimateLine(/^Target \$123.46K by Oct 31, 2026/))).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(editSaveSpy).toHaveBeenCalledTimes(1));
    await expect(editSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kpiId: 'revenue', target: 123456, targetType: 'absolute' }),
    );
  },
};

/** IP-8.3: cancelling an inline edit writes nothing and restores the readable bet. */
const cancelSaveSpy = fn();
export const EditCancel: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS, save: cancelSaveSpy }) },
  play: async ({ canvasElement }) => {
    cancelSaveSpy.mockClear();
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByRole('button', { name: /^Edit target/ }));
    await userEvent.type(await card.findByRole('textbox', { name: 'Target value' }), '9');
    await userEvent.click(card.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(card.queryByRole('textbox')).not.toBeInTheDocument());
    await expect(card.getAllByText('$100K').length).toBeGreaterThan(0);
    await expect(cancelSaveSpy).not.toHaveBeenCalled();
  },
};

/** Clicking the date part of the bet focuses the date input; the amount part focuses the amount. */
export const EditFocusesClickedPart: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByText('1 month after due date'));
    await waitFor(() => expect(card.getByRole('spinbutton', { name: 'Months after due date' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(card.queryByRole('spinbutton')).not.toBeInTheDocument());
    await userEvent.click(card.getByText('$100K'));
    await waitFor(() => expect(card.getByRole('textbox', { name: 'Target value' })).toHaveFocus());
  },
};

/** ••• → Edit opens the same inline edit; ••• → Remove asks first. */
const menuRemoveSpy = fn();
export const CardMenu: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS, remove: menuRemoveSpy }) },
  play: async ({ canvasElement }) => {
    menuRemoveSpy.mockClear();
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByRole('button', { name: 'Actions for Revenue' }));
    await userEvent.click(await card.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() => expect(card.getByRole('textbox', { name: 'Target value' })).toHaveFocus());
    // the menu's focus-return must not blur (and auto-confirm) the editor
    await new Promise((r) => setTimeout(r, 300));
    await expect(card.getByRole('textbox', { name: 'Target value' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(card.queryByRole('textbox')).not.toBeInTheDocument());

    await userEvent.click(card.getByRole('button', { name: 'Actions for Revenue' }));
    await userEvent.click(await card.findByRole('menuitem', { name: 'Remove' }));
    const dialog = within(await screen.findByRole('dialog'));
    await expect(dialog.getByText('Remove this KPI target?')).toBeInTheDocument();
    await expect(menuRemoveSpy).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(menuRemoveSpy).toHaveBeenCalledWith('revenue'));
  },
};

/** Esc on an open type menu closes only the menu; a second Esc cancels the inline edit. */
export const EditEscapeClosesMenuFirst: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByRole('button', { name: /^Edit target/ }));
    await userEvent.click(await card.findByRole('combobox', { name: 'Value type' }));
    await card.findByRole('option', { name: '% change' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(card.queryByRole('option')).not.toBeInTheDocument());
    await expect(card.getByRole('textbox', { name: 'Target value' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(card.queryByRole('textbox')).not.toBeInTheDocument());
  },
};

/** IP-7/IP-8.4: the edit view exposes the relative-vs-fixed date control. */
const dateSaveSpy = fn();
export const EditTargetDate: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS, save: dateSaveSpy }) },
  play: async ({ canvasElement }) => {
    dateSaveSpy.mockClear();
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByText('1 month after due date'));
    const offset = await card.findByRole('spinbutton', { name: 'Months after due date' });
    await userEvent.clear(offset);
    await userEvent.type(offset, '4');
    await userEvent.click(card.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(dateSaveSpy).toHaveBeenCalledTimes(1));
    await expect(dateSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kpiId: 'revenue',
        timing: expect.objectContaining({ due: expect.objectContaining({ mode: 'relative', offsetMonths: 4 }) }),
      }),
    );
  },
};

/** IP-7: switching the date type to "on a date" swaps the offset input for a date input. */
export const EditTargetDateToFixed: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByText('1 month after due date'));
    await userEvent.click(await card.findByRole('combobox', { name: 'Date type' }));
    await userEvent.click(await card.findByText('on a date'));
    await expect(card.queryByRole('spinbutton')).not.toBeInTheDocument();
    await expect(card.getByLabelText('Target date', { selector: 'input' })).toBeInTheDocument();
  },
};

/** Switching to "on a date" and back to months saves a clean relative timing (no blank fixed date). */
const roundTripSaveSpy = fn();
export const EditDateTypeRoundTrip: Story = {
  args: { usePanel: stub({ data: ALL_GROUPS, save: roundTripSaveSpy }) },
  play: async ({ canvasElement }) => {
    roundTripSaveSpy.mockClear();
    const c = within(canvasElement);
    const card = within(c.getByRole('group', { name: 'Revenue' }));
    await userEvent.click(card.getByText('1 month after due date'));
    await userEvent.click(await card.findByRole('combobox', { name: 'Date type' }));
    await userEvent.click(await card.findByText('on a date'));
    await userEvent.click(card.getByRole('combobox', { name: 'Date type' }));
    await userEvent.click(await card.findByText('months after due date', { selector: '[role="option"] *, [role="option"]' }));
    const offset = await card.findByRole('spinbutton', { name: 'Months after due date' });
    await userEvent.clear(offset);
    await userEvent.type(offset, '2');
    await userEvent.click(card.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(roundTripSaveSpy).toHaveBeenCalledTimes(1));
    await expect(roundTripSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timing: expect.objectContaining({ due: expect.objectContaining({ mode: 'relative', offsetMonths: 2, absolute: null }) }),
      }),
    );
    // the confirmed bet shows right away, before the (stubbed) save reloads the row
    await expect(card.getByText('2 months after due date')).toBeInTheDocument();
  },
};

/** The form previews the exact card it will create, and flags a bet against the KPI's direction. */
const formSaveSpy = fn();
export const FormPreview: Story = {
  args: { usePanel: stub({ data: { ...EMPTY, catalog: CATALOG.map((k) => (k.id === 'stores' ? { ...k, currentValue: 250 } : k)) }, save: formSaveSpy }) },
  play: async ({ canvasElement }) => {
    formSaveSpy.mockClear();
    const c = within(canvasElement);
    const form = within(c.getByRole('region', { name: 'Set a KPI target' }));
    await expect(form.queryByText('Preview')).not.toBeInTheDocument();
    await userEvent.click(form.getByRole('combobox', { name: 'KPI' }));
    await userEvent.click(await form.findByText('Number of Stores'));
    await userEvent.type(form.getByRole('textbox', { name: 'Target value' }), '+2');
    const preview = within(form.getByRole('group', { name: 'Number of Stores' }));
    await expect(preview.getByText('+2%')).toBeInTheDocument();
    await expect(preview.getByText('on the due date')).toBeInTheDocument();
    await expect(preview.getByText('Upcoming')).toBeInTheDocument();
    await expect(preview.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    await expect(form.getByText(estimateLine(/^Estimated target 255 by Sep 30, 2026/))).toBeInTheDocument();
    await expect(form.queryByText(/Double-check the sign/)).not.toBeInTheDocument();
    await userEvent.clear(form.getByRole('textbox', { name: 'Target value' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Target value' }), '-2');
    await expect(form.getByText(/Double-check the sign/)).toBeInTheDocument();
    await userEvent.click(form.getByRole('button', { name: 'Set KPI target' }));
    await expect(formSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kpiId: 'stores', target: -2, targetType: 'percent' }),
    );
  },
};

/** An additive ("more") target: `+100` on # of Orders previews latest + 100 and saves as `relative`. */
const amountSaveSpy = fn();
export const FormAmountChange: Story = {
  args: { usePanel: stub({ data: { ...EMPTY, catalog: CATALOG.map((k) => (k.id === 'orders' ? { ...k, currentValue: 1200 } : k)) }, save: amountSaveSpy }) },
  play: async ({ canvasElement }) => {
    amountSaveSpy.mockClear();
    const c = within(canvasElement);
    const form = within(c.getByRole('region', { name: 'Set a KPI target' }));
    await userEvent.click(form.getByRole('combobox', { name: 'KPI' }));
    await userEvent.click(await form.findByText('# of Orders'));
    await userEvent.click(form.getByRole('combobox', { name: 'Value type' }));
    await userEvent.click(await form.findByText('more'));
    await userEvent.type(form.getByRole('textbox', { name: 'Target value' }), '+100');
    const preview = within(form.getByRole('group', { name: '# of Orders' }));
    await expect(preview.getByText('+100')).toBeInTheDocument();
    await expect(form.getByText(estimateLine(/^Estimated target 1,300 by Sep 30, 2026 · from 1,200 now/))).toBeInTheDocument();
    await expect(form.queryByText(/Double-check the sign/)).not.toBeInTheDocument();
    await userEvent.clear(form.getByRole('textbox', { name: 'Target value' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Target value' }), '-100');
    await expect(form.getByText(/Double-check the sign/)).toBeInTheDocument();
    await userEvent.click(form.getByRole('button', { name: 'Set KPI target' }));
    await expect(amountSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kpiId: 'orders', target: -100, targetType: 'relative' }),
    );
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
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(kpiRecordSpy).toHaveBeenCalledWith('revenue', '2026-07-10', 1_300_000));
  },
};
