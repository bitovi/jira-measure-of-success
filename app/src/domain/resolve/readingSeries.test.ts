import { describe, expect, it } from 'vitest';
import {
  decodeReadingValue,
  encodeReadingValue,
  readingsFromChangelog,
  type ReadingChange,
} from './readingSeries.js';

/**
 * Option B storage (specs/01-initial-build/storage-model.md): readings live in
 * the changelog of a dedicated app-only field on the KPI issue. Each write is an
 * embedded-date value; the series is reconstructed from the field's changelog.
 */

const at = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();

describe('encodeReadingValue / decodeReadingValue', () => {
  it('round-trips a value', () => {
    const text = encodeReadingValue('2026-03-01', 1_240_000);
    expect(decodeReadingValue(text)).toEqual({ date: '2026-03-01', value: 1_240_000 });
  });

  it('round-trips a tombstone (null = delete)', () => {
    const text = encodeReadingValue('2026-03-01', null);
    expect(decodeReadingValue(text)).toEqual({ date: '2026-03-01', value: null });
  });

  it('returns null for unparseable / malformed text', () => {
    expect(decodeReadingValue('not json')).toBeNull();
    expect(decodeReadingValue('')).toBeNull();
    expect(decodeReadingValue(null)).toBeNull();
    expect(decodeReadingValue('{"d":"2026-03-01"}')).toBeNull(); // missing v
    expect(decodeReadingValue('{"d":"nope","v":1}')).toBeNull(); // bad date
  });
});

describe('readingsFromChangelog', () => {
  it('reconstructs a series from in-order entries', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-05'), to: encodeReadingValue('2026-01-01', 100) },
      { created: at('2026-02-05'), to: encodeReadingValue('2026-02-01', 120) },
    ];
    expect(readingsFromChangelog(changes)).toEqual([
      { date: '2026-01-01', value: 100, recordedAt: at('2026-01-05') },
      { date: '2026-02-01', value: 120, recordedAt: at('2026-02-05') },
    ]);
  });

  it('sorts by the embedded effective date, not by entry time (backfill)', () => {
    // Entered March first, then January backfilled later.
    const changes: ReadingChange[] = [
      { created: at('2026-03-10'), to: encodeReadingValue('2026-03-01', 300) },
      { created: at('2026-03-11'), to: encodeReadingValue('2026-01-01', 100) },
    ];
    expect(readingsFromChangelog(changes).map((r) => r.date)).toEqual([
      '2026-01-01',
      '2026-03-01',
    ]);
  });

  it('last write wins for a duplicate date (edit)', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-05'), to: encodeReadingValue('2026-01-01', 100) },
      { created: at('2026-01-09'), to: encodeReadingValue('2026-01-01', 175) },
    ];
    expect(readingsFromChangelog(changes)).toEqual([
      { date: '2026-01-01', value: 175, recordedAt: at('2026-01-09') },
    ]);
  });

  it('a tombstone removes the date', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-05'), to: encodeReadingValue('2026-01-01', 100) },
      { created: at('2026-02-05'), to: encodeReadingValue('2026-02-01', 120) },
      { created: at('2026-02-06'), to: encodeReadingValue('2026-01-01', null) },
    ];
    expect(readingsFromChangelog(changes).map((r) => r.date)).toEqual(['2026-02-01']);
  });

  it('a re-add after a tombstone brings the date back', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-05'), to: encodeReadingValue('2026-01-01', 100) },
      { created: at('2026-01-06'), to: encodeReadingValue('2026-01-01', null) },
      { created: at('2026-01-07'), to: encodeReadingValue('2026-01-01', 200) },
    ];
    expect(readingsFromChangelog(changes)).toEqual([
      { date: '2026-01-01', value: 200, recordedAt: at('2026-01-07') },
    ]);
  });

  it('orders duplicate-date writes by created regardless of input order', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-09'), to: encodeReadingValue('2026-01-01', 175) },
      { created: at('2026-01-05'), to: encodeReadingValue('2026-01-01', 100) },
    ];
    expect(readingsFromChangelog(changes)).toEqual([
      { date: '2026-01-01', value: 175, recordedAt: at('2026-01-09') },
    ]);
  });

  it('carries the author of the winning write when present', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-05'), to: encodeReadingValue('2026-01-01', 100), by: 'acc-jm' },
    ];
    expect(readingsFromChangelog(changes)).toEqual([
      { date: '2026-01-01', value: 100, recordedAt: at('2026-01-05'), recordedBy: 'acc-jm' },
    ]);
  });

  it('skips unparseable changelog entries', () => {
    const changes: ReadingChange[] = [
      { created: at('2026-01-05'), to: 'garbage' },
      { created: at('2026-02-05'), to: null },
      { created: at('2026-03-05'), to: encodeReadingValue('2026-03-01', 300) },
    ];
    expect(readingsFromChangelog(changes)).toEqual([
      { date: '2026-03-01', value: 300, recordedAt: at('2026-03-05') },
    ]);
  });

  it('returns an empty series for no changes', () => {
    expect(readingsFromChangelog([])).toEqual([]);
  });
});
