import type { ReactNode } from 'react';
import type { KeyHighlight } from '../useKeyHighlight.js';
import { typeKind, type KeyKind, type KeySummary } from '../keyKinds.js';
import { SERIES_COLOR, TargetGlyph } from '../markers.js';

/**
 * The plot key bar (spec 08) — one compact line, shared by the KPI Timeline and
 * the KPI View. Value and status entries show samples drawn with the plot's own
 * marks, so the key can't drift from the chart; issue-type entries show the
 * type's real icon. Target entries carry counts, and the issue-type
 * entries are built from the targets shown. Hovering (or focusing) an entry
 * highlights its marks — everything else dims; clicking pins the highlight
 * (click again, or "Clear highlight", to release it). Only entries that apply
 * are listed; with none, the bar renders nothing.
 */
export interface PlotKeyProps {
  summary: KeySummary;
  highlight: KeyHighlight;
  /** container classes (borders/rounding differ per surface) */
  className?: string;
}

const TARGET_ENTRIES: ReadonlyArray<{ kind: keyof KeySummary['counts']; label: string; description: string }> = [
  { kind: 'hit', label: 'Hit', description: 'Reached by its due date.' },
  { kind: 'missed', label: 'Missed', description: 'Its due date passed without reaching it.' },
  {
    kind: 'upcoming-fixed',
    label: 'Upcoming (fixed)',
    description: 'A set number (e.g. “reach 4.0”); its due date is still ahead.',
  },
  {
    kind: 'upcoming-relative',
    label: 'Upcoming (relative)',
    description:
      'A ± change (e.g. “+10%”) from the KPI’s value at the due date. The bar means the ≈ value can still move until that value is recorded.',
  },
  { kind: 'undated', label: 'Undated', description: 'No due date yet — listed in the Undated column.' },
];

function sampleFor(kind: KeyKind, iconUrl?: string | null): ReactNode {
  switch (kind) {
    case 'recorded':
      return (
        <svg width={22} height={12} aria-hidden="true">
          <line x1={1} y1={6} x2={21} y2={6} style={{ stroke: SERIES_COLOR }} strokeWidth={1.5} />
          <circle
            cx={11}
            cy={6}
            r={3.5}
            style={{ fill: SERIES_COLOR, stroke: 'var(--ds-surface, #fff)' }}
            strokeWidth={1.5}
          />
        </svg>
      );
    case 'projection':
      return (
        <svg width={22} height={12} aria-hidden="true">
          <line
            x1={1}
            y1={6}
            x2={21}
            y2={6}
            style={{ stroke: SERIES_COLOR }}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            opacity={0.7}
          />
        </svg>
      );
    case 'hit':
    case 'missed':
      return <TargetGlyph status={kind} provisional={false} />;
    case 'upcoming-fixed':
      return <TargetGlyph status="upcoming" provisional={false} />;
    case 'upcoming-relative':
      return <TargetGlyph status="upcoming" provisional barHeight={18} />;
    case 'undated':
      return (
        <span aria-hidden="true" className="inline-block h-3.5 w-5 rounded border border-text-subtlest bg-surface" />
      );
    default:
      // Issue type: the real, full-color Jira icon so the type is recognizable.
      // (On the chart the icon is only a status-tinted silhouette, and most Jira
      // icons are rounded squares — hovering the entry shows which markers it is.)
      return iconUrl ? (
        <img src={iconUrl} alt="" width={14} height={14} className="h-3.5 w-3.5" />
      ) : (
        <TargetGlyph status="upcoming" provisional={false} />
      );
  }
}

function KeyEntry({
  kind,
  label,
  description,
  count,
  iconUrl,
  highlight,
}: {
  kind: KeyKind;
  label: string;
  description: string;
  count?: number;
  iconUrl?: string | null;
  highlight: KeyHighlight;
}) {
  const pinned = highlight.pinned === kind;
  return (
    <button
      type="button"
      data-key-entry={kind}
      aria-pressed={pinned}
      title={`${description} Hover to highlight; click to pin.`}
      className={`inline-flex h-6 items-center gap-1.5 rounded px-1.5 hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        pinned ? 'bg-surface ring-1 ring-inset ring-brand' : ''
      }`}
      onMouseEnter={() => highlight.setHovered(kind)}
      onMouseLeave={() => highlight.setHovered(null)}
      onFocus={() => highlight.setHovered(kind)}
      onBlur={() => highlight.setHovered(null)}
      onClick={() => highlight.togglePin(kind)}
    >
      <span className="inline-grid min-w-[1.25rem] place-items-center">{sampleFor(kind, iconUrl)}</span>
      {count !== undefined && <span className="font-semibold tabular-nums text-text">{count}</span>}
      <span className={count !== undefined ? 'text-text-subtle' : 'text-text'}>{label}</span>
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;

export function PlotKey({ summary, highlight, className = '' }: PlotKeyProps) {
  const values: ReactNode[] = [];
  if (summary.recorded)
    values.push(
      <KeyEntry
        key="recorded"
        kind="recorded"
        label="Recorded value"
        description="A recorded value. Click one on the chart to edit or delete it."
        highlight={highlight}
      />,
    );
  if (summary.projection)
    values.push(
      <KeyEntry
        key="projection"
        kind="projection"
        label="Projected trend"
        description="Where the recent trend is heading (needs 2+ recorded values)."
        highlight={highlight}
      />,
    );

  const targets = TARGET_ENTRIES.filter((e) => summary.counts[e.kind] > 0).map((e) => (
    <KeyEntry
      key={e.kind}
      kind={e.kind}
      label={e.label}
      description={e.description}
      count={summary.counts[e.kind]}
      highlight={highlight}
    />
  ));

  const types = summary.types.map((t) => (
    <KeyEntry
      key={t.type}
      kind={typeKind(t.type)}
      label={t.type}
      description={`Targets set on ${t.type} issues — the marker shows the issue type's icon.`}
      count={t.count}
      iconUrl={t.iconUrl}
      highlight={highlight}
    />
  ));

  const groups = [values, targets, types].filter((g) => g.length > 0);
  if (groups.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Chart key"
      className={`flex flex-wrap items-center gap-x-1 gap-y-1 bg-surface-sunken px-2 py-1 text-[11px] ${className}`}
    >
      {groups.map((g, i) => (
        <span key={i} className="contents">
          {i > 0 && <Divider />}
          {g}
        </span>
      ))}
      {highlight.pinned !== null && (
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-0.5 text-brand hover:bg-border"
          onClick={highlight.clear}
        >
          Clear highlight
        </button>
      )}
    </div>
  );
}
