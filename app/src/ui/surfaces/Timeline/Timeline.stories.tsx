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
const src = (issue: string, type: string, title: string) => ({
  issue,
  type,
  title,
  iconUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' rx='3' fill='#5243AA'/></svg>`)}`,
});

const node = (over: Partial<TimelineNodeDto> & { id: string; kpiId: string; name: string }): TimelineNodeDto => ({
  issueKey: 'KPI-0',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
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
        { date: '2026-06-30', value: 1_300_000, status: 'missed', provisional: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
        { date: '2026-09-30', value: 1_400_000, status: 'upcoming', provisional: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
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
            // No iconUrl here (unlike src()'s default) to cover the fallback
            // diamond marker for sources without a resolvable issue-type icon.
            {
              date: '2026-08-15',
              value: 11_500,
              status: 'upcoming',
              provisional: false,
              source: { ...src('INIT-48', 'Initiative', 'Expand Orders'), iconUrl: null },
            },
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

/** A KPI with a provisional (estimate) marker and an undated projection chip. */
const PROJECTIONS: TimelineData = {
  today: '2026-07-10',
  roots: [
    node({
      id: 'n1',
      kpiId: 'revenue',
      issueKey: 'KPI-1',
      name: 'Revenue',
      unit: 'USD',
      readings: [{ date: '2026-06-01', value: 1_326_000 }],
      targets: [
        { date: '2026-09-30', value: 1_339_000, status: 'upcoming', provisional: true, source: src('INIT-48', 'Initiative', '+1% 3mo after due') },
      ],
      undated: [
        { date: null, value: 1_255_000, status: 'upcoming', provisional: true, source: { ...src('INC-90', 'Increment', '+1% after TBD due'), iconUrl: null } },
      ],
    }),
  ],
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
    searchIssues: over.searchIssues ?? (async () => []),
    addTarget: over.addTarget ?? (() => {}),
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

/** Undated projections: an estimate chip in the right lane opens a projection modal. */
export const UndatedProjections: Story = {
  args: { useData: stub({ data: PROJECTIONS }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const chip = c.getByRole('button', { name: /1,255,000/ });
    await expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    await expect(c.getByRole('dialog')).toBeInTheDocument();
    await expect(c.getByText('Projected target')).toBeInTheDocument();
    await expect(c.getByText(/Due date TBD/i)).toBeInTheDocument();
  },
};

/** Interaction: the chevron hides and shows a KPI's child rows. */
export const CollapseChildren: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const toggle = c.getByRole('button', { name: 'Collapse children' });
    await userEvent.click(toggle);
    await expect(c.queryByText('# of Orders')).not.toBeInTheDocument();
    await expect(toggle).toHaveAttribute('aria-label', 'Expand children');
    await userEvent.click(toggle);
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
  },
};

/**
 * Interaction: the project filter narrows the tree to KPIs whose targets come
 * from a selected Jira project (contributing issues can live in ANY project —
 * `POPULATED` has Revenue's own target from OUT-12 and its child "# of Orders"
 * from INIT-48). Subtree match: selecting "INIT" keeps BOTH rows (the child
 * matches directly; Revenue is kept as its ancestor for tree context) even
 * though Revenue's own target is from OUT — but that OUT-12 target marker is
 * itself hidden on the Revenue row, since only matching-project targets are
 * shown even on a kept/ancestor row. Selecting "OUT" instead drops
 * "# of Orders" entirely (no match, no children of its own). The selection is
 * also reflected in the URL (`?projects=...`) for shareability/refresh-safety.
 */
export const ProjectFilter: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: 'Project: All' })).toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /OUT-12/ }).length).toBeGreaterThan(0);

    await userEvent.click(c.getByRole('button', { name: 'Project: All' }));
    await userEvent.click(c.getByRole('checkbox', { name: 'INIT' }));
    await expect(c.getByRole('button', { name: 'Project: INIT' })).toBeInTheDocument();
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
    // Revenue is kept only for tree context — its own OUT-12 target marker,
    // which doesn't match the INIT selection, is hidden.
    await expect(c.queryByRole('link', { name: /OUT-12/ })).not.toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /INIT-48/ }).length).toBeGreaterThan(0);
    await waitFor(() => expect(window.location.search).toContain('projects=INIT'));

    // Uncheck INIT, check OUT: the leaf ("# of Orders", INIT-48) no longer
    // matches and has no children of its own, so it's dropped; Revenue
    // (OUT-12, its own match) stays, and its OUT-12 marker is visible again.
    await userEvent.click(c.getByRole('checkbox', { name: 'INIT' }));
    await userEvent.click(c.getByRole('checkbox', { name: 'OUT' }));
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.queryByText('# of Orders')).not.toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /OUT-12/ }).length).toBeGreaterThan(0);
    await expect(c.queryByRole('link', { name: /INIT-48/ })).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain('projects=OUT'));

    // Clear the filter and reset the URL — this jsdom `window` is shared
    // across every story test in this file, so leaving `?projects=` set here
    // would leak into later tests.
    await userEvent.click(c.getByRole('checkbox', { name: 'OUT' }));
    await expect(c.getByRole('button', { name: 'Project: All' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).not.toContain('projects'));
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
    await waitFor(() =>
      expect(link).toHaveAttribute('href', 'https://example.atlassian.net/browse/KPI-1'),
    );
    await userEvent.click(link);
    await waitFor(() => expect(openIssueSpy).toHaveBeenCalledWith('KPI-1'));
  },
};

/** Interaction: a target marker deep-links to the work item that set it. */
const openTargetSpy = fn();
export const OpenTargetIssue: Story = {
  args: { useData: stub({ data: POPULATED }), onOpenIssueNewTab: openTargetSpy },
  play: async ({ canvasElement }) => {
    openTargetSpy.mockClear();
    const c = within(canvasElement);
    const marker = c.getByRole('link', {
      name: /Target .* due 2026-06-30 .* Open Outcome OUT-12 in Jira \(new tab\)/i,
    });
    await waitFor(() =>
      expect(marker).toHaveAttribute('href', 'https://example.atlassian.net/browse/OUT-12'),
    );
    await expect(marker).toHaveAttribute('target', '_blank');
    await userEvent.click(marker);
    await waitFor(() => expect(openTargetSpy).toHaveBeenCalledWith('OUT-12'));
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

/**
 * Interaction: clicking a recorded value opens the edit modal; Save overwrites
 * the value at that date (last-write-wins per date).
 */
const editSpy = fn();
export const EditValue: Story = {
  args: { useData: stub({ data: POPULATED, record: editSpy }) },
  play: async ({ canvasElement }) => {
    editSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(
      c.getByRole('button', { name: 'Edit value 1,243,000 USD on 2026-07-06' }),
    );
    const dialog = within(await c.findByRole('dialog'));
    const input = dialog.getByLabelText('Value');
    await userEvent.clear(input);
    await userEvent.type(input, '1250000');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(editSpy).toHaveBeenCalledWith('revenue', '2026-07-06', 1_250_000));
  },
};

/** Interaction: Delete in the edit modal tombstones the value (record with null). */
const deleteSpy = fn();
export const DeleteValue: Story = {
  args: { useData: stub({ data: POPULATED, record: deleteSpy }) },
  play: async ({ canvasElement }) => {
    deleteSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(
      c.getByRole('button', { name: 'Edit value 1,000,000 USD on 2026-01-03' }),
    );
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('revenue', '2026-01-03', null));
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
 * Interaction: "+ Add KPI" also offers an optional parent picker (typing
 * filters the existing KPI tree) — choosing one nests the new KPI under it,
 * same as the row-level add-child flow but reachable from the header button.
 */
const createWithParentSpy = fn();
export const AddKpiWithParent: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createWithParentSpy }) },
  play: async ({ canvasElement }) => {
    createWithParentSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Repeat Orders');
    await userEvent.click(dialog.getByLabelText('Search for a parent KPI'));
    await userEvent.type(dialog.getByLabelText('Search for a parent KPI'), 'Orders');
    await userEvent.click(await dialog.findByRole('button', { name: '# of Orders' }));
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    await waitFor(() =>
      expect(createWithParentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Repeat Orders', parentKpiId: 'orders' }),
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
 * Interaction: the “Add a target” row action opens the Add Target modal, where a
 * type-ahead issue picker (like Jira's Parent field) chooses the contributing
 * issue; Add calls the loader with the KPI + issue + date + value.
 */
const addTargetSpy = fn();
const searchIssuesStub = async (q: string) => {
  const all = [
    { id: '10012', key: 'OUT-12', summary: 'Grow POS revenue', issueType: 'Outcome', iconUrl: null },
    { id: '10048', key: 'INIT-48', summary: 'Multi-store support', issueType: 'Initiative', iconUrl: null },
  ];
  const s = q.trim().toLowerCase();
  return s === ''
    ? all
    : all.filter((i) => i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s));
};
export const AddTarget: Story = {
  args: { useData: stub({ data: POPULATED, addTarget: addTargetSpy, searchIssues: searchIssuesStub }) },
  play: async ({ canvasElement }) => {
    addTargetSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Add a target' })[0]);
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Search for an issue'), 'INIT');
    await userEvent.click(await dialog.findByRole('button', { name: /INIT-48/ }));
    await userEvent.type(dialog.getByLabelText('Target value'), '2000000');
    await userEvent.click(dialog.getByRole('button', { name: 'Add target' }));
    await waitFor(() =>
      expect(addTargetSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kpiId: 'revenue', issueKey: 'INIT-48', value: 2_000_000 }),
      ),
    );
  },
};

/**
 * Interaction: an issue that already has a target for this KPI is shown in the
 * picker but is NOT selectable (one target per issue+KPI). Revenue already has
 * targets set on OUT-12, so OUT-12 appears disabled while INIT-48 stays pickable.
 */
export const ExcludeExistingTarget: Story = {
  args: { useData: stub({ data: POPULATED, searchIssues: searchIssuesStub }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Add a target' })[0]);
    const dialog = within(await c.findByRole('dialog'));
    await userEvent.click(dialog.getByLabelText('Search for an issue'));
    // OUT-12 already targets Revenue → present but not a selectable button.
    await dialog.findByText('OUT-12');
    await expect(dialog.queryByRole('button', { name: /OUT-12/ })).toBeNull();
    // INIT-48 has no Revenue target → selectable.
    await expect(await dialog.findByRole('button', { name: /INIT-48/ })).toBeInTheDocument();
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
