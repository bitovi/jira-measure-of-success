import { niceTicks, type TimelineNodeDto, type TimelineReadingDto } from '@domain/index.js';

/**
 * Value-scale + numeric helpers shared by the KPI Timeline and the KPI View.
 *
 * The ONE genuine difference between the two surfaces is the vertical scale:
 * - `bandScale` — the Timeline's per-row scale: squeeze the value domain into
 *   20–80% of a short (60px) row, NO ticks/labels.
 * - `niceScale` — the KPI View's tall (~600px) scale: a linear "nice" tick
 *   scale WITH gridline values + labels.
 * Both return a `yOf(value) → px` mapper, so the shared plot components
 * (`Sparkline`, `ReadingDot`, `TargetMarker`) take `yOf`/`y` and never branch.
 */

/** Milliseconds since epoch for an ISO date. */
export function ms(iso: string): number {
  return new Date(iso).getTime();
}

/** Compact numeric formatting for tooltips/labels (0 dp for |v|≥100, else 1 dp). */
export function fmtVal(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 });
}

/** Short axis-tick label: 1.6M / 800K / 42 / 0. */
export function fmtTickLabel(v: number): string {
  const abs = Math.abs(v);
  const trim = (n: number) => {
    const s = (Math.round(n * 100) / 100).toString();
    return s;
  };
  if (abs >= 1e9) return `${trim(v / 1e9)}B`;
  if (abs >= 1e6) return `${trim(v / 1e6)}M`;
  if (abs >= 1e3) return `${trim(v / 1e3)}K`;
  return trim(v);
}

/**
 * Value in effect at time `t` (ms): exact between two readings via linear
 * interpolation; flat before the first / after the last reading. Powers the
 * hover tooltip so hovering anywhere reports a value.
 */
export function valueDetailAt(
  readings: TimelineReadingDto[],
  t: number,
): { value: number; kind: 'before' | 'interp' | 'after' } | null {
  if (!readings.length) return null;
  const pts = [...readings].sort((a, b) => ms(a.date) - ms(b.date));
  const times = pts.map((p) => ms(p.date));
  if (t <= times[0]) return { value: pts[0].value, kind: 'before' };
  if (t >= times[times.length - 1]) return { value: pts[pts.length - 1].value, kind: 'after' };
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (t >= times[i] && t <= times[i + 1]) {
      const f = (t - times[i]) / (times[i + 1] - times[i]);
      return { value: pts[i].value + f * (pts[i + 1].value - pts[i].value), kind: 'interp' };
    }
  }
  return null;
}

/** The value domain of a node (readings ∪ targets), widened when flat; null when empty. */
export function domainFor(node: TimelineNodeDto): { min: number; max: number } | null {
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

/**
 * Timeline scale: value → y within a short row, padded to 20–80% of `plotH`.
 * No ticks (a 60px row can't hold labels).
 */
export function bandScale(node: TimelineNodeDto, plotH: number): (v: number) => number {
  const dom = domainFor(node);
  return (v: number): number => {
    if (!dom) return plotH / 2;
    const frac = (v - dom.min) / (dom.max - dom.min);
    return plotH * 0.2 + (1 - frac) * plotH * 0.6;
  };
}

export interface NiceScaleTick {
  value: number;
  y: number;
  label: string;
}

export interface NiceScale {
  yOf: (v: number) => number;
  ticks: NiceScaleTick[];
}

/**
 * KPI View scale: a "nice" linear value scale over a tall plot. Returns `yOf`
 * plus the gridline ticks (value + pixel y + short label) to draw a real
 * vertical value axis. `pad` reserves pixels at the top (above the max tick)
 * and bottom (below the axis line / for quarter labels).
 */
export function niceScale(
  node: TimelineNodeDto,
  plotH: number,
  tickCount = 5,
  pad: { top: number; bottom: number } = { top: 16, bottom: 28 },
): NiceScale {
  const dom = domainFor(node) ?? { min: 0, max: 1 };
  const nice = niceTicks(dom.min, dom.max, tickCount);
  const top = pad.top;
  const bottom = plotH - pad.bottom;
  const span = nice.max - nice.min || 1;
  const yOf = (v: number): number => {
    const frac = (v - nice.min) / span;
    return bottom - frac * (bottom - top);
  };
  const ticks = nice.ticks.map((value) => ({ value, y: yOf(value), label: fmtTickLabel(value) }));
  return { yOf, ticks };
}
