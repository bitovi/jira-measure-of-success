import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import type { PanelRowDto } from '@domain/index.js';
import { TargetCard } from './TargetCard.js';

/**
 * The saved-target card in every FR-26 state (mock v3 gallery), at a narrow and
 * a wide width — the card's layout follows its own width (container query).
 */
const base: PanelRowDto = {
  kpiId: 'stores',
  name: 'Number of Stores',
  unit: 'stores',
  direction: 'increase',
  target: 10,
  targetType: 'percent',
  targetDate: { date: '2027-04-15', pending: false, source: '' },
  dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
  start: null,
  relationship: 'onlyHere',
  resolvedValue: { value: 275, baseline: 250, baselineDate: '2027-01-15', baselineFrom: '2026-06-30', state: 'provisional', provisional: true },
  displayState: 'projected',
  warning: null,
  frozen: false,
  dueDate: '2027-01-15',
  dueDateRolledUp: true,
  actual: null,
};
const passedDue = { dueDate: '2026-06-01', dueDateRolledUp: false, targetDate: { date: '2026-09-01', pending: false, source: '' } };
const passedTarget = { dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' } };
const locked = { value: 275, baseline: 250, baselineDate: '2026-01-15', baselineFrom: '2026-01-15', state: 'baselined' as const, provisional: false };

const STATES: Array<[string, PanelRowDto]> = [
  ['1 · Work not due yet — estimate', base],
  ['2 · No due date yet', { ...base, displayState: 'provisional', dueDate: null, targetDate: { date: null, pending: true, source: '' } }],
  ['3 · Due date passed, value recorded — locked', { ...base, ...passedDue, displayState: 'baselined', resolvedValue: { value: 283.8, baseline: 258, baselineDate: '2026-06-01', baselineFrom: '2026-06-01', state: 'baselined', provisional: false } }],
  ['4 · Due date passed, no value since', { ...base, ...passedDue, displayState: 'needsMeasurement', warning: 'staleBaseline', resolvedValue: { ...base.resolvedValue!, baselineDate: '2026-06-01', baselineFrom: '2026-04-30' } }],
  ['5 · Met', { ...base, ...passedTarget, displayState: 'met', resolvedValue: locked, actual: 281 }],
  ['6 · Missed', { ...base, ...passedTarget, displayState: 'missed', resolvedValue: locked, actual: 268 }],
  ['7 · Not measured', { ...base, ...passedTarget, displayState: 'resultUnknown', warning: 'unconfirmedResult', resolvedValue: locked }],
  ['8 · No values recorded yet', { ...base, displayState: 'needsBaseline', warning: 'needsBaseline', resolvedValue: { value: null, baseline: null, baselineDate: '2027-01-15', baselineFrom: null, state: 'needsBaseline', provisional: true } }],
  ['Amount change (“more”) — estimate', { ...base, targetType: 'relative', target: 25 }],
  ['Amount change (“more”) — a drop', { ...base, targetType: 'relative', target: -5, resolvedValue: { ...base.resolvedValue!, value: 245 } }],
  ['Total by a fixed date', { ...base, targetType: 'absolute', target: 300, dueTiming: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 }, targetDate: { date: '2026-12-31', pending: false, source: '' }, resolvedValue: { value: 300, baseline: null, baselineDate: null, baselineFrom: null, state: 'baselined', provisional: false } }],
];

/** A target whose KPI issue was deleted: the panel only has the stored bet and the raw key. */
const deletedKpi: PanelRowDto = {
  ...base,
  kpiId: 'KPI-404',
  name: 'KPI-404',
  unit: '',
  direction: null,
  targetType: 'absolute',
  target: 50,
  dueTiming: { mode: 'absolute', absolute: '2026-05-31', anchor: 'issueDueDate', offsetMonths: 0 },
  targetDate: null,
  resolvedValue: null,
  displayState: null,
  dueDate: null,
  dueDateRolledUp: false,
  kpiMissing: true,
};

function Gallery({ width }: { width: number }) {
  return (
    <div style={{ width }} className="flex flex-col gap-3">
      {STATES.map(([caption, row]) => (
        <figure key={caption} className="m-0">
          <figcaption className="mb-1 text-xs font-medium text-text-subtlest">{caption}</figcaption>
          <TargetCard row={row} currentValue={262} onRecord={() => {}} />
        </figure>
      ))}
      <figure className="m-0">
        <figcaption className="mb-1 text-xs font-medium text-text-subtlest">KPI deleted</figcaption>
        <TargetCard row={deletedKpi} currentValue={null} onRecord={() => {}} />
      </figure>
      <figure className="m-0">
        <figcaption className="mb-1 text-xs font-medium text-text-subtlest">Preview (form)</figcaption>
        <TargetCard row={base} currentValue={250} preview />
      </figure>
    </div>
  );
}

const meta: Meta<typeof Gallery> = {
  component: Gallery,
  title: 'Surfaces/IssuePanel/TargetCard',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof Gallery>;

export const Narrow: Story = {
  args: { width: 360 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByRole('group', { name: 'Number of Stores' })).toHaveLength(STATES.length + 1);
    await expect(c.getByText('300 stores')).toBeInTheDocument();
    await expect(c.getByText('+25 stores')).toBeInTheDocument();
    await expect(c.getByText('−5 stores')).toBeInTheDocument();
    await expect(c.getByText('by Dec 31, 2026')).toBeInTheDocument();
    // the preview has no actions and no inline edit
    await expect(c.getAllByRole('button', { name: 'Actions for Number of Stores' })).toHaveLength(STATES.length);
  },
};

export const Medium: Story = { args: { width: 560 } };

export const Wide: Story = { args: { width: 760 } };

const onRemoveDeleted = fn();

/** Deleted KPI: no status, estimate, edit or record — only Remove. */
export const KpiDeleted: Story = {
  args: { width: 360 },
  render: ({ width }) => (
    <div style={{ width }}>
      <TargetCard row={deletedKpi} currentValue={null} onSave={fn()} onRemove={onRemoveDeleted} onRecord={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    onRemoveDeleted.mockClear();
    const c = within(canvasElement);
    const card = c.getByRole('group', { name: 'KPI-404' });
    await expect(within(card).getByText('KPI deleted')).toBeInTheDocument();
    await expect(within(card).getByText(/deleted or moved out of the KPI space/)).toBeInTheDocument();
    await expect(within(card).getByText('50')).toBeInTheDocument();
    await expect(within(card).queryByRole('button', { name: /^Edit target/ })).not.toBeInTheDocument();
    await expect(within(card).queryByRole('button', { name: 'Record a value' })).not.toBeInTheDocument();
    await expect(within(card).queryByText(/Estimated target/)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: `Actions for KPI-404` }));
    await waitFor(() => expect(c.getByRole('menuitem', { name: 'Remove' })).toBeInTheDocument());
    await expect(c.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(within(card).getByRole('button', { name: 'Remove target' }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoveDeleted).toHaveBeenCalledTimes(1));
  },
};
