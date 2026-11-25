import type { ReactNode } from 'react';
import Tooltip from '@atlaskit/tooltip';

/**
 * A work item the way Jira Plans shows one (spec 11 · 07): `{type icon} {key}
 * {summary}`. The type is shown only by its 16px icon, whose tooltip names it;
 * the key is link blue, the summary medium weight and truncated. Used for KPI
 * rows, parent bands, the picked KPI and the picker's messages.
 */
export function WorkItemRef({
  typeIconUrl,
  typeName,
  itemKey,
  summary,
  plain = false,
  highlight = '',
  className = '',
}: {
  /** an inlined `data:` URL; null draws a neutral square */
  typeIconUrl: string | null;
  typeName: string;
  itemKey: string;
  summary: string;
  /** regular-weight summary (inside a sentence) */
  plain?: boolean;
  /** search text to mark in the key and summary */
  highlight?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center ${className}`}>
      <TypeIcon typeIconUrl={typeIconUrl} typeName={typeName} className="mr-[5px]" />
      <span className="mr-1 flex-none whitespace-nowrap text-[var(--ds-link,#1868db)]">{marked(itemKey, highlight)}</span>
      <span className={`min-w-0 truncate text-text ${plain ? 'font-normal' : 'font-medium'}`}>{marked(summary, highlight)}</span>
    </span>
  );
}

/** A work type's 16px icon; its tooltip (Atlaskit) names the type. */
export function TypeIcon({ typeIconUrl, typeName, className = '' }: { typeIconUrl: string | null; typeName: string; className?: string }) {
  return (
    <Tooltip content={typeName} position="bottom">
      {(tooltipProps) =>
        typeIconUrl ? (
          <img {...tooltipProps} src={typeIconUrl} alt={typeName} width={16} height={16} className={`h-4 w-4 flex-none ${className}`} />
        ) : (
          <span
            {...tooltipProps}
            role="img"
            aria-label={typeName}
            className={`inline-block h-4 w-4 flex-none rounded-[3px] bg-[var(--ds-background-neutral,#091e420f)] ${className}`}
          />
        )
      }
    </Tooltip>
  );
}

function marked(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) return text;
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-[var(--ds-background-accent-yellow-subtler,#fff0b3)] text-inherit">
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length)}
    </>
  );
}
