import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { Dimmable, KeyHighlightProvider } from '../highlight.js';
import { useKeyHighlight } from '../useKeyHighlight.js';
import type { KeyKind, KeySummary } from '../keyKinds.js';
import { TargetGlyph } from '../markers.js';
import { PlotKey } from './PlotKey.js';

/**
 * Scenario stories for the plot key bar (spec 08). A tiny harness owns the
 * highlight state (as the surfaces do) and renders a few marks inside the
 * provider, so the stories show — and assert — that hovering / pinning an entry
 * dims every mark of another kind.
 */
const icon = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' rx='3' fill='${fill}'/></svg>`)}`;

const FULL: KeySummary = {
  recorded: true,
  projection: true,
  counts: { hit: 5, missed: 3, 'upcoming-fixed': 2, 'upcoming-relative': 8, undated: 5 },
  types: [
    { type: 'Epic', iconUrl: icon('#904ee2'), count: 9 },
    { type: 'Story', iconUrl: icon('#63ba3c'), count: 6 },
    { type: 'Task', iconUrl: null, count: 3 },
  ],
};

const MARKS: Array<{ id: string; kinds: KeyKind[]; status: 'hit' | 'missed' | 'upcoming'; provisional: boolean }> = [
  { id: 'hit', kinds: ['hit', 'type:Epic'], status: 'hit', provisional: false },
  { id: 'missed', kinds: ['missed', 'type:Story'], status: 'missed', provisional: false },
  { id: 'relative', kinds: ['upcoming-relative', 'type:Epic'], status: 'upcoming', provisional: true },
];

function Harness({ summary }: { summary: KeySummary }) {
  const highlight = useKeyHighlight();
  return (
    <KeyHighlightProvider active={highlight.active}>
      <div className="p-4 text-text">
        <PlotKey summary={summary} highlight={highlight} className="rounded border border-border" />
        <div className="mt-6 flex items-center gap-8">
          {MARKS.map((m) => (
            <span key={m.id} data-testid={`mark-${m.id}`}>
              <Dimmable kinds={m.kinds}>
                <TargetGlyph status={m.status} provisional={m.provisional} />
              </Dimmable>
            </span>
          ))}
        </div>
        <output data-testid="active" className="mt-4 block text-xs text-text-subtle">
          {highlight.active ?? 'none'}
        </output>
      </div>
    </KeyHighlightProvider>
  );
}

const meta: Meta<typeof Harness> = {
  component: Harness,
  title: 'Plot/PlotKey',
  args: { summary: FULL },
};
export default meta;
type Story = StoryObj<typeof Harness>;

const opacityOf = (el: HTMLElement) => (el.firstElementChild as HTMLElement).style.opacity;

/** Every entry: values, target statuses with counts, and issue types built from data. */
export const Full: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    for (const label of ['Recorded value', 'Projected trend', 'Hit', 'Missed', 'Upcoming (fixed)', 'Upcoming (relative)', 'Undated', 'Epic', 'Story', 'Task']) {
      await expect(c.getByText(label)).toBeInTheDocument();
    }
    await expect(c.getByText('8')).toBeInTheDocument();
    // Task has no tintable icon → the fallback diamond still renders.
    await expect(c.getByRole('button', { name: /3\s*Task/ })).toBeInTheDocument();
  },
};

/** Only entries that apply are listed (no projection, no fixed/undated targets, no types). */
export const OnlyWhatApplies: Story = {
  args: {
    summary: {
      recorded: true,
      projection: false,
      counts: { hit: 0, missed: 1, 'upcoming-fixed': 0, 'upcoming-relative': 2, undated: 0 },
      types: [],
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Recorded value')).toBeInTheDocument();
    await expect(c.getByText('Missed')).toBeInTheDocument();
    await expect(c.queryByText('Projected trend')).toBeNull();
    await expect(c.queryByText('Hit')).toBeNull();
    await expect(c.queryByText('Undated')).toBeNull();
  },
};

/** Nothing to explain → no bar at all. */
export const Empty: Story = {
  args: {
    summary: {
      recorded: false,
      projection: false,
      counts: { hit: 0, missed: 0, 'upcoming-fixed': 0, 'upcoming-relative': 0, undated: 0 },
      types: [],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('toolbar', { name: 'Chart key' })).toBeNull();
  },
};

/** Hover highlights (dims other kinds); click pins until cleared. */
export const HighlightAndPin: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const missed = c.getByRole('button', { name: /Missed/ });

    await userEvent.hover(missed);
    await expect(c.getByTestId('active')).toHaveTextContent('missed');
    await expect(opacityOf(c.getByTestId('mark-missed'))).toBe('');
    await expect(opacityOf(c.getByTestId('mark-hit'))).toBe('0.12');

    await userEvent.click(missed);
    await expect(missed).toHaveAttribute('aria-pressed', 'true');
    await userEvent.unhover(missed);
    await expect(c.getByTestId('active')).toHaveTextContent('missed');

    // An issue-type entry highlights every target from that type.
    await userEvent.hover(c.getByRole('button', { name: /Epic/ }));
    await expect(opacityOf(c.getByTestId('mark-hit'))).toBe('');
    await expect(opacityOf(c.getByTestId('mark-relative'))).toBe('');
    await expect(opacityOf(c.getByTestId('mark-missed'))).toBe('0.12');
    await userEvent.unhover(c.getByRole('button', { name: /Epic/ }));

    await userEvent.click(c.getByRole('button', { name: 'Clear highlight' }));
    await expect(c.getByTestId('active')).toHaveTextContent('none');
    await expect(c.queryByRole('button', { name: 'Clear highlight' })).toBeNull();
  },
};
