import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor, screen } from '@storybook/test';
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
        { date: '2026-06-30', value: 1_300_000, status: 'missed', provisional: false, relative: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
        { date: '2026-09-30', value: 1_400_000, status: 'upcoming', provisional: false, relative: false, source: src('OUT-12', 'Outcome', 'Grow Revenue') },
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
              relative: false,
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
        { date: '2026-09-30', value: 1_339_000, status: 'upcoming', provisional: true, relative: true, source: src('INIT-48', 'Initiative', '+1% 3mo after due') },
      ],
      undated: [
        { date: null, value: 1_255_000, status: 'upcoming', provisional: true, relative: true, source: { ...src('INC-90', 'Increment', '+1% after TBD due'), iconUrl: null } },
      ],
    }),
  ],
};

/** POPULATED as Phase 1 delivers it: same KPIs and readings, no targets, every row resolving. */
const stripTargets = (n: TimelineNodeDto): TimelineNodeDto => ({
  ...n,
  targets: [],
  undated: [],
  resolving: true,
  children: n.children.map(stripTargets),
});
const SKELETON: TimelineData = { ...POPULATED, roots: POPULATED.roots.map(stripTargets) };

function stub(over: Partial<TimelineController>): UseTimeline {
  return () => ({
    data: over.data ?? null,
    pending: over.pending ?? false,
    targetsPending: over.targetsPending ?? false,
    targetsError: over.targetsError ?? null,
    retryTargets: over.retryTargets ?? (() => {}),
    error: over.error ?? null,
    record: over.record ?? (async () => {}),
    createKpi: over.createKpi ?? (async () => {}),
    searchIssues: over.searchIssues ?? (async () => []),
    addTarget: over.addTarget ?? (async () => {}),
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
    await expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await expect(screen.getByText('Projected target')).toBeInTheDocument();
    await expect(screen.getByText(/Due date TBD/i)).toBeInTheDocument();
  },
};

/**
 * Progressive load, Phase 1 only (spec 06 P4): the KPI names, units and readings
 * are on screen (scaled to the readings alone) while the rows wait for their
 * targets. No target markers exist yet; they arrive with a smooth re-scale.
 */
export const LoadingTargets: Story = {
  args: { useData: stub({ data: SKELETON, targetsPending: true }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    await expect(c.getByText('Loading targets…')).toBeInTheDocument();
    // readings are drawn, but no target markers/links exist yet
    await expect(canvasElement.querySelectorAll('[data-reading]').length).toBeGreaterThan(0);
    await expect(c.queryByRole('link', { name: /OUT-12|INIT-48/ })).not.toBeInTheDocument();
    await expect(c.queryByText('Loading timeline…')).not.toBeInTheDocument();
  },
};

/**
 * A saved project filter can't be applied before targets exist (a KPI's projects
 * come from its targets), so every KPI shows while loading instead of an empty page.
 */
export const FilterWaitsForTargets: Story = {
  args: { useData: stub({ data: SKELETON, targetsPending: true }) },
  decorators: [
    (Story) => {
      window.history.replaceState(null, '', '?projects=NOPE');
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
    await expect(c.queryByText(/No KPIs match the selected project filter/)).not.toBeInTheDocument();
    window.history.replaceState(null, '', window.location.pathname);
  },
};

const retryTargets = fn();

/** Phase 2 failed: the KPIs stay, the shimmer stops, and a banner offers a retry. */
export const TargetsFailed: Story = {
  args: {
    useData: stub({
      data: { ...SKELETON, roots: SKELETON.roots.map((n) => ({ ...n, resolving: undefined, children: [] })) },
      targetsError: 'Request timed out',
      retryTargets,
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByRole('alert')).toHaveTextContent('Couldn’t load targets');
    await expect(c.getByRole('alert')).toHaveTextContent('Request timed out');
    await expect(canvasElement.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    await expect(c.queryByText('Loading targets…')).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-reading]').length).toBeGreaterThan(0);
    await userEvent.click(c.getByRole('button', { name: 'Retry' }));
    await expect(retryTargets).toHaveBeenCalledTimes(1);
  },
};

/** Interaction: the chevron hides and shows a KPI's child rows. */
export const CollapseChildren: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Collapse children' }));
    await expect(c.queryByText('# of Orders')).not.toBeInTheDocument();
    const expand = c.getByRole('button', { name: 'Expand children' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(expand);
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
  },
};

/** Project filter option by name — reopens the menu first if a previous pick closed it. */
async function pickProjectOption(c: ReturnType<typeof within>, name: string) {
  if (!screen.queryByRole('option', { name })) {
    await userEvent.click(c.getByRole('combobox', { name: 'Filter by Jira project' }));
  }
  return screen.findByRole('option', { name });
}

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
    await expect(c.getByText('Project: All')).toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /OUT-12/ }).length).toBeGreaterThan(0);

    await userEvent.click(c.getByRole('combobox', { name: 'Filter by Jira project' }));
    await userEvent.click(screen.getByRole('option', { name: 'INIT' }));
    await expect(c.getByText('Project: INIT')).toBeInTheDocument();
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
    await userEvent.click(await pickProjectOption(c, 'INIT'));
    await userEvent.click(await pickProjectOption(c, 'OUT'));
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.queryByText('# of Orders')).not.toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /OUT-12/ }).length).toBeGreaterThan(0);
    await expect(c.queryByRole('link', { name: /INIT-48/ })).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain('projects=OUT'));

    // Clear the filter and reset the URL — this jsdom `window` is shared
    // across every story test in this file, so leaving `?projects=` set here
    // would leak into later tests.
    await userEvent.click(await pickProjectOption(c, 'OUT'));
    await expect(c.getByText('Project: All')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).not.toContain('projects'));
  },
};

/** The key-bar entry for `label`, e.g. "2 Upcoming (fixed)". */
const keyEntry = (c: ReturnType<typeof within>, label: RegExp) =>
  within(c.getByRole('toolbar', { name: 'Chart key' })).getByRole('button', { name: label });

/** A dated target marker's inline opacity ('' = full strength, '0.12' = dimmed). */
const markerOpacity = (c: ReturnType<typeof within>, label: RegExp) =>
  (c.getAllByRole('link', { name: label })[0].querySelector('[data-marker-glyph]') as HTMLElement).style.opacity;

/**
 * Key bar (spec 08): entries + counts come from the targets shown, issue types
 * included; hovering an entry dims every other mark and clicking pins it; counts
 * follow the project filter but not row collapse.
 */
export const KeyBar: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(keyEntry(c, /Recorded value/)).toBeInTheDocument();
    await expect(keyEntry(c, /Projected trend/)).toBeInTheDocument();
    await expect(keyEntry(c, /1\s*Missed/)).toBeInTheDocument();
    await expect(keyEntry(c, /2\s*Upcoming \(fixed\)/)).toBeInTheDocument();
    await expect(keyEntry(c, /2\s*Outcome/)).toBeInTheDocument();
    await expect(keyEntry(c, /1\s*Initiative/)).toBeInTheDocument();

    // Hover highlights: the missed marker stays, upcoming ones dim.
    await userEvent.hover(keyEntry(c, /Missed/));
    await expect(markerOpacity(c, /Target missed/)).toBe('');
    await expect(markerOpacity(c, /— Upcoming\./)).toBe('0.12');
    // Click pins it past the hover; Clear releases it.
    await userEvent.click(keyEntry(c, /Missed/));
    await userEvent.unhover(keyEntry(c, /Missed/));
    await expect(markerOpacity(c, /— Upcoming\./)).toBe('0.12');
    await userEvent.click(c.getByRole('button', { name: 'Clear highlight' }));
    await expect(markerOpacity(c, /— Upcoming\./)).toBe('');

    // Collapsing rows doesn't change the counts.
    await userEvent.click(c.getByRole('button', { name: 'Collapse children' }));
    await expect(keyEntry(c, /2\s*Upcoming \(fixed\)/)).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Expand children' }));

    // The project filter does: INIT keeps only INIT-48's target.
    await userEvent.click(c.getByRole('combobox', { name: 'Filter by Jira project' }));
    await userEvent.click(screen.getByRole('option', { name: 'INIT' }));
    await expect(keyEntry(c, /1\s*Upcoming \(fixed\)/)).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /Missed/ })).not.toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /Outcome/ })).not.toBeInTheDocument();
    await userEvent.click(await pickProjectOption(c, 'INIT'));
    await waitFor(() => expect(window.location.search).not.toContain('projects'));
  },
};

/** Estimate (relative) targets: counted as "Upcoming (relative)" and drawn with an error bar. */
export const KeyBarRelative: Story = {
  args: { useData: stub({ data: PROJECTIONS }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(keyEntry(c, /1\s*Upcoming \(relative\)/)).toBeInTheDocument();
    await expect(keyEntry(c, /1\s*Undated/)).toBeInTheDocument();
    const marker = c.getAllByRole('link', { name: /INIT-48/ })[0];
    await expect(marker.querySelector('[data-error-bar]')).not.toBeNull();
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

// ── Spec 10: the KPI space follows the user's Jira permissions ──────────────

/** No Browse on the KPI project: the backend returns no KPIs and says why; Add KPI is disabled with the reason. */
export const NoAccess: Story = {
  args: {
    useData: stub({
      data: { today: '2026-07-10', roots: [], access: { browse: false, create: false, edit: false, link: false } },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/You don't have permission to view the KPI space/)).toBeInTheDocument();
    await expect(c.queryByText(/No KPIs yet/i)).toBeNull();
    await expect(c.getByRole('button', { name: /Add KPI/i })).toBeDisabled();
  },
};

const readOnlyRecordSpy = fn();
/** Browse only: KPIs are visible, but Add KPI, add-child and record are disabled, each with its reason. */
export const ReadOnly: Story = {
  args: {
    useData: stub({
      data: { ...POPULATED, access: { browse: true, create: false, edit: false, link: false } },
      record: readOnlyRecordSpy,
    }),
  },
  play: async ({ canvasElement }) => {
    readOnlyRecordSpy.mockClear();
    const c = within(canvasElement);
    const addKpi = c.getByRole('button', { name: /Add KPI/i });
    await expect(addKpi).toBeDisabled();
    await userEvent.hover(addKpi.closest('[data-disabled-reason]') as HTMLElement);
    await expect(await screen.findByRole('tooltip')).toHaveTextContent(/Adding a KPI needs Create Issues permission/);
    await userEvent.unhover(addKpi.closest('[data-disabled-reason]') as HTMLElement);

    const recordBtn = c.getAllByRole('button', { name: 'Record a value' })[0];
    await expect(recordBtn).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(recordBtn);
    await expect(screen.queryByRole('dialog')).toBeNull();
    await expect(c.getAllByRole('button', { name: 'Add child KPI' })[0]).toHaveAttribute('aria-disabled', 'true');
    // The tip no longer offers recording.
    await expect(c.queryByText(/click a past date to record a value/)).toBeNull();
    await expect(readOnlyRecordSpy).not.toHaveBeenCalled();
  },
};

/** Create but no Link Issues: Add KPI works, but the parent picker is disabled with the reason. */
export const CanAddButNotNest: Story = {
  args: {
    useData: stub({ data: { ...POPULATED, access: { browse: true, create: true, edit: true, link: false } } }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = await screen.findByRole('dialog');
    await expect(dialog.querySelector('[data-disabled-reason]')).toHaveAttribute(
      'data-disabled-reason',
      expect.stringMatching(/^Nesting a KPI under another needs Link Issues permission/),
    );
    await expect(c.getAllByRole('button', { name: 'Add child KPI' })[0]).toHaveAttribute('aria-disabled', 'true');
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
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(recordSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** While the value saves, the record modal stays open: Record spins, the fields and Cancel are disabled. */
export const RecordValueSaving: Story = {
  args: { useData: stub({ data: POPULATED, record: () => new Promise<void>(() => {}) }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Record a value' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(dialog.getByPlaceholderText(/1,300,000/)).toBeDisabled());
    await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeDisabled();
    await expect(screen.getByRole('dialog')).toBeInTheDocument();
  },
};

/** A failed save keeps the record modal open with the error inside it and the typed value intact. */
export const RecordValueFailed: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      record: async () => {
        throw new Error('Network request failed');
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Record a value' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByPlaceholderText(/1,300,000/), '1300000');
    await userEvent.click(dialog.getByRole('button', { name: 'Record' }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText(/Network request failed/)).toBeInTheDocument();
    await expect(dialog.getByPlaceholderText(/1,300,000/)).toHaveValue('1300000');
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
    const dialog = within(await screen.findByRole('dialog'));
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
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('revenue', '2026-01-03', null));
  },
};

/** Interaction: "Add KPI" opens the create modal and Create calls the loader (root KPI). */
const createSpy = fn();
export const AddKpi: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createSpy }) },
  play: async ({ canvasElement }) => {
    createSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Net Revenue');
    await userEvent.type(dialog.getByLabelText('KPI unit'), 'USD');
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Net Revenue', unit: 'USD', parentKpiId: null }),
      ),
    );
    // Saved → the modal closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/**
 * While the KPI is being created (a multi-second Jira round-trip) the modal
 * stays open: Create KPI shows a spinner, the fields and Cancel are disabled.
 */
export const AddKpiSaving: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: () => new Promise<void>(() => {}) }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Net Revenue');
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    await waitFor(() => expect(dialog.getByLabelText('KPI name')).toBeDisabled());
    await expect(dialog.getByRole('button', { name: /Cancel/i })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /Create KPI/i })).toHaveAttribute('aria-disabled', 'true');
    await expect(screen.getByRole('dialog')).toBeInTheDocument();
  },
};

/**
 * A failed create keeps the modal open with the error shown inside it, and the
 * typed values intact so the user can retry.
 */
export const AddKpiFailed: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      createKpi: async () => {
        throw new Error('Jira 400 while trying to create KPI issue "Net Revenue": boom');
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Net Revenue');
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText(/boom/)).toBeInTheDocument();
    await expect(dialog.getByLabelText('KPI name')).toHaveValue('Net Revenue');
    await expect(dialog.getByLabelText('KPI name')).not.toBeDisabled();
  },
};

/**
 * Nesting before an admin has chosen the KPI hierarchy link type: the modal
 * explains it and offers "Open Settings" instead of a raw Jira link error.
 */
export const AddChildKpiHierarchyNotSetUp: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      createKpi: async () => {
        throw new Error('KPI hierarchy is not set up — choose how KPIs nest in Settings first.');
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Add child KPI' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Sub Metric');
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText('KPI nesting isn’t set up')).toBeInTheDocument();
    await expect(alert.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
    await expect(dialog.getByLabelText('KPI name')).toHaveValue('Sub Metric');
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
    const dialog = within(await screen.findByRole('dialog'));
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
 * Interaction: "Add KPI" also offers an optional parent picker (typing
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
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Repeat Orders');
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for a parent KPI' }));
    await userEvent.click(await screen.findByRole('option', { name: '# of Orders' }));
    await userEvent.click(dialog.getByRole('button', { name: /Create KPI/i }));
    await waitFor(() =>
      expect(createWithParentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Repeat Orders', parentKpiId: 'orders' }),
      ),
    );
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
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for an issue' }));
    await userEvent.click(await screen.findByText('Multi-store support'));
    await userEvent.type(dialog.getByLabelText('Target value'), '2000000');
    await userEvent.click(dialog.getByRole('button', { name: 'Add target' }));
    await waitFor(() =>
      expect(addTargetSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kpiId: 'revenue', issueKey: 'INIT-48', value: 2_000_000 }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/**
 * A failed save keeps the Add Target modal open with the error inside it; a
 * missing KPI space offers the same "Open Settings" action as the page banner.
 */
export const AddTargetFailed: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      searchIssues: searchIssuesStub,
      addTarget: async () => {
        throw new Error('KPI space is not set up — configure it in Settings first.');
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getAllByRole('button', { name: 'Add a target' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for an issue' }));
    await userEvent.click(await screen.findByText('Multi-store support'));
    await userEvent.type(dialog.getByLabelText('Target value'), '2000000');
    await userEvent.click(dialog.getByRole('button', { name: 'Add target' }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText(/KPI space isn’t set up/i)).toBeInTheDocument();
    await expect(alert.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
    await expect(dialog.getByLabelText('Target value')).toHaveValue('2000000');
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
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for an issue' }));
    // OUT-12 already targets Revenue → listed but disabled.
    await expect(await screen.findByRole('option', { name: /OUT-12/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // INIT-48 has no Revenue target → selectable.
    await expect(await screen.findByRole('option', { name: /INIT-48/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};
