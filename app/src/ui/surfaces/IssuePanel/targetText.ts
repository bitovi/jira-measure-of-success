import {
  addMonths,
  applyTargetChange,
  isBaselineRelative,
  type CatalogEntryDto,
  type DueTiming,
  type PanelRowDto,
  type ResolvedTargetValueDto,
  type TargetType,
} from '@domain/index.js';

/**
 * Pure presentation rules for a saved KPI target card (mock v3,
 * specs/03-relative-dates-and-values/issue-panel-v3.html):
 *
 *  - the **bet** — what the PM typed (`+10%` / `+100 orders` · `3 months after due date`) — is the headline;
 *  - the **estimate** line says whether the number is a locked `Target` or an
 *    `Estimated target`, and where it came from (`from 250 now`, `reached 281`, …);
 *  - one **pill** says where the bet stands; a **nudge** asks for a missing reading.
 *
 * No React here so the wording is unit-testable and shared by the saved card,
 * the inline-edit live estimate, and the "Set a KPI target" preview.
 */

// ── numbers + dates ──────────────────────────────────────────────────────────
function isCurrency(unit: string): boolean {
  return unit === '$' || unit.toUpperCase() === 'USD';
}

/** A resolved number, without its unit (currency keeps `$`). */
export function fmtEst(n: number, unit: string): string {
  if (isCurrency(unit)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: Math.abs(n) >= 10_000 ? 'compact' : 'standard',
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(n) >= 10_000 ? 2 : 0,
    }).format(n);
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) < 100 ? 1 : 0 });
}

/**
 * A typed number with its unit, as it reads in the bet headline (`300 stores`,
 * `$1.5M`, `4.25%`). Unlike `fmtEst` it keeps the precision that was typed.
 */
export function fmtWithUnit(n: number, unit: string): string {
  const num =
    isCurrency(unit) && Math.abs(n) >= 10_000
      ? fmtEst(n, unit)
      : `${isCurrency(unit) ? '$' : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  if (isCurrency(unit) || unit === '' || unit === 'count') return num;
  if (unit === '%') return `${num}%`;
  return `${num} ${unit}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** `Apr 15, 2027` */
export function fmtDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** `Jun 1` — the year is added only when it differs from `ref`'s year. */
function fmtShortDate(iso: string, ref: string | null): string {
  if (ref && ref.slice(0, 4) !== iso.slice(0, 4)) return fmtDate(iso);
  return parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function isIsoDate(v: string | null): v is string {
  return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** '' is "no target yet" (null); otherwise a number, allowing `+` and thousands separators. */
export function parseTarget(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '').replace(/^\+/, '');
  return t === '' ? null : Number(t);
}

export function isValidNumber(raw: string): boolean {
  const n = parseTarget(raw);
  return n === null || Number.isFinite(n);
}

// ── the bet ──────────────────────────────────────────────────────────────────
export function betAmount(targetType: TargetType | null, target: number | null, unit: string): string {
  if (target === null || Number.isNaN(target)) return '—';
  if (targetType === 'percent') return `${target > 0 ? '+' : ''}${target}%`;
  if (targetType === 'relative') return `${target > 0 ? '+' : target < 0 ? '−' : ''}${fmtWithUnit(Math.abs(target), unit)}`;
  return fmtWithUnit(target, unit);
}

export function betWhen(due: DueTiming | null): string {
  if (!due) return '—';
  if (due.mode === 'absolute') return isIsoDate(due.absolute) ? `by ${fmtDate(due.absolute)}` : '—';
  const n = due.offsetMonths;
  if (n === 0) return 'on the due date';
  const m = Math.abs(n);
  return `${m} month${m === 1 ? '' : 's'} ${n > 0 ? 'after' : 'before'} due date`;
}

// ── the estimate line ────────────────────────────────────────────────────────
export interface EstimatePart {
  pre?: string;
  num?: string;
  post?: string;
  tone?: 'good' | 'bad';
  /** tooltip explaining where the number/date came from */
  hint?: string;
}

export interface Estimate {
  /** `Target` (locked) | `Estimated target` | `No target value yet` */
  label: string;
  /** the resolved target, or null when there's nothing to show */
  value: string | null;
  /** `by Apr 15, 2027` — only for relative dates (a fixed date is already in the bet) */
  by: EstimatePart | null;
  tail: EstimatePart[];
}

/** A % / amount change or a relative date can't resolve without the issue's due date. */
function dependsOnDueDate(row: Pick<PanelRowDto, 'targetType' | 'dueTiming'>): boolean {
  return isBaselineRelative(row.targetType) || row.dueTiming?.mode === 'relative';
}

export function estimate(row: PanelRowDto, currentValue: number | null): Estimate {
  const onBaseline = isBaselineRelative(row.targetType);
  const rv = row.resolvedValue;
  const state = row.displayState;
  const unit = row.unit;
  const targetDate = row.targetDate?.date ?? null;

  let by: EstimatePart | null = null;
  if (row.dueTiming?.mode === 'relative' && targetDate) {
    const n = row.dueTiming.offsetMonths;
    const base = row.dueDate ? `${row.dueDateRolledUp ? 'Rolled-up due date' : 'Due date'} ${fmtDate(row.dueDate)}` : 'Due date';
    by = {
      pre: `by ${fmtDate(targetDate)}`,
      hint: n === 0 ? base : `${base} ${n > 0 ? '+' : '−'} ${Math.abs(n)} month${Math.abs(n) === 1 ? '' : 's'}`,
    };
  }

  if (row.target === null) return { label: 'No target value yet', value: null, by, tail: nowPart(currentValue, unit) };

  const locked = !onBaseline || (rv !== null && !rv.provisional);
  const value = rv?.value ?? (onBaseline ? null : row.target);
  const tail: EstimatePart[] = [];
  const from = (n: number | null, post: string, hint: string) => {
    if (n !== null) tail.push({ pre: 'from ', num: fmtEst(n, unit), post, hint });
  };

  switch (state) {
    case 'met':
    case 'missed':
      if (row.actual !== null) tail.push({ pre: 'reached ', num: fmtEst(row.actual, unit), tone: state === 'met' ? 'good' : 'bad' });
      break;
    case 'resultUnknown':
      tail.push({ pre: 'no reading' });
      break;
    case 'needsBaseline':
      tail.push({ pre: 'no readings yet' });
      break;
    case 'baselined':
      if (onBaseline) from(rv?.baseline ?? null, ` on ${fmtShortDate(rv?.baselineDate ?? row.dueDate ?? '', targetDate)}`, 'Value on the due date');
      else tail.push(...nowPart(currentValue, unit));
      break;
    case 'needsMeasurement':
      if (onBaseline && rv?.baselineFrom) from(rv.baseline, ` on ${fmtShortDate(rv.baselineFrom, targetDate)}`, 'Latest reading — taken before the due date');
      else if (onBaseline) from(rv?.baseline ?? null, ' now', 'Latest reading');
      else tail.push(...nowPart(currentValue, unit));
      break;
    default:
      if (onBaseline) from(rv?.baseline ?? null, ' now', rv?.baselineFrom ? `Latest reading, ${fmtDate(rv.baselineFrom)}` : 'Latest reading');
      else tail.push(...nowPart(currentValue, unit));
  }
  if (state === 'provisional' && dependsOnDueDate(row)) tail.push(noDueDatePart(row));

  return {
    label: locked ? 'Target' : 'Estimated target',
    value: value === null ? '—' : fmtEst(value, unit),
    by,
    tail,
  };
}

/**
 * Why a provisional target is still waiting on the issue's due date. With a fixed
 * target date, only the starting value (measured on the due date) is missing.
 * Saying "no due date yet" there would read as if the picked date were ignored.
 */
function noDueDatePart(row: Pick<PanelRowDto, 'targetType' | 'dueTiming'>): EstimatePart {
  const startingValueHint = 'The starting value is the KPI’s value on the issue’s due date. Until there is one, the latest reading stands in.';
  if (row.dueTiming?.mode === 'absolute' && isBaselineRelative(row.targetType)) {
    return { pre: 'starting value waits for the issue’s due date', hint: startingValueHint };
  }
  return { pre: 'no due date yet', hint: isBaselineRelative(row.targetType) ? startingValueHint : 'The target date is counted from the issue’s due date.' };
}

function nowPart(currentValue: number | null, unit: string): EstimatePart[] {
  return currentValue === null ? [] : [{ num: fmtEst(currentValue, unit), post: ' now', hint: 'Latest reading' }];
}

/** The estimate as plain text (aria / tests). */
export function estimateText(e: Estimate): string {
  const part = (p: EstimatePart) => `${p.pre ?? ''}${p.num ?? ''}${p.post ?? ''}`;
  const head = [e.label, e.value, e.by ? part(e.by) : null].filter(Boolean).join(' ');
  return [head, ...e.tail.map(part)].join(' · ');
}

// ── pill + nudge ─────────────────────────────────────────────────────────────
export type PillKind = 'upcoming' | 'pending' | 'inprogress' | 'met' | 'missed' | 'unscored';

export const PILL: Record<PillKind, { label: string; appearance: 'default' | 'inprogress' | 'success' | 'removed' | 'moved' }> = {
  upcoming: { label: 'Upcoming', appearance: 'default' },
  pending: { label: 'Pending', appearance: 'default' },
  inprogress: { label: 'In progress', appearance: 'inprogress' },
  met: { label: 'Met', appearance: 'success' },
  missed: { label: 'Missed', appearance: 'removed' },
  unscored: { label: 'Not measured', appearance: 'moved' },
};

export function pillFor(row: PanelRowDto): PillKind | null {
  switch (row.displayState) {
    case null:
      return null;
    case 'provisional':
      return dependsOnDueDate(row) ? 'pending' : 'upcoming';
    case 'baselined':
    case 'needsMeasurement':
      return 'inprogress';
    case 'met':
      return 'met';
    case 'missed':
      return 'missed';
    case 'resultUnknown':
      return 'unscored';
    default:
      return 'upcoming';
  }
}

export function nudgeFor(row: PanelRowDto): string | null {
  switch (row.warning) {
    case 'staleBaseline':
      return 'Due date passed — record a value to lock in the target.';
    case 'unconfirmedResult':
      return 'No value recorded since the target date, so we can’t tell if it was met.';
    case 'needsBaseline':
      return row.targetType === 'relative' ? 'An amount change needs a starting value.' : 'A % change needs a starting value.';
    default:
      return null;
  }
}

// ── drafts (inline edit + "Set a KPI target") ────────────────────────────────
export interface TargetDraft {
  targetType: TargetType;
  value: string;
  due: DueTiming;
}

export const DEFAULT_DUE: DueTiming = { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 };

export function draftFromRow(row: PanelRowDto): TargetDraft {
  const signed = isBaselineRelative(row.targetType);
  const v = row.target;
  return {
    targetType: row.targetType ?? 'absolute',
    value: v === null ? '' : signed && v > 0 ? `+${v}` : String(v),
    due: row.dueTiming ?? DEFAULT_DUE,
  };
}

/** The timing to save: a relative date never carries a stale/blank fixed date. */
export function cleanDue(due: DueTiming): DueTiming {
  return due.mode === 'relative' && !isIsoDate(due.absolute) ? { ...due, absolute: null } : due;
}

/** True when the draft can be saved (a number or blank, and a real date when fixed). */
export function isValidDraft(d: TargetDraft): boolean {
  return isValidNumber(d.value) && (d.due.mode === 'relative' || isIsoDate(d.due.absolute));
}

export function sameDraft(a: TargetDraft, b: TargetDraft): boolean {
  return (
    a.targetType === b.targetType &&
    parseTarget(a.value) === parseTarget(b.value) &&
    JSON.stringify(cleanDue(a.due)) === JSON.stringify(cleanDue(b.due))
  );
}

/**
 * The row as it would read with `draft` applied — drives the live estimate while
 * editing and the "Set a KPI target" preview. Keeps the row's baseline (or the
 * KPI's latest reading when it has none) and re-resolves value + target date.
 */
export function applyDraft(row: PanelRowDto, draft: TargetDraft, currentValue: number | null): PanelRowDto {
  const parsed = parseTarget(draft.value);
  const target = parsed === null || Number.isNaN(parsed) ? null : parsed;
  const due = draft.due;
  const targetDate =
    due.mode === 'relative'
      ? row.dueDate
        ? { date: addMonths(row.dueDate, due.offsetMonths), pending: false, source: '' }
        : { date: null, pending: true, source: '' }
      : { date: isIsoDate(due.absolute) ? due.absolute : null, pending: false, source: '' };

  const rv = row.resolvedValue;
  let resolvedValue: ResolvedTargetValueDto;
  if (draft.targetType === 'absolute') {
    resolvedValue = { value: target, baseline: null, baselineDate: null, baselineFrom: null, state: 'baselined', provisional: false };
  } else {
    const hasRowBaseline = rv !== null && rv.baseline !== null;
    const baseline = hasRowBaseline ? rv.baseline : currentValue;
    resolvedValue =
      baseline === null
        ? { value: null, baseline: null, baselineDate: row.dueDate, baselineFrom: null, state: 'needsBaseline', provisional: true }
        : {
            value: target === null ? null : applyTargetChange(baseline, draft.targetType, target),
            baseline,
            baselineDate: rv?.baselineDate ?? row.dueDate,
            baselineFrom: rv?.baselineFrom ?? null,
            state: hasRowBaseline ? rv.state : 'provisional',
            provisional: hasRowBaseline ? rv.provisional : true,
          };
  }

  let displayState = row.displayState;
  // A judged result follows the edited target (same rule as domain displayState).
  if ((displayState === 'met' || displayState === 'missed') && row.actual !== null && resolvedValue.value !== null) {
    const met = row.direction === 'decrease' ? row.actual <= resolvedValue.value : row.actual >= resolvedValue.value;
    displayState = met ? 'met' : 'missed';
  }
  if (resolvedValue.state === 'needsBaseline') displayState = 'needsBaseline';
  else if (displayState === 'needsBaseline') displayState = row.dueDate ? 'projected' : 'provisional';

  return { ...row, target, targetType: draft.targetType, dueTiming: due, targetDate, resolvedValue, displayState };
}

/** A not-yet-saved row for the "Set a KPI target" preview card. */
export function previewRow(
  kpi: CatalogEntryDto,
  draft: TargetDraft,
  issueDueDate: string | null,
  issueDueRolledUp: boolean,
): PanelRowDto {
  const base: PanelRowDto = {
    kpiId: kpi.id,
    name: kpi.name,
    unit: kpi.unit,
    direction: kpi.direction,
    target: null,
    targetType: null,
    targetDate: null,
    dueTiming: null,
    start: null,
    relationship: 'onlyHere',
    resolvedValue: null,
    displayState: issueDueDate ? 'projected' : 'provisional',
    warning: null,
    frozen: false,
    dueDate: issueDueDate,
    dueDateRolledUp: issueDueRolledUp,
    actual: null,
  };
  const row = applyDraft(base, draft, kpi.currentValue ?? null);
  // The preview card always reads as "not started yet".
  return { ...row, displayState: row.displayState === 'needsBaseline' ? 'needsBaseline' : base.displayState };
}

/** True when the draft moves the KPI against its "better" direction. */
export function isWrongWay(row: PanelRowDto, currentValue: number | null): boolean {
  if (row.target === null || !row.direction) return false;
  const delta = isBaselineRelative(row.targetType) ? row.target : currentValue === null ? 0 : row.target - currentValue;
  return row.direction === 'increase' ? delta < 0 : delta > 0;
}
