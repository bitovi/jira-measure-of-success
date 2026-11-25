import type { TargetSummaryDto } from '@domain/index.js';
import { betAmount, betWhen } from '@ui/targetText.js';

/** The browser's columns (Plans style): KPI · Unit, plus Target in Tracked by parents. */
export const KPI_ROW_COLUMNS = {
  plain: 'grid-cols-[minmax(0,1fr)_56px]',
  withTarget: 'grid-cols-[minmax(0,1fr)_56px_minmax(0,180px)]',
} as const;

/** A parent's target as the Target column words it, like the panel's target cards (`+5% by Mar 31, 2026`). */
export function targetSummaryText(t: TargetSummaryDto, unit: string): string {
  const when = betWhen(t.due);
  return `${betAmount(t.targetType, t.target, unit)}${when.startsWith('by ') ? ' ' : ' · '}${when}`;
}
