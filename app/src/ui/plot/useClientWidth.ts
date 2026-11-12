import { useCallback, useRef, useState } from 'react';

/**
 * Track an element's `clientWidth` (0 until mounted). Returns a stable callback
 * ref to attach to the element; a ResizeObserver keeps the width current. Used
 * to fill the plot's scroll viewport with quarter columns (`buildAxis` minWidth).
 */
export function useClientWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width];
}
