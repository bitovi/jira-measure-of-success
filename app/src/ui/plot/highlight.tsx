import type { ReactNode } from 'react';
import type { KeyKind } from './keyKinds.js';
import { ActiveKindContext, dimStyle, useIsDimmed } from './useKeyHighlight.js';

/** Provides the key bar's active kind to every plot mark below it (spec 08). */
export function KeyHighlightProvider({ active, children }: { active: KeyKind | null; children: ReactNode }) {
  return <ActiveKindContext.Provider value={active}>{children}</ActiveKindContext.Provider>;
}

/** Wraps non-plot marks (e.g. undated chips) so they dim with the rest. */
export function Dimmable({ kinds, children }: { kinds: readonly KeyKind[]; children: ReactNode }) {
  const dimmed = useIsDimmed(kinds);
  return (
    <span className="inline-flex" style={dimStyle(dimmed)}>
      {children}
    </span>
  );
}
