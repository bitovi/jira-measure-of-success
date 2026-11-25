import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn, screen, waitFor } from '@storybook/test';
import type { CreatedKpi, CreateKpiInput, KpiCreateSpaces, KpiSpaceRef } from '@domain/index.js';
import { TYPE_ICONS } from '@harness/fixtures/typeIcons.js';
import { AddKpiDialog } from './AddKpiDialog.js';
import { PARENT_OPTIONS } from '../ParentField/parentField.fixtures.js';

const KPI: KpiSpaceRef = { id: '10000', key: 'KPI', name: 'KPIs' };
const DCOM: KpiSpaceRef = { id: '10101', key: 'DCOM', name: 'Digital Commerce' };
const CHK: KpiSpaceRef = { id: '10103', key: 'CHK', name: 'Checkout' };
const MOB: KpiSpaceRef = { id: '10104', key: 'MOB', name: 'Mobile App' };

const created = (input: CreateKpiInput): CreatedKpi => ({
  id: '900',
  kpiId: '900',
  issueKey: 'CHK-900',
  name: input.name,
  unit: input.unit,
  direction: input.direction,
  parentKpiId: input.parentKpiId ?? null,
});

const createSpy = fn(async (input: CreateKpiInput) => created(input));
const createdSpy = fn();
const closeSpy = fn();

function Harness({
  spaces,
  presetParent = null,
  centralSpaceKey = 'KPI',
  refuseNesting = false,
  onCreate = createSpy,
}: {
  spaces: KpiCreateSpaces;
  presetParent?: (typeof PARENT_OPTIONS)[number] | null;
  centralSpaceKey?: string | null;
  refuseNesting?: boolean;
  onCreate?: (input: CreateKpiInput) => Promise<CreatedKpi>;
}) {
  const [open, setOpen] = useState(true);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  if (!open) return <p>closed</p>;
  return (
    <AddKpiDialog
      presetParent={presetParent}
      parentOptions={PARENT_OPTIONS}
      typeIconUrl={TYPE_ICONS.KPI}
      centralSpaceKey={centralSpaceKey}
      loadSpaces={async () => spaces}
      guardCreate={(space, nesting, proceed) => {
        setRefusal(null);
        setChecking(true);
        setTimeout(() => {
          setChecking(false);
          if (refuseNesting && nesting) setRefusal(`Nesting a KPI under another needs Link Issues permission on the ${space.name} space. Ask a Jira admin.`);
          else proceed();
        }, 20);
      }}
      checking={checking}
      refusal={refusal}
      onCreate={onCreate}
      onCreated={createdSpy}
      onClose={() => {
        closeSpy();
        setOpen(false);
      }}
      onOpenSettings={() => {}}
    />
  );
}

const meta: Meta<typeof Harness> = { component: Harness, title: 'Timeline/AddKpiDialog' };
export default meta;
type Story = StoryObj<typeof Harness>;

const reset = () => {
  createSpy.mockClear();
  createdSpy.mockClear();
  closeSpy.mockClear();
};
const dialog = async () => within(await screen.findByRole('dialog'));

/** KPIs in several spaces, with a central space: nothing is filled in; Create without a space says so and doesn't save. */
export const ChooseASpace: Story = {
  args: { spaces: { spaces: [CHK, DCOM, KPI, MOB], preselect: null } },
  play: async () => {
    reset();
    const d = await dialog();
    const chip = await d.findByRole('button', { name: 'Space: none chosen' });
    await expect(d.getByLabelText('Type: KPI')).toBeInTheDocument();
    await userEvent.type(d.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Express pay share');
    await userEvent.type(d.getByRole('textbox', { name: 'Unit' }), '%');
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await expect(d.getByRole('alert')).toHaveTextContent('Choose a space.');
    await expect(createSpy).not.toHaveBeenCalled();

    await userEvent.click(chip);
    // The central space reads "Global KPIs".
    await expect(d.getByRole('option', { name: /Global KPIs/ })).toBeInTheDocument();
    await userEvent.type(d.getByRole('textbox', { name: 'Find a space' }), 'check');
    await userEvent.keyboard('{Enter}');
    await expect(d.getByRole('button', { name: 'Space: Checkout (CHK)' })).toBeInTheDocument();
    await expect(d.queryByRole('alert')).toBeNull();
    await userEvent.click(d.getByRole('button', { name: '↓ Lower is better' }));
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({ projectId: CHK.id, name: 'Express pay share', unit: '%', direction: 'decrease', parentKpiId: null }),
    );
    await waitFor(() => expect(createdSpy).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'CHK-900' })));
    await expect(closeSpy).toHaveBeenCalled();
  },
};
export const ChooseASpaceDark: Story = { ...ChooseASpace, globals: { theme: 'dark' } };

/** No central space: the same, nothing filled in. */
export const NoCentralSpace: Story = {
  args: { spaces: { spaces: [CHK, DCOM, MOB], preselect: null }, centralSpaceKey: null },
  play: async () => {
    const d = await dialog();
    await userEvent.click(await d.findByRole('button', { name: 'Space: none chosen' }));
    await expect(d.getAllByRole('option').map((o) => o.textContent)).toEqual(['CheckoutCHK', 'Digital CommerceDCOM', 'Mobile AppMOB']);
  },
};

/** A user who can create KPIs in one space only: it's filled in. */
export const SingleSpaceUser: Story = {
  args: { spaces: { spaces: [CHK], preselect: CHK.id } },
  play: async () => {
    reset();
    const d = await dialog();
    await expect(await d.findByRole('button', { name: 'Space: Checkout (CHK)' })).toBeInTheDocument();
    await userEvent.type(d.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Refund rate{Enter}');
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: CHK.id, name: 'Refund rate' })));
  },
};
export const SingleSpaceUserDark: Story = { ...SingleSpaceUser, globals: { theme: 'dark' } };

/** Every KPI in one space (today's installs): filled in. */
export const AllKpisInOneSpace: Story = {
  args: { spaces: { spaces: [KPI, MOB], preselect: KPI.id } },
  play: async () => {
    const d = await dialog();
    await expect(await d.findByRole('button', { name: 'Space: Global KPIs (KPI)' })).toBeInTheDocument();
  },
};

/** No space with the KPI type where the user may create: Create is disabled, with why. */
export const NoSpaceAvailable: Story = {
  args: { spaces: { spaces: [], preselect: null } },
  play: async () => {
    const d = await dialog();
    await expect(await d.findByText('No space available')).toBeInTheDocument();
    await expect(d.getByRole('alert')).toHaveTextContent('You can’t create KPIs in any space.');
    await expect(d.getByRole('button', { name: 'Create' })).toBeDisabled();
  },
};
export const NoSpaceAvailableDark: Story = { ...NoSpaceAvailable, globals: { theme: 'dark' } };

/** From a row's +: the parent is filled in; the space by the same rule (not the parent's space). */
export const ChildOfARow: Story = {
  args: { spaces: { spaces: [CHK, DCOM, KPI], preselect: null }, presetParent: PARENT_OPTIONS[0] },
  play: async () => {
    reset();
    const d = await dialog();
    await expect(await d.findByRole('button', { name: 'Space: none chosen' })).toBeInTheDocument();
    await expect(d.getByText('KPI-1')).toBeInTheDocument();
    await userEvent.click(d.getByRole('button', { name: 'Space: none chosen' }));
    await userEvent.click(d.getByRole('option', { name: /Checkout/ }));
    await userEvent.type(d.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Checkout profit');
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: CHK.id, parentKpiId: '1' })));
  },
};

/** Nesting needs Link Issues in the chosen space: checked when Create is pressed; refused, the reason names it. */
export const NestingRefused: Story = {
  args: { spaces: { spaces: [CHK], preselect: CHK.id }, presetParent: PARENT_OPTIONS[1], refuseNesting: true },
  play: async () => {
    reset();
    const d = await dialog();
    await d.findByRole('button', { name: 'Space: Checkout (CHK)' });
    await userEvent.type(d.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Checkout revenue');
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(d.getByRole('alert')).toHaveTextContent('Link Issues permission on the Checkout space'));
    await expect(createSpy).not.toHaveBeenCalled();
    // Clearing the parent makes it a top-level KPI, which needs no Link Issues.
    await userEvent.click(d.getByRole('button', { name: 'Clear parent' }));
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ parentKpiId: null })));
  },
};
export const NestingRefusedDark: Story = { ...NestingRefused, globals: { theme: 'dark' } };

/** Create another: the dialog stays open with an empty name, the same space. */
export const CreateAnother: Story = {
  args: { spaces: { spaces: [CHK], preselect: CHK.id } },
  play: async () => {
    reset();
    const d = await dialog();
    await d.findByRole('button', { name: 'Space: Checkout (CHK)' });
    await userEvent.click(d.getByRole('checkbox', { name: 'Create another' }));
    await userEvent.type(d.getByRole('textbox', { name: 'Summary (KPI name)' }), 'First');
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createdSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(d.getByRole('textbox', { name: 'Summary (KPI name)' })).toHaveValue(''));
    await expect(closeSpy).not.toHaveBeenCalled();
    await expect(d.getByRole('button', { name: 'Space: Checkout (CHK)' })).toBeInTheDocument();
  },
};

/** A failed create stays open with the error. */
export const CreateFailed: Story = {
  args: { spaces: { spaces: [CHK], preselect: CHK.id }, onCreate: async () => Promise.reject(new Error('Jira 500')) },
  play: async () => {
    const d = await dialog();
    await d.findByRole('button', { name: 'Space: Checkout (CHK)' });
    await userEvent.type(d.getByRole('textbox', { name: 'Summary (KPI name)' }), 'Broken');
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(d.getByText('Couldn’t save your change')).toBeInTheDocument());
    await expect(d.getByText('Jira 500')).toBeInTheDocument();
  },
};

/** A name is needed. */
export const NameRequired: Story = {
  args: { spaces: { spaces: [CHK], preselect: CHK.id } },
  play: async () => {
    reset();
    const d = await dialog();
    await d.findByRole('button', { name: 'Space: Checkout (CHK)' });
    await userEvent.click(d.getByRole('button', { name: 'Create' }));
    await expect(d.getByRole('alert')).toHaveTextContent('Enter a name for the KPI.');
    await expect(createSpy).not.toHaveBeenCalled();
  },
};
