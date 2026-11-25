import { useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, waitFor, screen, fn } from '@storybook/test';
import type { KpiOptionDto } from '@domain/index.js';
import type { KpiPickerApi } from '@ui/data/useKpiPicker/index.js';
import {
  PROTOTYPE_WORLD,
  PROTOTYPE_WORLD_NO_CENTRAL,
  scaleWorld,
  worldOption,
  worldPickerApi,
  worldSuggestions,
  type PickerWorld,
} from '@harness/fixtures/kpiPicker.js';
import { KpiPicker, type CurrentValueState } from './KpiPicker.js';

/**
 * The two-pane KPI browser (spec 11 · 07), on the prototype's site
 * (kpi-picker.html): TEAM-123 Story → PROG-45 Epic → PORT-7 Initiative, NEW-8
 * in a new space, FIN hidden from the user, KPI-5 moved to PORT-20. Lazy views
 * load through a fake API with a short round trip.
 */
interface HarnessArgs {
  world: PickerWorld;
  itemKey: string;
  /** wraps the world's API (count calls, hold a load in flight) */
  api?: (base: KpiPickerApi) => KpiPickerApi;
  width?: number;
  defaultOpen?: boolean;
  onChange?: (option: KpiOptionDto | null) => void;
  initial?: KpiOptionDto | null;
}

function PickerHarness({ world, itemKey, api, width = 820, defaultOpen = true, onChange, initial = null }: HarnessArgs) {
  const loads = useMemo(() => {
    const base = worldPickerApi(world, { delayMs: 30 });
    return api ? api(base) : base;
  }, [world, api]);
  const suggestions = useMemo(() => worldSuggestions(world, itemKey), [world, itemKey]);
  const tracked = useMemo(
    () => new Set(world.items.find((i) => i.key === itemKey)?.targets.map((a) => a.kpiId) ?? []),
    [world, itemKey],
  );
  const [value, setValue] = useState<KpiOptionDto | null>(initial);
  const [current, setCurrent] = useState<CurrentValueState>(null);
  return (
    <div style={{ width }} className="rounded-md border border-dashed border-border p-3">
      <label htmlFor="kpi-field" className="mb-0.5 block text-xs leading-4 text-text-subtle">
        KPI
      </label>
      <KpiPicker
        inputId="kpi-field"
        suggestions={suggestions}
        issueKey={itemKey}
        trackedIds={tracked}
        value={value}
        onChange={(o) => {
          setValue(o);
          onChange?.(o);
          if (!o) return setCurrent(null);
          setCurrent({ pending: true });
          void loads.getKpiCurrentValue(o.id).then((v) => setCurrent({ pending: false, value: v.value }));
        }}
        api={loads}
        currentValue={current}
        defaultOpen={defaultOpen}
      />
      <input aria-label="Next field" className="mt-2 h-8 w-full rounded border border-border bg-[var(--ds-surface-sunken,#f7f8f9)]" />
    </div>
  );
}

const meta: Meta<typeof PickerHarness> = {
  component: PickerHarness,
  title: 'Surfaces/IssuePanel/KpiPicker',
  parameters: { layout: 'padded' },
  args: { world: PROTOTYPE_WORLD, itemKey: 'TEAM-123' },
};
export default meta;
type Story = StoryObj<typeof PickerHarness>;

const browser = (el: HTMLElement) => within(within(el).getByTestId('kpi-browser'));
const list = (el: HTMLElement) => within(within(el).getByRole('listbox', { name: 'KPIs' }));
const nav = (el: HTMLElement) => within(within(el).getByRole('navigation', { name: 'KPI views' }));
const field = (el: HTMLElement) => within(el).getByRole('combobox', { name: 'KPI' });
const optionKeys = (el: HTMLElement) =>
  list(el)
    .queryAllByRole('option')
    .map((o) => o.textContent ?? '');

/** Counts each lazy load (stories check what opening a view asks for). */
function counting(calls: string[]) {
  return (base: KpiPickerApi): KpiPickerApi => ({
    listKpisInSpaces: (keys) => (calls.push(`spaces:${keys.join(',')}`), base.listKpisInSpaces(keys)),
    searchKpis: (text, key) => (calls.push(`search:${key ?? ''}:${text}`), base.searchKpis(text, key)),
    listKpiSpaces: (q, at) => (calls.push(`spaceList:${q}`), base.listKpiSpaces(q, at)),
    lookupKpiRef: (ref) => (calls.push(`lookup:${ref}`), base.lookupKpiRef(ref)),
    getKpiCurrentValue: (id) => (calls.push(`value:${id}`), base.getKpiCurrentValue(id)),
  });
}

/** Holds every search (and space list) in flight. */
const searchesInFlight = (base: KpiPickerApi): KpiPickerApi => ({
  ...base,
  searchKpis: () => new Promise(() => {}),
  listKpisInSpaces: () => new Promise(() => {}),
});

// ── The prototype's scenarios ───────────────────────────────────────────────

/**
 * TEAM-123 (a Story): opens on Tracked by parents. One shaded band per parent,
 * nearest first; every target is a top-level row with the parent's target;
 * Conversion rate is under both parents; sub-KPIs start collapsed.
 */
export const TrackedByParents: Story = {
  play: async ({ canvasElement }) => {
    const b = browser(canvasElement);
    // The menu: the views tied to this work item, Global KPIs last, then All KPIs. No counts.
    const entries = nav(canvasElement).getAllByRole('button').map((e) => e.textContent);
    await expect(entries).toEqual(['Tracked by parents', 'TEAMThis space', 'PROGGrowth Program', 'PORTCompany Portfolio', 'KPIGlobal KPIs', 'All KPIs']);
    await expect(nav(canvasElement).getByRole('button', { name: 'Tracked by parents' })).toHaveAttribute('aria-current', 'true');
    await expect(b.getByText('Parent spaces')).toBeInTheDocument();
    // No right-pane title: the column header starts it.
    await expect(b.getByTestId('kpi-columns')).toHaveTextContent('KPIUnitTarget');
    const bands = list(canvasElement).getAllByRole('group');
    await expect(bands.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual([
      'PROG-45Frictionless checkout',
      'PORT-7FY27 growth',
    ]);
    const epic = within(bands[0]);
    // Targets in rank order, all top level (TEAM-501 is PROG-210's sub-KPI, but both are targets).
    await expect(epic.getAllByRole('option').map((o) => [o.textContent?.split(/\s/)[0], o.getAttribute('aria-level')])).toEqual([
      [expect.stringMatching(/^TEAM-501/), '1'],
      [expect.stringMatching(/^PROG-210/), '1'],
    ]);
    await expect(epic.getByRole('option', { name: /PROG-210/ })).toHaveTextContent('+2% by Jun 30, 2026');
    await expect(within(bands[1]).getByRole('option', { name: /PROG-210/ })).toHaveTextContent('+3% by Dec 31, 2026');
    // Sub-KPIs collapsed: TEAM-502 (under TEAM-501) isn't shown until expanded.
    await expect(list(canvasElement).queryByRole('option', { name: /TEAM-502/ })).toBeNull();
    // The work item's own target (TEAM-503) is left out everywhere.
    await expect(list(canvasElement).queryByRole('option', { name: /TEAM-503/ })).toBeNull();
  },
};
export const TrackedByParentsDark: Story = { ...TrackedByParents, globals: { theme: 'dark' } };

/** A chevron opens a KPI's sub-KPIs without picking it; each place expands separately. */
const chevronPick = fn();
export const ExpandWithoutPicking: Story = {
  args: { onChange: chevronPick },
  play: async ({ canvasElement }) => {
    chevronPick.mockClear();
    const bands = list(canvasElement).getAllByRole('group');
    const epic = within(bands[0]);
    await userEvent.click(epic.getByRole('button', { name: 'Expand Conversion rate' }));
    await expect(chevronPick).not.toHaveBeenCalled();
    await expect(epic.getByRole('option', { name: /PROG-211/ })).toHaveAttribute('aria-level', '2');
    await expect(epic.getByRole('button', { name: 'Collapse Conversion rate' })).toHaveAttribute('aria-expanded', 'true');
    // The same KPI under the Initiative stays collapsed.
    await expect(within(bands[1]).queryByRole('option', { name: /PROG-211/ })).toBeNull();
    // Sub-KPI rows leave the Target column blank.
    await expect(epic.getByRole('option', { name: /PROG-211/ })).not.toHaveTextContent('by');
  },
};

/** NEW-8 (a new space): This space is known empty, greyed, with a tooltip; its message points to All KPIs. */
export const NewSpaceEmpty: Story = {
  args: { itemKey: 'NEW-8' },
  play: async ({ canvasElement }) => {
    const thisSpace = nav(canvasElement).getByRole('button', { name: /This space/ });
    await expect(thisSpace).toHaveAttribute('data-empty', 'true');
    await userEvent.hover(thisSpace);
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Nothing here'));
    await userEvent.click(thisSpace);
    await expect(list(canvasElement).getByText(/No KPIs in Loyalty Squad yet\. Find one in/)).toBeInTheDocument();
    await expect(list(canvasElement).queryByText(/Create/)).toBeNull();
    await userEvent.click(list(canvasElement).getByRole('button', { name: 'All KPIs' }));
    await expect(nav(canvasElement).getByRole('button', { name: 'All KPIs' })).toHaveAttribute('aria-current', 'true');
    await expect(browser(canvasElement).getByText('Type to search every KPI you can access, or choose a space.')).toBeInTheDocument();
  },
};
export const NewSpaceEmptyDark: Story = { ...NewSpaceEmpty, globals: { theme: 'dark' } };

/** PORT-7 (the top of its chain): Tracked by parents is empty and greyed, so the browser opens on This space. */
export const TopOfHierarchy: Story = {
  args: { itemKey: 'PORT-7' },
  play: async ({ canvasElement }) => {
    const n = nav(canvasElement);
    await expect(n.getByRole('button', { name: /This space/ })).toHaveAttribute('aria-current', 'true');
    await expect(n.getByRole('button', { name: 'Tracked by parents' })).toHaveAttribute('data-empty', 'true');
    // No parent spaces, but Global KPIs is still listed.
    await expect(n.getAllByRole('button').map((e) => e.textContent)).toEqual([
      'Tracked by parents',
      'PORTThis space',
      'KPIGlobal KPIs',
      'All KPIs',
    ]);
    await expect(optionKeys(canvasElement).join(' ')).toMatch(/PORT-14/);
    // Its own targets (PORT-12, PROG-210) are left out.
    await expect(optionKeys(canvasElement).join(' ')).not.toMatch(/PORT-12/);
    await userEvent.click(n.getByRole('button', { name: 'Tracked by parents' }));
    await expect(list(canvasElement).getByText('PORT-7 is at the top of its hierarchy, so it has no parents.')).toBeInTheDocument();
  },
};
export const TopOfHierarchyDark: Story = { ...TopOfHierarchy, globals: { theme: 'dark' } };

/** A site with no central space: no Global KPIs entry. */
export const NoCentralSpace: Story = {
  args: { world: PROTOTYPE_WORLD_NO_CENTRAL },
  play: async ({ canvasElement }) => {
    await expect(nav(canvasElement).queryByRole('button', { name: /Global KPIs/ })).toBeNull();
    await expect(nav(canvasElement).getByRole('button', { name: /Company Portfolio/ })).toBeInTheDocument();
  },
};

// ── Lazy views ──────────────────────────────────────────────────────────────

/** A parent space loads when opened (once: re-opening it makes no new request). */
const lazyCalls: string[] = [];
export const ParentSpaceLoads: Story = {
  args: { api: counting(lazyCalls) },
  play: async ({ canvasElement }) => {
    lazyCalls.length = 0;
    // Opening the browser loads nothing.
    await expect(lazyCalls).toEqual([]);
    const n = nav(canvasElement);
    await userEvent.click(n.getByRole('button', { name: /Growth Program/ }));
    await expect(list(canvasElement).getByText('Loading KPIs…')).toBeInTheDocument();
    await waitFor(() => expect(optionKeys(canvasElement).join(' ')).toMatch(/PROG-212/));
    // A collapsed tree: PROG-213 is under PROG-212.
    await expect(optionKeys(canvasElement).join(' ')).not.toMatch(/PROG-213/);
    await userEvent.click(n.getByRole('button', { name: /Global KPIs/ }));
    await waitFor(() => expect(optionKeys(canvasElement).join(' ')).toMatch(/KPI-7/));
    await userEvent.click(n.getByRole('button', { name: /Growth Program/ }));
    await expect(optionKeys(canvasElement).join(' ')).toMatch(/PROG-212/);
    await expect(lazyCalls).toEqual(['spaces:PROG', 'spaces:KPI']);
  },
};

/** A lazily loaded view while its request is in flight. */
export const ViewLoading: Story = {
  args: { api: searchesInFlight },
  play: async ({ canvasElement }) => {
    await userEvent.click(nav(canvasElement).getByRole('button', { name: /Global KPIs/ }));
    await expect(list(canvasElement).getByText('Loading KPIs…')).toBeInTheDocument();
  },
};
export const ViewLoadingDark: Story = { ...ViewLoading, globals: { theme: 'dark' } };

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Typing searches the selected view (matches marked, paths opened) and says how
 * many match elsewhere; "Search all KPIs" moves the same search to All KPIs.
 */
export const SearchTheView: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), 'conv');
    // The every-space search runs once for the footer.
    await waitFor(() => expect(within(canvasElement).getByText(/more in other spaces/)).toBeInTheDocument());
    // In Tracked by parents: Conversion rate (both bands) and Checkout conversion.
    await expect(optionKeys(canvasElement)).toEqual([
      expect.stringMatching(/^TEAM-501Checkout conversion/),
      expect.stringMatching(/^PROG-210Conversion rate/),
      expect.stringMatching(/^PROG-210Conversion rate/),
    ]);
    await expect(canvasElement.querySelector('mark')).toHaveTextContent(/conv/i);
    const footer = within(canvasElement).getByText(/more in other spaces/);
    await expect(footer).toHaveTextContent('2 more in other spaces · Search all KPIs');
    // Switching views keeps the text and re-runs it there.
    await userEvent.click(nav(canvasElement).getByRole('button', { name: /This space/ }));
    await expect(field(canvasElement)).toHaveValue('conv');
    await expect(optionKeys(canvasElement)).toEqual([expect.stringMatching(/^TEAM-501Checkout conversion/)]);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Search all KPIs' }));
    await expect(nav(canvasElement).getByRole('button', { name: 'All KPIs' })).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(optionKeys(canvasElement)).toHaveLength(4));
    // All KPIs groups results by space, with a header per space.
    await expect(list(canvasElement).getByRole('group', { name: 'MKT Marketing' })).toBeInTheDocument();
    await expect(list(canvasElement).getByRole('group', { name: 'MOB Mobile App' })).toBeInTheDocument();
  },
};
export const SearchTheViewDark: Story = { ...SearchTheView, globals: { theme: 'dark' } };

/** While the every-space search is in flight: "Searching other spaces…" / "Searching every space…". */
export const SearchInFlight: Story = {
  args: { api: searchesInFlight },
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), 'rev');
    await waitFor(() => expect(within(canvasElement).getByText('Searching other spaces…')).toBeInTheDocument());
    await userEvent.click(nav(canvasElement).getByRole('button', { name: 'All KPIs' }));
    await expect(list(canvasElement).getByText('Searching every space…')).toBeInTheDocument();
  },
};

/** All KPIs' Space filter: a searchable list of spaces; Enter picks the first match; × clears it. */
export const SpaceFilterNarrowsAllKpis: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(nav(canvasElement).getByRole('button', { name: 'All KPIs' }));
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Space: Any space' }));
    const find = within(canvasElement).getByRole('textbox', { name: 'Find a space' });
    await expect(find).toHaveFocus();
    // No counts in the space list; the hidden FIN space isn't offered.
    await waitFor(() => expect(within(canvasElement).getByRole('option', { name: /Customer Support/ })).toBeInTheDocument());
    await expect(within(canvasElement).queryByRole('option', { name: /Finance/ })).toBeNull();
    // Enter right after typing picks the first match once it arrives.
    await userEvent.type(find, 'platform ops{Enter}');
    await expect(await within(canvasElement).findByRole('button', { name: 'Space: OPS Platform Ops' })).toBeInTheDocument();
    await waitFor(() => expect(optionKeys(canvasElement)).toEqual([expect.stringMatching(/^OPS-40/), expect.stringMatching(/^OPS-42/)]));
    // With a space chosen: that space only, and the footer offers every space.
    await userEvent.type(field(canvasElement), 'u');
    await waitFor(() => expect(optionKeys(canvasElement)).toEqual([expect.stringMatching(/^OPS-40Uptime/)]));
    await waitFor(() => expect(within(canvasElement).getByText(/more in other spaces/)).toHaveTextContent('Search every space'));
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Any space' }));
    await expect(within(canvasElement).getByRole('button', { name: 'Space: Any space' })).toBeInTheDocument();
  },
};
export const SpaceFilterNarrowsAllKpisDark: Story = { ...SpaceFilterNarrowsAllKpis, globals: { theme: 'dark' } };

/** The Space filter open and filtered (a state to look at). */
export const SpaceFilterOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(nav(canvasElement).getByRole('button', { name: 'All KPIs' }));
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Space: Any space' }));
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Find a space' }), 'm');
    await waitFor(() => expect(within(canvasElement).getByRole('option', { name: /Marketing/ })).toBeInTheDocument());
    await expect(within(canvasElement).queryByRole('option', { name: 'Any space' })).toBeNull();
    // Esc closes just the list.
    await userEvent.keyboard('{Escape}');
    await expect(within(canvasElement).queryByRole('textbox', { name: 'Find a space' })).toBeNull();
    await expect(within(canvasElement).getByTestId('kpi-browser')).toBeInTheDocument();
  },
};

// ── Paste a key ─────────────────────────────────────────────────────────────

/** A pasted key from another space: listed under "Pasted key" with where it lives; Enter picks it. */
const pastedPick = fn();
export const PasteKeyFromAnotherSpace: Story = {
  args: { onChange: pastedPick },
  play: async ({ canvasElement }) => {
    pastedPick.mockClear();
    await userEvent.click(field(canvasElement));
    await userEvent.paste('PORT-14');
    const pasted = within(await within(canvasElement).findByRole('group', { name: 'Pasted key' }));
    await waitFor(() => expect(pasted.getByRole('option', { name: /PORT-14/ })).toHaveTextContent('In a parent space · PORT'));
    await userEvent.keyboard('{Enter}');
    await expect(pastedPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'PORT-14' }));
    await expect(field(canvasElement)).toHaveValue('PORT-14 Gross margin (%)');
  },
};
export const PasteKeyFromAnotherSpaceDark: Story = { ...PasteKeyFromAnotherSpace, globals: { theme: 'dark' } };

/** A pasted /browse/ URL is looked up (no search). */
export const PasteUrl: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(field(canvasElement));
    await userEvent.paste('https://acme.atlassian.net/browse/OPS-40');
    const pasted = within(await within(canvasElement).findByRole('group', { name: 'Pasted key' }));
    await waitFor(() => expect(pasted.getByRole('option', { name: /OPS-40/ })).toHaveTextContent('In another space · OPS'));
    await expect(optionKeys(canvasElement)).toHaveLength(1);
  },
};

/** An old key of a moved KPI shows under its new key. */
export const PasteMovedKey: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(field(canvasElement));
    await userEvent.paste('KPI-5');
    await waitFor(() => expect(within(canvasElement).getByText('KPI-5 moved to PORT-20. Showing it under its new key.')).toBeInTheDocument());
    await expect(within(canvasElement).getByRole('option', { name: /PORT-20/ })).toBeInTheDocument();
  },
};

/** A key of something that isn't a KPI. */
export const PasteNotAKpi: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(field(canvasElement));
    await userEvent.paste('PROG-45');
    await waitFor(() =>
      expect(within(canvasElement).getByRole('group', { name: 'Pasted key' })).toHaveTextContent(
        'PROG-45Frictionless checkout is an Epic, not a KPI.',
      ),
    );
    await expect(within(canvasElement).getByRole('img', { name: 'Epic' })).toBeInTheDocument();
  },
};
export const PasteNotAKpiDark: Story = { ...PasteNotAKpi, globals: { theme: 'dark' } };

/** A KPI this work item already targets. */
export const PasteAlreadyTracked: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(field(canvasElement));
    await userEvent.paste('TEAM-503');
    await waitFor(() =>
      expect(within(canvasElement).getByRole('group', { name: 'Pasted key' })).toHaveTextContent(
        'TEAM-503Checkout p95 latency is already tracked on this work item.',
      ),
    );
    await expect(within(canvasElement).queryByRole('option', { name: /TEAM-503/ })).toBeNull();
  },
};

/** A key the user can't see, or that doesn't exist: Jira doesn't say which. */
export const PasteHiddenKey: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(field(canvasElement));
    await userEvent.paste('FIN-2');
    await waitFor(() =>
      expect(within(canvasElement).getByRole('group', { name: 'Pasted key' })).toHaveTextContent(
        'You don’t have access to FIN-2, or it doesn’t exist.',
      ),
    );
  },
};

// ── Field and keyboard ──────────────────────────────────────────────────────

/**
 * Closed, it looks like a select. Clicking expands the browser inline; ↓ / Enter
 * pick; the field then shows the KPI and, below it, its space, where it came
 * from and its current value (fetched for that KPI only).
 */
const keyboardPick = fn();
export const KeyboardPick: Story = {
  args: { defaultOpen: false, onChange: keyboardPick },
  play: async ({ canvasElement }) => {
    keyboardPick.mockClear();
    const input = field(canvasElement);
    await expect(input).toHaveAttribute('placeholder', 'Choose KPI, search, or paste a key…');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(within(canvasElement).queryByTestId('kpi-browser')).toBeNull();
    await userEvent.click(input);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    // ↓ highlights the first row, → opens it (without picking), ← closes it.
    await userEvent.keyboard('{ArrowDown}');
    await expect(input).toHaveAttribute('aria-activedescendant', list(canvasElement).getAllByRole('option')[0].id);
    await userEvent.keyboard('{ArrowRight}');
    await expect(list(canvasElement).getByRole('option', { name: /TEAM-502/ })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(list(canvasElement).queryByRole('option', { name: /TEAM-502/ })).toBeNull();
    await expect(keyboardPick).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(keyboardPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'PROG-210' }));
    await expect(within(canvasElement).queryByTestId('kpi-browser')).toBeNull();
    await expect(input).toHaveValue('PROG-210 Conversion rate (%)');
    const picked = within(within(canvasElement).getByTestId('picked-kpi'));
    await expect(picked.getByText('Growth Program')).toBeInTheDocument();
    await expect(picked.getByText('Tracked by parents')).toBeInTheDocument();
    await waitFor(() => expect(picked.getByText(/Current:/)).toBeInTheDocument());
  },
};
export const KeyboardPickDark: Story = { ...KeyboardPick, globals: { theme: 'dark' } };

/** Esc collapses the browser; so does a click outside. */
export const EscAndOutsideClick: Story = {
  args: { defaultOpen: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(field(canvasElement));
    await expect(within(canvasElement).getByTestId('kpi-browser')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect(within(canvasElement).queryByTestId('kpi-browser')).toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    await expect(within(canvasElement).getByTestId('kpi-browser')).toBeInTheDocument();
    await userEvent.click(document.body);
    await expect(within(canvasElement).queryByTestId('kpi-browser')).toBeNull();
    // Tab reaches the menu; tabbing on past the browser to the form's next field collapses it.
    await userEvent.click(field(canvasElement));
    await expect(within(canvasElement).getByTestId('kpi-browser')).toBeInTheDocument();
    await userEvent.tab();
    await expect(nav(canvasElement).getByRole('button', { name: 'Tracked by parents' })).toHaveFocus();
    const next = within(canvasElement).getByRole('textbox', { name: 'Next field' });
    for (let i = 0; i < 20 && document.activeElement !== next; i += 1) await userEvent.tab();
    await expect(next).toHaveFocus();
    await expect(within(canvasElement).queryByTestId('kpi-browser')).toBeNull();
  },
};

/** Typing over a picked KPI starts a new search (it doesn't append to the KPI's name). */
const retype = fn();
export const TypeOverPicked: Story = {
  args: { defaultOpen: false, initial: worldOption(PROTOTYPE_WORLD, 'PORT-14'), onChange: retype },
  play: async ({ canvasElement }) => {
    retype.mockClear();
    const input = field(canvasElement);
    await expect(input).toHaveValue('PORT-14 Gross margin (%)');
    await userEvent.click(input);
    await userEvent.keyboard('{End}u');
    await expect(retype).toHaveBeenCalledWith(null);
    await expect(input).toHaveValue('u');
    await expect(within(canvasElement).getByTestId('kpi-browser')).toBeInTheDocument();
  },
};

/** Below ~620px the left menu becomes a select above the list. */
export const NarrowLayout: Story = {
  args: { width: 520 },
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole('combobox', { name: 'KPI view' });
    await expect(select).toHaveValue('tracked');
    await userEvent.selectOptions(select, 'thisSpace');
    await expect(optionKeys(canvasElement).join(' ')).toMatch(/TEAM-501/);
  },
};
export const NarrowLayoutDark: Story = { ...NarrowLayout, globals: { theme: 'dark' } };

// ── Scale check (Q6) ────────────────────────────────────────────────────────

/** 300 KPIs over 25 spaces; the Epic targets 6 KPIs: bands and collapsed trees stay readable. */
const SCALE = scaleWorld();
export const AtScale: Story = {
  args: { world: SCALE, itemKey: 'TEAM-950' },
  play: async ({ canvasElement }) => {
    const bands = list(canvasElement).getAllByRole('group');
    await expect(bands).toHaveLength(2);
    // Six targets, each collapsed over its sub-KPIs.
    await expect(within(bands[0]).getAllByRole('option')).toHaveLength(6);
    await expect(within(bands[0]).getAllByRole('button', { name: /^Expand/ })).toHaveLength(6);
    await expect(within(bands[1]).getAllByRole('option')).toHaveLength(2);
    // The menu stays short: no per-space entries beyond the parents' spaces and Global KPIs.
    await expect(nav(canvasElement).getAllByRole('button').map((e) => e.textContent)).toEqual([
      'Tracked by parents',
      'TEAMThis space',
      'PROGGrowth Program',
      'KPIGlobal KPIs',
      'All KPIs',
    ]);
    await userEvent.click(nav(canvasElement).getByRole('button', { name: /This space/ }));
    await expect(list(canvasElement).getAllByRole('option').length).toBeLessThan(10);
  },
};
export const AtScaleDark: Story = { ...AtScale, globals: { theme: 'dark' } };

/** Without the lazy loads (a story of the opening views only), a lazy view says it can't load. */
export const LoadFails: Story = {
  args: { api: () => ({ ...worldPickerApi(PROTOTYPE_WORLD), listKpisInSpaces: () => Promise.reject(new Error('Jira 503')) }) },
  play: async ({ canvasElement }) => {
    await userEvent.click(nav(canvasElement).getByRole('button', { name: /Global KPIs/ }));
    await waitFor(() => expect(list(canvasElement).getByText(/Couldn’t load KPIs: Jira 503/)).toBeInTheDocument());
    await expect(list(canvasElement).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  },
};
