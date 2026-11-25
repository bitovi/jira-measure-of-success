import { describe, expect, it } from 'vitest';
import type { Assignment, StoredAssignment, StoredAssignments } from '../models/index';
import {
  migrateStoredAssignments,
  parseKpiRef,
  readStoredAssignments,
  shouldStampRefs,
  storedKeysById,
  toStoredAssignments,
} from './kpiRef';

const base = {
  inheritFromParent: false,
  target: 10,
  targetType: 'absolute' as const,
  timing: { start: null, due: { mode: 'absolute' as const, absolute: '2026-06-30', anchor: 'issueDueDate' as const, offsetMonths: 0 } },
  updatedBy: 'acc-2',
  updatedAt: 1_700_000_000_000,
};
const target = (kpiId: string, over: Partial<Assignment> = {}): Assignment => ({ ...base, kpiId, ...over });
const stored = (kpiId: string, kpiIssueId?: string, over: Partial<StoredAssignment> = {}): StoredAssignment => ({
  ...base,
  kpiId,
  ...(kpiIssueId !== undefined ? { kpiIssueId } : {}),
  ...over,
});
const prop = (assignments: StoredAssignment[], over: Partial<StoredAssignments> = {}): StoredAssignments => ({
  assignments,
  ...over,
});

describe('parseKpiRef', () => {
  it.each([
    ['10234', { kind: 'id', id: '10234' }],
    [' 10234 ', { kind: 'id', id: '10234' }],
    ['KPI-5', { kind: 'key', key: 'KPI-5' }],
    ['PORT_2-20', { kind: 'key', key: 'PORT_2-20' }],
    ['revenue', { kind: 'invalid' }],
    ['', { kind: 'invalid' }],
    ['KPI-', { kind: 'invalid' }],
    ['5-KPI', { kind: 'invalid' }],
  ])('%j', (raw, expected) => {
    expect(parseKpiRef(raw)).toEqual(expected);
  });
});

describe('readStoredAssignments', () => {
  it('reads ids only: kpiIssueId becomes the kpiId', () => {
    const out = readStoredAssignments(prop([stored('KPI-5', '10234'), stored('KPI-6', '10235')]));
    expect(out.assignments.map((a) => a.kpiId)).toEqual(['10234', '10235']);
    expect(out.assignments[0]).toEqual(target('10234'));
    expect(out.deletedKeys).toEqual([]);
  });

  it('reads a key-only reference as a deleted KPI, kept by its key', () => {
    const out = readStoredAssignments(prop([stored('KPI-5'), stored('KPI-6', '10235')]));
    expect(out.assignments.map((a) => a.kpiId)).toEqual(['KPI-5', '10235']);
    expect(out.deletedKeys).toEqual(['KPI-5']);
  });

  it('reads a digits-only kpiId (someone wrote an id there) as an id', () => {
    const out = readStoredAssignments(prop([stored('10234')]));
    expect(out.assignments.map((a) => a.kpiId)).toEqual(['10234']);
    expect(out.deletedKeys).toEqual([]);
  });

  it('keeps an invalid value as a deleted reference', () => {
    const out = readStoredAssignments(prop([stored('revenue'), stored('KPI-5', 'not-an-id')]));
    expect(out.assignments.map((a) => a.kpiId)).toEqual(['revenue', 'KPI-5']);
    expect(out.deletedKeys).toEqual(['revenue', 'KPI-5']);
  });

  it('keeps the first of two references to the same KPI', () => {
    const out = readStoredAssignments(prop([stored('KPI-5', '10234', { target: 1 }), stored('PORT-20', '10234', { target: 2 })]));
    expect(out.assignments).toEqual([target('10234', { target: 1 })]);
  });
});

describe('toStoredAssignments', () => {
  const keys = new Map([
    ['10234', 'PORT-20'],
    ['10235', 'KPI-6'],
  ]);

  it('writes kpiIssueId + the current key for every id reference, and both index arrays', () => {
    const out = toStoredAssignments([target('10234'), target('10235')], keys, true);
    expect(out).toEqual({
      assignments: [stored('PORT-20', '10234'), stored('KPI-6', '10235')],
      kpiIssueIds: ['10234', '10235'],
      kpiIds: ['PORT-20', 'KPI-6'],
      refsVersion: 2,
    });
  });

  it('leaves updatedBy / updatedAt untouched', () => {
    const out = toStoredAssignments([target('10234', { updatedBy: 'someone', updatedAt: 5 })], keys, true);
    expect(out.assignments[0]).toMatchObject({ updatedBy: 'someone', updatedAt: 5 });
  });

  it('keeps key-only references as they are', () => {
    const out = toStoredAssignments([target('KPI-404'), target('10234')], keys, false);
    expect(out.assignments[0]).toEqual(stored('KPI-404'));
    expect(out.kpiIssueIds).toEqual(['10234']);
    expect(out.kpiIds).toEqual(['KPI-404', 'PORT-20']);
  });

  it('writes refsVersion only when stamping', () => {
    expect(toStoredAssignments([target('10234')], keys, true).refsVersion).toBe(2);
    expect(toStoredAssignments([target('10234')], keys, false)).not.toHaveProperty('refsVersion');
  });

  it('falls back to the id when no key is known', () => {
    expect(toStoredAssignments([target('999')], keys, true).assignments[0]).toEqual(stored('999', '999'));
  });

  it('round-trips: read(to(x)) is x', () => {
    const x = [target('10234', { target: 3 }), target('KPI-404'), target('10235', { targetType: 'percent' })];
    expect(readStoredAssignments(toStoredAssignments(x, keys, false)).assignments).toEqual(x);
    expect(readStoredAssignments(toStoredAssignments(x, keys, true)).assignments).toEqual(x);
  });
});

describe('shouldStampRefs / storedKeysById', () => {
  it('stamps no property, an all-id property and an already stamped one; not one with key-only references', () => {
    expect(shouldStampRefs(null)).toBe(true);
    expect(shouldStampRefs(prop([]))).toBe(true);
    expect(shouldStampRefs(prop([stored('KPI-5', '10234')]))).toBe(true);
    expect(shouldStampRefs(prop([stored('KPI-5')]))).toBe(false);
    expect(shouldStampRefs(prop([stored('KPI-404')], { refsVersion: 2 }))).toBe(true);
  });

  it('lists the stored key of each id reference', () => {
    expect(storedKeysById(prop([stored('KPI-5', '10234'), stored('KPI-404'), stored('777')]))).toEqual(new Map([['10234', 'KPI-5']]));
    expect(storedKeysById(null)).toEqual(new Map());
  });
});

describe('migrateStoredAssignments', () => {
  const idOfKey = new Map([
    ['KPI-5', '10234'], // moved: KPI-5 is now PORT-20
    ['KPI-6', '10235'],
  ]);
  const keyOfId = new Map([
    ['10234', 'PORT-20'],
    ['10235', 'KPI-6'],
  ]);

  it('keys only: resolves every key, writes the current key, stamps', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-5'), stored('KPI-6')], { kpiIds: ['KPI-5', 'KPI-6'] }), idOfKey, keyOfId);
    expect(out).toEqual({
      outcome: 'migrated',
      deletedKeys: [],
      stored: {
        assignments: [stored('PORT-20', '10234'), stored('KPI-6', '10235')],
        kpiIssueIds: ['10234', '10235'],
        kpiIds: ['PORT-20', 'KPI-6'],
        refsVersion: 2,
      },
    });
  });

  it('ids only: already done, only re-stamped', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-6', '10235')]), idOfKey, keyOfId);
    expect(out.outcome).toBe('alreadyDone');
    expect(out.stored).toEqual({ assignments: [stored('KPI-6', '10235')], kpiIssueIds: ['10235'], kpiIds: ['KPI-6'], refsVersion: 2 });
  });

  it('a mix: migrates the keys and keeps the ids', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-6', '10235'), stored('KPI-5')]), idOfKey, keyOfId);
    expect(out.outcome).toBe('migrated');
    expect(out.stored.assignments).toEqual([stored('KPI-6', '10235'), stored('PORT-20', '10234')]);
  });

  it('a key missing from idOfKey is a deleted KPI: kept, reported, and the issue is still stamped', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-404'), stored('KPI-5')]), idOfKey, keyOfId);
    expect(out.outcome).toBe('migrated');
    expect(out.deletedKeys).toEqual(['KPI-404']);
    expect(out.stored.assignments[0]).toEqual(stored('KPI-404'));
    expect(out.stored.refsVersion).toBe(2);
    expect(out.stored.kpiIds).toEqual(['KPI-404', 'PORT-20']);
  });

  it('an issue with nothing but deleted KPIs is skipped, and stamped', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-404'), stored('revenue')]), idOfKey, keyOfId);
    expect(out.outcome).toBe('skipped');
    expect(out.deletedKeys).toEqual(['KPI-404', 'revenue']);
    expect(out.stored).toEqual({
      assignments: [stored('KPI-404'), stored('revenue')],
      kpiIssueIds: [],
      kpiIds: ['KPI-404', 'revenue'],
      refsVersion: 2,
    });
  });

  it('a digits-only kpiId gains its kpiIssueId', () => {
    const out = migrateStoredAssignments(prop([stored('10235')]), idOfKey, keyOfId);
    expect(out.outcome).toBe('migrated');
    expect(out.stored.assignments).toEqual([stored('KPI-6', '10235')]);
  });

  it('leaves updatedBy / updatedAt untouched', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-5', undefined, { updatedBy: 'x', updatedAt: 7 })]), idOfKey, keyOfId);
    expect(out.stored.assignments[0]).toMatchObject({ updatedBy: 'x', updatedAt: 7 });
  });

  it('what it writes reads back as ids', () => {
    const out = migrateStoredAssignments(prop([stored('KPI-5'), stored('KPI-404')]), idOfKey, keyOfId);
    expect(readStoredAssignments(out.stored)).toEqual({ assignments: [target('10234'), target('KPI-404')], deletedKeys: ['KPI-404'] });
  });
});
