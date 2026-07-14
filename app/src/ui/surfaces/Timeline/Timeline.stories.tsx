import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor } from '@storybook/test';
import type { TimelineData, TimelineNodeDto } from '@domain/index.js';
import { Timeline } from './Timeline.js';
import type { TimelineController, UseTimeline } from '@ui/data/useTimelineData/index.js';

/**
 * Scenario stories for the Timeline — inject a stub loader hook for each data
 * shape (populated / empty tree / no-readings / loading / error) plus a
 * record-a-value interaction. The `*.test.tsx` sibling replays them.
 */
const src = (issue: string, type: string, title: string) => ({ issue, type, title });

const node = (over: Partial<TimelineNodeDto> & { id: string; kpiId: string; name: string }): TimelineNodeDto => ({
  issueKey: 'KPI-0',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  readings: [],
  children: [],
  ...over,
});

const POPULATED: TimelineData = {
  today: '2026-07-10',
  roots: [
    node({
      id: 'n1',
      kpiId: 'revenue',
      issueKey: 'KPI-1',
      name: 'Revenue',
      unit: 'USD',
      readings: [
        { date: '2026-01-03', value: 1_000_000 },
        { date: '2026-07-06', value: 1_243_000 },
      ],
      targets: [
        { date: '2026-06-30', value: 1_300_000, status: 'missed', source: src('OUT-12', 'Outcome', 'Grow Revenue') },
        { date: '2026-09-30', value: 1_400_000, status: 'upcoming', source: src('OUT-12', 'Outcome', 'Grow Revenue') },
      ],
      children: [
        node({
          id: 'n2',
          kpiId: 'orders',
          issueKey: 'KPI-2',
          name: '# of Orders',
          unit: 'count',
          depth: 1,
          readings: [],
          targets: [
            { date: '2026-08-15', value: 11_500, status: 'upcoming', source: src('INIT-48', 'Initiative', 'Expand Orders') },
          ],
        }),
      ],
    }),
  ],
};

const NO_READINGS: TimelineData = {
  today: '2026-07-10',
  roots: [node({ id: 'n1', kpiId: 'opportunity', name: 'Opportunity Enablement', unit: 'future value', direction: null })],
};

function stub(over: Partial<TimelineController>): UseTimeline {
  return () => ({
    data: over.data ?? null,
    pending: over.pending ?? false,
    error: over.error ?? null,
    actionError: over.actionError ?? null,
    clearActionError: over.clearActionError ?? (() => {}),
    record: over.record ?? (() => {}),
    createKpi: over.createKpi ?? (() => {}),
  });
}

const meta: Meta<typeof Timeline> = {
  component: Timeline,
  title: 'Surfaces/Timeline',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof Timeline>;

export const Populated: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
  },
};

/** Interaction: the KPI name is a link that navigates to the KPI's Jira issue. */
const openIssueSpy = fn();
export const OpenIssue: Story = {
  args: { useData: stub({ data: POPULATED }), onOpenIssue: openIssueSpy },
  play: async ({ canvasElement }) => {
    openIssueSpy.mockClear();
    const c = within(canvasElement);
    const link = c.getByRole('link', { name: 'Revenue' });
    await expect(link).toHaveAttribute('href', '/browse/KPI-1');
    await userEvent.click(link);
    await waitFor(() => expect(openIssueSpy).toHaveBeenCalledWith('KPI-1'));
  },
};

export const NoReadings: Story = {
  args: { useData: stub({ data: NO_READINGS }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/No values yet/i)).toBeInTheDocument();
  },
};

export const EmptyTree: Story = {
  args: { useData: stub({ data: { today: '2026-07-10', roots: [] } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/No KPIs yet/i)).toBeInTheDocument();
    // Add KPI is available even with an empty tree.
    await expect(c.getByRole('button', { name: /Add KPI/i })).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { useData: stub({ data: null, pending: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Loading timeline/i)).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: { useData: stub({ data: null, error: 'nope' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Failed to load timeline/i)).toBeInTheDocument();
  },
};

/**
 * Interaction: the record button opens the record modal, and Record calls the
 * loader. Row action buttons are hover-revealed (opacity-0 -> group-hover) but
 * stay in the a11y tree, so getByRole/click still find them without hovering.
 */
const recordSpy = fn();
export const RecordValue: Story = {
  args: { useData: stub({ data: POPULATED, record: recordSpy }) },
  play: async ({ canvasElement }) => {
    recordSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Record a value' })[0]);
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(recordSpy).toHaveBeenCalledTimes(1));
  },
};

/** Interaction: "+ Add KPI" opens the create modal and Create calls the loader (root KPI). */
const createSpy = fn();
export const AddKpi: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createSpy }) },
  play: async ({ canvasElement }) => {
    createSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Net Revenue');
    await userEvent.type(dialog.getByLabelText('KPI unit'), 'USD');
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Net Revenue', unit: 'USD', parentKpiId: null }),
      ),
    );
  },
};

/**
 * Interaction: a row's add-child (+) button nests the new KPI under that KPI.
 * The button is hover-revealed but remains findable by accessible name.
 */
const createChildSpy = fn();
export const AddChildKpi: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createChildSpy }) },
  play: async ({ canvasElement }) => {
    createChildSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Add child KPI' })[0]);
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Sub Metric');
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    await waitFor(() =>
      expect(createChildSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sub Metric', parentKpiId: 'revenue' }),
      ),
    );
  },
};

/**
 * A mutation failed because the KPI space isn't configured — the inline banner
 * appears with an "Open Settings" action that routes to the admin page (spied),
 * and a dismiss control that clears the error.
 */
const openSettingsSpy = fn();
const dismissSpy = fn();
export const SpaceNotSetUp: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      actionError: { kind: 'space-not-set-up', message: 'KPI space is not set up — configure it in Settings first.' },
      clearActionError: dismissSpy,
    }),
    onOpenSettings: openSettingsSpy,
  },
  play: async ({ canvasElement }) => {
    openSettingsSpy.mockClear();
    dismissSpy.mockClear();
    const c = within(canvasElement);
    const alert = within(await c.findByRole('alert'));
    await expect(alert.getByText(/KPI space isn’t set up/i)).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: /Open Settings/i }));
    await waitFor(() => expect(openSettingsSpy).toHaveBeenCalledTimes(1));
    await userEvent.click(alert.getByRole('button', { name: /Dismiss/i }));
    await waitFor(() => expect(dismissSpy).toHaveBeenCalledTimes(1));
  },
};

/**
 * A generic mutation failure shows the plain inline error message and NO
 * "Open Settings" action.
 */
export const GenericActionError: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      actionError: { kind: 'generic', message: 'Network request failed' },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const alert = within(await c.findByRole('alert'));
    await expect(alert.getByText(/Network request failed/i)).toBeInTheDocument();
    await expect(alert.queryByRole('button', { name: /Open Settings/i })).toBeNull();
  },
};
