import Tooltip from '@atlaskit/tooltip';
import type { StackedNote } from '@ui/targetText.js';

/**
 * `Stacked on 2 earlier Initiative targets` — shown under the estimate line when
 * earlier same-level targets were stacked onto the baseline (spec 09). Used by
 * the timeline's target tooltip; the issue panel's target card will use it once
 * spec 09 Step 4 (panel stacking) lands. With `hints`
 * it lists each step on hover; turn it off inside a tooltip, which can't be hovered.
 */
export function StackedLine({
  note,
  className = '',
  hints = true,
}: {
  note: StackedNote | null;
  className?: string;
  hints?: boolean;
}) {
  if (!note) return null;
  const body = <span>{note.text}</span>;
  return (
    <p className={`text-sm leading-5 text-text-subtle ${className}`}>
      {hints ? (
        <Tooltip
          content={
            <>
              {note.steps.map((s) => (
                <div key={s}>{s}</div>
              ))}
            </>
          }
          tag="span"
        >
          {body}
        </Tooltip>
      ) : (
        body
      )}
    </p>
  );
}
