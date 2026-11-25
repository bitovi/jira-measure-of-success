import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn, screen } from '@storybook/test';
import { RowActions, type RowMenuItem } from './RowActions.js';

const addChild = fn();
const edit = fn();
const open = fn();

function Harness({
  compact = false,
  busy = null,
  refused = null,
}: {
  compact?: boolean;
  busy?: 'child' | 'menu' | null;
  refused?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items: RowMenuItem[] = [
    { label: 'Edit name, unit, direction', onSelect: edit, disabledReason: refused },
    { label: 'Move under another KPI…', onSelect: () => {}, disabledReason: refused },
    { label: 'Open in Jira', onSelect: open },
  ];
  return (
    <div className="group relative flex items-center border border-border bg-surface px-3" style={{ width: 300, height: compact ? 32 : 60 }}>
      <span className="text-sm">Checkout conversion</span>
      <RowActions
        kpiKey="CHK-301"
        compact={compact}
        busy={busy}
        menuOpen={menuOpen}
        items={items}
        onAddChild={addChild}
        onToggleMenu={() => setMenuOpen((o) => !o)}
        onCloseMenu={() => setMenuOpen(false)}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = { component: Harness, title: 'Timeline/RowActions' };
export default meta;
type Story = StoryObj<typeof Harness>;

/** + creates a child; … opens Edit · Move · Open in Jira; Esc closes it. */
export const Actions: Story = {
  play: async ({ canvasElement }) => {
    addChild.mockClear();
    open.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Create child KPI for CHK-301' }));
    await expect(addChild).toHaveBeenCalledTimes(1);
    const more = c.getByRole('button', { name: 'More actions for CHK-301' });
    await userEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More actions for CHK-301' });
    await expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Edit name, unit, direction',
      'Move under another KPI…',
      'Open in Jira',
    ]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open in Jira' }));
    await expect(open).toHaveBeenCalledTimes(1);
    await expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(more);
    await userEvent.keyboard('{Escape}');
    await expect(screen.queryByRole('menu')).toBeNull();
  },
};
export const ActionsDark: Story = { ...Actions, globals: { theme: 'dark' } };

/** Waiting on the space's access: the button pulses and does nothing. */
export const Busy: Story = {
  args: { busy: 'menu' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const more = c.getByRole('button', { name: 'More actions for CHK-301' });
    await expect(more).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(more);
    await expect(screen.queryByRole('menu')).toBeNull();
  },
};

/** Refused in the KPI's space: the items show disabled, with the reason naming the space. */
export const Refused: Story = {
  args: { refused: 'Editing CHK-301 needs Edit Issues permission on the Checkout space. Ask a Jira admin.' },
  play: async ({ canvasElement }) => {
    edit.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'More actions for CHK-301' }));
    const item = screen.getByRole('menuitem', { name: /Edit name, unit, direction/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveTextContent(/Edit Issues permission on the Checkout space/);
    await userEvent.click(item);
    await expect(edit).not.toHaveBeenCalled();
    await expect(screen.getByRole('menuitem', { name: 'Open in Jira' })).not.toHaveAttribute('aria-disabled');
    await userEvent.keyboard('{Escape}');
  },
};
export const RefusedDark: Story = { ...Refused, globals: { theme: 'dark' } };

/** A compact context row: 28px buttons. */
export const Compact: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: 'Create child KPI for CHK-301' })).toHaveClass('h-7');
  },
};
