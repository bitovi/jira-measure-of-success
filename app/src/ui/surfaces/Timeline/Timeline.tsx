import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineData, type UseTimeline } from '@ui/data/useTimelineData/index.js';
import {
  quarterStartMs,
  type TimelineNodeDto,
  type TimelineReadingDto,
  type TimelineTargetDto,
} from '@domain/index.js';

/**
 * KPI Timeline v2 (Custom UI) — the KPI tree as a nested plan against a shared,
 * horizontally-scrollable date axis (Q5: 3-quarter default window, scroll to
 * pan). Sparklines of recorded readings, target diamonds classified
 * hit/missed/upcoming, drill-in to source issues, and a record-value modal.
 * Mock: specs/00-mocks/kpi-timeline-v2.html. Stories TL-1…TL-7.
 *
 * Data comes from an INJECTABLE loader hook (`useData`) — see usePanelData.ts.
 */
const LABEL_W = 300;
const QUARTER_PX = 220;
const PAD_R = 16;
const ROW_H = 44;
const ROW_H_EXPANDED = 232;
const PLOT_H_EXPANDED = 132;

interface FlatRow {
  node: TimelineNodeDto;
  hasChildren: boolean;
}

function fmtVal(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 });
}
function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return fmtVal(v);
}
function ms(iso: string): number {
  return new Date(iso).getTime();
}

export function Timeline({ useData = useTimelineData }: { useData?: UseTimeline }) {
  const { data, pending, error, record: recordValue } = useData();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalKpi, setModalKpi] = useState<TimelineNodeDto | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centeredRef = useRef(false);

  // Wide domain: 9 quarters centered on today; default view shows ~3 quarters
  // and the plot area scrolls horizontally to pan (Q5).
  const axis = useMemo(() => {
    const todayMs = data ? ms(data.today) : Date.now();
    const firstQ = addQuarters(quarterStartMs(todayMs), -4);
    const quarters = Array.from({ length: 9 }, (_, i) => {
      const startMs = addQuarters(firstQ, i);
      return { startMs, label: quarterLabel(startMs) };
    });
    const domainStart = firstQ;
    const domainEnd = addQuarters(firstQ, 9);
    const plotWidth = 9 * QUARTER_PX;
    const xOf = (iso: string) =>
      ((ms(iso) - domainStart) / (domainEnd - domainStart)) * plotWidth;
    return { quarters, domainStart, domainEnd, plotWidth, xOf, todayMs };
  }, [data]);

  // Center the scroll on today (previous quarter at the left edge) once.
  useEffect(() => {
    if (data && scrollRef.current && !centeredRef.current) {
      const prevQuarterStart = addQuarters(quarterStartMs(axis.todayMs), -1);
      const x = ((prevQuarterStart - axis.domainStart) / (axis.domainEnd - axis.domainStart)) * axis.plotWidth;
      scrollRef.current.scrollLeft = x;
      centeredRef.current = true;
    }
  }, [data, axis]);

  const flat = useMemo(() => {
    if (!data) return [];
    const rows: FlatRow[] = [];
    const walk = (nodes: TimelineNodeDto[]) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        rows.push({ node, hasChildren });
        if (hasChildren && !collapsed.has(node.id)) walk(node.children);
      }
    };
    walk(data.roots);
    return rows;
  }, [data, collapsed]);

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const record = (kpiId: string, date: string, value: number) => {
    recordValue(kpiId, date, value);
    setModalKpi(null);
  };

  if (error) return <div className="p-6 text-danger">Failed to load timeline: {error}</div>;
  if (pending || !data) return <div className="p-6 text-text-subtle">Loading timeline…</div>;
  if (flat.length === 0) return <div className="p-6 text-text-subtle">No KPIs to show yet.</div>;

  return (
    <div className="p-6 text-text">
      <h1 className="text-2xl font-semibold">KPI Timeline</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-subtle">
        The KPI tree as a nested plan. Each KPI shows recorded values as a sparkline; diamonds mark
        targets. Click a row's track to reveal the issues behind its targets; use + to record a value.
        Scroll horizontally to pan across quarters.
      </p>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <div ref={scrollRef} className="overflow-x-auto">
          <div style={{ width: LABEL_W + axis.plotWidth + PAD_R }}>
            {/* Header row: quarter labels */}
            <div className="flex border-b border-border bg-surface-sunken">
              <div
                className="sticky left-0 z-10 flex-none border-r border-border bg-surface-sunken px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                style={{ width: LABEL_W }}
              >
                KPI
              </div>
              <div className="relative flex-none" style={{ width: axis.plotWidth + PAD_R }}>
                {axis.quarters.map((q) => (
                  <div
                    key={q.startMs}
                    className="absolute top-0 border-l border-border py-2 pl-2 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                    style={{ left: axis.xOf(new Date(q.startMs).toISOString().slice(0, 10)) }}
                  >
                    {q.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Data rows */}
            {flat.map(({ node, hasChildren }) => (
              <TimelineRow
                key={node.id}
                node={node}
                hasChildren={hasChildren}
                collapsed={collapsed.has(node.id)}
                expanded={expanded.has(node.id)}
                axis={axis}
                today={data.today}
                onToggleCollapse={() => toggleCollapse(node.id)}
                onToggleExpand={() => toggleExpand(node.id)}
                onRecord={() => setModalKpi(node)}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-text-subtle">
        Diamonds mark targets · the red line is today · green/red = hit/missed · hollow purple =
        upcoming · click a row to see the issues behind its targets.
      </p>

      {modalKpi && (
        <RecordModal
          node={modalKpi}
          defaultDate={data.today}
          onCancel={() => setModalKpi(null)}
          onRecord={(date, value) => record(modalKpi.kpiId, date, value)}
        />
      )}
    </div>
  );
}

interface Axis {
  quarters: Array<{ startMs: number; label: string }>;
  domainStart: number;
  domainEnd: number;
  plotWidth: number;
  xOf: (iso: string) => number;
  todayMs: number;
}

function domainFor(node: TimelineNodeDto): { min: number; max: number } | null {
  const vals = node.readings.map((r) => r.value).concat(node.targets.map((t) => t.value));
  if (!vals.length) return null;
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function TimelineRow({
  node,
  hasChildren,
  collapsed,
  expanded,
  axis,
  today,
  onToggleCollapse,
  onToggleExpand,
  onRecord,
}: {
  node: TimelineNodeDto;
  hasChildren: boolean;
  collapsed: boolean;
  expanded: boolean;
  axis: Axis;
  today: string;
  onToggleCollapse: () => void;
  onToggleExpand: () => void;
  onRecord: () => void;
}) {
  const dom = domainFor(node);
  const rowH = expanded ? ROW_H_EXPANDED : ROW_H;
  const plotH = expanded ? PLOT_H_EXPANDED : ROW_H;
  // value → y (px within plot), inverted; padded to 20%..80% of plotH
  const yOf = (v: number): number => {
    if (!dom) return plotH / 2;
    const frac = (v - dom.min) / (dom.max - dom.min);
    return plotH * 0.2 + (1 - frac) * plotH * 0.6;
  };

  const todayX = axis.xOf(today);

  return (
    <div className="flex border-b border-border last:border-b-0">
      {/* Label cell (sticky) */}
      <div
        className="sticky left-0 z-10 flex flex-none items-center gap-2 border-r border-border bg-surface px-3"
        style={{ width: LABEL_W, height: rowH }}
      >
        <button
          className={`grid h-4 w-4 place-items-center text-[10px] text-text-subtle ${
            hasChildren ? '' : 'invisible'
          }`}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'expand' : 'collapse'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <span className="truncate text-sm font-semibold" style={{ paddingLeft: node.depth * 12 }}>
          {node.name}
        </span>
        <span className="flex-none text-xs text-text-subtle">{node.unit}</span>
        {node.direction && (
          <span className={node.direction === 'increase' ? 'text-[11px] text-success' : 'text-[11px] text-danger'}>
            {node.direction === 'increase' ? '▲' : '▼'}
          </span>
        )}
        <button
          className="ml-auto grid h-[22px] w-[22px] flex-none place-items-center rounded border border-border text-text-subtle hover:border-brand hover:text-brand"
          onClick={onRecord}
          aria-label="Record a value"
          title="Record a value"
        >
          +
        </button>
      </div>

      {/* Track cell */}
      <div
        className="relative flex-none cursor-pointer"
        style={{ width: axis.plotWidth + PAD_R, height: rowH }}
        onClick={onToggleExpand}
      >
        {/* quarter gridlines */}
        {axis.quarters.map((q) => (
          <div
            key={q.startMs}
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: axis.xOf(new Date(q.startMs).toISOString().slice(0, 10)) }}
          />
        ))}
        {/* today line */}
        <div
          className="absolute top-0 bottom-0 w-0 border-l border-dashed border-danger opacity-80"
          style={{ left: todayX }}
        />

        {/* y-axis labels when expanded */}
        {expanded && dom && (
          <>
            {[dom.max, dom.min].map((v, i) => (
              <div key={i}>
                <div
                  className={`absolute h-0 border-t border-dashed border-border ${
                    v === dom.min ? 'border-solid' : ''
                  }`}
                  style={{ left: 0, right: PAD_R, top: yOf(v) }}
                />
                <div
                  className="absolute left-0 w-11 -translate-y-1/2 text-right text-[10px] tabular-nums text-text-subtle"
                  style={{ top: yOf(v) }}
                >
                  {fmtAxis(v)}
                </div>
              </div>
            ))}
            <div className="absolute left-1 top-1 text-[9px] font-bold uppercase tracking-wide text-text-subtle">
              {node.unit}
            </div>
          </>
        )}

        {/* sparkline */}
        {node.readings.length === 0 ? (
          <span className="absolute left-12 top-1/2 -translate-y-1/2 text-[11px] text-text-subtle">
            No values yet — use + to add
          </span>
        ) : (
          <Sparkline readings={node.readings} axis={axis} yOf={yOf} plotH={plotH} />
        )}

        {/* target diamonds */}
        {node.targets.map((t, i) => (
          <Diamond key={i} target={t} node={node} axis={axis} y={yOf(t.value)} />
        ))}

        {/* expanded: source issue names */}
        {expanded &&
          (node.targets.length === 0 ? (
            <div className="absolute left-12 text-xs text-text-subtle" style={{ top: PLOT_H_EXPANDED + 8 }}>
              No targets set on issues for this KPI.
            </div>
          ) : (
            node.targets.map((t, i) => (
              <div
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-text"
                style={{ left: axis.xOf(t.date), top: PLOT_H_EXPANDED + 8 + (i % 3) * 16 }}
                title={`${t.source.type} ${t.source.issue}`}
              >
                <span className="font-semibold">{t.source.title}</span>
                <span className="text-text-subtle"> · {t.source.type} {t.source.issue}</span>
              </div>
            ))
          ))}
      </div>
    </div>
  );
}

function Sparkline({
  readings,
  axis,
  yOf,
  plotH,
}: {
  readings: TimelineReadingDto[];
  axis: Axis;
  yOf: (v: number) => number;
  plotH: number;
}) {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const points = sorted.map((r) => `${axis.xOf(r.date)},${yOf(r.value)}`).join(' ');
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={axis.plotWidth + PAD_R}
      height={plotH}
    >
      <polyline points={points} fill="none" stroke="#22a06b" strokeWidth={1.5} />
      {sorted.map((r, i) => (
        <circle
          key={i}
          cx={axis.xOf(r.date)}
          cy={yOf(r.value)}
          r={4}
          fill="#22a06b"
          stroke="#fff"
          strokeWidth={2}
        >
          <title>
            {fmtVal(r.value)} · {r.date}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function Diamond({
  target,
  node,
  axis,
  y,
}: {
  target: TimelineTargetDto;
  node: TimelineNodeDto;
  axis: Axis;
  y: number;
}) {
  const color =
    target.status === 'hit'
      ? 'bg-success'
      : target.status === 'missed'
        ? 'bg-danger'
        : 'border border-brand bg-surface';
  const statusLabel =
    target.status === 'hit' ? 'Target hit' : target.status === 'missed' ? 'Target missed' : 'Upcoming';
  return (
    <div
      className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${color}`}
      style={{ left: axis.xOf(target.date), top: y }}
      title={`Target ${fmtVal(target.value)} ${node.unit} — ${statusLabel} · due ${target.date} · Set on ${target.source.type} ${target.source.issue} — ${target.source.title}`}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function RecordModal({
  node,
  defaultDate,
  onCancel,
  onRecord,
}: {
  node: TimelineNodeDto;
  defaultDate: string;
  onCancel: () => void;
  onRecord: (date: string, value: number) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const num = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || Number.isNaN(num)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onRecord(date, num);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,30,66,0.54)]"
      onClick={onCancel}
    >
      <div
        className="w-[380px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold">Record a value</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {node.name} · {node.unit}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Date
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={value}
              placeholder="e.g. 1,300,000"
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={submit}
          >
            Record
          </button>
        </div>
      </div>
    </div>
  );
}

// ── axis helpers (px-domain quarter math) ───────────────────────────────────
function addQuarters(quarterStart: number, n: number): number {
  const d = new Date(quarterStart);
  const totalQ = d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3) + n;
  const year = Math.floor(totalQ / 4);
  const q = ((totalQ % 4) + 4) % 4;
  return Date.UTC(year, q * 3, 1);
}
function quarterLabel(quarterStart: number): string {
  const d = new Date(quarterStart);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}
