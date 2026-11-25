import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect, waitFor } from '@storybook/test';
import type { DateFieldCatalog, HierarchyLevel, KpiHierarchyStatus, RollupConfig } from '@domain/index.js';
import { Settings } from './Settings.js';
import type { SettingsController, UseSettings } from '@ui/data/useSettingsData/index.js';
import { useKpiSetupData, type KpiSetupApi, type UseKpiSetup } from '@ui/data/useKpiSetupData/index.js';
import { useMigrationsData, type MigrationsApi, type UseMigrations } from '@ui/data/useMigrationsData/index.js';
import { createKpiSetupSim, type KpiSetupScenario } from '@harness/fixtures/kpiSetup.js';
import {
  createMockMigrations,
  FIRST_MIGRATION,
  mockMigrationsApi,
  SECOND_MIGRATION,
  type MigrationsMode,
} from '@harness/fixtures/mockMigrations.js';

/**
 * Scenario stories for Settings — inject a stub loader hook to render each data
 * shape deterministically (default / custom / shallow / single-level / loading /
 * error). The `*.test.tsx` sibling replays them as assertions.
 */
const lvl = (level: number, ...issueTypeNames: string[]): HierarchyLevel => ({
  level,
  name: issueTypeNames[0],
  issueTypeNames,
});
/** Milestone and Increment share level 2 — settings are per level, not per type. */
const LEVELS = [lvl(4, 'Outcome'), lvl(3, 'Initiative'), lvl(2, 'Milestone', 'Increment'), lvl(1, 'Epic'), lvl(0, 'Story')];

const DATE_FIELDS: DateFieldCatalog = {
  fields: [
    { id: 'created', name: 'Created' },
    { id: 'duedate', name: 'Due date' },
    { id: 'customfield_10015', name: 'Start date' },
    { id: 'customfield_10022', name: 'Target end' },
    { id: 'customfield_10023', name: 'Target start' },
  ],
  defaults: { start: 'customfield_10015', due: 'duedate' },
};

const KPI_HIERARCHY = { id: '10500', name: 'KPI Hierarchy', inward: 'is a child KPI of', outward: 'is the parent KPI of' };
const HIERARCHY: KpiHierarchyStatus = {
  state: 'ready',
  linkType: KPI_HIERARCHY,
  linkTypeId: KPI_HIERARCHY.id,
  parentEnd: 'inward',
  available: [{ id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, KPI_HIERARCHY],
};

function stub(over: Partial<SettingsController>): UseSettings {
  return () => ({
    levels: over.levels ?? null,
    config: over.config ?? null,
    dateFields: over.dateFields === undefined ? DATE_FIELDS : over.dateFields,
    pending: over.pending ?? false,
    error: over.error ?? null,
    save: over.save ?? (async () => {}),
    hierarchy: over.hierarchy === undefined ? HIERARCHY : over.hierarchy,
    saveHierarchy: over.saveHierarchy ?? (async () => HIERARCHY),
    createHierarchyLinkType: over.createHierarchyLinkType ?? (async () => HIERARCHY),
    reloadHierarchy: over.reloadHierarchy ?? (async () => {}),
  });
}

/** The KPI building blocks on an in-memory site (spec 11 · 04), one per mounted story. */
function kpiSite(scenario: KpiSetupScenario): UseKpiSetup {
  return function useStorySite() {
    const [api] = useState<KpiSetupApi>(() => createKpiSetupSim(scenario));
    return useKpiSetupData(api);
  };
}

/** Upgrade data on in-memory migrations; 05's applies once fields are chosen (`fieldsChosen`). */
function migrations(mode: MigrationsMode, fieldsChosen = true): UseMigrations {
  return function useStoryMigrations() {
    const [api] = useState<MigrationsApi>(() =>
      mockMigrationsApi(
        createMockMigrations(mode, {
          applicability: (id) =>
            id === SECOND_MIGRATION && !fieldsChosen
              ? { applicable: false, reason: 'Choose the KPI fields in Settings first (KPI building blocks).' }
              : { applicable: true },
        }),
      ),
    );
    return useMigrationsData(api);
  };
}

const meta: Meta<typeof Settings> = {
  component: Settings,
  title: 'Surfaces/Settings',
  parameters: { layout: 'padded' },
  args: { useKpiSetup: kpiSite('configured'), useMigrations: migrations('done') },
};
export default meta;
type Story = StoryObj<typeof Settings>;

export const Default: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Date Rollup')).toBeInTheDocument();
    await expect(c.getByRole('heading', { name: 'KPI Hierarchy' })).toBeInTheDocument();
    await expect(c.getByText('Date fields')).toBeInTheDocument();
    await expect(c.getByText('Parent vs. children')).toBeInTheDocument();
    // each level appears once in the fields table and once in the rollup tree
    await expect(c.getAllByText('Outcome')).toHaveLength(2);
    await expect(c.getAllByText('Milestone / Increment')).toHaveLength(2);
    await expect(c.getAllByText('Story')).toHaveLength(2);
  },
};

export const CustomConfig: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: { dueDateRollup: { '4': 'childrenOnly', '3': 'parentOnly' } },
    }),
  },
};

export const ShallowHierarchy: Story = {
  args: { useSettings: stub({ levels: [lvl(1, 'Epic'), lvl(0, 'Story')], config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('Epic')).toHaveLength(2);
  },
};

export const SingleLevel: Story = {
  args: { useSettings: stub({ levels: [lvl(0, 'Task')], config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    // the only level is the leaf → it has no children to roll up, only its name shows
    await expect(within(canvasElement).getAllByText('Task')).toHaveLength(2);
  },
};

export const Loading: Story = {
  args: { useSettings: stub({ levels: null, pending: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Loading settings/i)).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: { useSettings: stub({ levels: null, error: 'nope' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Failed to load settings/i)).toBeInTheDocument();
  },
};

/**
 * The issue-type lookup failed (empty level list): the Date Rollup card explains
 * and has no Save button; the KPI space and hierarchy cards still render.
 */
export const LevelsUnavailable: Story = {
  args: { useSettings: stub({ levels: [], config: { dueDateRollup: { '1': 'childrenOnly' } } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/Couldn’t read this site’s issue types/)).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: /Save settings/i })).not.toBeInTheDocument();
    await expect(await c.findByRole('heading', { name: 'Central KPI space' })).toBeInTheDocument();
    await expect(c.getByRole('heading', { name: 'KPI Hierarchy' })).toBeInTheDocument();
  },
};

/** Interaction: "Save settings" persists the current per-level config. */
const saveSpy = fn(async (_c: RollupConfig) => {});
export const SaveInteraction: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, save: saveSpy }) },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  },
};

/** Interaction: pick a depth limit in the Select, then save. */
export const DepthCapInteraction: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, save: saveSpy }) },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('combobox', { name: /Rollup depth limit/i }));
    await userEvent.click(await c.findByText('2 levels deep'));
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ depthCap: 2 })),
    );
  },
};

/** Interaction: read Initiative's end date from "Target end"; only the change is stored. */
export const DateFieldInteraction: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, save: saveSpy }) },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('combobox', { name: 'Initiative end date field' }));
    await userEvent.click(await c.findByText('Target end'));
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ dateFields: { '3': { due: 'customfield_10022' } } }),
      ),
    );
  },
};

/** Interaction: a level shared by several issue types is configured once, for all of them. */
export const SharedLevelDateFields: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, save: saveSpy }) },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('combobox', { name: 'Milestone / Increment start date field' }));
    await userEvent.click(await c.findByText('Target start'));
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ dateFields: { '2': { start: 'customfield_10023' } } }),
      ),
    );
  },
};

/** A config saved before level keys (by issue-type name) shows on its level and re-saves by level. */
export const LegacyNameKeyedConfig: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: { dueDateRollup: { Milestone: 'childrenOnly' }, dateFields: { Milestone: { due: 'customfield_10022' } } },
      save: saveSpy,
    }),
  },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await expect(c.getByText('Target end')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDateRollup: expect.objectContaining({ '2': 'childrenOnly' }),
          dateFields: { '2': { due: 'customfield_10022' } },
        }),
      ),
    );
  },
};

/** Stored choices render in the pickers; "Reset to defaults" clears them. */
export const StoredDateFields: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: {
        dueDateRollup: {},
        dateFields: { '4': { start: 'customfield_10023', due: 'customfield_10022' } },
      },
      save: saveSpy,
    }),
  },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await expect(c.getByText('Target start')).toBeInTheDocument();
    await expect(c.getByText('Target end')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: /Reset to defaults/i }));
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ dateFields: {} })),
    );
  },
};

/** Field lookup failed → rollup still editable, no pickers, stored fields preserved. */
export const DateFieldsUnavailable: Story = {
  args: {
    useSettings: stub({
      levels: LEVELS,
      config: { dueDateRollup: {}, dateFields: { '1': { due: 'customfield_10022' } } },
      dateFields: null,
      save: saveSpy,
    }),
  },
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const c = within(canvasElement);
    await expect(c.queryByText('Date fields')).not.toBeInTheDocument();
    await expect(c.getByText('Parent vs. children')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: /Save settings/i }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ dateFields: { '1': { due: 'customfield_10022' } } }),
      ),
    );
  },
};

// ── KPI configuration (spec 11 · 04) ───────────────────────────────────────────

/** A fresh install: nothing set up, no data to upgrade. */
export const FreshInstall: Story = {
  args: {
    useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, hierarchy: { ...HIERARCHY, state: 'unset', linkType: null, linkTypeId: null } }),
    useKpiSetup: kpiSite('fresh'),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByRole('heading', { name: 'KPI building blocks' })).toBeInTheDocument();
    await expect(await c.findByText('All data is up to date.')).toBeInTheDocument();
    await expect(c.getByRole('button', { name: 'Set up everything…' })).toBeInTheDocument();
    await expect(c.getByText('First: choose the KPI work type above.')).toBeInTheDocument();
    await expect(c.getByText('Finish the KPI work type and KPI fields first. These steps refer to them.')).toBeInTheDocument();
  },
};

/**
 * An upgraded install: the Upgrade data card is first and expanded; the work
 * type and central space come from the older version; fields aren't chosen, so
 * 05's migration doesn't apply yet.
 */
export const UpgradedInstall: Story = {
  args: {
    useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }),
    useKpiSetup: kpiSite('upgraded'),
    useMigrations: migrations('pending', false),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await waitFor(() => expect(c.getByRole('heading', { name: 'Upgrade data' })).toBeInTheDocument());
    await expect(c.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Upgrade data');
    await expect(await c.findByText(/KPIs are created as work items in/)).toBeInTheDocument();
    await expect(within(c.getByRole('group', { name: 'KPI fields' })).getByText('To do')).toBeInTheDocument();
  },
};

/** Fully configured, data upgraded: the card is one line. */
export const FullyConfigured: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('All data is up to date.')).toBeInTheDocument();
    await expect(await c.findByText('Ready')).toBeInTheDocument();
    await expect(c.getByRole('heading', { name: 'Using KPIs in other spaces' })).toBeInTheDocument();
    await expect(c.queryByRole('button', { name: 'Set up everything…' })).not.toBeInTheDocument();
  },
};

/** A configured field was deleted in Jira. */
export const BrokenBlock: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }), useKpiSetup: kpiSite('broken') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(await c.findByText('Needs attention')).toBeInTheDocument();
    await expect(c.getByText('Field deleted')).toBeInTheDocument();
  },
};

/** "Set up everything" also sets up KPI nesting, so the page re-reads the hierarchy. */
const reloadSpy = fn(async () => {});
export const SetUpEverythingReloadsNesting: Story = {
  args: {
    useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} }, reloadHierarchy: reloadSpy }),
    useKpiSetup: kpiSite('fresh'),
  },
  play: async ({ canvasElement }) => {
    reloadSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'Set up everything…' }));
    await userEvent.click(c.getByRole('button', { name: 'Set it up' }));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    await expect(await c.findByText(/KPIs are created as work items in/)).toBeInTheDocument();
  },
};

/** Choosing the KPI fields makes 05's upgrade applicable: the card re-reads its list. */
function linkedSite(): { useKpiSetup: UseKpiSetup; useMigrations: UseMigrations } {
  const sim = createKpiSetupSim('upgraded');
  const mock = createMockMigrations('pending', {
    applicability: (id) =>
      id === SECOND_MIGRATION && !sim.config().fields
        ? { applicable: false, reason: 'Choose the KPI fields in Settings first (KPI building blocks).' }
        : { applicable: true },
  });
  while (mock.runMigrationBatch(FIRST_MIGRATION).state === 'running');
  const api = mockMigrationsApi(mock);
  return { useKpiSetup: () => useKpiSetupData(sim), useMigrations: () => useMigrationsData(api) };
}
export const ChoosingFieldsUnblocksTheirUpgrade: Story = {
  args: { useSettings: stub({ levels: LEVELS, config: { dueDateRollup: {} } }), ...linkedSite() },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const second = within(await c.findByRole('listitem', { name: 'Move unit and direction into fields' }));
    await expect(second.getByText('Not yet')).toBeInTheDocument();
    await userEvent.click(within(c.getByRole('group', { name: 'KPI fields' })).getByRole('button', { name: 'Create fields' }));
    await waitFor(() => expect(second.getByText('To do')).toBeInTheDocument());
    await expect(c.getByRole('button', { name: 'Upgrade' })).toBeEnabled();
  },
};

export const UpgradedInstallDark: Story = { ...UpgradedInstall, play: undefined, globals: { theme: 'dark' } };
export const FullyConfiguredDark: Story = { ...FullyConfigured, play: undefined, globals: { theme: 'dark' } };
