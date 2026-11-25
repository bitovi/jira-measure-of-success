import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn, waitFor } from '@storybook/test';
import type { KpiRefLookup } from '@domain/index.js';
import { TYPE_ICONS } from '@harness/fixtures/typeIcons.js';
import { ParentField, type ParentOption } from './ParentField.js';
import { PARENT_OPTIONS, space } from './parentField.fixtures.js';

const lookup = fn(async (ref: string): Promise<KpiRefLookup> => {
  if (ref === 'MOB-401')
    return {
      kind: 'kpi',
      option: {
        id: '401',
        key: 'MOB-401',
        name: 'App order share',
        typeIconUrl: null,
        unit: '%',
        direction: 'increase',
        space: space('MOB', 'Mobile App'),
        parentId: null,
        hasChildren: false,
      },
    };
  if (ref === 'PAY-88')
    return { kind: 'notKpi', item: { id: '88', key: 'PAY-88', summary: 'Retry declined cards', typeName: 'Epic', typeIconUrl: null } };
  return { kind: 'hidden' };
});

function Harness({ initial = null, onChange }: { initial?: ParentOption | null; onChange?: (o: ParentOption | null) => void }) {
  const [value, setValue] = useState<ParentOption | null>(initial);
  return (
    <div style={{ width: 560, height: 420 }}>
      <ParentField
        options={PARENT_OPTIONS}
        value={value}
        onChange={(o) => {
          setValue(o);
          onChange?.(o);
        }}
        typeIconUrl={TYPE_ICONS.KPI}
        lookupKpiRef={lookup}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = { component: Harness, title: 'Timeline/ParentField' };
export default meta;
type Story = StoryObj<typeof Harness>;

const change = fn();

/** Collapsed until clicked; search by name, key or space; two-line options with keys; clear for top level. */
export const SearchAndPick: Story = {
  args: { onChange: change },
  play: async ({ canvasElement }) => {
    change.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Parent' }));
    const input = c.getByRole('combobox', { name: 'Parent' });
    await expect(c.getAllByRole('option')).toHaveLength(5);
    await userEvent.type(input, 'chk-30');
    await expect(c.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'CHK-301 Checkout conversion',
      'CHK-302 Payment success rate',
    ]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(change).toHaveBeenLastCalledWith(PARENT_OPTIONS[4]);
    await expect(c.getByText('CHK-302')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Clear parent' }));
    await expect(change).toHaveBeenLastCalledWith(null);
  },
};
export const SearchAndPickDark: Story = { ...SearchAndPick, globals: { theme: 'dark' } };

/** Filled in from a row's +. */
export const Prefilled: Story = {
  args: { initial: PARENT_OPTIONS[3] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Checkout conversion')).toBeInTheDocument();
    await expect(c.getByText('CHK-301')).toBeInTheDocument();
  },
};
export const PrefilledDark: Story = { ...Prefilled, globals: { theme: 'dark' } };

/** A whole key not on the page is looked up directly: a KPI, a work item that isn't one, or nothing visible. */
export const TypeAWholeKey: Story = {
  args: { onChange: change },
  play: async ({ canvasElement }) => {
    change.mockClear();
    lookup.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Parent' }));
    const input = c.getByRole('combobox', { name: 'Parent' });
    await userEvent.type(input, 'MOB-401');
    const found = await c.findByRole('option', { name: 'MOB-401 App order share' });
    await expect(lookup).toHaveBeenCalledWith('MOB-401');
    await userEvent.click(found);
    await expect(change).toHaveBeenLastCalledWith({ kpiId: '401', key: 'MOB-401', name: 'App order share', space: space('MOB', 'Mobile App') });

    await userEvent.click(c.getByRole('button', { name: 'Parent' }));
    await userEvent.type(c.getByRole('combobox', { name: 'Parent' }), 'pay-88');
    await waitFor(() => expect(c.getByText('PAY-88 isn’t a KPI.')).toBeInTheDocument());
    await userEvent.clear(c.getByRole('combobox', { name: 'Parent' }));
    await userEvent.type(c.getByRole('combobox', { name: 'Parent' }), 'OPS-9');
    await waitFor(() => expect(c.getByText('No KPI OPS-9 that you can see.')).toBeInTheDocument());
    // A key already on the page needs no lookup.
    lookup.mockClear();
    await userEvent.clear(c.getByRole('combobox', { name: 'Parent' }));
    await userEvent.type(c.getByRole('combobox', { name: 'Parent' }), 'KPI-2');
    await expect(c.getByRole('option', { name: 'KPI-2 Revenue' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    await expect(lookup).not.toHaveBeenCalled();
  },
};
