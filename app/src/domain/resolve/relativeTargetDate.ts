import type { DueTiming, IsoDate } from '../models/index.js';
import type { ResolvedEndpoint } from './effectiveTiming.js';

/**
 * Relative target-date resolution — Brief §4.2/§6.1, requirements §5.3.
 *
 * Computes a KPI target date at READ time: `resolve(anchor) + offsetMonths`.
 * Never snapshots. An unresolvable anchor (no own date, no dated descendants)
 * yields `pending` rather than a computed-from-nothing date.
 */
export interface RelativeAnchorTiming {
  issueKey: string;
  /** effective due of this issue, from effectiveTiming(...).due */
  due: ResolvedEndpoint;
}

export interface RelativeTargetContext {
  /** the assignment's own issue timing (for anchor = issueDueDate) */
  issue: RelativeAnchorTiming;
  /** the parent's timing (for anchor = parentDueDate); undefined at the root */
  parent?: RelativeAnchorTiming;
}

export interface ResolvedTargetDate {
  /** null => pending */
  date: IsoDate | null;
  pending: boolean;
  /** human-readable description of how the date was derived */
  source: string;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month1: number): number {
  if (month1 === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month1 - 1];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Add whole months to an ISO date, preserving an end-of-month anchor: the last
 * day of a month maps to the last day of the target month (e.g. 2026-09-30 + 1
 * → 2026-10-31). Non-EOM days clamp to the target month's length.
 */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const isEndOfMonth = d === daysInMonth(y, m);
  const totalMonths0 = m - 1 + months;
  const ny = y + Math.floor(totalMonths0 / 12);
  const nm = ((totalMonths0 % 12) + 12) % 12; // 0-based
  const targetLastDay = daysInMonth(ny, nm + 1);
  const nd = isEndOfMonth ? targetLastDay : Math.min(d, targetLastDay);
  return `${ny}-${pad(nm + 1)}-${pad(nd)}`;
}

function offsetPhrase(offsetMonths: number, anchorNoun: string): string {
  if (offsetMonths === 0) return `on ${anchorNoun}`;
  const unit = Math.abs(offsetMonths) === 1 ? 'mo' : 'mo';
  return `${offsetMonths > 0 ? '+' : ''}${offsetMonths} ${unit} after ${anchorNoun}`;
}

function rollupPhrase(endpoint: ResolvedEndpoint): string {
  if (endpoint.source === 'children') {
    return endpoint.fromIssueKey ? `rolled up from ${endpoint.fromIssueKey}` : 'rolled up from children';
  }
  return 'own date';
}

export function resolveRelativeTargetDate(
  timing: DueTiming,
  ctx: RelativeTargetContext,
  kpiStart: IsoDate | null,
): ResolvedTargetDate {
  if (timing.mode === 'absolute') {
    return timing.absolute !== null
      ? { date: timing.absolute, pending: false, source: 'absolute date' }
      : { date: null, pending: true, source: 'absolute date not set' };
  }

  // relative
  switch (timing.anchor) {
    case 'kpiStart': {
      if (kpiStart === null) {
        return { date: null, pending: true, source: 'KPI start not set' };
      }
      return {
        date: addMonths(kpiStart, timing.offsetMonths),
        pending: false,
        source: `${offsetPhrase(timing.offsetMonths, 'KPI start')}`,
      };
    }
    case 'parentDueDate': {
      const anchor = ctx.parent?.due;
      if (!anchor || anchor.date === null) {
        return { date: null, pending: true, source: 'parent due date pending' };
      }
      const noun = `${ctx.parent!.issueKey} due`;
      return {
        date: addMonths(anchor.date, timing.offsetMonths),
        pending: false,
        source: `${offsetPhrase(timing.offsetMonths, noun)}, ${rollupPhrase(anchor)}`,
      };
    }
    case 'issueDueDate':
    default: {
      const anchor = ctx.issue.due;
      if (anchor.date === null) {
        return { date: null, pending: true, source: 'due date pending' };
      }
      const noun = `${ctx.issue.issueKey} due`;
      return {
        date: addMonths(anchor.date, timing.offsetMonths),
        pending: false,
        source: `${offsetPhrase(timing.offsetMonths, noun)}, ${rollupPhrase(anchor)}`,
      };
    }
  }
}
