import { describe, expect, it } from 'vitest';
import { dateFieldSelection, readOwnDates, toIsoDay } from './dateFields';

const DEFAULTS = { start: 'customfield_10015', due: 'duedate' };

describe('dateFieldSelection', () => {
  it('uses the site defaults when nothing is configured', () => {
    const s = dateFieldSelection({}, DEFAULTS);
    expect(s.forType('Epic')).toEqual(DEFAULTS);
    expect(s.fieldIds.sort()).toEqual(['customfield_10015', 'duedate']);
  });

  it('applies per-type choices and falls back per endpoint', () => {
    const s = dateFieldSelection(
      { dateFields: { Initiative: { start: 'customfield_20001', due: 'customfield_20002' }, Epic: { due: 'customfield_20002' } } },
      DEFAULTS,
    );
    expect(s.forType('Initiative')).toEqual({ start: 'customfield_20001', due: 'customfield_20002' });
    expect(s.forType('Epic')).toEqual({ start: 'customfield_10015', due: 'customfield_20002' });
    expect(s.forType('Story')).toEqual(DEFAULTS);
    expect(s.fieldIds.sort()).toEqual(['customfield_10015', 'customfield_20001', 'customfield_20002', 'duedate']);
  });
});

describe('toIsoDay', () => {
  it('keeps date values and truncates datetimes to the day', () => {
    expect(toIsoDay('2026-03-01')).toBe('2026-03-01');
    expect(toIsoDay('2026-03-01T23:00:00.000-0600')).toBe('2026-03-01');
  });
  it('returns null for empty or non-date values', () => {
    expect(toIsoDay(null)).toBeNull();
    expect(toIsoDay(undefined)).toBeNull();
    expect(toIsoDay('soon')).toBeNull();
    expect(toIsoDay(42)).toBeNull();
  });
});

describe('readOwnDates', () => {
  it('reads the fields selected for the issue type', () => {
    const s = dateFieldSelection({ dateFields: { Initiative: { start: 'cf_ts', due: 'cf_te' } } }, DEFAULTS);
    const fields = { duedate: '2026-12-31', customfield_10015: '2026-01-01', cf_ts: '2026-02-01', cf_te: '2026-09-30' };
    expect(readOwnDates(fields, 'Initiative', s)).toEqual({ ownStart: '2026-02-01', ownDue: '2026-09-30' });
    expect(readOwnDates(fields, 'Epic', s)).toEqual({ ownStart: '2026-01-01', ownDue: '2026-12-31' });
    expect(readOwnDates(undefined, 'Epic', s)).toEqual({ ownStart: null, ownDue: null });
  });
});
