import { describe, expect, test } from 'vitest';
import type { PanelRowDto } from '@domain/index.js';
import {
  applyDraft,
  cleanDue,
  isValidDraft,
  isValidNumber,
  sameDraft,
  betAmount,
  betWhen,
  draftFromRow,
  estimate,
  estimateText,
  isWrongWay,
  nudgeFor,
  parseTarget,
  pillFor,
  previewRow,
  stackedNote,
} from './targetText.js';

/** Number of Stores, +10%, 3 months after a (rolled-up) due date — the mock's gallery bet. */
const row = (over: Partial<PanelRowDto>): PanelRowDto => ({
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
  ...over,
});

const passedDue = { dueDate: '2026-06-01', dueDateRolledUp: false, targetDate: { date: '2026-09-01', pending: false, source: '' } };
const passedTarget = { dueDate: '2026-01-15', dueDateRolledUp: false, targetDate: { date: '2026-04-15', pending: false, source: '' } };
const locked = { value: 275, baseline: 250, baselineDate: '2026-01-15', baselineFrom: '2026-01-15', state: 'baselined' as const, provisional: false };

const text = (r: PanelRowDto, current: number | null = 250) => estimateText(estimate(r, current));

describe('the bet', () => {
  test('percent + relative date reads as typed', () => {
    expect(betAmount('percent', 10, 'stores')).toBe('+10%');
    expect(betAmount('percent', -2, 'stores')).toBe('-2%');
    expect(betWhen({ mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 3 })).toBe('3 months after due date');
    expect(betWhen({ mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: -1 })).toBe('1 month before due date');
    expect(betWhen({ mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 })).toBe('on the due date');
  });

  test('an amount change ("more") is signed and keeps its unit', () => {
    expect(betAmount('relative', 100, 'orders')).toBe('+100 orders');
    expect(betAmount('relative', -3, 'stores')).toBe('−3 stores');
    expect(betAmount('relative', 100, 'count')).toBe('+100');
    expect(betAmount('relative', 5000, '$')).toBe('+$5,000');
    expect(betAmount('relative', -25_000, 'USD')).toBe('−$25K');
    expect(betAmount('relative', 2, '%')).toBe('+2%');
    expect(betAmount('relative', 0, 'stores')).toBe('0 stores');
  });

  test('a total keeps its unit; currency is compact', () => {
    expect(betAmount('absolute', 300, 'stores')).toBe('300 stores');
    expect(betAmount('absolute', 300, 'count')).toBe('300');
    expect(betAmount('absolute', 1_500_000, 'USD')).toBe('$1.5M');
    expect(betWhen({ mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 })).toBe('by Dec 31, 2026');
  });

  test('a total keeps the precision that was typed', () => {
    expect(betAmount('absolute', 4.25, '%')).toBe('4.25%');
    expect(betAmount('absolute', 0.035, 'ratio')).toBe('0.035 ratio');
    expect(betAmount('absolute', 12.5, '$')).toBe('$12.5');
  });

  test('parseTarget accepts a leading + and separators', () => {
    expect(parseTarget('+2')).toBe(2);
    expect(parseTarget('1,200')).toBe(1200);
    expect(parseTarget(' ')).toBeNull();
    expect(isValidNumber('1e999')).toBe(false);
    expect(isValidNumber('abc')).toBe(false);
    expect(isValidNumber('')).toBe(true);
  });
});

describe('the estimate line + pill + nudge, per FR-26 state (mock v3 wording)', () => {
  test('1 projected', () => {
    const r = row({});
    expect(text(r)).toBe('Estimated target 275 by Apr 15, 2027 · from 250 now');
    expect(pillFor(r)).toBe('upcoming');
    expect(nudgeFor(r)).toBeNull();
  });

  test('2 provisional (no due date yet)', () => {
    const r = row({ displayState: 'provisional', dueDate: null, targetDate: { date: null, pending: true, source: '' } });
    expect(text(r)).toBe('Estimated target 275 · from 250 now · no due date yet');
    expect(pillFor(r)).toBe('pending');
  });

  test('3 baselined — locked', () => {
    const r = row({ ...passedDue, displayState: 'baselined', resolvedValue: { value: 283.8, baseline: 258, baselineDate: '2026-06-01', baselineFrom: '2026-06-01', state: 'baselined', provisional: false } });
    expect(text(r)).toBe('Target 284 by Sep 1, 2026 · from 258 on Jun 1');
    expect(pillFor(r)).toBe('inprogress');
  });

  test('4 needsMeasurement — still an estimate, with a nudge', () => {
    const r = row({ ...passedDue, displayState: 'needsMeasurement', warning: 'staleBaseline', resolvedValue: { value: 275, baseline: 250, baselineDate: '2026-06-01', baselineFrom: '2026-04-30', state: 'provisional', provisional: true } });
    expect(text(r)).toBe('Estimated target 275 by Sep 1, 2026 · from 250 on Apr 30');
    expect(pillFor(r)).toBe('inprogress');
    expect(nudgeFor(r)).toMatch(/record a value to lock in the target/);
  });

  test('5/6 met + missed', () => {
    const met = row({ ...passedTarget, displayState: 'met', resolvedValue: locked, actual: 281 });
    expect(text(met)).toBe('Target 275 by Apr 15, 2026 · reached 281');
    expect(estimate(met, 250).tail[0]?.tone).toBe('good');
    expect(pillFor(met)).toBe('met');
    const missed = row({ ...passedTarget, displayState: 'missed', resolvedValue: locked, actual: 268 });
    expect(estimate(missed, 250).tail[0]?.tone).toBe('bad');
    expect(pillFor(missed)).toBe('missed');
  });

  test('7 resultUnknown — not measured', () => {
    const r = row({ ...passedTarget, displayState: 'resultUnknown', warning: 'unconfirmedResult', resolvedValue: locked });
    expect(text(r)).toBe('Target 275 by Apr 15, 2026 · no reading');
    expect(pillFor(r)).toBe('unscored');
    expect(nudgeFor(r)).toMatch(/can’t tell if it was met/);
  });

  test('8 needsBaseline — no readings', () => {
    const r = row({ displayState: 'needsBaseline', warning: 'needsBaseline', resolvedValue: { value: null, baseline: null, baselineDate: '2027-01-15', baselineFrom: null, state: 'needsBaseline', provisional: true } });
    expect(text(r, null)).toBe('Estimated target — by Apr 15, 2027 · no readings yet');
    expect(pillFor(r)).toBe('upcoming');
    expect(nudgeFor(r)).toBe('A % change needs a starting value.');
  });

  test('an amount change estimates from the baseline like a % change', () => {
    const r = row({ targetType: 'relative', target: 25 });
    expect(text(r)).toBe('Estimated target 275 by Apr 15, 2027 · from 250 now');
    const needs = row({ targetType: 'relative', target: 25, displayState: 'needsBaseline', warning: 'needsBaseline', resolvedValue: { value: null, baseline: null, baselineDate: '2027-01-15', baselineFrom: null, state: 'needsBaseline', provisional: true } });
    expect(nudgeFor(needs)).toBe('An amount change needs a starting value.');
    const pending = row({ targetType: 'relative', target: 25, displayState: 'provisional', dueDate: null, targetDate: { date: null, pending: true, source: '' } });
    expect(text(pending)).toBe('Estimated target 275 · from 250 now · no due date yet');
  });

  test('a total by a fixed date is always locked and never "pending"', () => {
    const r = row({
      targetType: 'absolute',
      target: 300,
      dueTiming: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 },
      targetDate: { date: '2026-12-31', pending: false, source: '' },
      resolvedValue: { value: 300, baseline: null, baselineDate: null, baselineFrom: null, state: 'baselined', provisional: false },
      displayState: 'provisional',
      dueDate: null,
    });
    expect(text(r, 262)).toBe('Target 300 · 262 now');
    expect(pillFor(r)).toBe('upcoming');
  });
});

describe('drafts', () => {
  test('applyDraft re-resolves value + date from the row baseline', () => {
    const r = row({});
    const d = { ...draftFromRow(r), value: '+20' };
    expect(draftFromRow(r).value).toBe('+10');
    expect(text(applyDraft(r, d, 250))).toBe('Estimated target 300 by Apr 15, 2027 · from 250 now');
    const fixed = { ...d, due: { ...d.due, mode: 'absolute' as const, absolute: '2027-06-30' } };
    expect(text(applyDraft(r, fixed, 250))).toBe('Estimated target 300 · from 250 now');
    const total = { ...d, targetType: 'absolute' as const, value: '320' };
    expect(text(applyDraft(r, total, 262), 262)).toBe('Target 320 by Apr 15, 2027 · 262 now');
  });

  test('applyDraft adds an amount change to the baseline', () => {
    const r = row({});
    const more = { ...draftFromRow(r), targetType: 'relative' as const, value: '+40' };
    const applied = applyDraft(r, more, 250);
    expect(applied.resolvedValue?.value).toBe(290);
    expect(text(applied)).toBe('Estimated target 290 by Apr 15, 2027 · from 250 now');
    expect(draftFromRow(row({ targetType: 'relative', target: 40 })).value).toBe('+40');
    expect(draftFromRow(row({ targetType: 'relative', target: -40 })).value).toBe('-40');
  });

  test('editing a judged target re-judges met/missed against the new value', () => {
    const met = row({ ...passedTarget, displayState: 'met', resolvedValue: locked, actual: 281 });
    const raised = applyDraft(met, { ...draftFromRow(met), value: '+20' }, 250);
    expect(raised.displayState).toBe('missed');
    expect(estimate(raised, 250).tail[0]?.tone).toBe('bad');
  });

  test('a relative date never keeps a blank fixed date', () => {
    const due = { mode: 'relative' as const, absolute: '', anchor: 'issueDueDate' as const, offsetMonths: 3 };
    expect(cleanDue(due).absolute).toBeNull();
    const r = row({});
    expect(sameDraft(draftFromRow(r), { ...draftFromRow(r), due })).toBe(true);
    expect(isValidDraft({ ...draftFromRow(r), due: { ...due, mode: 'absolute' } })).toBe(false);
  });

  test('previewRow reads like a new saved card', () => {
    const kpi = { id: 'stores', name: 'Number of Stores', unit: 'stores', direction: 'increase' as const, currentValue: 250 };
    const draft = { targetType: 'percent' as const, value: '+2', due: { mode: 'relative' as const, absolute: null, anchor: 'issueDueDate' as const, offsetMonths: 3 } };
    const p = previewRow(kpi, draft, '2027-01-15', true);
    expect(text(p)).toBe('Estimated target 255 by Apr 15, 2027 · from 250 now');
    expect(pillFor(p)).toBe('upcoming');
    expect(isWrongWay(p, 250)).toBe(false);
    expect(isWrongWay(previewRow(kpi, { ...draft, value: '-2' }, '2027-01-15', true), 250)).toBe(true);
    expect(text(previewRow({ ...kpi, currentValue: null }, draft, '2027-01-15', true), null)).toBe('Estimated target — by Apr 15, 2027 · no readings yet');
  });

  test('previewRow for an amount change resolves latest + amount and flags the wrong way', () => {
    const kpi = { id: 'orders', name: '# of Orders', unit: 'orders', direction: 'increase' as const, currentValue: 1200 };
    const draft = { targetType: 'relative' as const, value: '+100', due: { mode: 'relative' as const, absolute: null, anchor: 'issueDueDate' as const, offsetMonths: 0 } };
    const p = previewRow(kpi, draft, '2027-01-15', false);
    expect(text(p, 1200)).toBe('Estimated target 1,300 by Jan 15, 2027 · from 1,200 now');
    expect(isWrongWay(p, 1200)).toBe(false);
    expect(isWrongWay(previewRow(kpi, { ...draft, value: '-100' }, '2027-01-15', false), 1200)).toBe(true);
    const costs = { ...kpi, direction: 'decrease' as const };
    expect(isWrongWay(previewRow(costs, draft, '2027-01-15', false), 1200)).toBe(true);
  });
});

describe('stacked on earlier targets (spec 09)', () => {
  const step = (issueKey: string, issueType: string, date: string, change = 1) =>
    ({ issueKey, issueType, level: 3, date, targetType: 'percent' as const, change });
  const stacked = (steps: ReturnType<typeof step>[]) =>
    row({
      resolvedValue: {
        value: 280.5,
        baseline: 255,
        baselineDate: '2027-01-15',
        baselineFrom: '2026-06-30',
        state: 'provisional',
        provisional: true,
        stackedFrom: steps,
        unstackedBaseline: 250,
      },
    });

  test('"from … now" is the latest reading, not the stacked baseline', () => {
    expect(text(stacked([step('INIT-1', 'Initiative', '2026-10-31')]))).toContain('from 250 now');
  });

  test('names the issue type when every stacked target shares it', () => {
    const r = stacked([step('INIT-1', 'Initiative', '2026-10-31'), step('INIT-2', 'Initiative', '2027-01-31', 2)]);
    expect(stackedNote(r.resolvedValue, r.unit)).toEqual({
      text: 'Stacked on 2 earlier Initiative targets',
      steps: ['INIT-1 +1% on Oct 31, 2026', 'INIT-2 +2% on Jan 31, 2027'],
    });
  });

  test('singular, and "at this level" when the level mixes types', () => {
    expect(stackedNote(stacked([step('INIT-1', 'Initiative', '2026-10-31')]).resolvedValue, 'stores')?.text).toBe(
      'Stacked on 1 earlier Initiative target',
    );
    const mixed = stacked([step('MS-1', 'Milestone', '2026-10-31'), step('INC-2', 'Increment', '2026-11-30')]);
    expect(stackedNote(mixed.resolvedValue, 'stores')?.text).toBe('Stacked on 2 earlier targets at this level');
  });

  test('nothing when nothing stacked', () => {
    expect(stackedNote(row({}).resolvedValue, 'stores')).toBeNull();
    expect(stackedNote(null, 'stores')).toBeNull();
  });
});
