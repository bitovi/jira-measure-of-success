import { z } from 'zod';
import { IsoDate } from '../models/assignment';

/**
 * Reading series storage — Option B (specs/01-initial-build/storage-model.md).
 *
 * A KPI's readings live in the Jira changelog of a dedicated, app-only field on
 * the KPI issue. Each recorded value is written as an embedded-date payload, so
 * every write becomes one changelog entry; the series is reconstructed here from
 * the field's history. This module is pure (no @forge/*): the backend fetches
 * the raw changelog (`POST /rest/api/3/changelog/bulkfetch`, filtered to the
 * field) and hands the entries to `readingsFromChangelog`.
 *
 * Rules:
 * - Effective date is embedded in the value, so ordering is by that date — not
 *   by changelog `created` (entry time) — which makes backfill safe.
 * - Append-only with last-write-wins per date: re-writing a date edits it; a
 *   `null` value is a tombstone that deletes the date. History is never purged.
 */

/** The payload written to the field for a single reading (`v: null` = delete). */
const EncodedReading = z.object({ d: IsoDate, v: z.number().nullable() });

/** One change taken from the field's changelog (`to`/`toString` + `created`). */
export interface ReadingChange {
  /** Entry timestamp (ms since epoch) — Jira changelog `created`. */
  created: number;
  /** The field's new value for this change (changelog `to`); null when cleared. */
  to: string | null;
  /** Optional author account id (changelog `author`). */
  by?: string;
}

/** A reconstructed reading in the effective-date series. */
export interface ReadingPoint {
  date: IsoDate;
  value: number;
  /** `created` of the winning write for this date. */
  recordedAt: number;
  /** Author of the winning write, when known. */
  recordedBy?: string;
}

/** Encode a reading (or tombstone) into the field payload string. */
export function encodeReadingValue(date: string, value: number | null): string {
  return JSON.stringify(EncodedReading.parse({ d: date, v: value }));
}

/** Decode a field payload back into `{ date, value }`, or null if unparseable. */
export function decodeReadingValue(
  text: string | null | undefined,
): { date: IsoDate; value: number | null } | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = EncodedReading.safeParse(raw);
  return parsed.success ? { date: parsed.data.d, value: parsed.data.v } : null;
}

/**
 * Reconstruct the effective-date-ordered reading series from a field's
 * changelog. Applies last-write-wins per date (by `created`), drops tombstones,
 * and sorts by the embedded date.
 */
export function readingsFromChangelog(changes: ReadingChange[]): ReadingPoint[] {
  const byDate = new Map<string, { value: number | null; recordedAt: number; recordedBy?: string }>();

  const ordered = [...changes].sort((a, b) => a.created - b.created);
  for (const change of ordered) {
    const decoded = decodeReadingValue(change.to);
    if (!decoded) continue;
    byDate.set(decoded.date, {
      value: decoded.value,
      recordedAt: change.created,
      ...(change.by !== undefined ? { recordedBy: change.by } : {}),
    });
  }

  const series: ReadingPoint[] = [];
  for (const [date, entry] of byDate) {
    if (entry.value === null) continue; // tombstone → deleted
    series.push({
      date,
      value: entry.value,
      recordedAt: entry.recordedAt,
      ...(entry.recordedBy !== undefined ? { recordedBy: entry.recordedBy } : {}),
    });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}
