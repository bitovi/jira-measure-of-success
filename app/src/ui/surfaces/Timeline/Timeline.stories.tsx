import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor, screen, fireEvent } from '@storybook/test';
import {
  kpiCreateSpacePreselect,
  kpiSpacesOf,
  KPI_WORK_TYPE_NOT_SET_UP,
  NO_KPIS_MESSAGE,
  type CreatedKpi,
  type CreateKpiInput,
  type KpiCreateSpaces,
  type KpiSpaceAccess,
  type KpiSpaceRef,
  type TimelineData,
  type TimelineNodeDto,
} from '@domain/index.js';
import { TYPE_ICONS } from '@harness/fixtures/typeIcons.js';
import { Timeline } from './Timeline.js';
import {
  memoryTimelineFilters,
  noTimelineFilters,
  type TimelineController,
  type UseTimeline,
} from '@ui/data/useTimelineData/index.js';

/**
 * Scenario stories for the Timeline — inject a stub loader hook for each data
 * shape (populated / empty tree / no-readings / loading / error) plus the
 * interactions (record a value on the track, row actions, Add KPI, filters).
 * Spec 11 · 08 adds KPIs in one vs. seven spaces, the KPI space filter with
 * compact ancestor rows, and Add KPI's space choice. The `*.test.tsx` sibling
 * replays them.
 */
const src = (issue: string, type: string, title: string) => ({
  issue,
  type,
  title,
  iconUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' rx='3' fill='#5243AA'/></svg>`)}`,
});

const KPI_SPACE: KpiSpaceRef = { id: '10000', key: 'KPI', name: 'KPIs' };
const PORT_SPACE: KpiSpaceRef = { id: '10400', key: 'PORT', name: 'Portfolio' };

const node = (over: Partial<TimelineNodeDto> & { id: string; kpiId: string; name: string }): TimelineNodeDto => ({
  issueKey: 'KPI-0',
  space: KPI_SPACE,
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
      kpiId: '20001',
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
          kpiId: '20002',
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
  roots: [node({ id: 'n1', kpiId: '20010', name: 'Opportunity Enablement', unit: 'future value', direction: null })],
};

/** A KPI with a provisional (estimate) marker and an undated projection chip. */
const PROJECTIONS: TimelineData = {
  today: '2026-07-10',
  roots: [
    node({
      id: 'n1',
      kpiId: '20001',
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


/** What Add KPI offers by default: the loaded KPIs' spaces, filled in by the preselect rule. */
const spacesOf = (data: TimelineData | null): KpiCreateSpaces => {
  const spaces = data ? kpiSpacesOf(data.roots) : [KPI_SPACE];
  const all = spaces.length ? spaces : [KPI_SPACE];
  return { spaces: all, preselect: kpiCreateSpacePreselect(all, spaces.map((s) => s.key)) };
};

const createdKpi = (input: CreateKpiInput, issueKey = 'KPI-99'): CreatedKpi => ({
  id: '29999',
  kpiId: '29999',
  issueKey,
  name: input.name,
  unit: input.unit,
  direction: input.direction,
  parentKpiId: input.parentKpiId ?? null,
});

function stub(over: Partial<TimelineController>): UseTimeline {
  return () => ({
    data: over.data ?? null,
    pending: over.pending ?? false,
    targetsPending: over.targetsPending ?? false,
    targetsError: over.targetsError ?? null,
    retryTargets: over.retryTargets ?? (() => {}),
    error: over.error ?? null,
    record: over.record ?? (async () => {}),
    createKpi: over.createKpi ?? (async (input) => createdKpi(input)),
    updateKpi: over.updateKpi ?? (async () => {}),
    searchIssues: over.searchIssues ?? (async () => []),
    addTarget: over.addTarget ?? (async () => {}),
    loadReadings: over.loadReadings ?? (() => {}),
    readingsError: over.readingsError ?? null,
    retryReadings: over.retryReadings ?? (() => {}),
    getKpiCreateSpaces: over.getKpiCreateSpaces ?? (async () => spacesOf(over.data ?? null)),
    lookupKpiRef: over.lookupKpiRef ?? (async () => ({ kind: 'hidden' })),
    ...(over.getKpiAccess ? { getKpiAccess: over.getKpiAccess } : {}),
  });
}

const meta: Meta<typeof Timeline> = {
  component: Timeline,
  title: 'Surfaces/Timeline',
  parameters: { layout: 'fullscreen' },
  args: { filterStore: noTimelineFilters },
};
export default meta;
type Story = StoryObj<typeof Timeline>;

type Canvas = ReturnType<typeof within>;

/** A KPI row's track (`issueKey`). */
const track = (canvasElement: HTMLElement, issueKey: string) =>
  canvasElement.querySelector<HTMLElement>(`[data-kpi-track="${issueKey}"]`)!;
/** Click a track's past side (record a value; jsdom lays it out at x = 0, the axis start). */
const clickPast = (canvasElement: HTMLElement, issueKey: string) => fireEvent.click(track(canvasElement, issueKey), { clientX: 0 });
/** Click a track's future side (add a target; clamped to the axis end). */
const clickFuture = (canvasElement: HTMLElement, issueKey: string) =>
  fireEvent.click(track(canvasElement, issueKey), { clientX: 1_000_000 });
/** Open a row's … menu and pick `item`. */
async function menuItem(c: Canvas, issueKey: string, item: string | RegExp) {
  await userEvent.click(c.getByRole('button', { name: `More actions for ${issueKey}` }));
  return screen.findByRole('menuitem', { name: item });
}
/** The label column's rows, in order (name text; context rows marked). */
const rowNames = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll<HTMLElement>('a[href*="/browse/"]')]
    .filter((a) => !a.querySelector('[data-marker-glyph]') && !a.closest('[data-kpi-track]'))
    .map((a) => (a.closest('[data-context-row]') ? `(${a.textContent})` : a.textContent));

export const Populated: Story = {
  args: { useData: stub({ data: { ...POPULATED, kpiTypeIconUrl: TYPE_ICONS.KPI } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
    // Spec 11 · 08: a KPI row is `{KPI icon} {name}`, no key; one space, so no space badges.
    await expect(c.getAllByRole('img', { name: 'KPI' }).length).toBeGreaterThanOrEqual(2);
    await expect(c.queryByText('KPI-1')).toBeNull();
    await expect(c.queryByText('KPI', { selector: 'span.font-mono' })).toBeNull();
    // Plans-style row actions, named per KPI.
    await expect(c.getByRole('button', { name: 'Create child KPI for KPI-1' })).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'More actions for KPI-2' })).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: 'Record a value' })).toBeNull();
    await expect(c.getByRole('button', { name: 'KPI space: All' })).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Work from: All' })).toBeInTheDocument();
  },
};
export const PopulatedDark: Story = { ...Populated, globals: { theme: 'dark' } };

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
 * A remembered Work from choice can't be applied before targets exist (a KPI's
 * projects come from its targets), so every KPI shows while loading instead of an empty page.
 */
export const FilterWaitsForTargets: Story = {
  args: {
    useData: stub({ data: SKELETON, targetsPending: true }),
    filterStore: memoryTimelineFilters({ spaces: [], workFrom: ['NOPE'] }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
    await expect(c.queryByText(/No KPIs match the filters/)).not.toBeInTheDocument();
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

/** Toggle a Work from (or KPI space) option, opening the list if needed. */
async function toggleScope(c: Canvas, filter: 'Work from' | 'KPI space', option: string | RegExp) {
  if (!c.queryByRole('group', { name: filter })) {
    await userEvent.click(c.getByRole('button', { name: new RegExp(`^${filter}:`) }));
  }
  await userEvent.click(within(c.getByRole('group', { name: filter })).getByRole('checkbox', { name: option }));
}

const workFromStore = memoryTimelineFilters();
/**
 * Work from (today's project filter, renamed): narrows the tree to KPIs whose
 * targets come from the chosen work items' spaces. Subtree match: "INIT" keeps
 * BOTH rows (the child matches directly; Revenue is kept as its ancestor), but
 * Revenue's own OUT-12 marker is hidden. "OUT" instead drops "# of Orders". The
 * choice is remembered in the browser.
 */
export const WorkFromFilter: Story = {
  args: { useData: stub({ data: POPULATED }), filterStore: workFromStore },
  play: async ({ canvasElement }) => {
    workFromStore.saved = null;
    const c = within(canvasElement);
    await expect(c.getAllByRole('link', { name: /OUT-12/ }).length).toBeGreaterThan(0);

    await toggleScope(c, 'Work from', 'INIT');
    await expect(c.getByRole('button', { name: 'Work from: INIT' })).toBeInTheDocument();
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.getByText('# of Orders')).toBeInTheDocument();
    await expect(c.queryByRole('link', { name: /OUT-12/ })).not.toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /INIT-48/ }).length).toBeGreaterThan(0);
    await waitFor(() => expect(workFromStore.saved).toEqual({ spaces: [], workFrom: ['INIT'] }));

    await toggleScope(c, 'Work from', 'INIT');
    await toggleScope(c, 'Work from', 'OUT');
    await expect(c.getByText('Revenue')).toBeInTheDocument();
    await expect(c.queryByText('# of Orders')).not.toBeInTheDocument();
    await expect(c.getAllByRole('link', { name: /OUT-12/ }).length).toBeGreaterThan(0);
    await expect(c.queryByRole('link', { name: /INIT-48/ })).not.toBeInTheDocument();

    await userEvent.click(c.getByRole('button', { name: 'Show all' }));
    await expect(c.getByRole('button', { name: 'Work from: All' })).toBeInTheDocument();
    await waitFor(() => expect(workFromStore.saved).toEqual({ spaces: [], workFrom: [] }));
  },
};

/** The key-bar entry for `label`, e.g. "2 Upcoming (fixed)". */
const keyEntry = (c: Canvas, label: RegExp) =>
  within(c.getByRole('toolbar', { name: 'Chart key' })).getByRole('button', { name: label });

/** A dated target marker's inline opacity ('' = full strength, '0.12' = dimmed). */
const markerOpacity = (c: Canvas, label: RegExp) =>
  (c.getAllByRole('link', { name: label })[0].querySelector('[data-marker-glyph]') as HTMLElement).style.opacity;

/**
 * Key bar (spec 08): entries + counts come from the targets shown, issue types
 * included; hovering an entry dims every other mark and clicking pins it; counts
 * follow the filters but not row collapse.
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

    // Work from does: INIT keeps only INIT-48's target.
    await toggleScope(c, 'Work from', 'INIT');
    await expect(keyEntry(c, /1\s*Upcoming \(fixed\)/)).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /Missed/ })).not.toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /Outcome/ })).not.toBeInTheDocument();
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

/** Interaction: the KPI name is a link that navigates to the KPI's Jira issue; so does … → Open in Jira. */
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
    await userEvent.click(await menuItem(c, 'KPI-2', 'Open in Jira'));
    await waitFor(() => expect(openIssueSpy).toHaveBeenLastCalledWith('KPI-2'));
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

/** A user who can browse no KPIs at all (or none exist yet): 06's message, with Add KPI. */
export const EmptyTree: Story = {
  args: { useData: stub({ data: { today: '2026-07-10', roots: [] }, getKpiCreateSpaces: async () => ({ spaces: [], preselect: null }) }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    // Spec 11 · 06 (Q4): one message for "none yet" and "none you can see".
    await expect(c.getByText(NO_KPIS_MESSAGE)).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /KPI space/ })).toBeNull();
    // Add KPI is available with an empty tree: in the toolbar and next to the message.
    await expect(c.getAllByRole('button', { name: /Add KPI/i })).toHaveLength(2);
    await userEvent.click(c.getAllByRole('button', { name: /Add KPI/i })[1]);
    const dialog = within(await screen.findByRole('dialog'));
    await expect(await dialog.findByText('You can’t create KPIs in any space.')).toBeInTheDocument();
  },
};

export const EmptyTreeDark: Story = { ...EmptyTree, globals: { theme: 'dark' } };

const openSettingsSpy = fn();
/** No KPI work type configured yet (04): the empty Timeline says so, with Open Settings. */
export const NoWorkType: Story = {
  args: { useData: stub({ data: { today: '2026-07-10', roots: [], noWorkType: true } }), onOpenSettings: openSettingsSpy },
  play: async ({ canvasElement }) => {
    openSettingsSpy.mockClear();
    const c = within(canvasElement);
    await expect(c.getByText(/No KPI work type configured yet/)).toBeInTheDocument();
    await expect(c.queryByText(NO_KPIS_MESSAGE)).toBeNull();
    await userEvent.click(c.getByRole('button', { name: 'Open Settings' }));
    await expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  },
};

export const NoWorkTypeDark: Story = { ...NoWorkType, globals: { theme: 'dark' } };

// ── Spec 11 · 08: KPIs in seven spaces, the KPI space filter, compact ancestors ──

const SP = (id: string, key: string, name: string): KpiSpaceRef => ({ id, key, name });
const SPACES7: Record<string, KpiSpaceRef> = {
  KPI: SP('10000', 'KPI', 'KPIs'),
  DCOM: SP('10101', 'DCOM', 'Digital Commerce'),
  PLAT: SP('10102', 'PLAT', 'Enterprise Platform'),
  CHK: SP('10103', 'CHK', 'Checkout'),
  MOB: SP('10104', 'MOB', 'Mobile App'),
  DEVP: SP('10105', 'DEVP', 'Developer Platform'),
  PAY: SP('10106', 'PAY', 'Payments'),
};
// key, name, unit, direction, parent (the prototype's org: global → portfolio → product → team)
const SEED: Array<[string, string, string, 'increase' | 'decrease', string | null]> = [
  ['KPI-1', 'Profit', '$M', 'increase', null],
  ['KPI-2', 'Revenue', '$M', 'increase', 'KPI-1'],
  ['KPI-3', 'Expenses', '$M', 'decrease', 'KPI-1'],
  ['DCOM-101', 'Online revenue', '$M', 'increase', 'KPI-2'],
  ['DCOM-103', 'Cost to serve per order', '$', 'decrease', 'KPI-3'],
  ['PLAT-201', 'Platform licensing revenue', '$M', 'increase', 'KPI-2'],
  ['PLAT-203', 'DORA: lead time for changes', 'days', 'decrease', 'KPI-3'],
  ['CHK-301', 'Checkout conversion', '%', 'increase', 'DCOM-101'],
  ['CHK-302', 'Payment success rate', '%', 'increase', 'CHK-301'],
  ['CHK-305', 'Refund processing cost', '$', 'decrease', 'DCOM-103'],
  ['MOB-401', 'App order share', '%', 'increase', 'DCOM-101'],
  ['DEVP-501', 'Build time (p50)', 'min', 'decrease', 'PLAT-203'],
  ['PAY-601', 'Fraud review time', 'h', 'decrease', 'CHK-302'],
];
function orgTree(oneSpace: boolean, readingsPendingOutside: string[] | null = null): TimelineData {
  const nodeOf = (key: string, depth: number): TimelineNodeDto => {
    const [, name, unit, direction] = SEED.find((s) => s[0] === key)!;
    const spaceKey = key.split('-')[0];
    const id = String(30000 + SEED.findIndex((s) => s[0] === key));
    const pending = readingsPendingOutside !== null && !readingsPendingOutside.includes(spaceKey);
    return node({
      id,
      kpiId: id,
      issueKey: oneSpace ? `KPI-${Number(id) - 29999}` : key,
      name,
      unit,
      direction,
      depth,
      space: oneSpace ? SPACES7.KPI : SPACES7[spaceKey],
      readings: pending ? [] : [{ date: '2026-02-01', value: 10 }, { date: '2026-06-01', value: 12 }],
      ...(pending ? { readingsPending: true } : {}),
      children: SEED.filter((s) => s[4] === key).map((s) => nodeOf(s[0], depth + 1)),
    });
  };
  return {
    today: '2026-07-10',
    centralSpace: SPACES7.KPI,
    kpiTypeIconUrl: TYPE_ICONS.KPI,
    roots: SEED.filter((s) => s[4] === null).map((s) => nodeOf(s[0], 0)),
  };
}
const ORG = orgTree(false);
const ORG_ONE_SPACE = orgTree(true);

/** KPIs in seven spaces: one tree, every KPI by default, each row with its space key. */
export const SevenSpaces: Story = {
  args: { useData: stub({ data: ORG }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(rowNames(canvasElement)).toHaveLength(SEED.length);
    await expect(c.getByTitle('Payments')).toHaveTextContent('PAY');
    // The central space reads "Global KPIs".
    await expect(c.getAllByTitle('Global KPIs')).toHaveLength(3);
    await userEvent.click(c.getByRole('button', { name: 'KPI space: All' }));
    const options = within(c.getByRole('group', { name: 'KPI space' })).getAllByRole('checkbox');
    await expect(options.map((o) => o.closest('label')!.textContent)).toEqual([
      'Global KPIsKPI',
      'CheckoutCHK',
      'Developer PlatformDEVP',
      'Digital CommerceDCOM',
      'Enterprise PlatformPLAT',
      'Mobile AppMOB',
      'PaymentsPAY',
    ]);
  },
};
export const SevenSpacesDark: Story = { ...SevenSpaces, globals: { theme: 'dark' } };

/** Today's installs: every KPI in one space, so no space keys on the rows. */
export const OneSpace: Story = {
  args: { useData: stub({ data: ORG_ONE_SPACE }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(rowNames(canvasElement)).toHaveLength(SEED.length);
    await expect(c.queryByTitle('Global KPIs')).toBeNull();
    await expect(c.queryByText('KPI-1')).toBeNull();
  },
};

/**
 * KPI space filter, one space: Checkout's KPIs are full rows, with their
 * ancestors (Online revenue, Revenue, Profit; Cost to serve, Expenses) as
 * compact, faded context rows above them; no unrelated siblings. Remembered.
 */
export const SpaceFilterOne: Story = {
  args: { useData: stub({ data: ORG }), filterStore: memoryTimelineFilters() },
  play: async ({ canvasElement, args }) => {
    const scopeStore = args.filterStore as ReturnType<typeof memoryTimelineFilters>;
    const c = within(canvasElement);
    await toggleScope(c, 'KPI space', /Checkout/);
    await expect(c.getByRole('button', { name: 'KPI space: Checkout' })).toBeInTheDocument();
    await expect(rowNames(canvasElement)).toEqual([
      '(Profit)',
      '(Revenue)',
      '(Online revenue)',
      'Checkout conversion',
      'Payment success rate',
      '(Expenses)',
      '(Cost to serve per order)',
      'Refund processing cost',
    ]);
    // Context rows have no track (and so no record / add-target clicks).
    await expect(track(canvasElement, 'KPI-1')).toBeNull();
    await expect(track(canvasElement, 'CHK-301')).not.toBeNull();
    await waitFor(() => expect(scopeStore.saved).toEqual({ spaces: ['CHK'], workFrom: [] }));
  },
};
export const SpaceFilterOneDark: Story = {
  ...SpaceFilterOne,
  args: { ...SpaceFilterOne.args, filterStore: memoryTimelineFilters() },
  globals: { theme: 'dark' },
};

/** Several spaces: an ancestor in a chosen space is a full row. */
export const SpaceFilterSeveral: Story = {
  args: { useData: stub({ data: ORG }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await toggleScope(c, 'KPI space', /Digital Commerce/);
    await toggleScope(c, 'KPI space', /Payments/);
    await expect(c.getByRole('button', { name: 'KPI space: 2 spaces' })).toBeInTheDocument();
    await expect(rowNames(canvasElement)).toEqual([
      '(Profit)',
      '(Revenue)',
      'Online revenue',
      '(Checkout conversion)',
      '(Payment success rate)',
      'Fraud review time',
      '(Expenses)',
      'Cost to serve per order',
    ]);
  },
};

/** The page opens on the remembered filter; a remembered space with no KPIs any more is ignored. */
export const SpaceFilterRemembered: Story = {
  args: { useData: stub({ data: ORG }), filterStore: memoryTimelineFilters({ spaces: ['MOB', 'GONE'], workFrom: [] }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: 'KPI space: Mobile App' })).toBeInTheDocument();
    await expect(rowNames(canvasElement)).toEqual(['(Profit)', '(Revenue)', '(Online revenue)', 'App order share']);
  },
};

const loadReadingsSpy = fn();
/** Readings load only for full rows: the KPIs the load left out are asked for when they come into scope. */
export const ReadingsLoadForScope: Story = {
  args: {
    useData: stub({ data: orgTree(false, ['CHK']), loadReadings: loadReadingsSpy }),
    filterStore: memoryTimelineFilters({ spaces: ['CHK'], workFrom: [] }),
  },
  play: async ({ canvasElement }) => {
    loadReadingsSpy.mockClear();
    const c = within(canvasElement);
    // Checkout's readings came with the load; its ancestors need none.
    await expect(loadReadingsSpy).not.toHaveBeenCalled();
    await toggleScope(c, 'KPI space', /Mobile App/);
    await waitFor(() => expect(loadReadingsSpy).toHaveBeenCalledWith(['30010']));
    await expect(c.getByText('Loading values…')).toBeInTheDocument();
  },
};

const retryReadingsSpy = fn();
/** Values for KPIs that came into scope failed to load: a banner offers a retry. */
export const ReadingsFailed: Story = {
  args: { useData: stub({ data: POPULATED, readingsError: 'Jira 500', retryReadings: retryReadingsSpy }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('alert')).toHaveTextContent('Couldn’t load values');
    await userEvent.click(c.getByRole('button', { name: 'Retry' }));
    await expect(retryReadingsSpy).toHaveBeenCalledTimes(1);
  },
};

const contextChildSpy = fn(async (input: CreateKpiInput) => createdKpi(input, 'MOB-900'));
/**
 * + on a context row while filtered to one space: the dialog fills in that KPI as
 * the parent; the user picks the space (here Mobile App). The new KPI is hidden
 * by the filter, so the flag says so and **Show it** adds its space.
 */
export const AddChildOnContextRow: Story = {
  args: {
    useData: stub({
      data: ORG,
      createKpi: async (input) => {
        const kpi = await contextChildSpy(input);
        return { ...kpi, space: SPACES7.MOB };
      },
    }),
    filterStore: memoryTimelineFilters({ spaces: ['CHK'], workFrom: [] }),
  },
  play: async ({ canvasElement }) => {
    contextChildSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Create child KPI for DCOM-101' }));
    const dialog = within(await screen.findByRole('dialog'));
    await expect(dialog.getByText('DCOM-101')).toBeInTheDocument();
    await userEvent.click(await dialog.findByRole('button', { name: 'Space: none chosen' }));
    await userEvent.click(dialog.getByRole('option', { name: /Mobile App/ }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'App checkout share');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(contextChildSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: SPACES7.MOB.id, parentKpiId: '30003' })),
    );
    const flag = (await screen.findByText(/App checkout share created/)).closest<HTMLElement>('[role="status"]')!;
    await expect(flag).toHaveTextContent('MOB-900 App checkout share created');
    await expect(flag).toHaveTextContent('In Mobile App (MOB). It’s hidden by the filters.');
    await userEvent.click(within(flag).getByRole('button', { name: 'Show it' }));
    await expect(c.getByRole('button', { name: 'KPI space: 2 spaces' })).toBeInTheDocument();
  },
};
export const AddChildOnContextRowDark: Story = {
  ...AddChildOnContextRow,
  args: { ...AddChildOnContextRow.args, filterStore: memoryTimelineFilters({ spaces: ['CHK'], workFrom: [] }) },
  globals: { theme: 'dark' },
};

// ── Spec 11 · 06: access per KPI space, looked up when an action is used ────

const FULL: KpiSpaceAccess = { browse: true, create: true, edit: true, link: true };
const READ_ONLY: KpiSpaceAccess = { browse: true, create: false, edit: false, link: false };

/** KPIs in two spaces: Revenue (KPI, central) with Margin and Pipeline (Portfolio) nested under it. */
const TWO_SPACES: TimelineData = {
  today: '2026-07-10',
  centralSpace: KPI_SPACE,
  roots: [
    node({
      id: 'n1',
      kpiId: '20001',
      issueKey: 'KPI-1',
      name: 'Revenue',
      readings: [{ date: '2026-01-03', value: 1_000_000 }],
      children: [
        node({
          id: 'n2',
          kpiId: '20050',
          issueKey: 'PORT-1',
          name: 'Portfolio margin',
          unit: '%',
          depth: 1,
          space: PORT_SPACE,
          readings: [{ date: '2026-02-03', value: 12 }],
        }),
        node({
          id: 'n3',
          kpiId: '20051',
          issueKey: 'PORT-2',
          name: 'Portfolio pipeline',
          unit: 'USD',
          depth: 1,
          space: PORT_SPACE,
          readings: [{ date: '2026-02-03', value: 5 }],
        }),
      ],
    }),
  ],
};

const refusedRecordSpy = fn();
const refusedLookups = fn(async (projectKey: string) => (projectKey === 'PORT' ? READ_ONLY : FULL));
/**
 * A KPI in a space where the user lacks Edit Issues: clicking its track looks
 * the space up, then shows the reason naming that space instead of the dialog;
 * its … menu then shows Edit and Move disabled with their reasons. A second KPI
 * in that space reuses the answer; a KPI in another space records fine.
 */
export const RefusedInAnotherSpace: Story = {
  args: { useData: stub({ data: TWO_SPACES, record: refusedRecordSpy, getKpiAccess: refusedLookups }) },
  play: async ({ canvasElement }) => {
    refusedRecordSpy.mockClear();
    refusedLookups.mockClear();
    const c = within(canvasElement);
    await clickPast(canvasElement, 'PORT-1');
    const alert = await c.findByRole('alert');
    await expect(alert).toHaveTextContent(
      'Recording a value on PORT-1 needs Edit Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    await expect(screen.queryByRole('dialog')).toBeNull();

    // The second KPI in Portfolio: its menu opens at once (no new lookup), items disabled with why.
    const edit = await menuItem(c, 'PORT-2', /Edit name, unit, direction/);
    await expect(edit).toHaveAttribute('aria-disabled', 'true');
    await expect(edit).toHaveTextContent('Editing PORT-2 needs Edit Issues permission on the Portfolio space');
    await expect(screen.getByRole('menuitem', { name: /Move under another KPI/ })).toHaveTextContent(
      'Nesting a KPI under another needs Link Issues permission on the Portfolio space',
    );
    // Record a value… (the track click's keyboard path) is disabled with the same reason; Add a target… isn't.
    const recordItem = screen.getByRole('menuitem', { name: /Record a value…/ });
    await expect(recordItem).toHaveAttribute('aria-disabled', 'true');
    await expect(recordItem).toHaveTextContent(
      'Recording a value on PORT-2 needs Edit Issues permission on the Portfolio space',
    );
    await userEvent.click(recordItem);
    await expect(screen.queryByRole('dialog')).toBeNull();
    await expect(screen.getByRole('menuitem', { name: 'Add a target…' })).not.toHaveAttribute('aria-disabled');
    await expect(refusedLookups.mock.calls.map(([key]) => key)).toEqual(['PORT']);
    await userEvent.keyboard('{Escape}');

    // The central space's KPI is unaffected: its own lookup, then the dialog.
    await clickPast(canvasElement, 'KPI-1');
    await expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await expect(refusedLookups.mock.calls.map(([key]) => key)).toEqual(['PORT', 'KPI']);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Another action in the same space reuses the answer.
    await userEvent.click(await menuItem(c, 'KPI-1', 'Edit name, unit, direction'));
    await expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await expect(refusedLookups).toHaveBeenCalledTimes(2);
    await expect(refusedRecordSpy).not.toHaveBeenCalled();
  },
};

export const RefusedInAnotherSpaceDark: Story = { ...RefusedInAnotherSpace, globals: { theme: 'dark' } };

/** While a space's access is looked up, the action shows a busy state and nothing opens yet. */
export const CheckingAccess: Story = {
  args: { useData: stub({ data: TWO_SPACES, getKpiAccess: () => new Promise<KpiSpaceAccess | null>(() => {}) }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const more = c.getByRole('button', { name: 'More actions for PORT-1' });
    await userEvent.click(more);
    await waitFor(() => expect(more).toHaveAttribute('aria-busy', 'true'));
    await expect(screen.queryByRole('menu')).toBeNull();
    // Clicking the track's past side (to record a value there) waits the same way.
    await clickPast(canvasElement, 'PORT-1');
    await waitFor(() => expect(track(canvasElement, 'PORT-1')).toHaveAttribute('data-access-pending', 'true'));
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};

export const CheckingAccessDark: Story = { ...CheckingAccess, globals: { theme: 'dark' } };

/** When Jira can't answer the lookup, the action goes ahead (Jira's own refusal explains a denied save). */
export const AccessLookupFails: Story = {
  args: { useData: stub({ data: TWO_SPACES, getKpiAccess: async () => null }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await clickPast(canvasElement, 'PORT-1');
    await expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await expect(c.queryByRole('alert')).toBeNull();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // … → Record a value… goes ahead the same way.
    await userEvent.click(await menuItem(c, 'PORT-2', 'Record a value…'));
    await expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await expect(c.queryByRole('alert')).toBeNull();
  },
};

export const AccessLookupFailsDark: Story = { ...AccessLookupFails, globals: { theme: 'dark' } };

/** No Link Issues in the space the child goes to: Create is refused with the reason naming that space. */
export const AddChildRefusedWithoutLinkIssues: Story = {
  args: {
    useData: stub({
      data: TWO_SPACES,
      getKpiAccess: async () => ({ ...FULL, link: false }),
      getKpiCreateSpaces: async () => ({ spaces: [PORT_SPACE], preselect: PORT_SPACE.id }),
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Create child KPI for KPI-1' }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Space: Portfolio (PORT)' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Sub Metric');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(dialog.getByRole('alert')).toHaveTextContent(
        /Nesting a KPI under another needs Link Issues permission on the Portfolio space\./,
      ),
    );
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

/** Interaction: clicking a past date on the track opens the record modal, and Record calls the loader. */
const recordSpy = fn();
export const RecordValue: Story = {
  args: { useData: stub({ data: POPULATED, record: recordSpy }) },
  play: async ({ canvasElement }) => {
    recordSpy.mockClear();
    await clickPast(canvasElement, 'KPI-1');
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
    await clickPast(canvasElement, 'KPI-1');
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
    await clickPast(canvasElement, 'KPI-1');
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
    await waitFor(() => expect(editSpy).toHaveBeenCalledWith('20001', '2026-07-06', 1_250_000));
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
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('20001', '2026-01-03', null));
  },
};

/** Interaction: Add KPI with every KPI in one space: the space is filled in; Create calls the loader and flags the new KPI. */
const createSpy = fn(async (input: CreateKpiInput) => ({ ...createdKpi(input), space: KPI_SPACE }));
export const AddKpi: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createSpy }) },
  play: async ({ canvasElement }) => {
    createSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await expect(await dialog.findByRole('button', { name: 'Space: KPIs (KPI)' })).toBeInTheDocument();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Net Revenue');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Unit' }), 'USD');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({ projectId: '10000', name: 'Net Revenue', unit: 'USD', direction: 'increase', parentKpiId: null }),
    );
    // Saved → the dialog closes and a flag names the KPI by key and name.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expect(screen.getByText(/Net Revenue created/).closest('[role="status"]')).toHaveTextContent('KPI-99 Net Revenue created');
    await expect(screen.queryByRole('button', { name: 'Show it' })).toBeNull();
  },
};
export const AddKpiDark: Story = { ...AddKpi, globals: { theme: 'dark' } };

const chooseSpaceSpy = fn(async (input: CreateKpiInput) => createdKpi(input));
/** KPIs in two spaces and a central space: nothing filled in; Create without a space says "Choose a space." */
export const AddKpiChooseSpace: Story = {
  args: { useData: stub({ data: TWO_SPACES, createKpi: chooseSpaceSpy }) },
  play: async ({ canvasElement }) => {
    chooseSpaceSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Space: none chosen' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Net Revenue');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await expect(dialog.getByRole('alert')).toHaveTextContent('Choose a space.');
    await expect(chooseSpaceSpy).not.toHaveBeenCalled();
    // Creating in the second space puts the KPI there.
    await userEvent.click(dialog.getByRole('button', { name: 'Space: none chosen' }));
    await userEvent.click(dialog.getByRole('option', { name: /Portfolio/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(chooseSpaceSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: PORT_SPACE.id })));
  },
};

export const AddKpiChooseSpaceDark: Story = { ...AddKpiChooseSpace, globals: { theme: 'dark' } };

export const AddKpiSaving: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: () => new Promise<CreatedKpi>(() => {}) }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Space: KPIs (KPI)' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Net Revenue');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(dialog.getByRole('textbox', { name: 'Summary (KPI name)' })).toBeDisabled());
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
    await expect(screen.getByRole('dialog')).toBeInTheDocument();
  },
};

/** A failed create keeps the dialog open with the error inside it, and the typed values intact. */
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
    await dialog.findByRole('button', { name: 'Space: KPIs (KPI)' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Net Revenue');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText(/boom/)).toBeInTheDocument();
    await expect(dialog.getByRole('textbox', { name: 'Summary (KPI name)' })).toHaveValue('Net Revenue');
    await expect(dialog.getByRole('textbox', { name: 'Summary (KPI name)' })).not.toBeDisabled();
  },
};

/**
 * Nesting before an admin has chosen the KPI hierarchy link type: the dialog
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
    await userEvent.click(c.getByRole('button', { name: 'Create child KPI for KPI-1' }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Space: KPIs (KPI)' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Sub Metric');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText('KPI nesting isn’t set up')).toBeInTheDocument();
    await expect(alert.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
    await expect(dialog.getByRole('textbox', { name: 'Summary (KPI name)' })).toHaveValue('Sub Metric');
  },
};

/** Interaction: a row's + (Create child KPI) nests the new KPI under that KPI. */
const createChildSpy = fn(async (input: CreateKpiInput) => createdKpi(input));
export const AddChildKpi: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createChildSpy }) },
  play: async ({ canvasElement }) => {
    createChildSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Create child KPI for KPI-1' }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Space: KPIs (KPI)' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Sub Metric');
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createChildSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sub Metric', parentKpiId: '20001' }),
      ),
    );
  },
};

/** Interaction: Add KPI's Parent field searches every KPI (with keys); choosing one nests the new KPI under it. */
const createWithParentSpy = fn(async (input: CreateKpiInput) => createdKpi(input));
export const AddKpiWithParent: Story = {
  args: { useData: stub({ data: POPULATED, createKpi: createWithParentSpy }) },
  play: async ({ canvasElement }) => {
    createWithParentSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Add KPI/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await dialog.findByRole('button', { name: 'Space: KPIs (KPI)' });
    await userEvent.type(dialog.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Repeat Orders');
    await userEvent.click(dialog.getByRole('button', { name: 'Parent' }));
    await userEvent.type(dialog.getByRole('combobox', { name: 'Parent' }), 'orders');
    await userEvent.click(dialog.getByRole('option', { name: 'KPI-2 # of Orders' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createWithParentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Repeat Orders', parentKpiId: '20002' }),
      ),
    );
  },
};

/**
 * Interaction: … → Edit name, unit, direction opens the KPI's definition;
 * Save stays disabled until something changes, then calls the loader with
 * only what changed, so an out-of-date timeline can't write back stale values.
 */
const editKpiSpy = fn();
export const EditKpi: Story = {
  args: { useData: stub({ data: POPULATED, updateKpi: editKpiSpy }) },
  play: async ({ canvasElement }) => {
    editKpiSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(await menuItem(c, 'KPI-2', 'Edit name, unit, direction'));
    const dialog = within(await screen.findByRole('dialog'));
    await expect(dialog.getByText('Edit KPI')).toBeInTheDocument();
    await expect(dialog.getByLabelText('KPI name')).toHaveValue('# of Orders');
    await expect(dialog.getByLabelText('KPI unit')).toHaveValue('count');
    await expect(dialog.getByText('Higher is better')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.clear(dialog.getByLabelText('KPI name'));
    await userEvent.type(dialog.getByLabelText('KPI name'), 'Orders');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(editKpiSpy).toHaveBeenCalledWith({ kpiId: '20002', name: 'Orders' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};
export const EditKpiDark: Story = { ...EditKpi, globals: { theme: 'dark' } };

/** Interaction: … → Move under another KPI…, clearing the parent, moves the KPI to the top level. */
const moveKpiSpy = fn();
export const EditKpiMoveToTop: Story = {
  args: { useData: stub({ data: POPULATED, updateKpi: moveKpiSpy }) },
  play: async ({ canvasElement }) => {
    moveKpiSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(await menuItem(c, 'KPI-2', 'Move under another KPI…'));
    const dialog = within(await screen.findByRole('dialog'));
    await expect(dialog.getByText('KPI-1')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Move' })).toBeDisabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Clear parent' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(moveKpiSpy).toHaveBeenCalledWith({ kpiId: '20002', parentKpiId: null }));
  },
};

/** The Move dialog never offers the KPI itself or anything nested under it (that would make a loop). */
export const EditKpiParentOptions: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await menuItem(c, 'KPI-1', 'Move under another KPI…'));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Parent KPI' }));
    await expect(await dialog.findByText('No KPIs match')).toBeInTheDocument();
    await expect(dialog.queryByRole('option', { name: /# of Orders/ })).toBeNull();
  },
};

/** A failed edit keeps the modal open with the error inside it and the typed values intact. */
export const EditKpiFailed: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      updateKpi: async () => {
        throw new Error("KPI-1 can't be nested under KPI-2: KPI-2 is nested under KPI-1.");
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await menuItem(c, 'KPI-1', 'Edit name, unit, direction'));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('KPI name'), ' (net)');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText(/is nested under KPI-1/)).toBeInTheDocument();
    await expect(dialog.getByLabelText('KPI name')).toHaveValue('Revenue (net)');
  },
};

/**
 * Interaction: clicking a future date on the track opens the Add Target modal,
 * where a type-ahead issue picker chooses the contributing issue; Add calls the
 * loader with the KPI + issue + date + value.
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
    await clickFuture(canvasElement, 'KPI-1');
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for an issue' }));
    await userEvent.click(await screen.findByText('Multi-store support'));
    await userEvent.type(dialog.getByLabelText('Target value'), '2000000');
    await userEvent.click(dialog.getByRole('button', { name: 'Add target' }));
    await waitFor(() =>
      expect(addTargetSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kpiId: '20001', issueKey: 'INIT-48', value: 2_000_000 }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/**
 * A failed save keeps the Add Target modal open with the error inside it; no
 * KPI work type configured yet offers the same "Open Settings" action as the page.
 */
export const AddTargetFailed: Story = {
  args: {
    useData: stub({
      data: POPULATED,
      searchIssues: searchIssuesStub,
      addTarget: async () => {
        throw new Error(`${KPI_WORK_TYPE_NOT_SET_UP} — choose one in Settings first.`);
      },
    }),
  },
  play: async ({ canvasElement }) => {
    await clickFuture(canvasElement, 'KPI-1');
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for an issue' }));
    await userEvent.click(await screen.findByText('Multi-store support'));
    await userEvent.type(dialog.getByLabelText('Target value'), '2000000');
    await userEvent.click(dialog.getByRole('button', { name: 'Add target' }));
    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText(/No KPI work type configured yet/i)).toBeInTheDocument();
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
    await clickFuture(canvasElement, 'KPI-1');
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

// ── The … menu's keyboard path to recording and adding targets ──────────────

/**
 * The … menu: the prototype's Edit · Move · Open in Jira, plus the keyboard path
 * to what the track clicks do — Record a value… and Add a target….
 */
export const RowMenu: Story = {
  args: { useData: stub({ data: POPULATED }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await menuItem(c, 'KPI-1', 'Open in Jira');
    const menu = screen.getByRole('menu', { name: 'More actions for KPI-1' });
    await expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Edit name, unit, direction',
      'Move under another KPI…',
      'Record a value…',
      'Add a target…',
      'Open in Jira',
    ]);
    await expect(within(menu).getByRole('menuitem', { name: 'Record a value…' })).not.toHaveAttribute('aria-disabled');
    await userEvent.keyboard('{Escape}');
  },
};
export const RowMenuDark: Story = { ...RowMenu, globals: { theme: 'dark' } };

/** Focus a row's … button and pick `item` with the keyboard alone (Enter, arrows, Enter). */
async function pickWithKeyboard(c: Canvas, issueKey: string, item: string) {
  c.getByRole('button', { name: `More actions for ${issueKey}` }).focus();
  await userEvent.keyboard('{Enter}');
  const menu = await screen.findByRole('menu', { name: `More actions for ${issueKey}` });
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  for (let i = 0; i < 5 && document.activeElement?.textContent !== item; i++) await userEvent.keyboard('{ArrowDown}');
  await expect(document.activeElement).toHaveTextContent(item);
  await userEvent.keyboard('{Enter}');
}

/** Keyboard only: … → Record a value… opens the record dialog dated today (as a past-date click would). */
const keyboardRecordSpy = fn();
const keyboardLookups = fn(async (_projectKey: string) => FULL);
export const RecordValueWithKeyboard: Story = {
  args: { useData: stub({ data: POPULATED, record: keyboardRecordSpy, getKpiAccess: keyboardLookups }) },
  play: async ({ canvasElement }) => {
    keyboardRecordSpy.mockClear();
    keyboardLookups.mockClear();
    const c = within(canvasElement);
    await pickWithKeyboard(c, 'KPI-2', 'Record a value…');
    const dialog = within(await screen.findByRole('dialog'));
    await expect(dialog.getByRole('heading', { name: 'Record a value' })).toBeInTheDocument();
    await expect(dialog.getByLabelText('Date')).toHaveValue('2026-07-10');
    await expect(keyboardLookups.mock.calls.map(([key]) => key)).toEqual(['KPI']);
    // The dialog focuses Value; type it and Tab past Cancel to Record.
    await waitFor(() => expect(dialog.getByLabelText('Value')).toHaveFocus());
    await userEvent.keyboard('11000');
    await userEvent.tab();
    await userEvent.tab();
    await expect(document.activeElement).toHaveTextContent('Record');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(keyboardRecordSpy).toHaveBeenCalledWith('20002', '2026-07-10', 11_000));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** Keyboard only: … → Add a target… opens Add target, due by default at the end of the next quarter. */
const keyboardTargetSpy = fn();
export const AddTargetWithKeyboard: Story = {
  args: { useData: stub({ data: POPULATED, addTarget: keyboardTargetSpy, searchIssues: searchIssuesStub }) },
  play: async ({ canvasElement }) => {
    keyboardTargetSpy.mockClear();
    const c = within(canvasElement);
    await pickWithKeyboard(c, 'KPI-1', 'Add a target…');
    const dialog = within(await screen.findByRole('dialog'));
    await expect(dialog.getByRole('heading', { name: 'Add target' })).toBeInTheDocument();
    await expect(dialog.getByLabelText('Date')).toHaveValue('2026-12-31');
    await userEvent.click(dialog.getByRole('combobox', { name: 'Search for an issue' }));
    await userEvent.click(await screen.findByText('Multi-store support'));
    await userEvent.type(dialog.getByLabelText('Target value'), '2000000');
    await userEvent.click(dialog.getByRole('button', { name: 'Add target' }));
    await waitFor(() =>
      expect(keyboardTargetSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kpiId: '20001', issueKey: 'INIT-48', date: '2026-12-31', value: 2_000_000 }),
      ),
    );
  },
};
