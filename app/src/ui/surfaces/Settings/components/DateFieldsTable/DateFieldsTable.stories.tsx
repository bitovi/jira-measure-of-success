import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import type { DateFieldDefaults, DateFieldOption, HierarchyLevel } from '@domain/index.js';
import { DateFieldsTable } from './DateFieldsTable.js';

const FIELDS: DateFieldOption[] = [
  { id: 'created', name: 'Created' },
  { id: 'duedate', name: 'Due date' },
  { id: 'customfield_10015', name: 'Start date' },
  { id: 'customfield_10022', name: 'Target end' },
  { id: 'customfield_10023', name: 'Target start' },
];

const LEVELS: HierarchyLevel[] = [
  { level: 3, name: 'Outcome', issueTypeNames: ['Outcome'] },
  { level: 2, name: 'Initiative', issueTypeNames: ['Initiative', 'Increment'] },
  { level: 1, name: 'Epic', issueTypeNames: ['Epic'] },
  { level: 0, name: 'Story', issueTypeNames: ['Story'] },
];
const DEFAULT: DateFieldDefaults = { start: 'customfield_10015', due: 'duedate' };
const allDefault = Object.fromEntries(LEVELS.map((l) => [String(l.level), DEFAULT]));

const meta: Meta<typeof DateFieldsTable> = {
  component: DateFieldsTable,
  title: 'Surfaces/Settings/DateFieldsTable',
  parameters: { layout: 'padded' },
  args: { levels: LEVELS, fields: FIELDS, value: allDefault, onChange: fn() },
};
export default meta;
type Story = StoryObj<typeof DateFieldsTable>;

export const Defaults: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Start date field')).toBeInTheDocument();
    await expect(c.getByText('End date field')).toBeInTheDocument();
    await expect(c.getAllByText('Start date')).toHaveLength(LEVELS.length);
    await expect(c.getAllByText('Due date')).toHaveLength(LEVELS.length);
  },
};

export const TargetFields: Story = {
  args: {
    value: { ...allDefault, '2': { start: 'customfield_10023', due: 'customfield_10022' } },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Target start')).toBeInTheDocument();
    await expect(c.getByText('Target end')).toBeInTheDocument();
    // one row covers every issue type at the level
    await expect(c.getByText('Initiative / Increment')).toBeInTheDocument();
  },
};

/** A stored field that was deleted from the site still renders (by id). */
export const MissingField: Story = {
  args: { value: { ...allDefault, '1': { start: 'customfield_99999', due: 'duedate' } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('customfield_99999 (not found)')).toBeInTheDocument();
  },
};

const changeSpy = fn();
export const PickEndField: Story = {
  args: { onChange: changeSpy },
  play: async ({ canvasElement }) => {
    changeSpy.mockClear();
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('combobox', { name: 'Initiative / Increment end date field' }));
    await userEvent.click(await c.findByText('Target end'));
    await waitFor(() =>
      expect(changeSpy).toHaveBeenCalledWith('2', { start: 'customfield_10015', due: 'customfield_10022' }),
    );
  },
};
