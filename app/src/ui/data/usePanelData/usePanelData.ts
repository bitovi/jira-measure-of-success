import { useEffect, useState } from 'react';
import { call } from '@ui/bridge.js';
import type { Assignment, PanelData } from '@domain/index.js';

/**
 * Injectable loader hook for the Issue panel (the `@forge/bridge` seam).
 *
 * Surfaces take this as a prop defaulted to the real hook, so Storybook stories
 * and tests can swap in a stub that returns canned scenario data synchronously —
 * exercising loading / error / empty / pending branches with no bridge or async.
 * See the "injectable loader hook" convention in
 * `.claude/skills/implement-feature/SKILL.md` and tech-choices §5.
 */
export interface PanelController {
  data: PanelData | null;
  /** true while the initial load is in flight */
  pending: boolean;
  error: string | null;
  /** true while a save/remove mutation is in flight */
  busy: boolean;
  save(assignment: Assignment): void;
  remove(kpiId: string): void;
}

export type UsePanel = (issueId: string) => PanelController;

export const usePanelData: UsePanel = (issueId) => {
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    call<PanelData>('getPanelData', { issueId })
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [issueId]);

  const mutate = async (key: string, payload: unknown) => {
    setBusy(true);
    try {
      setData(await call<PanelData>(key, payload));
    } finally {
      setBusy(false);
    }
  };

  return {
    data,
    pending: data === null && error === null,
    error,
    busy,
    save: (assignment) => void mutate('saveAssignment', { issueId, assignment }),
    remove: (kpiId) => void mutate('removeAssignment', { issueId, kpiId }),
  };
};
