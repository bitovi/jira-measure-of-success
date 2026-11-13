import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor, screen } from '@storybook/test';
import type { TimelineNodeDto } from '@domain/index.js';
import { KpiView } from './KpiView.js';

/**
 * Scenario stories for the KPI View (Feature 04) — the single-KPI chart shown
 * on a KPI issue's panel. Each story feeds one `TimelineNodeDto` (this KPI's own
 * series) plus injected callbacks; the `*.test.tsx` sibling replays them.
 */
const src = (issue: string, type: string, title: string) => ({
  issue,
  type,
  title,
  iconUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' rx='3' fill='#5243AA'/></svg>`)}`,
});

const node = (over: Partial<TimelineNodeDto> & { id: string; kpiId: string; name: string }): TimelineNodeDto => ({
  issueKey: 'KPI-1',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
  readings: [],
  children: [],
  ...over,
});

const REVENUE = node({
  id: 'n1',
  kpiId: 'revenue',
  issueKey: 'KPI-1',
  name: 'Revenue',
  unit: 'USD',
  readings: [
    { date: '2026-01-03', value: 1_000_000 },
    { date: '2026-03-04', value: 1_072_000 },
    { date: '2026-05-05', value: 1_129_000 },
    { date: '2026-07-06', value: 1_243_000 },
  ],
  targets: [
    { date: '2026-06-30', value: 1_300_000, status: 'missed', provisional: false, relative: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
    { date: '2026-09-30', value: 1_400_000, status: 'upcoming', provisional: false, relative: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
    { date: '2026-12-20', value: 1_500_000, status: 'upcoming', provisional: false, relative: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
  ],
});

const meta: Meta<typeof KpiView> = {
  component: KpiView,
  title: 'Surfaces/KpiView',
  parameters: { layout: 'fullscreen' },
  args: {
    today: '2026-07-10',
    onRecord: fn(),
    loadSiteUrl: async () => 'https://example.atlassian.net',
  },
};
export default meta;
type Story = StoryObj<typeof KpiView>;

export const WithReadingsAndTargets: Story = {
  args: { node: REVENUE },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('link', { name: 'Revenue' })).toBeInTheDocument();
    // The nice-tick value axis labels render (compact millions).
    await expect(c.getAllByText(/M$/).length).toBeGreaterThan(0);
  },
};

export const Empty: Story = {
  args: {
    node: node({ id: 'n1', kpiId: 'opportunity', name: 'Opportunity Enablement', unit: 'future value', direction: null }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/No values recorded yet/i)).toBeInTheDocument();
    // Nothing plotted → nothing for the key to explain.
    await expect(within(canvasElement).queryByRole('toolbar', { name: 'Chart key' })).not.toBeInTheDocument();
  },
};

/** Key bar (spec 08): the shared key, counted for this one KPI; hovering an entry dims the rest. */
export const KeyBar: Story = {
  args: { node: REVENUE },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const key = within(c.getByRole('toolbar', { name: 'Chart key' }));
    await expect(key.getByRole('button', { name: /1\s*Missed/ })).toBeInTheDocument();
    await expect(key.getByRole('button', { name: /2\s*Upcoming \(fixed\)/ })).toBeInTheDocument();
    await expect(key.getByRole('button', { name: /3\s*Outcome/ })).toBeInTheDocument();

    await userEvent.hover(key.getByRole('button', { name: /Upcoming \(fixed\)/ }));
    const missed = c.getAllByRole('link', { name: /Target missed/ })[0].querySelector('[data-marker-glyph]') as HTMLElement;
    await expect(missed.style.opacity).toBe('0.12');
    await userEvent.unhover(key.getByRole('button', { name: /Upcoming \(fixed\)/ }));
    await expect(missed.style.opacity).toBe('');
  },
};

export const Undated: Story = {
  args: {
    node: node({
      id: 'n1',
      kpiId: 'revenue',
      name: 'Revenue',
      unit: 'USD',
      readings: [{ date: '2026-06-01', value: 1_326_000 }],
      undated: [
        { date: null, value: 1_255_000, status: 'upcoming', provisional: true, relative: true, source: { ...src('INC-90', 'Increment', '+1% after TBD due'), iconUrl: null } },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const chip = c.getByRole('button', { name: /1,255,000/ });
    await userEvent.click(chip);
    await expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await expect(screen.getByText('Projected target')).toBeInTheDocument();
  },
};

/** Interaction: the Record a value button opens the modal and Record calls back. */
const recordSpy = fn();
const RECORD_REASON = 'Recording a value needs Edit Issues permission on the KPI space project. Ask a Jira admin.';
const blockedRecordSpy = fn();

/** Spec 10: no Edit Issues on this KPI — the chart reads fine, recording is disabled with the reason. */
export const RecordBlocked: Story = {
  args: { node: REVENUE, onRecord: blockedRecordSpy, recordBlocked: RECORD_REASON },
  play: async ({ canvasElement }) => {
    blockedRecordSpy.mockClear();
    const c = within(canvasElement);
    const btn = c.getByRole('button', { name: 'Record a value' });
    await expect(btn).toBeDisabled();
    await userEvent.hover(btn.closest('[data-disabled-reason]') as HTMLElement);
    await expect(await screen.findByRole('tooltip')).toHaveTextContent(RECORD_REASON);
    await expect(screen.queryByRole('dialog')).toBeNull();
    await expect(blockedRecordSpy).not.toHaveBeenCalled();
  },
};

export const RecordValue: Story = {
  args: { node: REVENUE, onRecord: recordSpy },
  play: async ({ canvasElement }) => {
    recordSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Record a value' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith('revenue', '2026-07-10', 1_300_000));
  },
};

/** Interaction: clicking a recorded value opens the edit modal; Save overwrites it. */
const editSpy = fn();
export const EditValue: Story = {
  args: { node: REVENUE, onRecord: editSpy },
  play: async ({ canvasElement }) => {
    editSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Edit value 1,243,000 USD on 2026-07-06' }));
    const dialog = within(await screen.findByRole('dialog'));
    const input = dialog.getByLabelText('Value');
    await userEvent.clear(input);
    await userEvent.type(input, '1250000');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(editSpy).toHaveBeenCalledWith('revenue', '2026-07-06', 1_250_000));
  },
};

/** Interaction: the KPI name links to its Jira issue. */
const openIssueSpy = fn();
export const OpenKpiIssue: Story = {
  args: { node: REVENUE, onOpenIssue: openIssueSpy },
  play: async ({ canvasElement }) => {
    openIssueSpy.mockClear();
    const c = within(canvasElement);
    const link = c.getByRole('link', { name: 'Revenue' });
    await waitFor(() =>
      expect(link).toHaveAttribute('href', 'https://example.atlassian.net/browse/KPI-1'),
    );
    await userEvent.click(link);
    await waitFor(() => expect(openIssueSpy).toHaveBeenCalledWith('KPI-1'));
  },
};
