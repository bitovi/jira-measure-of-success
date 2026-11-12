import { Fragment } from 'react';
import Tooltip from '@atlaskit/tooltip';
import type { Estimate, EstimatePart } from '@ui/targetText.js';

/**
 * `Estimated target 275 by Apr 15, 2027 · from 250 now` — numbers in --text, the
 * rest subtle. Shared by the issue panel's target card and the timeline's target
 * tooltip so both read the same. `hints` adds the hover explanations; turn it off
 * inside a tooltip, which can't be hovered.
 */
export function EstimateLine({
  est,
  className = '',
  hints = true,
}: {
  est: Estimate;
  className?: string;
  hints?: boolean;
}) {
  return (
    <p className={`text-sm leading-5 text-text-subtle ${className}`}>
      {est.label}
      {est.value !== null && (
        <>
          {' '}
          <span className="text-text tabular-nums">{est.value}</span>
        </>
      )}
      {est.by && (
        <>
          {' '}
          <Part part={est.by} hints={hints} />
        </>
      )}
      {est.tail.map((p, i) => (
        <Fragment key={i}>
          {' · '}
          <Part part={p} hints={hints} />
        </Fragment>
      ))}
    </p>
  );
}

function Part({ part, hints }: { part: EstimatePart; hints: boolean }) {
  const tone = part.tone === 'good' ? 'text-success' : part.tone === 'bad' ? 'text-danger' : 'text-text';
  const body = (
    <span className="whitespace-nowrap">
      {part.pre}
      {part.num && <span className={`${tone} tabular-nums`}>{part.num}</span>}
      {part.post}
    </span>
  );
  return hints && part.hint ? (
    <Tooltip content={part.hint} tag="span">
      {body}
    </Tooltip>
  ) : (
    body
  );
}
