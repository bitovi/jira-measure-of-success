import { useLayoutEffect, useRef } from 'react';

/**
 * Where to put a cursor-following tooltip so it stays inside the viewport.
 * Prefers the right of the cursor, flips left when only the left has room for
 * the full width, and otherwise uses the roomier side with the width capped to
 * the space there. On a viewport too narrow for even `minWidth` beside the
 * cursor, it spans the viewport (minus margins). Returns `left` OR `right`
 * (CSS px from that edge) plus the `maxWidth` to apply.
 */
export interface TooltipPlacement {
  left?: number;
  right?: number;
  maxWidth: number;
}

export function tooltipPlacement(
  clientX: number,
  viewportWidth: number,
  { maxWidth = 400, gap = 14, margin = 8, minWidth = 200 }: { maxWidth?: number; gap?: number; margin?: number; minWidth?: number } = {},
): TooltipPlacement {
  const roomRight = viewportWidth - margin - (clientX + gap);
  const roomLeft = clientX - gap - margin;
  const cap = Math.max(0, Math.min(maxWidth, viewportWidth - 2 * margin));
  const onRight = (w: number): TooltipPlacement => ({ left: clientX + gap, maxWidth: w });
  const onLeft = (w: number): TooltipPlacement => ({ right: viewportWidth - clientX + gap, maxWidth: w });

  if (roomRight >= cap) return onRight(cap);
  if (roomLeft >= cap) return onLeft(cap);
  if (Math.max(roomRight, roomLeft) >= minWidth) return roomRight >= roomLeft ? onRight(roomRight) : onLeft(roomLeft);
  return { left: margin, maxWidth: cap };
}

/**
 * The `top` (CSS px) for a cursor-following tooltip of `height`: below the
 * cursor when it fits, else above it when that fits, else on the roomier side
 * kept inside the viewport as far as it can be.
 */
export function tooltipTop(
  clientY: number,
  viewportHeight: number,
  height: number,
  { gap = 14, margin = 8 }: { gap?: number; margin?: number } = {},
): number {
  const below = clientY + gap;
  const above = clientY - gap - height;
  if (below + height <= viewportHeight - margin) return below;
  if (above >= margin) return above;
  const roomBelow = viewportHeight - margin - below;
  const roomAbove = clientY - gap - margin;
  return roomAbove > roomBelow ? margin : below;
}

/**
 * A ref for a `position: fixed` tooltip that sets its `top` from `clientY`
 * after each render, before paint: it measures the tooltip and opens it upward
 * when it would be cut off by the bottom of the viewport. Leave `top` out of
 * the element's `style`; this owns it.
 */
export function useTooltipTop<T extends HTMLElement>(clientY: number) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.top = `${tooltipTop(clientY, window.innerHeight, el.offsetHeight)}px`;
  });
  return ref;
}
