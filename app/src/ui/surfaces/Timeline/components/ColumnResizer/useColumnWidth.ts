import { useCallback, useState } from 'react';

/** Keeps `width` within [min, max]; `max` wins over `min` if they cross. */
export function clampWidth(width: number, min: number, max: number): number {
  return Math.round(Math.max(Math.min(width, max), Math.min(min, max)));
}

/** Reads a remembered width; anything unreadable or not a number gives `null`. */
export function readStoredWidth(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStoredWidth(key: string, width: number) {
  try {
    window.localStorage.setItem(key, String(width));
  } catch {
    // storage unavailable: the column opens at its default width next time
  }
}

/**
 * A column width the user can change, remembered in the browser under
 * `storageKey`. The returned width is always clamped to [min, max], so a
 * smaller window narrows it without forgetting the chosen width.
 */
export function useColumnWidth({
  storageKey,
  defaultWidth,
  min,
  max,
}: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
}) {
  const [chosen, setChosen] = useState(() => readStoredWidth(storageKey) ?? defaultWidth);
  const width = clampWidth(chosen, min, max);
  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampWidth(next, min, max);
      setChosen(clamped);
      writeStoredWidth(storageKey, clamped);
    },
    [storageKey, min, max],
  );
  const reset = useCallback(() => {
    setChosen(defaultWidth);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey, defaultWidth]);
  return { width, setWidth, reset };
}
