import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import type { TargetDraft } from '@ui/targetText.js';
import { TargetEditor } from './TargetEditor.js';

/** The bet editor: `[ amount ][ % change | more | total ]` + `[ months | date ][ months after due date | on a date ]`. */
function Harness({ initial, width }: { initial: TargetDraft; width: number }) {
  const [draft, setDraft] = useState(initial);
  return (
    <div style={{ width }} className="[container-type:inline-size]">
      <TargetEditor draft={draft} onChange={setDraft} />
      <pre data-testid="draft" className="mt-2 text-xs text-text-subtle">
        {JSON.stringify(draft)}
      </pre>
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  component: Harness,
  title: 'Surfaces/IssuePanel/TargetEditor',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Harness>;

export const PercentRelative: Story = {
  args: {
    width: 360,
    initial: { targetType: 'percent', value: '+2', due: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 } },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const months = c.getByRole('spinbutton', { name: 'Months after due date' });
    await userEvent.clear(months);
    await userEvent.type(months, '-1');
    await waitFor(() => expect(c.getByTestId('draft').textContent).toContain('"offsetMonths":-1'));
  },
};

export const TotalFixedDateWide: Story = {
  args: {
    width: 760,
    initial: { targetType: 'absolute', value: '300', due: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 } },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByLabelText('Target date', { selector: 'input' })).toHaveValue('2026-12-31');
    await expect(c.getByText('total')).toBeInTheDocument();
  },
};

export const AmountChange: Story = {
  args: {
    width: 360,
    initial: { targetType: 'relative', value: '', due: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 } },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('more')).toBeInTheDocument();
    const amount = c.getByPlaceholderText('e.g. +100');
    await userEvent.type(amount, '+100');
    await waitFor(() => expect(c.getByTestId('draft').textContent).toContain('"value":"+100"'));
    await expect(c.getByTestId('draft').textContent).toContain('"targetType":"relative"');
  },
};
