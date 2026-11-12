import Lozenge from '@atlaskit/lozenge';
import type { PanelRowDto, TargetDetailDto, TimelineNodeDto, TimelineTargetDto } from '@domain/index.js';
import { EstimateLine } from '@ui/components/EstimateLine/index.js';
import { StackedLine } from '@ui/components/StackedLine/index.js';
import { PILL, betAmount, betWhen, estimate, nudgeFor, pillFor, stackedNote } from '@ui/targetText.js';

/**
 * A marker with no `detail` (built by hand, e.g. in stories) is read as a fixed
 * value on a fixed date, with its status taken from the marker.
 */
function fallbackDetail(target: TimelineTargetDto): TargetDetailDto {
  return {
    target: target.value,
    targetType: 'absolute',
    dueTiming: { mode: 'absolute', absolute: target.date, anchor: 'issueDueDate', offsetMonths: 0 },
    start: null,
    targetDate: { date: target.date, pending: target.date === null, source: 'own' },
    resolvedValue: {
      value: target.value,
      baseline: null,
      baselineDate: null,
      baselineFrom: null,
      state: 'baselined',
      provisional: target.provisional,
    },
    displayState: target.status === 'hit' ? 'met' : target.status === 'missed' ? 'missed' : 'projected',
    warning: null,
    dueDate: target.date,
    dueDateRolledUp: false,
    actual: null,
  };
}

/** The panel row this marker's target would be on the issue panel. */
function rowForTarget(target: TimelineTargetDto, node: TimelineNodeDto): PanelRowDto {
  return {
    kpiId: node.kpiId,
    name: node.name,
    unit: node.unit,
    direction: node.direction,
    relationship: 'onlyHere',
    frozen: false,
    ...(target.detail ?? fallbackDetail(target)),
  };
}

/**
 * The target marker's tooltip body — the issue panel's target card, read-only:
 * the issue that set it with the status pill, the bet, then the estimate line
 * (and, when earlier same-level targets stacked onto it, what it's stacked on).
 */
export function TargetTooltipBody({ target, node }: { target: TimelineTargetDto; node: TimelineNodeDto }) {
  const row = rowForTarget(target, node);
  const latest = node.readings[node.readings.length - 1];
  const pill = pillFor(row);
  const nudge = nudgeFor(row);

  return (
    <>
      <div className="flex items-start gap-1 text-text-subtle">
        {target.source.iconUrl && (
          <img
            src={target.source.iconUrl}
            alt={target.source.type}
            width={14}
            height={14}
            className="mt-px h-3.5 w-3.5 flex-none"
          />
        )}
        <span className="min-w-0">
          {target.source.issue} {target.source.title}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold leading-5 tabular-nums">
          <span>{betAmount(row.targetType, row.target, row.unit)}</span>
          <span aria-hidden="true" className="font-normal text-text-subtlest">
            ·
          </span>
          <span>{betWhen(row.dueTiming)}</span>
        </p>
        {pill && (
          <span className="flex-none">
            <Lozenge appearance={PILL[pill].appearance}>{PILL[pill].label}</Lozenge>
          </span>
        )}
      </div>
      <EstimateLine est={estimate(row, latest?.value ?? null)} className="mt-0.5 !text-xs" hints={false} />
      <StackedLine note={stackedNote(row.resolvedValue, row.unit)} className="!text-xs" hints={false} />
      {nudge && <p className="mt-1.5 text-xs font-medium text-warning">{nudge}</p>}
    </>
  );
}
