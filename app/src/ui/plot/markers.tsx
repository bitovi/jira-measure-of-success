import { useState } from 'react';
import type {
  Projection,
  TargetStatus,
  TimelineNodeDto,
  TimelineReadingDto,
  TimelineTargetDto,
} from '@domain/index.js';
import type { Axis } from './axis.js';
import { PAD_R } from './axis.js';
import { fmtVal } from './scale.js';
import type { HoverState } from './hover.js';
import { dimStyle, useIsDimmed } from './useKeyHighlight.js';
import { targetKeyKinds } from './keyKinds.js';
import { TargetTooltipBody } from './targetTooltip.js';
import { tooltipPlacement, type TooltipPlacement } from './tooltipPlacement.js';

/**
 * Recorded values + the projected trend are drawn in a neutral color so green
 * only ever means "target hit" (spec 08).
 */
export const SERIES_COLOR = 'var(--ds-icon, #44546f)';

/**
 * Total height of the error bar drawn through an estimate target (spec 08).
 * Rows must reserve at least half of it above/below the value range — see
 * `bandScaleOf` — so a target at the row's min/max isn't clipped.
 */
export const ERROR_BAR_H = 24;

/**
 * The plotted primitives shared by the KPI Timeline and the KPI View — the
 * recorded-value sparkline, the clickable reading dots, and the target markers
 * (source-issue type-icon silhouettes tinted by status). Every one is
 * parameterized by the axis + a pre-computed `y` (or a `yOf` mapper), so they
 * render identically at 60px (timeline row) or 600px (KPI View) with no branch.
 */

export function Sparkline({
  readings,
  axis,
  yOf,
  plotH,
  width,
}: {
  readings: TimelineReadingDto[];
  axis: Axis;
  yOf: (v: number) => number;
  plotH: number;
  /** SVG width; defaults to the full plot width + right padding. */
  width?: number;
}) {
  const dimmed = useIsDimmed(['recorded']);
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const points = sorted.map((r) => `${axis.xOf(r.date)},${yOf(r.value)}`).join(' ');
  // Purely presentational and click-through: the track handles hover so a
  // tooltip shows the value anywhere, not only on the dots.
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width ?? axis.plotWidth + PAD_R}
      height={plotH}
      style={dimStyle(dimmed)}
    >
      <polyline points={points} fill="none" style={{ stroke: SERIES_COLOR }} strokeWidth={1.5} />
      {sorted.map((r, i) => (
        <circle
          key={i}
          cx={axis.xOf(r.date)}
          cy={yOf(r.value)}
          r={4}
          style={{ fill: SERIES_COLOR, stroke: 'var(--ds-surface, #fff)' }}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

/**
 * The dashed forward-projection ray — the recency-weighted trend of the
 * recorded readings extended from the latest reading to the right edge of the
 * axis (`domainEnd`). Same neutral color as the sparkline so it reads as the
 * metric's projected continuation. Rendered only when a `projection` exists
 * (≥ 2 readings — see `projectSeries`). Shared by the Timeline and KPI View.
 */
export function ProjectionLine({
  projection,
  axis,
  yOf,
  plotH,
  width,
}: {
  projection: Projection;
  axis: Axis;
  yOf: (v: number) => number;
  plotH: number;
  width?: number;
}) {
  const dimmed = useIsDimmed(['projection']);
  const endISO = new Date(axis.domainEnd).toISOString().slice(0, 10);
  const x1 = axis.xOf(projection.anchorDate);
  const y1 = yOf(projection.anchorValue);
  const x2 = axis.xOf(endISO);
  const y2 = yOf(projection.at(endISO));
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width ?? axis.plotWidth + PAD_R}
      height={plotH}
      style={dimStyle(dimmed)}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        style={{ stroke: SERIES_COLOR }}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        opacity={0.7}
      />
    </svg>
  );
}

/**
 * A recorded value on the track — a transparent, accessible hit target over the
 * sparkline dot so clicking a value opens the edit/delete modal (the dot itself
 * is drawn by the Sparkline, which is click-through). With `editBlocked` (the
 * user can't record values, spec 10) the dot is disabled and its tooltip says why.
 */
export function ReadingDot({
  reading,
  node,
  axis,
  y,
  onEdit,
  editBlocked = null,
}: {
  reading: TimelineReadingDto;
  node: TimelineNodeDto;
  axis: Axis;
  y: number;
  onEdit: (reading: TimelineReadingDto) => void;
  editBlocked?: string | null;
}) {
  const value = `${fmtVal(reading.value)} ${node.unit}`;
  return (
    <button
      type="button"
      data-reading
      className={`absolute z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ${editBlocked ? 'cursor-default' : 'cursor-pointer'}`}
      style={{ left: axis.xOf(reading.date), top: y }}
      aria-label={editBlocked ? `Value ${value} on ${reading.date}` : `Edit value ${value} on ${reading.date}`}
      aria-disabled={editBlocked ? true : undefined}
      title={`${value} · ${reading.date} — ${editBlocked ?? 'click to edit or delete'}`}
      onClick={(e) => {
        // Swallow the click either way so it never reaches the track's add-value handler.
        e.stopPropagation();
        if (!editBlocked) onEdit(reading);
      }}
    />
  );
}

const STATUS_BG: Record<TargetStatus, string> = {
  hit: 'bg-success',
  missed: 'bg-danger',
  upcoming: 'bg-text-subtle',
};
const STATUS_TEXT: Record<TargetStatus, string> = {
  hit: 'text-success',
  missed: 'text-danger',
  upcoming: 'text-text-subtle',
};

const maskStyle = (url: string): React.CSSProperties => ({
  WebkitMaskImage: `url(${url})`,
  maskImage: `url(${url})`,
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
});

/**
 * The visible part of a target marker, shared by the plot and the key (spec 08):
 *  - the source issue's type icon tinted by status (green hit / red missed /
 *    gray upcoming), or a status diamond when no tintable icon is available;
 *  - a ✓ / ✕ badge on hit / missed so status doesn't rely on color alone;
 *  - an error bar behind the icon when the value is an estimate (≈) — a relative
 *    target whose baseline hasn't been recorded yet. Rows reserve room for it.
 *
 * Tint the icon via CSS mask ONLY for a same-origin `data:` URL, which is
 * guaranteed CORS-clean. Remote Atlassian icon hosts don't send CORS headers, so
 * a mask over them fails silently in the iframe (blank marker) — the backend
 * proxies remote icons into `data:` URLs (see jira.ts inlineIssueTypeIcons); if
 * that ever falls through, the diamond is drawn instead.
 */
export function TargetGlyph({
  status,
  provisional,
  iconUrl,
  barHeight = ERROR_BAR_H,
}: {
  status: TargetStatus;
  provisional: boolean;
  iconUrl?: string | null;
  barHeight?: number;
}) {
  const bg = STATUS_BG[status];
  const canTint = !!iconUrl && iconUrl.startsWith('data:');
  return (
    <span className="relative grid place-items-center">
      {provisional && (
        <svg
          aria-hidden="true"
          data-error-bar
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${STATUS_TEXT[status]}`}
          width={8}
          height={barHeight}
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
        >
          <line x1={4} y1={1} x2={4} y2={barHeight - 1} />
          <line x1={1} y1={1} x2={7} y2={1} />
          <line x1={1} y1={barHeight - 1} x2={7} y2={barHeight - 1} />
        </svg>
      )}
      {/* Surface-colored backing so the error bar passes behind the icon, not through it. */}
      <span className={`relative grid place-items-center ${provisional ? 'rounded-sm bg-surface p-px' : ''}`}>
        {canTint ? (
          <span className={`block h-4 w-4 ${bg}`} style={maskStyle(iconUrl)} />
        ) : (
          <span className={`block h-2.5 w-2.5 rotate-45 ${bg}`} />
        )}
        {status !== 'upcoming' && (
          <span
            aria-hidden="true"
            data-status-badge
            className={`absolute -bottom-1 -right-1 grid h-2.5 w-2.5 place-items-center rounded-full ${bg} text-[7px] font-bold leading-none text-surface ring-[1.5px] ring-surface`}
          >
            {status === 'hit' ? '✓' : '✕'}
          </span>
        )}
      </span>
    </span>
  );
}

export function TargetMarker({
  target,
  node,
  axis,
  y,
  onOpenIssueNewTab,
  siteUrl,
}: {
  target: TimelineTargetDto & { date: string };
  node: TimelineNodeDto;
  axis: Axis;
  y: number;
  onOpenIssueNewTab: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  const [tip, setTip] = useState<{ clientY: number; place: TooltipPlacement } | null>(null);
  const dimmed = useIsDimmed(targetKeyKinds(target));
  const statusLabel =
    target.status === 'hit' ? 'Target hit' : target.status === 'missed' ? 'Target missed' : 'Upcoming';

  const track = (e: React.MouseEvent) =>
    setTip({ clientY: e.clientY, place: tooltipPlacement(e.clientX, window.innerWidth) });

  const issueKey = target.source.issue;
  const href = siteUrl ? `${siteUrl}/browse/${issueKey}` : `/browse/${issueKey}`;

  return (
    <>
          {/* Larger transparent hit area centered on the marker so the small target
            is easy to hover; the visible marker is a `TargetGlyph` (status-tinted
            issue icon or diamond, ✓/✕ badge, error bar for estimates). Clicking it opens
            the work item that set the target in a NEW tab. No native
          `title` — the custom tooltip below carries the same info, and a title
          would render a second, overlapping browser tooltip. */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute z-20 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-fade-in cursor-pointer place-items-center"
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
        {/* Dim on an inner element: the link's fade-in animation (fill-mode both)
            would otherwise override an inline opacity. */}
        <span data-marker-glyph className="grid place-items-center" style={dimStyle(dimmed)}>
          <TargetGlyph status={target.status} provisional={target.provisional} iconUrl={target.source.iconUrl} />
        </span>
      </a>
      {tip && (
        <div
          className="pointer-events-none fixed z-50 w-max whitespace-normal rounded border border-border bg-surface px-2.5 py-2 text-xs text-text shadow-md"
          style={{ ...tip.place, top: tip.clientY + 14 }}
          role="tooltip"
        >
          <TargetTooltipBody target={target} node={node} />
        </div>
      )}
    </>
  );
}

/** The vertical crosshair line that follows the cursor across a plot track. */
export function PlotCrosshair({ x, height }: { x: number; height?: number }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-px bg-brand opacity-60"
      style={{ left: x, height: height ?? undefined, bottom: height ? undefined : 0 }}
    />
  );
}

/** The floating value tooltip shown while hovering a plot track. */
export function PlotTooltip({ hover }: { hover: HoverState }) {
  return (
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
  );
}

