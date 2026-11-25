import { describe, expect, it } from 'vitest';
import {
  decodeKpiMetaFields,
  encodeKpiMetaFields,
  isMarkedKpiMeta,
  kpiMetaCreate,
  kpiMetaFromChangelog,
  kpiMetaWrite,
  planKpiMetaToFields,
  resolveKpiMeta,
} from './kpiMetaFields';
import { KpiMetaProperty } from '../models/kpiMeta';
import type { KpiFieldsConfig } from '../models/kpiSiteConfig';

const UNIT = 'customfield_10910';
const DIR = 'customfield_10911';
const SELECT: KpiFieldsConfig = {
  unit: { fieldId: UNIT },
  direction: { fieldId: DIR, kind: 'select', optionIds: { increase: '10652', decrease: '10653' } },
};
const TEXT: KpiFieldsConfig = { unit: { fieldId: UNIT }, direction: { fieldId: DIR, kind: 'text' } };
const option = (id: string, value: string) => ({ self: `https://x/rest/api/3/customFieldOption/${id}`, id, value });

describe('encodeKpiMetaFields', () => {
  it.each([
    ['select', SELECT, { unit: '%', direction: 'increase' as const }, { [UNIT]: '%', [DIR]: { id: '10652' } }],
    ['select, decrease', SELECT, { unit: '$', direction: 'decrease' as const }, { [UNIT]: '$', [DIR]: { id: '10653' } }],
    ['text', TEXT, { unit: 'count', direction: 'decrease' as const }, { [UNIT]: 'count', [DIR]: 'decrease' }],
    ['empty unit and no direction empty the fields', SELECT, { unit: '', direction: null }, { [UNIT]: null, [DIR]: null }],
    ['only the parts given (unit)', SELECT, { unit: '%' }, { [UNIT]: '%' }],
    ['only the parts given (direction)', TEXT, { direction: null }, { [DIR]: null }],
  ])('%s', (_name, cfg, meta, expected) => {
    expect(encodeKpiMetaFields(cfg, meta)).toEqual(expected);
  });
});

describe('decodeKpiMetaFields', () => {
  it.each([
    ['select', SELECT, { [UNIT]: '%', [DIR]: option('10652', 'Increase') }, { unit: '%', direction: 'increase' }],
    ['select by bare id', SELECT, { [UNIT]: '%', [DIR]: '10653' }, { unit: '%', direction: 'decrease' }],
    ['text', TEXT, { [UNIT]: 'count', [DIR]: 'decrease' }, { unit: 'count', direction: 'decrease' }],
    ['text, as typed in Jira', TEXT, { [UNIT]: 'count', [DIR]: ' Increase ' }, { unit: 'count', direction: 'increase' }],
    ['empty fields read as empty', SELECT, { [UNIT]: null, [DIR]: null }, { unit: '', direction: null }],
    ['an unknown option reads as no direction', SELECT, { [UNIT]: '%', [DIR]: option('99999', 'Sideways') }, { unit: '%', direction: null }],
    ['an unknown string reads as no direction', TEXT, { [UNIT]: '%', [DIR]: 'up' }, { unit: '%', direction: null }],
    ['fields not in the response are left out', SELECT, { summary: 'x' }, {}],
  ])('%s', (_name, cfg, raw, expected) => {
    expect(decodeKpiMetaFields(cfg, raw)).toEqual(expected);
  });

  it('round-trips what it encodes (as Jira returns a select)', () => {
    for (const meta of [
      { unit: '%', direction: 'increase' as const },
      { unit: '', direction: null },
      { unit: 'users', direction: 'decrease' as const },
    ]) {
      const encoded = encodeKpiMetaFields(SELECT, meta);
      const stored = { ...encoded, [DIR]: encoded[DIR] ? option((encoded[DIR] as { id: string }).id, '') : null };
      expect(decodeKpiMetaFields(SELECT, stored)).toEqual(meta);
      expect(decodeKpiMetaFields(TEXT, encodeKpiMetaFields(TEXT, meta))).toEqual(meta);
    }
  });
});

describe('resolveKpiMeta', () => {
  const legacy = { unit: '%', direction: 'increase' };
  it('fields not chosen: kpi-meta, as before (null when absent or unreadable)', () => {
    expect(resolveKpiMeta(null, { legacy, fields: { [UNIT]: '$' } })).toEqual(legacy);
    expect(resolveKpiMeta(null, { legacy: undefined })).toBeNull();
    expect(resolveKpiMeta(null, { legacy: { unit: 5 } })).toBeNull();
  });

  it.each([
    ['fields set', { [UNIT]: '$', [DIR]: option('10653', 'Decrease') }, { unit: '$', direction: 'decrease' }],
    ['fields empty: empty, whatever kpi-meta holds', { [UNIT]: null, [DIR]: null }, { unit: '', direction: null }],
    ['fields missing from the response: empty', undefined, { unit: '', direction: null }],
  ])('fields chosen, %s', (_name, fields, expected) => {
    expect(resolveKpiMeta(SELECT, { legacy, fields })).toEqual(expected);
    expect(resolveKpiMeta(SELECT, { legacy: { ...legacy, fields: true }, fields })).toEqual(expected);
  });
});

describe('writes: kpiMetaCreate / kpiMetaWrite', () => {
  it('a created KPI: every non-empty field and a marked kpi-meta; fields not chosen: unmarked kpi-meta only', () => {
    expect(kpiMetaCreate(SELECT, { unit: '%', direction: 'increase' })).toEqual({
      fields: { [UNIT]: '%', [DIR]: { id: '10652' } },
      meta: { unit: '%', direction: 'increase', fields: true },
    });
    expect(kpiMetaCreate(SELECT, { unit: '', direction: null })).toEqual({
      fields: {},
      meta: { unit: '', direction: null, fields: true },
    });
    expect(kpiMetaCreate(null, { unit: '%', direction: null })).toEqual({ fields: {}, meta: { unit: '%', direction: null } });
  });

  it('a unit-only edit sends only the unit field and keeps the stored direction and marker', () => {
    const stored = { unit: '%', direction: 'increase', fields: true };
    expect(kpiMetaWrite(SELECT, stored, { unit: '%', direction: 'increase' }, { unit: '$' })).toEqual({
      fields: { [UNIT]: '$' },
      meta: { unit: '$', direction: 'increase', fields: true },
    });
  });

  it('an edit of an unmigrated KPI keeps kpi-meta\'s other value and leaves it unmarked', () => {
    // Fields chosen but empty: the app shows no unit or direction.
    const stored = { unit: '%', direction: 'decrease', note: 'kept' };
    const write = kpiMetaWrite(SELECT, stored, { unit: '', direction: null }, { unit: '$' });
    expect(write).toEqual({ fields: { [UNIT]: '$' }, meta: { unit: '$', direction: 'decrease', note: 'kept' } });
    expect(isMarkedKpiMeta(write.meta)).toBe(false);
  });

  it('a direction-only edit', () => {
    expect(kpiMetaWrite(TEXT, { unit: '%', direction: 'increase', fields: true }, { unit: '%', direction: 'increase' }, { direction: null })).toEqual({
      fields: { [DIR]: null },
      meta: { unit: '%', direction: null, fields: true },
    });
  });

  it('a KPI with no readable kpi-meta gets one built from its fields, marked', () => {
    expect(kpiMetaWrite(SELECT, undefined, { unit: '%', direction: 'increase' }, { unit: '$' })).toEqual({
      fields: { [UNIT]: '$' },
      meta: { unit: '$', direction: 'increase', fields: true },
    });
  });

  it('fields not chosen: kpi-meta only, never marked', () => {
    expect(kpiMetaWrite(null, { unit: '%', direction: 'increase' }, { unit: '%', direction: 'increase' }, { unit: '$' })).toEqual({
      fields: {},
      meta: { unit: '$', direction: 'increase' },
    });
  });

  it("what's written still parses with KpiMetaProperty, as the customer's report reads it", () => {
    const writes = [
      kpiMetaCreate(SELECT, { unit: '%', direction: 'increase' }).meta,
      kpiMetaWrite(SELECT, { unit: '%', direction: 'increase', fields: true }, { unit: '%', direction: 'increase' }, { unit: '$' }).meta,
    ];
    expect(writes.map((m) => KpiMetaProperty.parse(m))).toEqual([
      { unit: '%', direction: 'increase' },
      { unit: '$', direction: 'increase' },
    ]);
  });
});

describe('kpiMetaFromChangelog (sync trigger)', () => {
  const marked = { unit: '%', direction: 'increase', fields: true };
  const unitEdit = { items: [{ field: 'KPI Unit', fieldId: UNIT, fromString: '%', toString: '$', from: null, to: null }] };

  it('a unit edit on a marked KPI rewrites kpi-meta', () => {
    expect(kpiMetaFromChangelog(unitEdit, SELECT, marked)).toEqual({ unit: '$', direction: 'increase', fields: true });
  });

  it('a select direction edit reads the option id', () => {
    const changelog = { items: [{ fieldId: DIR, from: '10652', fromString: 'Increase', to: '10653', toString: 'Decrease' }] };
    expect(kpiMetaFromChangelog(changelog, SELECT, marked)).toEqual({ unit: '%', direction: 'decrease', fields: true });
  });

  it('a cleared unit and a text direction', () => {
    const changelog = {
      items: [
        { fieldId: UNIT, fromString: '%', toString: '' },
        { fieldId: DIR, fromString: 'increase', toString: 'Decrease' },
      ],
    };
    expect(kpiMetaFromChangelog(changelog, TEXT, marked)).toEqual({ unit: '', direction: 'decrease', fields: true });
  });

  it('an item without toString reads as empty (not Object.prototype.toString)', () => {
    expect(kpiMetaFromChangelog({ items: [{ fieldId: UNIT }] }, SELECT, marked)).toEqual({ unit: '', direction: 'increase', fields: true });
  });

  it.each([
    ['on an unmarked KPI (the migration reconciles it)', unitEdit, SELECT, { unit: '%', direction: 'increase' }],
    ['on a non-KPI (no kpi-meta)', unitEdit, SELECT, undefined],
    ['when the fields are not chosen', unitEdit, null, marked],
    ['for an edit to another field', { items: [{ fieldId: 'summary', fromString: 'a', toString: 'b' }] }, SELECT, marked],
    ['with no changelog items', { items: [] }, SELECT, marked],
    ['with no changelog', undefined, SELECT, marked],
    ['when kpi-meta already holds the new values', { items: [{ fieldId: UNIT, toString: '%' }] }, SELECT, marked],
  ])('does nothing %s', (_name, changelog, cfg, stored) => {
    expect(kpiMetaFromChangelog(changelog, cfg, stored)).toBeNull();
  });
});

describe('planKpiMetaToFields', () => {
  const fieldsOf = (unit: string | null, direction: 'increase' | 'decrease' | null) => ({
    [UNIT]: unit,
    [DIR]: direction ? option(direction === 'increase' ? '10652' : '10653', direction) : null,
  });

  it.each([
    ['absent kpi-meta: nothing to do', undefined, fieldsOf(null, null), { action: 'none', reason: 'absent' }],
    ['marked: already done', { unit: '%', direction: 'increase', fields: true }, fieldsOf(null, null), { action: 'none', reason: 'marked' }],
  ])('%s', (_name, legacy, fields, expected) => {
    expect(planKpiMetaToFields(SELECT, { legacy, fields })).toEqual(expected);
  });

  it.each([
    [
      'fields empty: both copied',
      { unit: '%', direction: 'increase' },
      fieldsOf(null, null),
      { [UNIT]: '%', [DIR]: { id: '10652' } },
      { unit: '%', direction: 'increase', fields: true },
      [],
    ],
    [
      'fields equal: nothing copied, kpi-meta just marked',
      { unit: '%', direction: 'increase' },
      fieldsOf('%', 'increase'),
      {},
      { unit: '%', direction: 'increase', fields: true },
      [],
    ],
    [
      'unit field differs: the field wins; direction copied',
      { unit: '%', direction: 'decrease' },
      fieldsOf('orders', null),
      { [DIR]: { id: '10653' } },
      { unit: 'orders', direction: 'decrease', fields: true },
      [{ part: 'unit', field: 'orders', legacy: '%' }],
    ],
    [
      'direction field differs: the field wins',
      { unit: '%', direction: 'decrease' },
      fieldsOf(null, 'increase'),
      { [UNIT]: '%' },
      { unit: '%', direction: 'increase', fields: true },
      [{ part: 'direction', field: 'increase', legacy: 'decrease' }],
    ],
    [
      'a field set where kpi-meta is empty wins too',
      { unit: '', direction: null },
      fieldsOf('$', 'increase'),
      {},
      { unit: '$', direction: 'increase', fields: true },
      [
        { part: 'unit', field: '$', legacy: null },
        { part: 'direction', field: 'increase', legacy: null },
      ],
    ],
    [
      'empty everywhere: kpi-meta just marked',
      { unit: '', direction: null },
      fieldsOf(null, null),
      {},
      { unit: '', direction: null, fields: true },
      [],
    ],
    [
      "unknown keys in kpi-meta are kept (copy only)",
      { unit: '%', direction: null, extra: 1 },
      fieldsOf(null, null),
      { [UNIT]: '%' },
      { unit: '%', direction: null, extra: 1, fields: true },
      [],
    ],
  ])('unmarked, %s', (_name, legacy, fields, writeFields, meta, differences) => {
    expect(planKpiMetaToFields(SELECT, { legacy, fields })).toEqual({ action: 'write', fields: writeFields, meta, differences });
  });

  it('a text direction field, and an unmapped option is overwritten from kpi-meta', () => {
    expect(planKpiMetaToFields(TEXT, { legacy: { unit: '%', direction: 'increase' }, fields: { [UNIT]: null, [DIR]: null } })).toMatchObject({
      fields: { [UNIT]: '%', [DIR]: 'increase' },
    });
    expect(
      planKpiMetaToFields(SELECT, { legacy: { unit: '%', direction: 'increase' }, fields: { [UNIT]: '%', [DIR]: option('1', 'Sideways') } }),
    ).toMatchObject({ fields: { [DIR]: { id: '10652' } }, differences: [] });
  });
});
