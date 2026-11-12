import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineNodeDto, TimelineTargetDto } from '@domain/index.js';
import { TargetTooltipBody } from './targetTooltip.js';

const node = {
  id: 'r',
  kpiId: 'r',
  issueKey: 'KPI-1',
  name: 'Revenue',
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
  readings: [{ date: '2026-05-01', value: 250 }],
  children: [],
} satisfies TimelineNodeDto;

const source = { issue: 'INIT-48', type: 'Initiative', title: 'Multi-store support', iconUrl: null };

describe('TargetTooltipBody', () => {
  it('reads like the issue panel card for a relative target', () => {
    const target: TimelineTargetDto = {
      date: '2027-04-15',
      value: 275,
      status: 'upcoming',
      provisional: true,
      relative: true,
      source,
      detail: {
        target: 10,
        targetType: 'percent',
        dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
        start: null,
        targetDate: { date: '2027-04-15', pending: false, source: 'own' },
        resolvedValue: {
          value: 275,
          baseline: 250,
          baselineDate: '2027-01-15',
          baselineFrom: '2026-05-01',
          state: 'provisional',
          provisional: true,
        },
        displayState: 'projected',
        warning: null,
        dueDate: '2027-01-15',
        dueDateRolledUp: false,
        actual: null,
      },
    };
    const { container } = render(<TargetTooltipBody target={target} node={node} />);
    const text = container.textContent ?? '';
    expect(text).toContain('INIT-48 Multi-store support');
    expect(text).toContain('Upcoming');
    expect(text).toContain('+10%·3 months after due date');
    expect(text).toContain('Estimated target');
    expect(text).toContain('by Apr 15, 2027');
    expect(text).toContain('from $250 now');
    expect(text).not.toContain('Click to open');
  });

  it('says what a stacked target is stacked on, and keeps "now" on the latest reading', () => {
    const target: TimelineTargetDto = {
      date: '2027-04-15',
      value: 280.5,
      status: 'upcoming',
      provisional: true,
      relative: true,
      source,
      detail: {
        target: 10,
        targetType: 'percent',
        dueTiming: { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 },
        start: null,
        targetDate: { date: '2027-04-15', pending: false, source: 'own' },
        resolvedValue: {
          value: 280.5,
          baseline: 255,
          baselineDate: '2027-01-15',
          baselineFrom: '2026-05-01',
          state: 'provisional',
          provisional: true,
          stackedFrom: [
            { issueKey: 'INIT-40', issueType: 'Initiative', level: 3, date: '2026-09-30', targetType: 'percent', change: 1 },
            { issueKey: 'INIT-41', issueType: 'Initiative', level: 3, date: '2026-12-31', targetType: 'percent', change: 1 },
          ],
          unstackedBaseline: 250,
        },
        displayState: 'projected',
        warning: null,
        dueDate: '2027-01-15',
        dueDateRolledUp: false,
        actual: null,
      },
    };
    const { container } = render(<TargetTooltipBody target={target} node={node} />);
    const text = container.textContent ?? '';
    expect(text).toContain('from $250 now');
    expect(text).toContain('Stacked on 2 earlier Initiative targets');
  });

  it('shows no "stacked on" line when nothing stacked', () => {
    const target: TimelineTargetDto = { date: '2026-06-30', value: 300, status: 'upcoming', provisional: false, relative: false, source };
    const { container } = render(<TargetTooltipBody target={target} node={node} />);
    expect(container.textContent).not.toContain('Stacked on');
  });

  it('falls back to a fixed value on a fixed date without detail', () => {
    const target: TimelineTargetDto = {
      date: '2026-06-30',
      value: 300,
      status: 'missed',
      provisional: false,
      relative: false,
      source,
    };
    const { container } = render(<TargetTooltipBody target={target} node={node} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Missed');
    expect(text).toContain('by Jun 30, 2026');
  });
});
