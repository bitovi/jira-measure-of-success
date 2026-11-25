import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const KEY_STEP = 16;

/**
 * A vertical drag handle on a column's right edge. Drag to resize, arrow keys
 * when focused, double-click to restore the default width.
 */
export function ColumnResizer({
  width,
  min,
  max,
  onResize,
  onReset,
  label = 'Resize column',
}: {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset?: () => void;
  label?: string;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // While dragging, keep the resize cursor everywhere and stop text selection.
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onResize(drag.current.startWidth + e.clientX - drag.current.startX);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') onResize(width - KEY_STEP);
    else if (e.key === 'ArrowRight') onResize(width + KEY_STEP);
    else if (e.key === 'Home') onResize(min);
    else if (e.key === 'End') onResize(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid="column-resizer"
      data-dragging={dragging || undefined}
      className="group/resizer absolute inset-y-0 -right-1 z-40 flex w-2 cursor-col-resize touch-none justify-center outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <div
        className={`h-full w-0.5 transition-colors group-hover/resizer:bg-[var(--ds-border-focused,#388bff)] group-focus-visible/resizer:bg-[var(--ds-border-focused,#388bff)] ${
          dragging ? 'bg-[var(--ds-border-focused,#388bff)]' : 'bg-transparent'
        }`}
      />
    </div>
  );
}
