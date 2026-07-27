import { useEffect, useMemo, useState } from 'react';
import { openIssue, openIssueNewTab, getSiteUrl } from '@ui/bridge.js';
import {
  axisDatesOf,
  buildAxis,
  computeHover,
  EditReadingModal,
  fmtVal,
  niceScale,
  PAD_R,
  PlotCrosshair,
  PlotTooltip,
  ProjectionLine,
  ProjectionModal,
  ReadingDot,
  RecordModal,
  Sparkline,
  TargetMarker,
  type HoverState,
} from '@ui/plot/index.js';
import { projectSeries, type TimelineNodeDto, type TimelineReadingDto, type TimelineTargetDto } from '@domain/index.js';

/**
 * KPI View (Custom UI) — the single-KPI chart shown on the Issue panel when the
 * issue IS a KPI (it lives in the KPI space, Feature 04). It draws the SAME plot
 * the KPI Timeline draws for one row — quarter date axis, recorded-value
 * sparkline, target markers, hover tooltip, record/edit modals — but promoted to
 * a tall (~600px) chart WITH a real vertical value axis (nice-tick gridlines +
 * labels). Everything plotted comes from the shared `@ui/plot` module; the only
 * difference from the Timeline row is the vertical scale (`niceScale`, not the
 * Timeline's `bandScale`) and the added trajectory line.
 * Mock: specs/04-kpi-view/kpi-view.html.
 */
const CHART_H = 600;
const GUTTER_W = 64;
/** Reserve pixels above the max tick / below the axis (for quarter labels). */
const SCALE_PAD = { top: 20, bottom: 32 };

export function KpiView({
  node,
  today,
  onRecord,
  onOpenIssue = openIssue,
  onOpenIssueNewTab = openIssueNewTab,
  loadSiteUrl = getSiteUrl,
}: {
  node: TimelineNodeDto;
  today: string;
  /** record (or, with value=null, delete) a reading on this KPI */
  onRecord: (kpiId: string, date: string, value: number | null) => void;
  onOpenIssue?: (issueKey: string) => void | Promise<void>;
  onOpenIssueNewTab?: (issueKey: string) => void | Promise<void>;
  loadSiteUrl?: () => Promise<string>;
}) {
  const [siteUrl, setSiteUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadSiteUrl().then((u) => {
      if (!cancelled) setSiteUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSiteUrl]);

  // Shared fit-to-range date axis + a nice-tick VALUE scale (the one genuine
  // difference from the Timeline row — see @ui/plot/scale.ts).
  const axis = useMemo(() => buildAxis(axisDatesOf(node), today), [node, today]);
  const scale = useMemo(() => niceScale(node, CHART_H, 5, SCALE_PAD), [node]);
  const yOf = scale.yOf;
  const todayX = axis.xOf(today);

  const [adding, setAdding] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<TimelineReadingDto | null>(null);
  const [projecting, setProjecting] = useState<TimelineTargetDto | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const sortedReadings = useMemo(
    () => [...node.readings].sort((a, b) => a.date.localeCompare(b.date)),
    [node.readings],
  );
  const latest = sortedReadings[sortedReadings.length - 1] ?? null;
  const datedTargets = useMemo(
    () => node.targets.filter((t): t is TimelineTargetDto & { date: string } => t.date !== null),
    [node.targets],
  );
  // The next upcoming target (on/after today), for the header stat chip.
  const nextTarget = useMemo(() => {
    const upcoming = datedTargets
      .filter((t) => t.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (upcoming[0]) return upcoming[0];
    const past = [...datedTargets].sort((a, b) => a.date.localeCompare(b.date));
    return past[past.length - 1] ?? null;
  }, [datedTargets, today]);

  // Recency-weighted forward projection of the recorded readings (null with < 2
  // readings — no trend to draw).
  const projection = useMemo(() => projectSeries(node.readings), [node.readings]);

  const record = (date: string, value: number | null) => {
    onRecord(node.kpiId, date, value);
    setAdding(null);
    setEditing(null);
  };

  // Click open space on a past/today date to record a value (KPI View doesn't
  // author targets — those live on the contributing work issues via the Timeline).
  const onPlotClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-diamond],[data-reading]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, axis.plotWidth));
    const t = axis.domainStart + (x / axis.plotWidth) * (axis.domainEnd - axis.domainStart);
    const dateISO = new Date(t).toISOString().slice(0, 10);
    if (dateISO <= today) setAdding({ date: dateISO });
  };

  const dirGlyph = node.direction === 'increase' ? '▲' : node.direction === 'decrease' ? '▼' : '';
  const href = node.issueKey
    ? siteUrl
      ? `${siteUrl}/browse/${node.issueKey}`
      : `/browse/${node.issueKey}`
    : undefined;

  return (
    <div className="p-4 text-text">
      {/* Header: KPI name (links to the KPI issue), unit · direction, Record a value */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {href ? (
          <a
            href={href}
            className="text-lg font-semibold text-brand hover:underline"
            title={`Open ${node.name} (${node.issueKey}) in Jira`}
            onClick={(e) => {
              e.preventDefault();
              void onOpenIssue(node.issueKey);
            }}
          >
            {node.name}
          </a>
        ) : (
          <span className="text-lg font-semibold">{node.name}</span>
        )}
        <span className="text-sm text-text-subtle">· {node.unit}</span>
        {dirGlyph && (
          <span className={node.direction === 'increase' ? 'text-sm text-success' : 'text-sm text-danger'}>
            {dirGlyph} {node.direction === 'increase' ? 'increase' : 'decrease'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {latest && (
            <span className="text-xs text-text-subtle">
              Latest <b className="text-text tabular-nums">{fmtVal(latest.value)}</b> {node.unit}
            </span>
          )}
          {nextTarget && (
            <span className="text-xs text-text-subtle">
              Next target <b className="text-text tabular-nums">{fmtVal(nextTarget.value)}</b> ·{' '}
              {nextTarget.date}
            </span>
          )}
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => setAdding({ date: today })}
          >
            Record a value
          </button>
        </div>
      </div>

      {/* Chart: sticky value-axis gutter + a scrolling quarter plot */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex">
          {/* Sticky Y-axis gutter — tick labels stay put while the plot scrolls. */}
          <div
            className="relative flex-none border-r border-border bg-surface"
            style={{ width: GUTTER_W, height: CHART_H }}
          >
            {scale.ticks.map((t) => (
              <div
                key={t.value}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-text-subtle"
                style={{ top: t.y }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {/* Scrolling plot column. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div
              className="relative cursor-pointer"
              style={{ width: axis.plotWidth + PAD_R, height: CHART_H }}
              onClick={onPlotClick}
              onMouseMove={(e) => setHover(computeHover(node, axis, e, projection))}
              onMouseLeave={() => setHover(null)}
            >
              {/* horizontal nice-tick gridlines */}
              {scale.ticks.map((t) => (
                <div
                  key={t.value}
                  className="pointer-events-none absolute left-0 right-0 h-px bg-border"
                  style={{ top: t.y }}
                />
              ))}
              {/* vertical quarter gridlines + labels along the bottom */}
              {axis.quarters.map((q) => {
                const left = axis.xOf(new Date(q.startMs).toISOString().slice(0, 10));
                return (
                  <div key={q.startMs}>
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
                      style={{ left }}
                    />
                    <div
                      className="pointer-events-none absolute bottom-1 pl-2 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                      style={{ left }}
                    >
                      {q.label}
                    </div>
                  </div>
                );
              })}
              {/* today line */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-0 border-l border-dashed border-danger opacity-80"
                style={{ left: todayX }}
              />

              {/* dashed recency-weighted projection of the recorded trend */}
              {projection && (
                <ProjectionLine projection={projection} axis={axis} yOf={yOf} plotH={CHART_H} />
              )}

              {/* recorded-value sparkline */}
              {node.readings.length === 0 ? (
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-text-subtle">
                  No values recorded yet — click a past date to add one.
                </span>
              ) : (
                <Sparkline readings={node.readings} axis={axis} yOf={yOf} plotH={CHART_H} />
              )}

              {/* clickable reading dots */}
              {node.readings.map((r, i) => (
                <ReadingDot
                  key={i}
                  reading={r}
                  node={node}
                  axis={axis}
                  y={yOf(r.value)}
                  onEdit={setEditing}
                />
              ))}

              {/* target markers (dated only; undated render as a list below) */}
              {datedTargets.map((t, i) => (
                <TargetMarker
                  key={i}
                  target={t}
                  node={node}
                  axis={axis}
                  y={yOf(t.value)}
                  onOpenIssueNewTab={onOpenIssueNewTab}
                  siteUrl={siteUrl}
                />
              ))}

              {/* hover crosshair + floating value tooltip */}
              {hover && <PlotCrosshair x={hover.x} />}
              {hover && <PlotTooltip hover={hover} />}
            </div>
          </div>
        </div>
      </div>

      {/* Undated targets — a compact list below the chart (chips → projection). */}
      {node.undated.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Undated targets
          </div>
          <div className="flex flex-wrap gap-2">
            {node.undated.map((t, i) => (
              <button
                key={i}
                type="button"
                className="rounded border border-dashed border-text-subtle px-2 py-0.5 text-xs text-text-subtle hover:border-brand hover:text-brand"
                title={`Projected ${t.provisional ? '≈ ' : ''}${fmtVal(t.value)} ${node.unit} · date TBD — click for details`}
                onClick={() => setProjecting(t)}
              >
                {t.provisional ? '≈ ' : ''}
                {fmtVal(t.value)} {node.unit}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-subtle">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-success" /> recorded value
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-success opacity-70" />{' '}
          projection (recent trend)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rotate-45 bg-text-subtle" /> issue target
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-0 border-l border-dashed border-danger" /> today
        </span>
      </div>

      {adding && (
        <RecordModal
          node={node}
          defaultDate={adding.date}
          today={today}
          onCancel={() => setAdding(null)}
          onRecord={(date, value) => record(date, value)}
        />
      )}

      {editing && (
        <EditReadingModal
          node={node}
          reading={editing}
          onCancel={() => setEditing(null)}
          onSave={(value) => record(editing.date, value)}
          onDelete={() => record(editing.date, null)}
        />
      )}

      {projecting && (
        <ProjectionModal
          node={node}
          target={projecting}
          siteUrl={siteUrl}
          onClose={() => setProjecting(null)}
          onOpenIssueNewTab={onOpenIssueNewTab}
        />
      )}
    </div>
  );
}
