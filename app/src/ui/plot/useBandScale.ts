import { useEffect, useRef, useState } from 'react';
import type { TimelineNodeDto } from '@domain/index.js';
import { bandScaleOf, domainFor } from './scale.js';

/**
 * Animated Timeline row scale (spec 06 P4, "readings first, smooth").
 *
 * A row's value domain covers its readings AND its targets. While targets are
 * still loading the domain is the readings alone; when they arrive it widens.
 * Snapping would make every line jump, so for exactly that moment — the row
 * going from `resolving` to resolved — the domain glides from the old range to
 * the new one. Every other change (recording a value, a filter) snaps as before.
 * `settled` is false during the glide so target markers, which belong to the new
 * range, are drawn only once the lines have arrived.
 */
type Domain = { min: number; max: number };

export const SCALE_GLIDE_MS = 400;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function lerpDomain(from: Domain, to: Domain, t: number): Domain {
  const k = easeOutCubic(t);
  return { min: from.min + (to.min - from.min) * k, max: from.max + (to.max - from.max) * k };
}

const keyOf = (d: Domain | null): string => (d ? `${d.min}|${d.max}` : '');

interface Glide {
  from: Domain | null;
  to: Domain | null;
  t: number;
}

export function useBandScale(
  node: TimelineNodeDto,
  plotH: number,
): { yOf: (v: number) => number; settled: boolean } {
  const target = domainFor(node);
  const resolving = node.resolving === true;
  const [glide, setGlide] = useState<Glide>({ from: target, to: target, t: 1 });
  const lastKey = useRef(keyOf(target));
  const wasResolving = useRef(resolving);
  const shown = useRef<Domain | null>(target);
  const frame = useRef<number | null>(null);

  const current = glide.from && glide.to && glide.t < 1 ? lerpDomain(glide.from, glide.to, glide.t) : glide.to;
  shown.current = current;

  useEffect(() => {
    const justResolved = wasResolving.current && !resolving;
    wasResolving.current = resolving;
    const key = keyOf(target);
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (frame.current !== null) cancelAnimationFrame(frame.current);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const from = shown.current;
    if (!justResolved || reduceMotion || !from || !target) {
      setGlide({ from: target, to: target, t: 1 });
      return;
    }
    const start = performance.now();
    setGlide({ from, to: target, t: 0 });
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SCALE_GLIDE_MS);
      setGlide((g) => ({ ...g, t }));
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    // `target` is captured by its key above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyOf(target), resolving]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Not settled until the animated range has arrived at the row's real range —
  // including the very render where targets first appear, before the effect runs.
  const settled = glide.t >= 1 && keyOf(glide.to) === keyOf(target);
  return { yOf: bandScaleOf(current, plotH), settled };
}
