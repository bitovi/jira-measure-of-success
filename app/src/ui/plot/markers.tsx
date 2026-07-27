import { useState } from 'react';
import type { Projection, TimelineNodeDto, TimelineReadingDto, TimelineTargetDto } from '@domain/index.js';
import type { Axis } from './axis.js';
import { PAD_R } from './axis.js';
import { fmtVal } from './scale.js';
import type { HoverState } from './hover.js';

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
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const points = sorted.map((r) => `${axis.xOf(r.date)},${yOf(r.value)}`).join(' ');
  // Purely presentational and click-through: the track handles hover so a
  // tooltip shows the value anywhere, not only on the dots.
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width ?? axis.plotWidth + PAD_R}
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
 * The dashed forward-projection ray — the recency-weighted trend of the
 * recorded readings extended from the latest reading to the right edge of the
 * axis (`domainEnd`). Same dashed green as the sparkline so it reads as the
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
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#22a06b"
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
 * is drawn by the Sparkline, which is click-through).
 */
export function ReadingDot({
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
  const [tip, setTip] = useState<{ clientX: number; clientY: number; flipX: boolean } | null>(null);
  // Status colors the marker: green = hit, red = missed, gray = upcoming.
  // A provisional (not-yet-baselined) estimate is rendered hollow/dashed (FR-23).
  const color = target.status === 'hit' ? 'bg-success' : target.status === 'missed' ? 'bg-danger' : 'bg-text-subtle';
  const statusLabel =
    target.status === 'hit' ? 'Target hit' : target.status === 'missed' ? 'Target missed' : 'Upcoming';

  const track = (e: React.MouseEvent) =>
    setTip({ clientX: e.clientX, clientY: e.clientY, flipX: e.clientX > window.innerWidth - 240 });

  const issueKey = target.source.issue;
  const href = siteUrl ? `${siteUrl}/browse/${issueKey}` : `/browse/${issueKey}`;
  const iconUrl = target.source.iconUrl;
  // Tint the issue-type icon via CSS mask ONLY for a same-origin `data:` URL,
  // which is guaranteed CORS-clean. Remote Atlassian icon hosts don't send CORS
  // headers, so a mask over them fails silently in the iframe (blank marker) —
  // the backend proxies remote icons into `data:` URLs (see jira.ts
  // inlineIssueTypeIcons); if that ever falls through, we render the status
  // diamond instead of an invisible or full-color marker.
  const canTint = !!iconUrl && iconUrl.startsWith('data:');

  return (
    <>
          {/* Larger transparent hit area centered on the marker so the small target
            is easy to hover; the visible marker is either a status-tinted issue
            icon silhouette or, when no icon is available (or it fails), a plain
            rotated-square diamond in the same status color. Clicking it opens
            the work item that set the target in a NEW tab. No native
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
        {canTint ? (
          <div
            className={`h-4 w-4 ${color} ${target.provisional ? 'opacity-50' : ''}`}
            style={{
              WebkitMaskImage: `url(${iconUrl})`,
              maskImage: `url(${iconUrl})`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
        ) : target.provisional ? (
          // Provisional estimate: hollow, dashed outline (FR-23).
          <div
            className={`h-2.5 w-2.5 rotate-45 border border-dashed bg-transparent ${
              target.status === 'hit'
                ? 'border-success'
                : target.status === 'missed'
                  ? 'border-danger'
                  : 'border-text-subtle'
            }`}
          />
        ) : (
          <div className={`h-2.5 w-2.5 rotate-45 ${color}`} />
        )}
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
              Target {target.provisional ? '≈ ' : ''}{fmtVal(target.value)} {node.unit}
            </span>
            <span className="text-text-subtle"> · {statusLabel}</span>
          </div>
          <div className="text-text-subtle">Due {target.date}</div>
          {target.provisional && (
            <div className="text-text-subtle">Provisional estimate (baseline not yet baselined)</div>
          )}
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

