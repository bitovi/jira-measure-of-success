import type { MouseEvent } from 'react';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import type { KpiOptionDto, TargetSummaryDto } from '@domain/index.js';
import { WorkItemRef } from '@ui/components/WorkItemRef/index.js';
import { KPI_ROW_COLUMNS, targetSummaryText } from './kpiRowText.js';

/**
 * One KPI in the browser (spec 11 · 07): a Plans-style chevron (or a
 * same-width spacer) in a 24px column, `{icon} {key} {summary}` indented 24px
 * per level, its unit, and in Tracked by parents the target its parent set.
 * The chevron opens or closes the sub-KPIs without picking the row.
 */
export function KpiRow({
  id,
  option,
  depth,
  hasChildren,
  open,
  active,
  withTarget,
  target,
  hint,
  highlight = '',
  onPick,
  onToggle,
  onHover,
}: {
  /** the option's element id (the combobox's `aria-activedescendant`) */
  id: string;
  option: KpiOptionDto;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  /** highlighted by the keyboard or the mouse */
  active: boolean;
  /** the Target column is shown (Tracked by parents) */
  withTarget: boolean;
  /** the parent's target (top-level rows of a band); sub-KPI rows leave it blank */
  target?: TargetSummaryDto | null;
  /** where a pasted key's KPI lives (`In another space · PORT`) */
  hint?: string;
  highlight?: string;
  onPick: () => void;
  onToggle: () => void;
  onHover: () => void;
}) {
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-level={depth + 1}
      {...(hasChildren ? { 'aria-expanded': open } : {})}
      data-kpi-id={option.id}
      onMouseDown={keepFocus}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`grid min-h-9 cursor-pointer items-center gap-3 px-3 py-1 text-sm ${withTarget ? KPI_ROW_COLUMNS.withTarget : KPI_ROW_COLUMNS.plain} ${
        active
          ? 'bg-[var(--ds-background-neutral-subtle-hovered,#091e420f)] shadow-[inset_2px_0_0_var(--ds-border-focused,#388bff)]'
          : ''
      }`}
    >
      <span className="flex min-w-0 items-center" style={{ paddingLeft: depth * 24 }}>
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${option.name}`}
            onMouseDown={keepFocus}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="grid h-6 w-6 flex-none place-items-center rounded-[3px] text-text-subtle hover:bg-[var(--ds-background-neutral-subtle-hovered,#091e420f)] hover:text-text"
          >
            {open ? <ChevronDownIcon label="" size="small" /> : <ChevronRightIcon label="" size="small" />}
          </button>
        ) : (
          <span aria-hidden className="inline-block h-6 w-6 flex-none" />
        )}
        <WorkItemRef typeIconUrl={option.typeIconUrl} typeName="KPI" itemKey={option.key} summary={option.name} highlight={highlight} />
        {hint && <span className="ml-2 flex-none text-xs text-text-subtlest">{hint}</span>}
      </span>
      <span className="truncate text-text-subtle">{option.unit}</span>
      {withTarget && (
        <span className="truncate whitespace-nowrap text-xs text-text-subtle" title={target ? targetSummaryText(target, option.unit) : undefined}>
          {target ? targetSummaryText(target, option.unit) : ''}
        </span>
      )}
    </div>
  );
}
