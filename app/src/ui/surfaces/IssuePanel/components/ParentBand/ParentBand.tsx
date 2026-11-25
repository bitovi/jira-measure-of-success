import type { WorkItemRefDto } from '@domain/index.js';
import { WorkItemRef } from '@ui/components/WorkItemRef/index.js';

/**
 * A parent work item in "Tracked by parents" (spec 11 · 07): `{type icon}
 * {key} {summary}` on a shaded band with top and bottom borders, flush left
 * (its icon lines up with the KPI rows' chevron column), not selectable, and
 * pinned while its KPIs scroll under it.
 */
export function ParentBand({ id, item, first = false }: { id?: string; item: WorkItemRefDto; first?: boolean }) {
  return (
    <div
      id={id}
      role="presentation"
      onMouseDown={(e) => e.preventDefault()}
      className={`sticky top-0 z-[1] flex cursor-default items-center border-y border-border bg-[var(--ds-surface-sunken,#f1f2f4)] px-3 py-1.5 text-sm ${first ? '' : 'mt-1.5'}`}
    >
      <WorkItemRef typeIconUrl={item.typeIconUrl} typeName={item.typeName} itemKey={item.key} summary={item.summary} />
    </div>
  );
}
