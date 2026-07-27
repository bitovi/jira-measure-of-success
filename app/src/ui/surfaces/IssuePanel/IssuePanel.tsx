import { useEffect, useMemo, useRef, useState } from 'react';
import { usePanelData, type UsePanel } from '@ui/data/usePanelData/index.js';
import { openKpiTimeline } from '@ui/bridge.js';
import { KpiView } from '@ui/surfaces/KpiView/index.js';
import {
  addMonths,
  type Assignment,
  type CatalogEntryDto,
  type DisplayState,
  type DueTiming,
  type PanelRowDto,
  type TargetType,
  type TargetWarning,
} from '@domain/index.js';

/**
 * Issue panel (Custom UI) — on-issue KPI editor. KPIs are grouped by their
 * relationship to the parent (shared / only here / on parent, not tracked).
 * v1 authors INDEPENDENT targets (no value inheritance, Q11).
 *
 * Feature 03 (relative dates & values): a target value is **Absolute value** or
 * **Percent change** (percent of the KPI's value at the due date); a target date
 * is **Fixed date** or **N months after the due date**. A saved target renders
 * as a card whose status pill encodes the combined value×date state (the 8
 * FR-26 states), with a baseline note, warnings, and Edit/Remove. Mocks:
 * specs/03-relative-dates-and-values/issue-panel.html.
 */
const GROUP_META: Record<PanelRowDto['relationship'], { title: string; order: number }> = {
  shared: { title: 'Shared with parent', order: 0 },
  onlyHere: { title: 'Only on this issue', order: 1 },
  onParentNotTracked: { title: 'On parent, not tracked here', order: 2 },
};

function fmtNum(n: number | null): string {
  return n === null ? '—' : Math.round(n).toLocaleString();
}

function fmtPercent(n: number | null): string {
  if (n === null) return '—';
  return `${n > 0 ? '+' : ''}${n}%`;
}

function directionGlyph(direction: PanelRowDto['direction']): string {
  if (direction === 'increase') return '▲';
  if (direction === 'decrease') return '▼';
  return '';
}

function offsetPhrase(n: number): string {
  if (n === 0) return 'on the due date';
  const m = Math.abs(n);
  return `${m} month${m === 1 ? '' : 's'} ${n > 0 ? 'after' : 'before'} due date`;
}

// ── State → presentation ─────────────────────────────────────────────────────
const PILL: Record<DisplayState, { label: string; cls: string }> = {
  projected: { label: 'Projected', cls: 'text-warning' },
  provisional: { label: 'Provisional', cls: 'text-text-subtle' },
  baselined: { label: 'Baselined', cls: 'text-brand' },
  needsMeasurement: { label: 'Needs measurement', cls: 'text-warning' },
  met: { label: 'Met ✓', cls: 'text-success' },
  missed: { label: 'Missed ✗', cls: 'text-danger' },
  resultUnknown: { label: 'Result unknown', cls: 'text-warning' },
  needsBaseline: { label: 'Needs baseline', cls: 'text-warning' },
};

const WARNING_COPY: Record<Exclude<TargetWarning, null>, string> = {
  staleBaseline: 'Due date passed with no measurement — baseline may be stale. Record a value.',
  unconfirmedResult:
    'Target date passed with no measurement since the baseline — can’t confirm if it was met. Record a value.',
  needsBaseline: 'A Percent change target needs at least one reading to establish the baseline. Record a value.',
};

function dateStatus(state: DisplayState): { label: string; cls: string } {
  switch (state) {
    case 'provisional':
      return { label: 'Date TBD', cls: 'text-text-subtle' };
    case 'met':
      return { label: 'Met', cls: 'text-success' };
    case 'missed':
      return { label: 'Missed', cls: 'text-danger' };
    case 'resultUnknown':
      return { label: 'passed', cls: 'text-warning' };
    default:
      return { label: 'Upcoming', cls: 'text-brand' };
  }
}

export function IssuePanel({
  issueId = '10048',
  usePanel = usePanelData,
}: {
  issueId?: string;
  usePanel?: UsePanel;
}) {
  const { data, pending, error, busy, save, remove, record } = usePanel(issueId);

  const groups = useMemo(() => {
    if (!data) return [];
    const byRel = new Map<PanelRowDto['relationship'], PanelRowDto[]>();
    for (const row of data.rows) {
      const list = byRel.get(row.relationship) ?? [];
      list.push(row);
      byRel.set(row.relationship, list);
    }
    return [...byRel.entries()].sort(
      (a, b) => GROUP_META[a[0]].order - GROUP_META[b[0]].order,
    );
  }, [data]);

  if (error) return <div className="p-4 text-danger">Failed to load KPIs: {error}</div>;
  if (pending || !data) return <div className="p-4 text-text-subtle">Loading KPIs…</div>;

  // This issue IS a KPI (it lives in the KPI space, Feature 04): render ONLY the
  // single-KPI chart — no group list, no "Set a KPI target" form. Authoring
  // nested KPIs happens on the Timeline's add-child, not here.
  if (data.kpiView) {
    return <KpiView node={data.kpiView.node} today={data.kpiView.today} onRecord={record} />;
  }

  const tracked = data.rows.filter((r) => r.relationship !== 'onParentNotTracked');
  const isEmpty = tracked.length === 0;
  const noCatalog = data.catalog.length === 0;
  const currentValueOf = (kpiId: string) =>
    data.catalog.find((c) => c.id === kpiId)?.currentValue ?? null;

  return (
    <div className="max-w-xl p-4 text-text">
      {busy && <div className="mb-3 text-xs text-text-subtle">saving…</div>}

      {isEmpty && !noCatalog && (
        <p className="mb-3 rounded border border-dashed border-border p-3 text-sm text-text-subtle">
          No KPIs tracked on this issue yet. Associate one below.
        </p>
      )}

      {groups.map(([rel, rows]) => (
        <div key={rel} className="mb-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            {GROUP_META[rel].title}
          </div>
          {rows.map((row) =>
            row.relationship === 'onParentNotTracked' ? (
              <TrackThisRow key={row.kpiId} row={row} onTrack={save} />
            ) : (
              <TrackedRow
                key={row.kpiId}
                row={row}
                issueKey={data.issueKey}
                issueDueDate={data.issueDueDate}
                issueDueRolledUp={data.issueDueRolledUp}
                currentValue={currentValueOf(row.kpiId)}
                onRemove={remove}
                onSave={save}
              />
            ),
          )}
        </div>
      ))}

      {noCatalog ? (
        <p className="rounded border border-dashed border-border p-3 text-sm text-text-subtle">
          KPIs are not defined yet. You must first{' '}
          <button
            type="button"
            className="text-brand underline"
            onClick={() => void openKpiTimeline()}
          >
            define a KPI
          </button>
          .
        </p>
      ) : (
        <AssociateForm
          catalog={data.catalog}
          existing={data.rows}
          issueDueDate={data.issueDueDate}
          issueDueRolledUp={data.issueDueRolledUp}
          onSave={save}
        />
      )}
    </div>
  );
}

function TrackedRow({
  row,
  issueKey,
  issueDueDate,
  issueDueRolledUp,
  currentValue,
  onRemove,
  onSave,
}: {
  row: PanelRowDto;
  issueKey: string;
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
  currentValue: number | null;
  onRemove: (kpiId: string) => void;
  onSave: (a: Assignment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.target === null ? '' : String(row.target));
  const [targetType, setTargetType] = useState<TargetType>(row.targetType ?? 'absolute');
  const [due, setDue] = useState<DueTiming>(row.dueTiming ?? DEFAULT_DUE);

  const confirm = () => {
    const num = value.trim() === '' ? null : Number(value.replace(/,/g, ''));
    if (num !== null && Number.isNaN(num)) return;
    if (due.mode === 'absolute' && !isIsoDate(due.absolute)) return;
    onSave(buildAssignment(row, { target: num, targetType, due, start: row.start }));
    setEditing(false);
  };

  if (!editing) {
    return (
      <SavedTargetCard
        row={row}
        issueKey={issueKey}
        onEdit={() => setEditing(true)}
        onRemove={() => onRemove(row.kpiId)}
      />
    );
  }

  return (
    <div className="mb-2 rounded border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-text-subtle">{row.unit}</span>
        {row.direction && (
          <span className={row.direction === 'increase' ? 'text-xs text-success' : 'text-xs text-danger'}>
            {directionGlyph(row.direction)}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button className="text-xs text-brand" onClick={confirm}>
            ✓ Save
          </button>
          <button className="text-xs text-text-subtle" onClick={() => setEditing(false)}>
            ✕ Cancel
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <TargetValueEditor
          targetType={targetType}
          value={value}
          unit={row.unit}
          currentValue={currentValue}
          onChange={(next) => {
            setTargetType(next.targetType);
            setValue(next.value);
          }}
        />
        <TargetDateEditor
          value={due}
          issueDueDate={issueDueDate}
          issueDueRolledUp={issueDueRolledUp}
          onChange={setDue}
        />
      </div>
    </div>
  );
}

/** Saved-target card — value row + date row, status pill, warnings, Edit/Remove (FR-26…28). */
function SavedTargetCard({
  row,
  issueKey,
  onEdit,
  onRemove,
}: {
  row: PanelRowDto;
  issueKey: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const state = row.displayState;
  const pill = state ? PILL[state] : null;
  const isPercent = row.targetType === 'delta';

  const valueWarning = row.warning === 'staleBaseline' || row.warning === 'needsBaseline' ? row.warning : null;
  const dateWarning = row.warning === 'unconfirmedResult' ? row.warning : null;

  const dateMark = state === 'projected' || state === 'needsBaseline' ? '~' : '';
  const ds = state ? dateStatus(state) : { label: '', cls: '' };

  return (
    <div className="mb-2 rounded border border-border bg-surface p-3">
      {/* header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="font-medium text-text">{row.name}</span>
        <span className="text-xs text-text-subtle">{row.unit}</span>
        {row.direction && (
          <span className={row.direction === 'increase' ? 'text-xs text-success' : 'text-xs text-danger'}>
            {directionGlyph(row.direction)}
          </span>
        )}
        {pill && (
          <span
            className={`ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold ${pill.cls}`}
          >
            {pill.label}
          </span>
        )}
      </div>

      {/* target value row */}
      <div className="mb-2.5">
        <div className="text-sm font-medium text-text">Target value</div>
        <div className="text-sm">
          {isPercent ? (
            <>
              <b className="font-mono text-text">{fmtPercent(row.target)}</b>{' '}
              <span className="text-text-subtle">Percent change</span>
            </>
          ) : (
            <>
              <b className="font-mono text-text">{fmtNum(row.target)}</b>{' '}
              <span className="text-text-subtle">{row.unit} · Absolute value</span>
            </>
          )}
        </div>
        {isPercent && <ValueNote row={row} />}
        {valueWarning && (
          <div className="mt-1.5 rounded border border-border px-2 py-1 text-[11px] leading-snug text-warning">
            ⚠ {WARNING_COPY[valueWarning]}
          </div>
        )}
      </div>

      {/* target date row */}
      <div className="border-t border-border pt-2.5">
        <div className="text-sm font-medium text-text">Target date</div>
        <div className="text-sm">
          {row.dueTiming?.mode === 'relative' ? (
            <>
              <b className="text-text">{offsetPhrase(row.dueTiming.offsetMonths)}</b>{' '}
              <span className="text-text-subtle">
                ·{' '}
                <span className="font-mono">
                  {row.targetDate?.pending ? 'pending' : `${dateMark}${row.targetDate?.date ?? '—'}`}
                </span>
              </span>
            </>
          ) : (
            <>
              <b className="font-mono text-text">{row.targetDate?.date ?? '—'}</b>{' '}
              <span className="text-text-subtle">Fixed date</span>
            </>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-text-subtle">
          <span aria-hidden="true">↳</span>{' '}
          {row.dueDate
            ? `${row.dueDateRolledUp ? 'Rolled up due date' : 'Due date'} ${row.dueDate}`
            : `${issueKey} has no date yet`}{' '}
          · <span className={`font-semibold ${ds.cls}`}>{ds.label}</span>
        </p>
        {dateWarning && (
          <div className="mt-1.5 rounded border border-border px-2 py-1 text-[11px] leading-snug text-warning">
            ⚠ {WARNING_COPY[dateWarning]}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="mt-2.5 flex justify-end gap-3">
        <button className="text-xs font-medium text-text-subtle hover:text-brand" onClick={onEdit}>
          Edit
        </button>
        <button className="text-xs font-medium text-text-subtle hover:text-danger" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

/** The `↳` resolved-value note beneath the value row of a saved percent target. */
function ValueNote({ row }: { row: PanelRowDto }) {
  const rv = row.resolvedValue;
  const state = row.displayState;
  if (!rv || !state) return null;

  if (state === 'needsBaseline') {
    return (
      <p className="mt-0.5 text-[12px] leading-snug text-text-subtle">
        <span aria-hidden="true">↳</span>{' '}
        <span className="font-semibold text-warning">needs a baseline reading</span> — no measurements yet
      </p>
    );
  }

  const baseline = fmtNum(rv.baseline);
  const target = fmtNum(rv.value);

  if (state === 'met' || state === 'missed' || state === 'resultUnknown') {
    const actualCls = state === 'met' ? 'text-success' : state === 'missed' ? 'text-danger' : 'text-text-subtle';
    return (
      <p className="mt-0.5 text-[12px] leading-snug text-text-subtle">
        <span aria-hidden="true">↳</span> baselined <b className="text-text">{baseline}</b> → target{' '}
        <b className="text-text">{target}</b> · actual{' '}
        <b className={actualCls}>{row.actual === null ? '—' : fmtNum(row.actual)}</b>
      </p>
    );
  }

  if (rv.provisional) {
    return (
      <p className="mt-0.5 text-[12px] leading-snug text-text-subtle">
        <span aria-hidden="true">↳</span> baseline (provisional from {rv.baselineFrom ?? '—'}){' '}
        <b className="text-text">≈ {baseline}</b> → targeting <b className="text-text">≈ {target}</b>
      </p>
    );
  }

  return (
    <p className="mt-0.5 text-[12px] leading-snug text-text-subtle">
      <span aria-hidden="true">↳</span> baselined <b className="text-text">{baseline}</b> → targeting{' '}
      <b className="text-text">{target}</b>
    </p>
  );
}

function TrackThisRow({
  row,
  onTrack,
}: {
  row: PanelRowDto;
  onTrack: (a: Assignment) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-dashed border-border p-3">
      <span className="text-sm text-text-subtle">{row.name}</span>
      <button
        className="ml-auto text-xs text-brand"
        onClick={() => onTrack(buildAssignment(row, { target: null, targetType: 'absolute', due: DEFAULT_DUE, start: null }))}
      >
        + Track this
      </button>
    </div>
  );
}

function AssociateForm({
  catalog,
  existing,
  issueDueDate,
  issueDueRolledUp,
  onSave,
}: {
  catalog: CatalogEntryDto[];
  existing: PanelRowDto[];
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
  onSave: (a: Assignment) => void;
}) {
  const trackedIds = new Set(existing.filter((r) => r.relationship !== 'onParentNotTracked').map((r) => r.kpiId));
  const [kpiId, setKpiId] = useState('');
  const [value, setValue] = useState('');
  const [due, setDue] = useState<DueTiming>(DEFAULT_DUE);
  const [targetType, setTargetType] = useState<TargetType>('absolute');

  const options = catalog.filter((c) => !trackedIds.has(c.id));
  const selected = catalog.find((c) => c.id === kpiId);

  const submit = () => {
    if (!kpiId) return;
    const num = value.trim() === '' ? null : Number(value.replace(/,/g, ''));
    if (num !== null && Number.isNaN(num)) return;
    if (due.mode === 'absolute' && !isIsoDate(due.absolute)) return;
    onSave({
      kpiId,
      inheritFromParent: false,
      target: num,
      targetType,
      timing: { start: null, due },
      updatedBy: 'me',
      updatedAt: Date.now(),
    });
    setKpiId('');
    setValue('');
    setTargetType('absolute');
    setDue(DEFAULT_DUE);
  };

  return (
    <div className="rounded border border-dashed border-border p-3">
      <div className="mb-2 text-sm font-medium text-text-subtle">Set a KPI target</div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-text-subtle">
          KPI
          <select
            className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
            value={kpiId}
            onChange={(e) => setKpiId(e.target.value)}
          >
            <option value="">Choose KPI…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id} style={{ paddingLeft: (o.depth ?? 0) * 12 }}>
                {'\u00A0\u00A0'.repeat(o.depth ?? 0)}
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <TargetValueEditor
          targetType={targetType}
          value={value}
          unit={selected?.unit ?? ''}
          currentValue={selected?.currentValue ?? null}
          onChange={(next) => {
            setTargetType(next.targetType);
            setValue(next.value);
          }}
        />

        <TargetDateEditor
          value={due}
          issueDueDate={issueDueDate}
          issueDueRolledUp={issueDueRolledUp}
          onChange={setDue}
        />

        <div className="flex gap-2">
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={submit}
          >
            Set KPI target
          </button>
        </div>
      </div>
    </div>
  );
}

// ── shared editors ───────────────────────────────────────────────────────────
const DEFAULT_DUE: DueTiming = {
  mode: 'relative',
  absolute: null,
  anchor: 'issueDueDate',
  offsetMonths: 0,
};

function isIsoDate(v: string | null): v is string {
  return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Shared value/type editor (FR-1/FR-1a/FR-2): target value TYPE (Absolute value
 * | Percent change) + an adaptive value input (a `%` suffix + sign when percent)
 * + a live resolved-value note. Mirrors `TargetDateEditor`, used by BOTH the
 * Associate form and the inline edit path so target type is editable, not just
 * set at creation.
 */
function TargetValueEditor({
  targetType,
  value,
  unit,
  currentValue,
  onChange,
}: {
  targetType: TargetType;
  value: string;
  unit: string;
  currentValue: number | null;
  onChange: (next: { targetType: TargetType; value: string }) => void;
}) {
  const isPercent = targetType === 'delta';
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-text-subtle">
          Target value type
          <select
            className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
            value={targetType}
            onChange={(e) => onChange({ targetType: e.target.value as TargetType, value })}
          >
            <option value="absolute">Absolute value</option>
            <option value="delta">Percent change</option>
          </select>
        </label>
        <label className="text-xs text-text-subtle">
          Target value
          <div className="relative mt-0.5">
            <input
              className={`w-full rounded border border-border px-2 py-1 text-sm ${isPercent ? 'pr-6' : ''}`}
              value={value}
              placeholder={isPercent ? 'e.g. +1' : 'e.g. 250'}
              onChange={(e) => onChange({ targetType, value: e.target.value })}
            />
            {isPercent && (
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-text-subtle">
                %
              </span>
            )}
          </div>
        </label>
      </div>
      {isPercent && <LiveValueNote value={value} unit={unit} currentValue={currentValue} />}
    </div>
  );
}

/** Authoring `↳` note for a percent target: current value → resolved target (FR-5). */
function LiveValueNote({
  value,
  unit,
  currentValue,
}: {
  value: string;
  unit: string;
  currentValue: number | null;
}) {
  const pct = Number(value.replace(/,/g, ''));
  if (value.trim() === '' || Number.isNaN(pct)) {
    return (
      <p className="mt-1 text-[11px] text-text-subtle">
        <span aria-hidden="true">↳</span> Applied to the KPI’s value at the due date.
      </p>
    );
  }
  if (currentValue === null) {
    return (
      <p className="mt-1 text-[11px] text-text-subtle">
        <span aria-hidden="true">↳</span> {fmtPercent(pct)} of the KPI’s value at the due date.
      </p>
    );
  }
  const target = currentValue * (1 + pct / 100);
  return (
    <p className="mt-1 text-[11px] text-text-subtle">
      <span aria-hidden="true">↳</span> Current value: {fmtNum(currentValue)} {unit} → targeting{' '}
      <b className="text-text">
        {fmtNum(target)} {unit}
      </b>
    </p>
  );
}

/** Authoring `↳` note for the date: rolled-up due date → resolved target date (FR-5). */
function LiveDateNote({
  due,
  issueDueDate,
  issueDueRolledUp,
}: {
  due: DueTiming;
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
}) {
  if (due.mode !== 'relative') return null;
  const label = issueDueRolledUp ? 'Rolled up due date' : 'Due date';
  if (issueDueDate === null) {
    return (
      <p className="mt-1 text-[11px] text-text-subtle">
        <span aria-hidden="true">↳</span> {label}: pending → targeting <b className="text-text">TBD</b>
      </p>
    );
  }
  const target = addMonths(issueDueDate, due.offsetMonths);
  return (
    <p className="mt-1 text-[11px] text-text-subtle">
      <span aria-hidden="true">↳</span> {label}: {issueDueDate} → targeting <b className="text-text">{target}</b>
    </p>
  );
}

/**
 * Fixed-vs-relative target-date control (FR-3): a fixed date, or N months after
 * the issue's (rolled-up) due date. v1 offers only the `issueDueDate` anchor.
 *
 * Laid out as a two-column grid mirroring `TargetValueEditor` — a **Target date
 * type** select alongside the value field (**Target date** date-picker when
 * fixed, or a `[ N ] months` numeric input when relative) — plus the live `↳`
 * resolved-date note beneath (FR-5). Mock: issue-panel.html.
 */
function TargetDateEditor({
  value,
  issueDueDate,
  issueDueRolledUp,
  onChange,
}: {
  value: DueTiming;
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
  onChange: (d: DueTiming) => void;
}) {
  const isRelative = value.mode === 'relative';
  // Local text buffer for the offset so the field can hold a transient empty or
  // "-" state (a signed integer offset, FR-3) instead of snapping to 0 on every
  // keystroke. Resynced from the committed value on external changes (mode
  // switch, form submit reset) but NOT mid-edit, so a half-typed "-" survives.
  const [offsetText, setOffsetText] = useState(String(value.offsetMonths));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setOffsetText(String(value.offsetMonths));
  }, [value.offsetMonths]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-text-subtle">
          Target date type
          <select
            className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
            value={value.mode}
            onChange={(e) =>
              onChange(
                e.target.value === 'absolute'
                  ? { ...value, mode: 'absolute', absolute: value.absolute ?? '' }
                  : { ...value, mode: 'relative', anchor: 'issueDueDate' },
              )
            }
          >
            <option value="absolute">Fixed date</option>
            <option value="relative">Relative date</option>
          </select>
        </label>
        <label className="text-xs text-text-subtle">
          {isRelative ? 'Months after due date' : 'Target date'}
          <div className="relative mt-0.5">
            {isRelative ? (
              <>
                <input
                  type="number"
                  step={1}
                  className="w-full rounded border border-border px-2 py-1 pr-14 text-sm"
                  value={offsetText}
                  onFocus={() => {
                    editing.current = true;
                  }}
                  onBlur={() => {
                    editing.current = false;
                    setOffsetText(String(value.offsetMonths));
                  }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setOffsetText(raw);
                    const n = parseInt(raw, 10);
                    onChange({ ...value, offsetMonths: Number.isNaN(n) ? 0 : n });
                  }}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-text-subtle">
                  months
                </span>
              </>
            ) : (
              <input
                type="date"
                className="w-full rounded border border-border px-2 py-1 text-sm"
                value={value.absolute ?? ''}
                onChange={(e) => onChange({ ...value, absolute: e.target.value })}
              />
            )}
          </div>
        </label>
      </div>
      <LiveDateNote due={value} issueDueDate={issueDueDate} issueDueRolledUp={issueDueRolledUp} />
    </div>
  );
}

/** Build an assignment from a row, applying value/type/timing edits. */
function buildAssignment(
  row: PanelRowDto,
  edit: { target: number | null; targetType: TargetType; due: DueTiming; start: string | null },
): Assignment {
  return {
    kpiId: row.kpiId,
    inheritFromParent: false,
    target: edit.target,
    targetType: edit.targetType,
    timing: { start: edit.start, due: edit.due },
    updatedBy: 'me',
    updatedAt: Date.now(),
  };
}
