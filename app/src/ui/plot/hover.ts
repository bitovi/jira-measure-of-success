import type React from 'react';
import type { Projection, TimelineNodeDto, TimelineReadingDto } from '@domain/index.js';
import type { Axis } from './axis.js';
import { fmtVal, valueDetailAt } from './scale.js';

/**
 * The hover crosshair + value tooltip shared by the KPI Timeline and the KPI
 * View. Hovering anywhere on a plot track reports the value at the cursor's
 * date — the measured reading when close to its dot, a linear interpolation
 * between readings in the PAST, or (past the latest reading) the PROJECTED value
 * off the recency-weighted trend line. Both surfaces compute the same
 * `HoverState` and render the same crosshair/tooltip.
 */
export interface HoverState {
  x: number; // px within the plot (for the crosshair)
  clientX: number;
  clientY: number;
  flipX: boolean; // render the tooltip to the left of the cursor near the right edge
  dateISO: string;
  primary: string;
  kindLabel: string | null;
  sub: string | null;
}

/**
 * Build the hover state for a pointer move over a plot track, or null when the
 * pointer is over a target marker (those keep their own tooltip). `e` must be a
 * move event whose `currentTarget` is the full-width track element.
 */
export function computeHover(
  node: TimelineNodeDto,
  axis: Axis,
  e: React.MouseEvent<HTMLDivElement>,
  /** the recency-weighted trend, used to report PROJECTED values past the last reading */
  projection?: Projection | null,
): HoverState | null {
  // Target markers keep their own native tooltip — don't stack ours on top.
  if ((e.target as HTMLElement).closest('[data-diamond]')) return null;

  const rect = e.currentTarget.getBoundingClientRect();
  const rawX = e.clientX - rect.left;
  const x = Math.max(0, Math.min(rawX, axis.plotWidth));
  const t = axis.msAt(x);
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
      } else if (det.kind === 'after' && projection) {
        // Past the latest reading: read off the projection ray, not a flat carry.
        primary = `~ ${fmtVal(projection.at(dateISO))} ${node.unit}`;
        kindLabel = 'projected';
        sub = dateISO;
      } else {
        primary = `~ ${fmtVal(det.value)} ${node.unit}`;
        kindLabel = det.kind === 'after' ? 'latest' : 'interpolated';
        sub = dateISO;
      }
    }
  }

  return {
    x,
    clientX: e.clientX,
    clientY: e.clientY,
    flipX: e.clientX > window.innerWidth - 220,
    dateISO,
    primary,
    kindLabel,
    sub,
  };
}
