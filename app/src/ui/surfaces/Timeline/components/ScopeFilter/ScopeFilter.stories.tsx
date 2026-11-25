import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn } from '@storybook/test';
import { ScopeFilter, type ScopeOption } from './ScopeFilter.js';

const SPACES: ScopeOption[] = [
  { key: 'KPI', name: 'Global KPIs' },
  { key: 'DCOM', name: 'Digital Commerce' },
  { key: 'PLAT', name: 'Enterprise Platform' },
  { key: 'CHK', name: 'Checkout' },
  { key: 'MOB', name: 'Mobile App' },
  { key: 'DEVP', name: 'Developer Platform' },
  { key: 'PAY', name: 'Payments' },
];

function Harness({ label = 'KPI space', options = SPACES, initial = [] as string[], onChange }: {
  label?: string;
  options?: ScopeOption[];
  initial?: string[];
  onChange?: (next: string[]) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', width: 520, height: 420 }}>
      <ScopeFilter
        label={label}
        options={options}
        selected={selected}
        onChange={(next) => {
          setSelected(next);
          onChange?.([...next]);
        }}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = { component: Harness, title: 'Timeline/ScopeFilter' };
export default meta;
type Story = StoryObj<typeof Harness>;

const change = fn();

/** Nothing chosen: every KPI. Pick two spaces, then clear with "Show all". */
export const PickSeveral: Story = {
  args: { onChange: change },
  play: async ({ canvasElement }) => {
    change.mockClear();
    const c = within(canvasElement);
    const button = c.getByRole('button', { name: 'KPI space: All' });
    await userEvent.click(button);
    await userEvent.click(c.getByRole('checkbox', { name: /Checkout/ }));
    await expect(change).toHaveBeenLastCalledWith(['CHK']);
    await expect(c.getByRole('button', { name: 'KPI space: Checkout' })).toBeInTheDocument();
    await userEvent.click(c.getByRole('checkbox', { name: /Payments/ }));
    await expect(c.getByRole('button', { name: 'KPI space: 2 spaces' })).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Show all' }));
    await expect(change).toHaveBeenLastCalledWith([]);
    await expect(c.getByRole('button', { name: 'KPI space: All' })).toHaveAttribute('aria-expanded', 'false');
  },
};
export const PickSeveralDark: Story = { ...PickSeveral, globals: { theme: 'dark' } };

/** "Find a space…" matches keys and names; Esc closes the list. */
export const FindASpace: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'KPI space: All' }));
    await userEvent.type(c.getByRole('textbox', { name: /Find a space/ }), 'plat');
    await expect(c.getByRole('checkbox', { name: /Enterprise Platform/ })).toBeInTheDocument();
    await expect(c.getByRole('checkbox', { name: /Developer Platform/ })).toBeInTheDocument();
    await expect(c.queryByRole('checkbox', { name: /Checkout/ })).toBeNull();
    await userEvent.clear(c.getByRole('textbox', { name: /Find a space/ }));
    await userEvent.type(c.getByRole('textbox', { name: /Find a space/ }), 'zzz');
    await expect(c.getByText('No spaces match')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect(c.queryByRole('group', { name: 'KPI space' })).toBeNull();
  },
};

/** Work from lists the work items' spaces by key. */
export const WorkFrom: Story = {
  args: { label: 'Work from', options: [{ key: 'APP', name: 'APP' }, { key: 'WEB', name: 'WEB' }], initial: ['WEB'] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Work from: WEB' }));
    await expect(c.getByRole('checkbox', { name: 'WEB' })).toBeChecked();
    await expect(c.getByRole('checkbox', { name: 'APP' })).not.toBeChecked();
  },
};
export const WorkFromDark: Story = { ...WorkFrom, globals: { theme: 'dark' } };
