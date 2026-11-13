import type { ReactNode } from 'react';
import Tooltip from '@atlaskit/tooltip';

/**
 * Explains why a control is disabled (spec 10: "disabled, with a tooltip for a
 * reason"). A disabled button gets no pointer or focus events, so the tooltip
 * hangs off a focusable wrapper instead; screen readers get the reason through
 * the tooltip's `aria-describedby`. With no `reason` it renders `children` as is.
 */
export function DisabledReason({ reason, children }: { reason: string | null | undefined; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip content={reason}>
      {(tooltipProps) => (
        <span {...tooltipProps} tabIndex={0} className="inline-flex" data-disabled-reason={reason}>
          {children}
        </span>
      )}
    </Tooltip>
  );
}
