import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn } from '@storybook/test';
import type { KpiOptionDto } from '@domain/index.js';
import { TYPE_ICONS } from '@harness/fixtures/typeIcons.js';
import { KpiRow } from './KpiRow.js';

const OPTION: KpiOptionDto = {
  id: '70005',
  key: 'PROG-210',
  name: 'Conversion rate',
  typeIconUrl: TYPE_ICONS.KPI,
  unit: '%',
  direction: 'increase',
  space: { key: 'PROG', name: 'Growth Program' },
  parentId: null,
  hasChildren: true,
};
const pick = fn();
const toggle = fn();

const meta: Meta<typeof KpiRow> = {
  component: KpiRow,
  title: 'Surfaces/IssuePanel/KpiRow',
  args: {
    id: 'row-1',
    option: OPTION,
    depth: 0,
    hasChildren: true,
    open: false,
    active: false,
    withTarget: true,
    target: { target: 2, targetType: 'relative', due: { mode: 'absolute', absolute: '2026-06-30', anchor: 'issueDueDate', offsetMonths: 0 } },
    onPick: pick,
    onToggle: toggle,
    onHover: () => {},
  },
  decorators: [(Story) => <div role="listbox" aria-label="KPIs" style={{ width: 620 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof KpiRow>;

/** A target row: chevron, `{icon} {key} {summary}`, unit, the parent's target. The chevron doesn't pick. */
export const TargetRow: Story = {
  play: async ({ canvasElement }) => {
    pick.mockClear();
    toggle.mockClear();
    const c = within(canvasElement);
    const row = c.getByRole('option', { name: /PROG-210/ });
    await expect(row).toHaveTextContent('PROG-210Conversion rate%+2% by Jun 30, 2026');
    await userEvent.click(c.getByRole('button', { name: 'Expand Conversion rate' }));
    await expect(toggle).toHaveBeenCalledTimes(1);
    await expect(pick).not.toHaveBeenCalled();
    await userEvent.click(row);
    await expect(pick).toHaveBeenCalledTimes(1);
  },
};
export const TargetRowDark: Story = { ...TargetRow, globals: { theme: 'dark' } };

/** A sub-KPI two levels down: 48px in, a spacer instead of a chevron, no target; highlighted. */
export const NestedLeafActive: Story = {
  args: { depth: 2, hasChildren: false, target: null, active: true, option: { ...OPTION, key: 'PROG-211', name: 'Trial-to-paid', hasChildren: false } },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('option', { name: /PROG-211/ });
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row).toHaveAttribute('aria-level', '3');
    await expect(within(row).queryByRole('button')).toBeNull();
    await expect((row.firstElementChild as HTMLElement).style.paddingLeft).toBe('48px');
  },
};

/** A pasted key's row: where it lives, no Target column. */
export const PastedHint: Story = {
  args: { withTarget: false, hasChildren: false, hint: 'In another space · PROG' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('In another space · PROG')).toBeInTheDocument();
  },
};
