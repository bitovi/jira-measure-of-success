import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, waitFor, fn } from '@storybook/test';
import type { KpiPickerSpace, ListKpiSpacesResult } from '@domain/index.js';
import { SpaceFilter } from './SpaceFilter.js';

/** 120 spaces that can hold KPIs, a page of 50 at a time. */
const SPACES: KpiPickerSpace[] = Array.from({ length: 120 }, (_, i) => ({
  key: `S${String(i + 1).padStart(3, '0')}`,
  name: i === 6 ? 'Growth Program' : `Team space ${i + 1}`,
}));
const loadSpaces = async (query: string, startAt = 0): Promise<ListKpiSpacesResult> => {
  const q = query.toLowerCase();
  const all = SPACES.filter((s) => !q || s.key.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  const page = all.slice(startAt, startAt + 50);
  return { spaces: page, nextStartAt: startAt + 50 < all.length ? startAt + 50 : null };
};

function Harness({ onChange }: { onChange?: (s: KpiPickerSpace | null) => void }) {
  const [value, setValue] = useState<KpiPickerSpace | null>(null);
  return (
    <div style={{ width: 520, height: 320 }}>
      <SpaceFilter
        value={value}
        onChange={(s) => {
          setValue(s);
          onChange?.(s);
        }}
        loadSpaces={loadSpaces}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = { component: Harness, title: 'Components/SpaceFilter' };
export default meta;
type Story = StoryObj<typeof Harness>;

const change = fn();

/** Opens a list with its own Find box (the first page of spaces; typing finds the rest); Enter picks the first match; × clears. */
export const FindAndPick: Story = {
  args: { onChange: change },
  play: async ({ canvasElement }) => {
    change.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Space: Select space' }));
    await waitFor(() => expect(c.getAllByRole('option')).toHaveLength(50));
    await expect(c.queryByRole('button', { name: 'More spaces…' })).toBeNull();
    await userEvent.type(c.getByRole('textbox', { name: 'Find a space' }), 'growth{Enter}');
    await waitFor(() => expect(change).toHaveBeenCalledWith({ key: 'S007', name: 'Growth Program' }));
    await expect(await c.findByRole('button', { name: 'Space: S007 Growth Program' })).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Clear space' }));
    await expect(change).toHaveBeenLastCalledWith(null);
  },
};
export const FindAndPickDark: Story = { ...FindAndPick, globals: { theme: 'dark' } };

/** No match, and Esc closes just the list. */
export const NoMatch: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Space: Select space' }));
    await userEvent.type(c.getByRole('textbox', { name: 'Find a space' }), 'zzz');
    await waitFor(() => expect(c.getByText('No space matches “zzz”.')).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await expect(c.queryByRole('textbox', { name: 'Find a space' })).toBeNull();
    await expect(c.getByRole('button', { name: 'Space: Select space' })).toHaveFocus();
  },
};
