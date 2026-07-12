import { useEffect, useMemo, useState } from 'react';
import { call } from '@ui/bridge.js';
import type {
  Assignment,
  CatalogEntryDto,
  PanelData,
  PanelRowDto,
  TargetType,
} from '@domain/index.js';

/**
 * Issue panel (Custom UI) — on-issue KPI editor. KPIs are grouped by their
 * relationship to the parent (shared / only here / on parent, not tracked).
 * v1 authors INDEPENDENT targets (no value inheritance, Q11). Mock:
 * specs/00-mocks/issue.html. Stories IP-1, IP-4…IP-10.
 */
const GROUP_META: Record<PanelRowDto['relationship'], { title: string; order: number }> = {
  shared: { title: 'Shared with parent', order: 0 },
  onlyHere: { title: 'Only on this issue', order: 1 },
  onParentNotTracked: { title: 'On parent, not tracked here', order: 2 },
};

function fmtNum(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

function directionGlyph(direction: PanelRowDto['direction']): string {
  if (direction === 'increase') return '▲';
  if (direction === 'decrease') return '▼';
  return '';
}

export function IssuePanel({ issueId = '10048' }: { issueId?: string }) {
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await call<PanelData>('getPanelData', { issueId });
        if (alive) setData(d);
      } catch (e: unknown) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [issueId]);

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

  const remove = async (kpiId: string) => {
    setBusy(true);
    try {
      setData(await call<PanelData>('removeAssignment', { issueId, kpiId }));
    } finally {
      setBusy(false);
    }
  };

  const save = async (assignment: Assignment) => {
    setBusy(true);
    try {
      setData(await call<PanelData>('saveAssignment', { issueId, assignment }));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="p-4 text-danger">Failed to load KPIs: {error}</div>;
  if (!data) return <div className="p-4 text-text-subtle">Loading KPIs…</div>;

  const tracked = data.rows.filter((r) => r.relationship !== 'onParentNotTracked');
  const isEmpty = tracked.length === 0;

  return (
    <div className="max-w-xl p-4 text-text">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">KPIs</h2>
        <span className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-text-subtle">
          {tracked.length}
        </span>
        {busy && <span className="text-xs text-text-subtle">saving…</span>}
      </div>

      {isEmpty && (
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
              <TrackedRow key={row.kpiId} row={row} onRemove={remove} onSave={save} />
            ),
          )}
        </div>
      ))}

      <AssociateForm catalog={data.catalog} existing={data.rows} onSave={save} />

      <div className="mt-3 flex gap-2 rounded bg-surface-sunken p-3 text-xs text-text-subtle">
        <span className="grid h-4 w-4 flex-none place-items-center rounded-full bg-brand text-[10px] text-white">
          i
        </span>
        <span>
          KPIs are grouped by their relationship to the parent issue. Each issue sets its own targets;
          sharing a KPI with the parent links this issue's contribution into the parent's rollup.
        </span>
      </div>
    </div>
  );
}

function TrackedRow({
  row,
  onRemove,
  onSave,
}: {
  row: PanelRowDto;
  onRemove: (kpiId: string) => void;
  onSave: (a: Assignment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.target === null ? '' : String(row.target));
  const [date, setDate] = useState(row.targetDate?.date ?? '');

  const confirm = () => {
    const num = value.trim() === '' ? null : Number(value.replace(/,/g, ''));
    if (num !== null && Number.isNaN(num)) return;
    onSave(buildAssignment(row, { target: num, absoluteDate: date || null }));
    setEditing(false);
  };

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
          {editing ? (
            <>
              <button className="text-xs text-brand" onClick={confirm}>
                ✓ Save
              </button>
              <button className="text-xs text-text-subtle" onClick={() => setEditing(false)}>
                ✕ Cancel
              </button>
            </>
          ) : (
            <>
              <button className="text-xs text-brand" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="text-xs text-danger" onClick={() => onRemove(row.kpiId)}>
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-text-subtle">
            Target value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              value={value}
              placeholder="e.g. 250"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Target date
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              value={date}
              placeholder="YYYY-MM-DD"
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-text-subtle">Target value</div>
            <div className="font-mono">{fmtNum(row.target)}</div>
          </div>
          <div>
            <div className="text-xs text-text-subtle">Target date</div>
            <div className="font-mono">
              {row.targetDate?.pending ? (
                <span className="text-text-subtle">pending</span>
              ) : (
                row.targetDate?.date ?? '—'
              )}
            </div>
            {row.targetDate && !row.targetDate.pending && (
              <div className="text-[11px] text-text-subtle">{row.targetDate.source}</div>
            )}
          </div>
        </div>
      )}
    </div>
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
        onClick={() => onTrack(buildAssignment(row, { target: null, absoluteDate: null }))}
      >
        + Track this
      </button>
    </div>
  );
}

const DEFINE_NEW = '__define_new__';

function AssociateForm({
  catalog,
  existing,
  onSave,
}: {
  catalog: CatalogEntryDto[];
  existing: PanelRowDto[];
  onSave: (a: Assignment) => void;
}) {
  const trackedIds = new Set(existing.filter((r) => r.relationship !== 'onParentNotTracked').map((r) => r.kpiId));
  const [kpiId, setKpiId] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('absolute');

  // define-new fields
  const [defining, setDefining] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');

  const options = catalog.filter((c) => !trackedIds.has(c.id));

  const submit = () => {
    const chosen = defining ? slug(newName) : kpiId;
    if (!chosen) return;
    const num = target.trim() === '' ? null : Number(target.replace(/,/g, ''));
    if (num !== null && Number.isNaN(num)) return;
    onSave({
      kpiId: chosen,
      inheritFromParent: false,
      target: num,
      targetType,
      timing: {
        start: null,
        due: date
          ? { mode: 'absolute', absolute: date, anchor: 'issueDueDate', offsetMonths: 0 }
          : { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 },
      },
      updatedBy: 'me',
      updatedAt: Date.now(),
    });
    setKpiId('');
    setTarget('');
    setDate('');
    setDefining(false);
    setNewName('');
    setNewUnit('');
  };

  return (
    <div className="rounded border border-dashed border-border p-3">
      <div className="mb-2 text-sm font-medium text-text-subtle">Associate a KPI</div>
      <div className="flex flex-col gap-2">
        {defining ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-text-subtle">
              Name
              <input
                className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Churn Rate"
              />
            </label>
            <label className="text-xs text-text-subtle">
              Unit
              <input
                className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="e.g. %"
              />
            </label>
          </div>
        ) : (
          <label className="text-xs text-text-subtle">
            KPI
            <select
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              value={kpiId}
              onChange={(e) => {
                if (e.target.value === DEFINE_NEW) setDefining(true);
                else setKpiId(e.target.value);
              }}
            >
              <option value="">Choose KPI…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value={DEFINE_NEW}>— Define new… —</option>
            </select>
          </label>
        )}

        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-text-subtle">
            Target value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 250"
            />
          </label>
          <label className="text-xs text-text-subtle">
            Target type
            <select
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
            >
              <option value="absolute">absolute</option>
              <option value="delta">delta</option>
            </select>
          </label>
          <label className="text-xs text-text-subtle">
            Target date
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={submit}
          >
            {defining ? 'Create & associate' : 'Associate KPI'}
          </button>
          {defining && (
            <button
              className="rounded border border-border px-3 py-1.5 text-sm"
              onClick={() => setDefining(false)}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build an assignment from a row, applying value/date edits. */
function buildAssignment(
  row: PanelRowDto,
  edit: { target: number | null; absoluteDate: string | null },
): Assignment {
  return {
    kpiId: row.kpiId,
    inheritFromParent: false,
    target: edit.target,
    targetType: row.targetType ?? 'absolute',
    timing: {
      start: null,
      due: edit.absoluteDate
        ? { mode: 'absolute', absolute: edit.absoluteDate, anchor: 'issueDueDate', offsetMonths: 0 }
        : { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0 },
    },
    updatedBy: 'me',
    updatedAt: Date.now(),
  };
}
