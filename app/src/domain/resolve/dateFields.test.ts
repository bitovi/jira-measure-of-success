import { describe, expect, it } from 'vitest';
import { dateFieldSelection, readOwnDates, toIsoDay } from './dateFields';

const DEFAULTS = { start: 'customfield_10015', due: 'duedate' };
const INITIATIVE = { name: 'Initiative', hierarchyLevel: 2 };
const EPIC = { name: 'Epic', hierarchyLevel: 1 };
const STORY = { name: 'Story', hierarchyLevel: 0 };

describe('dateFieldSelection', () => {
  it('uses the site defaults when nothing is configured', () => {
    const s = dateFieldSelection({}, DEFAULTS);
    expect(s.forType(EPIC)).toEqual(DEFAULTS);
    expect(s.fieldIds.sort()).toEqual(['customfield_10015', 'duedate']);
  });

  it('applies per-level choices and falls back per endpoint', () => {
    const s = dateFieldSelection(
      { dateFields: { '2': { start: 'customfield_20001', due: 'customfield_20002' }, '1': { due: 'customfield_20002' } } },
      DEFAULTS,
    );
    expect(s.forType(INITIATIVE)).toEqual({ start: 'customfield_20001', due: 'customfield_20002' });
    expect(s.forType(EPIC)).toEqual({ start: 'customfield_10015', due: 'customfield_20002' });
    expect(s.forType(STORY)).toEqual(DEFAULTS);
    expect(s.fieldIds.sort()).toEqual(['customfield_10015', 'customfield_20001', 'customfield_20002', 'duedate']);
  });

  it('applies a level choice to EVERY issue type at that level', () => {
    const s = dateFieldSelection({ dateFields: { '2': { start: 'cf_ts', due: 'cf_te' } } }, DEFAULTS);
    expect(s.forType({ name: 'Milestone', hierarchyLevel: 2 })).toEqual({ start: 'cf_ts', due: 'cf_te' });
    expect(s.forType({ name: 'Increment', hierarchyLevel: 2 })).toEqual({ start: 'cf_ts', due: 'cf_te' });
  });

  it('honors legacy issue-type-name keys; a level key wins over them', () => {
    const legacy = dateFieldSelection({ dateFields: { Initiative: { due: 'cf_legacy' } } }, DEFAULTS);
    expect(legacy.forType(INITIATIVE).due).toBe('cf_legacy');
    const both = dateFieldSelection({ dateFields: { Initiative: { due: 'cf_legacy' }, '2': { due: 'cf_level' } } }, DEFAULTS);
    expect(both.forType(INITIATIVE).due).toBe('cf_level');
  });

  it('uses the defaults for an issue whose level is unknown', () => {
    const s = dateFieldSelection({ dateFields: { '2': { due: 'cf_te' } } }, DEFAULTS);
    expect(s.forType({ name: 'Increment', hierarchyLevel: null })).toEqual(DEFAULTS);
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
  it("reads the fields selected for the issue type's level", () => {
    const s = dateFieldSelection({ dateFields: { '2': { start: 'cf_ts', due: 'cf_te' } } }, DEFAULTS);
    const fields = { duedate: '2026-12-31', customfield_10015: '2026-01-01', cf_ts: '2026-02-01', cf_te: '2026-09-30' };
    expect(readOwnDates(fields, INITIATIVE, s)).toEqual({ ownStart: '2026-02-01', ownDue: '2026-09-30' });
    expect(readOwnDates(fields, EPIC, s)).toEqual({ ownStart: '2026-01-01', ownDue: '2026-12-31' });
    expect(readOwnDates(undefined, EPIC, s)).toEqual({ ownStart: null, ownDue: null });
  });
});
