import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { KeyKind } from './keyKinds.js';

/**
 * Key-bar highlight state (spec 08). The surface owns it (`useKeyHighlight`): a
 * hovered kind and a pinned kind; the ACTIVE kind is the hovered one, else the
 * pinned one. Plot marks read it (via `KeyHighlightProvider`, highlight.tsx) and
 * dim themselves when they don't belong to the active kind. With no provider (or
 * no active kind) nothing dims, so marks render normally in isolation.
 */
export const ActiveKindContext = createContext<KeyKind | null>(null);

export const DIMMED_OPACITY = 0.12;

/** True when a key entry is active and this mark (with `kinds`) isn't part of it. */
export function useIsDimmed(kinds: readonly KeyKind[]): boolean {
  const active = useContext(ActiveKindContext);
  return active !== null && !kinds.includes(active);
}

/** Inline style for a mark that fades when dimmed. */
export function dimStyle(dimmed: boolean): React.CSSProperties {
  return { opacity: dimmed ? DIMMED_OPACITY : undefined, transition: 'opacity 120ms ease' };
}

export interface KeyHighlight {
  /** the kind marks are currently highlighting for (hover wins over pin) */
  active: KeyKind | null;
  pinned: KeyKind | null;
  setHovered: (kind: KeyKind | null) => void;
  /** pin `kind`, or clear the pin when `kind` is already pinned */
  togglePin: (kind: KeyKind) => void;
  clear: () => void;
}

export function useKeyHighlight(): KeyHighlight {
  const [hovered, setHovered] = useState<KeyKind | null>(null);
  const [pinned, setPinned] = useState<KeyKind | null>(null);
  const togglePin = useCallback((kind: KeyKind) => setPinned((p) => (p === kind ? null : kind)), []);
  const clear = useCallback(() => setPinned(null), []);
  return useMemo(
    () => ({ active: hovered ?? pinned, pinned, setHovered, togglePin, clear }),
    [hovered, pinned, togglePin, clear],
  );
}
