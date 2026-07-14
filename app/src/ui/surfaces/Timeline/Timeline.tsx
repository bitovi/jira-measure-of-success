import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineData, type UseTimeline, type TimelineActionError } from '@ui/data/useTimelineData/index.js';
import { openKpiSettings, openIssue, openIssueNewTab, getSiteUrl } from '@ui/bridge.js';
import {
  quarterStartMs,
  type AddTargetInput,
  type CreateKpiInput,
  type IssuePickerItem,
  type KpiDirection,
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
const HEADER_H = 33;

/** Stable empty set for the issue picker's default `excludedKeys`. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

interface FlatRow {
  node: TimelineNodeDto;
  hasChildren: boolean;
}

function fmtVal(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 });
}
function ms(iso: string): number {
  return new Date(iso).getTime();
}

// Value in effect at time t (ms): exact between two readings via linear
// interpolation; flat before the first / after the last reading. Mirrors the
// mock's valueDetailAt so hovering anywhere on a row reports a value.
function valueDetailAt(
  readings: TimelineReadingDto[],
  t: number,
): { value: number; kind: 'before' | 'interp' | 'after' } | null {
  if (!readings.length) return null;
  const pts = [...readings].sort((a, b) => ms(a.date) - ms(b.date));
  const times = pts.map((p) => ms(p.date));
  if (t <= times[0]) return { value: pts[0].value, kind: 'before' };
  if (t >= times[times.length - 1]) return { value: pts[pts.length - 1].value, kind: 'after' };
  for (let i = 0; i < pts.length - 1; i++) {
    if (t >= times[i] && t <= times[i + 1]) {
      const f = (t - times[i]) / (times[i + 1] - times[i]);
      return { value: pts[i].value + f * (pts[i + 1].value - pts[i].value), kind: 'interp' };
    }
  }
  return null;
}

interface HoverState {
  x: number; // px within the plot (for crosshair / date flag)
  clientX: number;
  clientY: number;
  flipX: boolean; // render tooltip to the left of the cursor near the right edge
  dateISO: string;
  primary: string;
  kindLabel: string | null;
  sub: string | null;
}

export function Timeline({
  useData = useTimelineData,
  onOpenSettings = openKpiSettings,
  onOpenIssue = openIssue,
  onOpenIssueNewTab = openIssueNewTab,
  loadSiteUrl = getSiteUrl,
}: {
  useData?: UseTimeline;
  onOpenSettings?: () => void | Promise<void>;
  onOpenIssue?: (issueKey: string) => void | Promise<void>;
  onOpenIssueNewTab?: (issueKey: string) => void | Promise<void>;
  loadSiteUrl?: () => Promise<string>;
}) {
  const { data, pending, error, actionError, clearActionError, record: recordValue, createKpi, searchIssues, addTarget } =
    useData();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ node: TimelineNodeDto; date: string } | null>(null);
  const [editing, setEditing] = useState<{ node: TimelineNodeDto; reading: TimelineReadingDto } | null>(
    null,
  );
  const [creating, setCreating] = useState<{ parentKpiId: string | null; parentName?: string } | null>(
    null,
  );
  const [addingTarget, setAddingTarget] = useState<{ node: TimelineNodeDto; date: string } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const centeredRef = useRef(false);
  const [siteUrl, setSiteUrl] = useState('');

  // Site base URL for absolute /browse links (so hover/middle-click/copy don't
  // resolve against the Custom UI iframe origin). Empty until resolved.
  useEffect(() => {
    let cancelled = false;
    void loadSiteUrl().then((u) => {
      if (!cancelled) setSiteUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSiteUrl]);

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

  // On load, land on the CURRENT quarter (previous quarter just to its left,
  // current + next visible) rather than the far-right end of the 9-quarter
  // domain (Q5 default window). Center the current quarter within the plot
  // viewport (excluding the sticky label column), clamped to the scroll range —
  // so a wide viewport (small max-scroll) doesn't pin us to the domain's end.
  useEffect(() => {
    const node = scrollRef.current;
    if (!data || !node || centeredRef.current) return;
    const plotX = (msVal: number) =>
      ((msVal - axis.domainStart) / (axis.domainEnd - axis.domainStart)) * axis.plotWidth;
    const currentQuarterStart = quarterStartMs(axis.todayMs);
    const currentMidX =
      (plotX(currentQuarterStart) + plotX(addQuarters(currentQuarterStart, 1))) / 2;
    const viewportCenter = node.clientWidth / 2;
    const maxScroll = node.scrollWidth - node.clientWidth;
    node.scrollLeft = Math.max(0, Math.min(currentMidX - viewportCenter, maxScroll));
    centeredRef.current = true;
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const record = (kpiId: string, date: string, value: number | null) => {
    recordValue(kpiId, date, value);
    setAdding(null);
    setEditing(null);
  };

  const submitCreate = (input: CreateKpiInput) => {
    createKpi(input);
    setCreating(null);
  };

  const submitTarget = (input: AddTargetInput) => {
    addTarget(input);
    setAddingTarget(null);
  };

  if (error) return <div className="p-6 text-danger">Failed to load timeline: {error}</div>;
  if (pending || !data) return <div className="p-6 text-text-subtle">Loading timeline…</div>;

  return (
    <div className="p-6 text-text">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="max-w-2xl text-sm text-text-subtle">
            The KPI tree as a nested plan. Each KPI shows recorded values as a sparkline; diamonds
            mark targets. Click an empty spot on a past date to record a value, click a future date
            to add a target, or click a recorded value to edit or delete it. Scroll horizontally to
            pan across quarters.
          </p>
        </div>
        <button
          className="mt-1 flex-none rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => setCreating({ parentKpiId: null })}
        >
          + Add KPI
        </button>
      </div>

      {actionError && (
        <ActionErrorBanner
          error={actionError}
          onDismiss={clearActionError}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex">
          {/* Fixed label column — the KPI names. Deliberately OUTSIDE the scroll
              container so only the quarter columns scroll horizontally. */}
          <div className="flex-none" style={{ width: LABEL_W }}>
            <div
              className="flex items-center border-b border-r border-border bg-surface-sunken px-3 text-xs font-semibold uppercase tracking-wide text-text-subtle"
              style={{ height: HEADER_H }}
            >
              KPI
            </div>
            {flat.length === 0 ? (
              <div className="border-r border-border px-3 py-6 text-sm text-text-subtle">
                No KPIs yet — use <strong className="text-text">+ Add KPI</strong> to create your
                first one.
              </div>
            ) : (
              flat.map(({ node, hasChildren }) => (
                <TimelineRowLabel
                  key={node.id}
                  node={node}
                  hasChildren={hasChildren}
                  collapsed={collapsed.has(node.id)}
                  onToggleCollapse={() => toggleCollapse(node.id)}
                  onRecord={() => setAdding({ node, date: data.today })}
                  onAddTarget={() => setAddingTarget({ node, date: data.today })}
                  onAddChild={() => setCreating({ parentKpiId: node.kpiId, parentName: node.name })}
                  onOpenIssue={onOpenIssue}
                  siteUrl={siteUrl}
                />
              ))
            )}
          </div>

          {/* Scrolling plot column — only the quarter columns pan horizontally. */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
            <div style={{ width: axis.plotWidth + PAD_R }}>
              {/* Header row: quarter labels */}
              <div
                className="relative border-b border-border bg-surface-sunken"
                style={{ height: HEADER_H }}
              >
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

              {/* Data rows */}
              {flat.map(({ node }) => (
                <TimelineRowTrack
                  key={node.id}
                  node={node}
                  axis={axis}
                  today={data.today}
                  onAddValue={(date) => setAdding({ node, date })}
                  onAddTarget={(date) => setAddingTarget({ node, date })}
                  onEditReading={(reading) => setEditing({ node, reading })}
                  onOpenIssueNewTab={onOpenIssueNewTab}
                  siteUrl={siteUrl}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-text-subtle">
        Diamonds mark targets · the red line is today · green/red = hit/missed · hollow purple =
        upcoming · click a recorded value to edit or delete it.
      </p>

      {adding && (
        <RecordModal
          node={adding.node}
          defaultDate={adding.date}
          today={data.today}
          onCancel={() => setAdding(null)}
          onRecord={(date, value) => record(adding.node.kpiId, date, value)}
        />
      )}

      {editing && (
        <EditReadingModal
          node={editing.node}
          reading={editing.reading}
          onCancel={() => setEditing(null)}
          onSave={(value) => record(editing.node.kpiId, editing.reading.date, value)}
          onDelete={() => record(editing.node.kpiId, editing.reading.date, null)}
        />
      )}

      {creating && (
        <CreateKpiModal
          parentName={creating.parentName}
          onCancel={() => setCreating(null)}
          onCreate={({ name, unit, direction }) =>
            submitCreate({ name, unit, direction, parentKpiId: creating.parentKpiId })
          }
        />
      )}

      {addingTarget && (
        <AddTargetModal
          node={addingTarget.node}
          defaultDate={addingTarget.date}
          searchIssues={searchIssues}
          onCancel={() => setAddingTarget(null)}
          onAdd={(issue, date, value) =>
            submitTarget({
              kpiId: addingTarget.node.kpiId,
              issueId: issue.id,
              issueKey: issue.key,
              issueType: issue.issueType,
              issueTypeIconUrl: issue.iconUrl,
              issueSummary: issue.summary,
              date,
              value,
            })
          }
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

function TimelineRowLabel({
  node,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onRecord,
  onAddTarget,
  onAddChild,
  onOpenIssue,
  siteUrl,
}: {
  node: TimelineNodeDto;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRecord: () => void;
  onAddTarget: () => void;
  onAddChild: () => void;
  onOpenIssue: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  return (
    <div
      className="group flex items-center gap-2 border-b border-r border-border bg-surface px-3 last:border-b-0"
      style={{ height: ROW_H }}
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
        {node.issueKey ? (
          <a
            href={siteUrl ? `${siteUrl}/browse/${node.issueKey}` : `/browse/${node.issueKey}`}
            className="truncate text-sm font-semibold text-brand hover:underline"
            style={{ paddingLeft: node.depth * 12 }}
            title={`Open ${node.name} (${node.issueKey}) in Jira`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onOpenIssue(node.issueKey);
            }}
          >
            {node.name}
          </a>
        ) : (
          <span className="truncate text-sm font-semibold" style={{ paddingLeft: node.depth * 12 }}>
            {node.name}
          </span>
        )}
        <span className="flex-none text-xs text-text-subtle">{node.unit}</span>
        {node.direction && (
          <span className={node.direction === 'increase' ? 'text-[11px] text-success' : 'text-[11px] text-danger'}>
            {node.direction === 'increase' ? '▲' : '▼'}
          </span>
        )}
        <button
          className="ml-auto grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onAddChild}
          aria-label="Add child KPI"
          title="Create child KPI"
        >
          <span className="text-[13px] leading-none">+</span>
        </button>
        <button
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onRecord}
          aria-label="Record a value"
          title="Record a value"
        >
          <span className="text-[13px] leading-none">●</span>
        </button>
        <button
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onAddTarget}
          aria-label="Add a target"
          title="Add a target"
        >
          <span className="text-[11px] leading-none">◇</span>
        </button>
    </div>
  );
}

function TimelineRowTrack({
  node,
  axis,
  today,
  onAddValue,
  onAddTarget,
  onEditReading,
  onOpenIssueNewTab,
  siteUrl,
}: {
  node: TimelineNodeDto;
  axis: Axis;
  today: string;
  onAddValue: (date: string) => void;
  onAddTarget: (date: string) => void;
  onEditReading: (reading: TimelineReadingDto) => void;
  onOpenIssueNewTab: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  const dom = domainFor(node);
  const plotH = ROW_H;
  // value → y (px within plot), inverted; padded to 20%..80% of plotH
  const yOf = (v: number): number => {
    if (!dom) return plotH / 2;
    const frac = (v - dom.min) / (dom.max - dom.min);
    return plotH * 0.2 + (1 - frac) * plotH * 0.6;
  };

  const todayX = axis.xOf(today);

  const [hover, setHover] = useState<HoverState | null>(null);

  // Hovering anywhere on the row track reports the value at the cursor's date —
  // the measured reading when close to its dot, otherwise a linear
  // interpolation between readings (mirrors the mock's crosshair + tooltip).
  const onTrackMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Target diamonds keep their own native tooltip — don't stack ours on top.
    if ((e.target as HTMLElement).closest('[data-diamond]')) {
      setHover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const x = Math.max(0, Math.min(rawX, axis.plotWidth));
    const t = axis.domainStart + (x / axis.plotWidth) * (axis.domainEnd - axis.domainStart);
    const dateISO = new Date(t).toISOString().slice(0, 10);

    let primary: string;
    let kindLabel: string | null;
    let sub: string | null;
    if (node.readings.length === 0) {
      primary = 'No values recorded yet';
      kindLabel = null;
      sub = null;
    } else {
      // Snap to a measured reading when the cursor is near its dot.
      let snap: TimelineReadingDto | null = null;
      let best = 8;
      for (const r of node.readings) {
        const d = Math.abs(axis.xOf(r.date) - rawX);
        if (d < best) {
          best = d;
          snap = r;
        }
      }
      if (snap) {
        primary = `${fmtVal(snap.value)} ${node.unit}`;
        kindLabel = 'measured';
        sub = snap.date;
      } else {
        const det = valueDetailAt(node.readings, t);
        if (!det || det.kind === 'before') {
          primary = '—';
          kindLabel = 'no reading yet';
          sub = dateISO;
        } else {
          primary = `~ ${fmtVal(det.value)} ${node.unit}`;
          kindLabel = det.kind === 'after' ? 'latest' : 'interpolated';
          sub = dateISO;
        }
      }
    }
    setHover({
      x,
      clientX: e.clientX,
      clientY: e.clientY,
      flipX: e.clientX > window.innerWidth - 220,
      dateISO,
      primary,
      kindLabel,
      sub,
    });
  };

  // Clicking the track adds a value: snap to a nearby recorded reading (edit /
  // delete it) or, on an empty past date, open the record modal pre-filled with
  // that date. Clicks on target diamonds and reading dots are handled by those
  // elements; a click that reaches the track is on open space.
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-diamond],[data-reading]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const x = Math.max(0, Math.min(rawX, axis.plotWidth));
    const t = axis.domainStart + (x / axis.plotWidth) * (axis.domainEnd - axis.domainStart);
    const dateISO = new Date(t).toISOString().slice(0, 10);
    // Near an existing target? Leave it to the diamond's own tooltip.
    if (node.targets.some((tg) => Math.abs(axis.xOf(tg.date) - rawX) < 8)) return;
    // Past/today opens the record-a-value modal; a future date opens the
    // add-a-target modal — both pre-filled with the clicked date.
    if (dateISO <= today) onAddValue(dateISO);
    else onAddTarget(dateISO);
  };

  return (
    <div className="group border-b border-border last:border-b-0">
      {/* Track cell */}
      <div
        className="relative cursor-pointer"
        style={{ width: axis.plotWidth + PAD_R, height: ROW_H }}
        onClick={onTrackClick}
        onMouseMove={onTrackMove}
        onMouseLeave={() => setHover(null)}
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

        {/* sparkline */}
        {node.readings.length === 0 ? (
          <span className="absolute left-12 top-1/2 -translate-y-1/2 text-[11px] text-text-subtle">
            No values yet — click a past date to add
          </span>
        ) : (
          <Sparkline readings={node.readings} axis={axis} yOf={yOf} plotH={plotH} />
        )}

        {/* clickable reading dots — click to edit or delete the value */}
        {node.readings.map((r, i) => (
          <ReadingDot key={i} reading={r} node={node} axis={axis} y={yOf(r.value)} onEdit={onEditReading} />
        ))}

        {/* target diamonds */}
        {node.targets.map((t, i) => (
          <Diamond
            key={i}
            target={t}
            node={node}
            axis={axis}
            y={yOf(t.value)}
            onOpenIssueNewTab={onOpenIssueNewTab}
            siteUrl={siteUrl}
          />
        ))}

        {/* hover: crosshair follows the cursor; a floating tooltip reports the
            value (measured / interpolated) at that date. */}
        {hover && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-brand opacity-60"
            style={{ left: hover.x }}
          />
        )}
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-[11px] text-text shadow-md"
          style={{
            left: hover.flipX ? undefined : hover.clientX + 14,
            right: hover.flipX ? window.innerWidth - hover.clientX + 14 : undefined,
            top: hover.clientY + 14,
          }}
          role="tooltip"
        >
          <span className="font-semibold tabular-nums">{hover.primary}</span>
          {hover.kindLabel && <span className="text-text-subtle"> · {hover.kindLabel}</span>}
          {hover.sub && <span className="text-text-subtle"> · {hover.sub}</span>}
        </div>
      )}
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
  // Purely presentational and click-through: the row track handles hover so a
  // tooltip shows the value anywhere across the row, not only on the dots.
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
        />
      ))}
    </svg>
  );
}

/**
 * A recorded value on the track. Rendered as a transparent, accessible hit
 * target over the sparkline dot so clicking a value opens the edit/delete modal
 * (the dot itself is drawn by the Sparkline, which is click-through).
 */
function ReadingDot({
  reading,
  node,
  axis,
  y,
  onEdit,
}: {
  reading: TimelineReadingDto;
  node: TimelineNodeDto;
  axis: Axis;
  y: number;
  onEdit: (reading: TimelineReadingDto) => void;
}) {
  return (
    <button
      type="button"
      data-reading
      className="absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full"
      style={{ left: axis.xOf(reading.date), top: y }}
      aria-label={`Edit value ${fmtVal(reading.value)} ${node.unit} on ${reading.date}`}
      title={`${fmtVal(reading.value)} ${node.unit} · ${reading.date} — click to edit or delete`}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(reading);
      }}
    />
  );
}

function Diamond({
  target,
  node,
  axis,
  y,
  onOpenIssueNewTab,
  siteUrl,
}: {
  target: TimelineTargetDto;
  node: TimelineNodeDto;
  axis: Axis;
  y: number;
  onOpenIssueNewTab: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  const [tip, setTip] = useState<{ clientX: number; clientY: number; flipX: boolean } | null>(null);
  const color =
    target.status === 'hit'
      ? 'bg-success'
      : target.status === 'missed'
        ? 'bg-danger'
        : 'border border-brand bg-surface';
  const statusLabel =
    target.status === 'hit' ? 'Target hit' : target.status === 'missed' ? 'Target missed' : 'Upcoming';

  const track = (e: React.MouseEvent) =>
    setTip({ clientX: e.clientX, clientY: e.clientY, flipX: e.clientX > window.innerWidth - 240 });

  const issueKey = target.source.issue;
  const href = siteUrl ? `${siteUrl}/browse/${issueKey}` : `/browse/${issueKey}`;

  return (
    <>
      {/* Larger transparent hit area centered on the diamond so the small target
          is easy to hover; the rotated square is the visible marker. Clicking
          it opens the work item that set the target in a NEW tab. No native
          `title` — the custom tooltip below carries the same info, and a title
          would render a second, overlapping browser tooltip. */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute z-20 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center"
        style={{ left: axis.xOf(target.date), top: y }}
        data-diamond
        aria-label={`Target ${fmtVal(target.value)} ${node.unit} due ${target.date} — ${statusLabel}. Open ${target.source.type} ${issueKey} in Jira (new tab)`}
        onMouseEnter={track}
        onMouseMove={track}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void onOpenIssueNewTab(issueKey);
        }}
      >
        <div className={`h-2.5 w-2.5 rotate-45 ${color}`} />
      </a>
      {tip && (
        <div
          className="pointer-events-none fixed z-50 max-w-[240px] whitespace-normal rounded border border-border bg-surface px-2 py-1 text-[11px] text-text shadow-md"
          style={{
            left: tip.flipX ? undefined : tip.clientX + 14,
            right: tip.flipX ? window.innerWidth - tip.clientX + 14 : undefined,
            top: tip.clientY + 14,
          }}
          role="tooltip"
        >
          <div>
            <span className="font-semibold tabular-nums">
              Target {fmtVal(target.value)} {node.unit}
            </span>
            <span className="text-text-subtle"> · {statusLabel}</span>
          </div>
          <div className="text-text-subtle">Due {target.date}</div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="text-text-subtle">Set on</span>
            {target.source.iconUrl && (
              <img
                src={target.source.iconUrl}
                alt={target.source.type}
                title={target.source.type}
                width={14}
                height={14}
                className="h-3.5 w-3.5 flex-none"
              />
            )}
            <span className="font-semibold">{target.source.title}</span>
          </div>
          <div className="mt-0.5 text-text-subtle">Click to open in Jira (new tab)</div>
        </div>
      )}
    </>
  );
}

function ActionErrorBanner({
  error,
  onDismiss,
  onOpenSettings,
}: {
  error: TimelineActionError;
  onDismiss: () => void;
  onOpenSettings: () => void | Promise<void>;
}) {
  const spaceNotSetUp = error.kind === 'space-not-set-up';
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-lg border border-danger bg-surface px-4 py-3 text-sm"
    >
      <div className="flex-1">
        <p className="font-semibold text-danger">
          {spaceNotSetUp ? 'KPI space isn’t set up' : 'Couldn’t save your change'}
        </p>
        <p className="mt-0.5 text-text-subtle">
          {spaceNotSetUp
            ? 'Create or select the project that stores your KPIs in Settings, then try again.'
            : error.message}
        </p>
        {spaceNotSetUp && (
          <button
            className="mt-2 rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => void onOpenSettings()}
          >
            Open Settings
          </button>
        )}
      </div>
      <button
        className="flex-none rounded px-2 py-1 text-text-subtle hover:text-text"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

function RecordModal({
  node,
  defaultDate,
  today,
  onCancel,
  onRecord,
}: {
  node: TimelineNodeDto;
  defaultDate: string;
  today: string;
  onCancel: () => void;
  onRecord: (date: string, value: number) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');
  const isFutureDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today;

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
              type="date"
              className="mt-0.5 h-9 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {isFutureDate && (
            <p role="alert" className="-mt-1 text-xs text-warning">
              This date is in the future. You can still record it, but the value
              hasn’t happened yet.
            </p>
          )}
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

/**
 * Edit or delete a recorded value. Readings are last-write-wins per date
 * (storage-model.md), so saving overwrites the value at this date and deleting
 * tombstones it — both keep a changelog entry rather than mutating history.
 */
function EditReadingModal({
  node,
  reading,
  onCancel,
  onSave,
  onDelete,
}: {
  node: TimelineNodeDto;
  reading: TimelineReadingDto;
  onCancel: () => void;
  onSave: (value: number) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(String(reading.value));

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
    onSave(num);
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
          <h2 className="text-base font-semibold">Edit value</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {node.name} · {node.unit} · {reading.date}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={value}
              placeholder="e.g. 1,300,000"
              autoFocus
              aria-label="Value"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center justify-between px-5 pb-4 pt-3">
          <button
            className="rounded border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-surface-sunken"
            onClick={onDelete}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
              onClick={submit}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateKpiModal({
  parentName,
  onCancel,
  onCreate,
}: {
  parentName?: string;
  onCancel: () => void;
  onCreate: (input: { name: string; unit: string; direction: KpiDirection | null }) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState<'increase' | 'decrease' | 'none'>('increase');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    if (name.trim() === '') return;
    onCreate({
      name: name.trim(),
      unit: unit.trim(),
      direction: direction === 'none' ? null : direction,
    });
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
          <h2 className="text-base font-semibold">New KPI</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {parentName ? (
              <>
                Nested under <strong className="text-text">{parentName}</strong>
              </>
            ) : (
              'A new top-level KPI'
            )}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Name
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={name}
              placeholder="e.g. Revenue"
              autoFocus
              aria-label="KPI name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Unit
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={unit}
              placeholder="e.g. USD"
              aria-label="KPI unit"
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Direction
            <select
              className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              value={direction}
              aria-label="KPI direction"
              onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease' | 'none')}
            >
              <option value="increase">Higher is better</option>
              <option value="decrease">Lower is better</option>
              <option value="none">No direction</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            onClick={submit}
            disabled={name.trim() === ''}
          >
            Create KPI
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Add a target to a KPI, held on a contributing work issue chosen from a
 * type-ahead issue picker (like Jira's Parent field). The target is due on an
 * absolute date, pre-filled from the clicked position on the timeline.
 */
function AddTargetModal({
  node,
  defaultDate,
  searchIssues,
  onCancel,
  onAdd,
}: {
  node: TimelineNodeDto;
  defaultDate: string;
  searchIssues: (query: string) => Promise<IssuePickerItem[]>;
  onCancel: () => void;
  onAdd: (issue: IssuePickerItem, date: string, value: number) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');
  const [issue, setIssue] = useState<IssuePickerItem | null>(null);

  // Each KPI target lives on a distinct contributing issue — one target per
  // (issue, KPI). Issues already targeting this KPI can't be picked again.
  const excludedKeys = useMemo(
    () => new Set(node.targets.map((t) => t.source.issue)),
    [node.targets],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const num = Number(value.replace(/,/g, ''));
  const valid =
    issue !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    value.trim() !== '' &&
    !Number.isNaN(num);

  const submit = () => {
    if (valid && issue) onAdd(issue, date, num);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,30,66,0.54)]"
      onClick={onCancel}
    >
      <div
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-lg bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold">Add target</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {node.name} · {node.unit}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Issue
            <IssueCombobox
              searchIssues={searchIssues}
              value={issue}
              onChange={setIssue}
              excludedKeys={excludedKeys}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Date
            <input
              type="date"
              className="mt-0.5 h-9 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Target value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={value}
              placeholder="e.g. 1,300,000"
              aria-label="Target value"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            onClick={submit}
            disabled={!valid}
          >
            Add target
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A type-ahead issue picker — a plain input + filtered dropdown wired to the
 * Jira issue-picker endpoint via `searchIssues`, mirroring how the native Parent
 * field behaves (debounced search, recents on focus, keyboard navigation). Once
 * an issue is chosen it collapses to a compact chip with a clear affordance.
 */
function IssueCombobox({
  searchIssues,
  value,
  onChange,
  excludedKeys,
}: {
  searchIssues: (query: string) => Promise<IssuePickerItem[]>;
  value: IssuePickerItem | null;
  onChange: (item: IssuePickerItem | null) => void;
  /** issue keys that already have a target for this KPI — shown but not selectable */
  excludedKeys?: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<IssuePickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const excluded = excludedKeys ?? EMPTY_KEYS;
  // Keyboard navigation + Enter operate over the selectable (non-excluded) rows.
  const selectable = items.filter((i) => !excluded.has(i.key));

  // Debounced search while the dropdown is open; the latest response wins.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const h = setTimeout(() => {
      void Promise.resolve(searchIssues(query)).then((res) => {
        if (cancelled) return;
        setItems(res);
        setActive(0);
        setLoading(false);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [query, open, searchIssues]);

  // Close the dropdown when clicking outside the control.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (item: IssuePickerItem) => {
    onChange(item);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, selectable.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && selectable[active]) {
        e.preventDefault();
        choose(selectable[active]);
      }
    }
  };

  if (value) {
    return (
      <div className="mt-0.5 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm">
        <span className="flex-none font-medium text-brand">{value.key}</span>
        <span className="truncate text-text-subtle">{value.summary}</span>
        <button
          type="button"
          className="ml-auto flex-none rounded px-1 text-text-subtle hover:text-text"
          aria-label="Clear selected issue"
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="relative mt-0.5" ref={rootRef}>
      <input
        className="w-full rounded border border-border px-2 py-1.5 text-sm"
        placeholder="Search issues by key or summary…"
        aria-label="Search for an issue"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
          role="listbox"
        >
          {loading && <li className="px-2 py-1.5 text-xs text-text-subtle">Searching…</li>}
          {!loading && items.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-text-subtle">No matching issues</li>
          )}
          {!loading &&
            items.map((item) => {
              if (excluded.has(item.key)) {
                return (
                  <li
                    key={item.key}
                    role="option"
                    aria-disabled="true"
                    aria-selected={false}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm opacity-50"
                  >
                    <span className="flex-none font-medium">{item.key}</span>
                    <span className="truncate text-text-subtle">{item.summary}</span>
                    <span className="ml-auto flex-none whitespace-nowrap text-[11px] text-text-subtle">
                      already has a target
                    </span>
                  </li>
                );
              }
              const i = selectable.indexOf(item);
              return (
                <li key={item.key} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${
                      i === active ? 'bg-surface-sunken' : ''
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    <span className="flex-none font-medium text-brand">{item.key}</span>
                    <span className="truncate text-text-subtle">{item.summary}</span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
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
