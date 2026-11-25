import type { ReactNode } from 'react';
import Lozenge from '@atlaskit/lozenge';

export type StepState = 'todo' | 'done' | 'broken' | 'waiting' | 'attention';

const BADGE: Record<StepState, 'default' | 'success' | 'removed' | 'moved' | 'new'> = {
  todo: 'new',
  done: 'success',
  broken: 'removed',
  waiting: 'default',
  attention: 'moved',
};

export interface StepCardProps {
  title: string;
  state: StepState;
  badge: string;
  optional?: boolean;
  /** what the block is */
  what: ReactNode;
  /** why the app needs it (behind "Why?") */
  why?: ReactNode;
  error?: string | null;
  children?: ReactNode;
}

/** One KPI building block in Settings: title + state, what it is, what's chosen, its actions. */
export function StepCard({ title, state, badge, optional, what, why, error, children }: StepCardProps) {
  return (
    <div className="rounded-md border border-border px-4 py-3" role="group" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold ${
            state === 'done' ? 'bg-brand text-white' : 'border border-border text-text-subtle'
          }`}
        >
          {state === 'done' ? '✓' : state === 'broken' ? '!' : '·'}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        {optional && <span className="text-xs text-text-subtlest">optional</span>}
        <Lozenge appearance={BADGE[state]}>{badge}</Lozenge>
      </div>
      <p className="mt-1 text-sm text-text-subtle">{what}</p>
      {children}
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {why && (
        <details className="mt-2 text-xs text-text-subtle">
          <summary className="cursor-pointer">Why?</summary>
          <p className="mt-1">{why}</p>
        </details>
      )}
    </div>
  );
}

/** The Q8 warning shown when an admin changes a block that's already in use. */
export function ChangeWarning({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 rounded border border-border bg-surface-sunken px-3 py-2 text-xs text-warning" role="note">
      {children}
    </p>
  );
}
