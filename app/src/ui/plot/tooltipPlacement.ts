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
