import { useEffect, useState } from 'react';

/** One lazy load's state, as the picker shows it. */
export type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

const IDLE = { status: 'idle' } as const;

/**
 * Run `load` whenever `key` changes (null = nothing to load), after `delayMs`
 * (typing), and keep only the latest answer.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>, delayMs = 0): Load<T> {
  const [state, setState] = useState<{ key: string | null; load: Load<T> }>({ key: null, load: IDLE });
  useEffect(() => {
    if (key === null) {
      setState({ key: null, load: IDLE });
      return;
    }
    let alive = true;
    setState({ key, load: { status: 'loading' } });
    const run = () =>
      load().then(
        (value) => alive && setState({ key, load: { status: 'ready', value } }),
        (e: unknown) => alive && setState({ key, load: { status: 'error', message: e instanceof Error ? e.message : String(e) } }),
      );
    const timer = delayMs > 0 ? setTimeout(run, delayMs) : (void run(), null);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // `load` is a fresh closure each render; `key` says what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs]);
  if (key === null) return IDLE;
  return state.key === key ? state.load : { status: 'loading' };
}
