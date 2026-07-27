import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineData, type UseTimeline, type TimelineActionError } from '@ui/data/useTimelineData/index.js';
import { openKpiSettings, openIssue, openIssueNewTab, getSiteUrl } from '@ui/bridge.js';
import {
  buildAxis,
  axisDatesOf,
  bandScale,
  computeHover,
  fmtVal,
  PAD_R,
  PlotCrosshair,
  PlotTooltip,
  ProjectionLine,
  ProjectionModal,
  ReadingDot,
  RecordModal,
  EditReadingModal,
  Sparkline,
  TargetMarker,
  type Axis,
  type HoverState,
} from '@ui/plot/index.js';
import {
  collectContributingProjects,
  filterTimelineByProjects,
  projectSeries,
  type AddTargetInput,
  type CreateKpiInput,
  type IssuePickerItem,
  type TimelineNodeDto,
  type TimelineReadingDto,
  type TimelineTargetDto,
} from '@domain/index.js';

/**
 * KPI Timeline v2 (Custom UI) — the KPI tree as a nested plan against a shared
 * date axis. The horizontal axis FITS THE DATA RANGE (Feature 04, §4a): the
 * domain is the union of every visible KPI's readings + dated targets (plus
 * today), snapped outward to whole quarters — so the plot scrolls only when the
 * range is genuinely wider than the viewport. Sparklines of recorded readings,
 * target markers (the source issue's type icon, tinted gray/green/red for
 * upcoming/hit/missed), drill-in to source issues, and a record-value modal.
 * The plot primitives (axis, sparkline, markers, hover, modals) are shared with
 * the KPI View via `@ui/plot` — see specs/04-kpi-view/plan.md.
 * Mock: specs/00-mocks/kpi-timeline-v2.html. Stories TL-1…TL-7.
 *
 * Data comes from an INJECTABLE loader hook (`useData`) — see usePanelData.ts.
 */
const LABEL_W = 300;
const ROW_H = 60;
const HEADER_H = 33;
// Right-pinned "Undated" lane holding projection chips for pending targets (FR-24).
const UNDATED_W = 140;
// Per-depth indent for the label column's chevron + name (Jira Plans style —
// the chevron indents together with the text, not pinned at the left edge).
const INDENT_STEP = 20;

/** Stable empty set for the issue picker's default `excludedKeys`. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

// Project filter (contributing issues can live in any Jira project). The
// selection is kept in the URL (`?projects=ECOM,POS`) via `history.replaceState`
// — shareable/refresh-safe without spamming browser back-history on every
// checkbox toggle.
const PROJECTS_PARAM = 'projects';

function readSelectedProjectsFromUrl(): Set<string> | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get(PROJECTS_PARAM);
  if (!raw) return null;
  const keys = raw.split(',').filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

function writeSelectedProjectsToUrl(selected: Set<string> | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (selected && selected.size > 0) url.searchParams.set(PROJECTS_PARAM, [...selected].sort().join(','));
  else url.searchParams.delete(PROJECTS_PARAM);
  window.history.replaceState(window.history.state, '', url);
}

interface FlatRow {
  node: TimelineNodeDto;
  hasChildren: boolean;
}

export function Timeline({
  useData = useTimelineData,
  onOpenSettings = openKpiSettings,
  onOpenIssue = openIssue,
  onOpenIssueNewTab = openIssueNewTab,
  loadSiteUrl = getSiteUrl,
}: {
  useData?: UseTimeline;
  onOpenSettings?: () => void | Promise<void>;
  onOpenIssue?: (issueKey: string) => void | Promise<void>;
  onOpenIssueNewTab?: (issueKey: string) => void | Promise<void>;
  loadSiteUrl?: () => Promise<string>;
}) {
  const { data, pending, error, actionError, clearActionError, record: recordValue, createKpi, searchIssues, addTarget } =
    useData();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string> | null>(() =>
    readSelectedProjectsFromUrl(),
  );
  const isFirstProjectsRender = useRef(true);
  useEffect(() => {
    // Skip the initial mount — the URL already reflects `selectedProjects` (it
    // was read FROM the URL above), so there's nothing to write back yet.
    if (isFirstProjectsRender.current) {
      isFirstProjectsRender.current = false;
      return;
    }
    writeSelectedProjectsToUrl(selectedProjects);
  }, [selectedProjects]);
  const [adding, setAdding] = useState<{ node: TimelineNodeDto; date: string } | null>(null);
  const [editing, setEditing] = useState<{ node: TimelineNodeDto; reading: TimelineReadingDto } | null>(
    null,
  );
  const [creating, setCreating] = useState<{
    presetParent: { kpiId: string; name: string } | null;
  } | null>(null);
  const [addingTarget, setAddingTarget] = useState<{ node: TimelineNodeDto; date: string } | null>(
    null,
  );
  const [projecting, setProjecting] = useState<{ node: TimelineNodeDto; target: TimelineTargetDto } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [siteUrl, setSiteUrl] = useState('');

  // Site base URL for absolute /browse links (so hover/middle-click/copy don't
  // resolve against the Custom UI iframe origin). Empty until resolved.
  useEffect(() => {
    let cancelled = false;
    void loadSiteUrl().then((u) => {
      if (!cancelled) setSiteUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSiteUrl]);

  // Project filter — contributing issues can live in any Jira project.
  // `availableProjects` lists every project key seen anywhere in the tree;
  // `filteredRoots` is the subtree-filtered tree (unchanged when "All").
  const availableProjects = useMemo(
    () => (data ? collectContributingProjects(data.roots) : []),
    [data],
  );
  const filteredRoots = useMemo(
    () => (data ? filterTimelineByProjects(data.roots, selectedProjects) : []),
    [data, selectedProjects],
  );

  // Fit-to-data-range date axis (Feature 04, §4a): the domain is the union of
  // every visible KPI's readings + dated targets (always including today),
  // snapped outward to whole quarters. Built from the project-filtered tree (not
  // collapse state) so expanding/collapsing rows never reflows the axis.
  const axis = useMemo(() => {
    const today = data?.today ?? new Date().toISOString().slice(0, 10);
    const dates: string[] = [];
    const walk = (nodes: TimelineNodeDto[]) => {
      for (const node of nodes) {
        dates.push(...axisDatesOf(node));
        walk(node.children);
      }
    };
    walk(filteredRoots);
    return buildAxis(dates, today);
  }, [data, filteredRoots]);

  const flat = useMemo(() => {
    if (!data) return [];
    const rows: FlatRow[] = [];
    const walk = (nodes: TimelineNodeDto[]) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        rows.push({ node, hasChildren });
        if (hasChildren && !collapsed.has(node.id)) walk(node.children);
      }
    };
    walk(filteredRoots);
    return rows;
  }, [data, filteredRoots, collapsed]);

  // Full flattened KPI list (ignores `collapsed`) for the "+ Add KPI" parent
  // picker — every existing KPI is a valid parent, not just the visible ones.
  const kpiOptions = useMemo(() => {
    if (!data) return [];
    const options: { kpiId: string; name: string; depth: number }[] = [];
    const walk = (nodes: TimelineNodeDto[]) => {
      for (const node of nodes) {
        options.push({ kpiId: node.kpiId, name: node.name, depth: node.depth });
        walk(node.children);
      }
    };
    walk(data.roots);
    return options;
  }, [data]);

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const record = (kpiId: string, date: string, value: number | null) => {
    recordValue(kpiId, date, value);
    setAdding(null);
    setEditing(null);
  };

  const submitTarget = (input: AddTargetInput) => {
    addTarget(input);
    setAddingTarget(null);
  };

  if (error) return <div className="p-6 text-danger">Failed to load timeline: {error}</div>;
  if (pending || !data) return <div className="p-6 text-text-subtle">Loading timeline…</div>;

  // Only show the right-pinned Undated lane when at least one KPI actually has
  // undated (pending) targets — otherwise it's just dead space.
  const hasUndated = flat.some(({ node }) => node.undated.length > 0);

  return (
    <div className="p-6 text-text">
      <div className="flex items-start justify-end gap-4">
        <div className="mt-1 flex flex-none items-center gap-2">
          <ProjectFilterControl
            projects={availableProjects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
          <button
            className="flex-none rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => setCreating({ presetParent: null })}
          >
            + Add KPI
          </button>
        </div>
      </div>

      {actionError && (
        <ActionErrorBanner
          error={actionError}
          onDismiss={clearActionError}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex">
          {/* Fixed label column — the KPI names. Deliberately OUTSIDE the scroll
              container so only the quarter columns scroll horizontally. */}
          <div className="flex-none" style={{ width: LABEL_W }}>
            <div
              className="flex items-center border-b border-r border-border bg-surface-sunken px-3 text-xs font-semibold uppercase tracking-wide text-text-subtle"
              style={{ height: HEADER_H }}
            >
              KPI
            </div>
            {flat.length === 0 ? (
              <div className="border-r border-border px-3 py-6 text-sm text-text-subtle">
                {data.roots.length === 0 ? (
                  <>
                    No KPIs yet — use <strong className="text-text">+ Add KPI</strong> to create
                    your first one.
                  </>
                ) : (
                  <>
                    No KPIs match the selected project filter — try{' '}
                    <button
                      type="button"
                      className="font-medium text-brand underline"
                      onClick={() => setSelectedProjects(null)}
                    >
                      clearing it
                    </button>
                    .
                  </>
                )}
              </div>
            ) : (
              flat.map(({ node, hasChildren }) => (
                <TimelineRowLabel
                  key={node.id}
                  node={node}
                  hasChildren={hasChildren}
                  collapsed={collapsed.has(node.id)}
                  onToggleCollapse={() => toggleCollapse(node.id)}
                  onRecord={() => setAdding({ node, date: data.today })}
                  onAddTarget={() => setAddingTarget({ node, date: data.today })}
                  onAddChild={() =>
                    setCreating({ presetParent: { kpiId: node.kpiId, name: node.name } })
                  }
                  onOpenIssue={onOpenIssue}
                  siteUrl={siteUrl}
                />
              ))
            )}
          </div>

          {/* Scrolling plot column — only the quarter columns pan horizontally. */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
            <div style={{ width: axis.plotWidth + PAD_R }}>
              {/* Header row: quarter labels */}
              <div
                className="relative border-b border-border bg-surface-sunken"
                style={{ height: HEADER_H }}
              >
                {axis.quarters.map((q) => (
                  <div
                    key={q.startMs}
                    className="absolute top-0 border-l border-border py-2 pl-2 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                    style={{ left: axis.xOf(new Date(q.startMs).toISOString().slice(0, 10)) }}
                  >
                    {q.label}
                  </div>
                ))}
              </div>

              {/* Data rows */}
              {flat.map(({ node }) => (
                <TimelineRowTrack
                  key={node.id}
                  node={node}
                  axis={axis}
                  today={data.today}
                  onAddValue={(date) => setAdding({ node, date })}
                  onAddTarget={(date) => setAddingTarget({ node, date })}
                  onEditReading={(reading) => setEditing({ node, reading })}
                  onOpenIssueNewTab={onOpenIssueNewTab}
                  siteUrl={siteUrl}
                />
              ))}
            </div>
          </div>

          {/* Right-pinned "Undated" lane — pending targets that can't sit on the
              dated axis. Deliberately OUTSIDE the scroll container (Q10).
              Hidden entirely when no KPI has an undated target. */}
          {hasUndated && (
            <div className="flex-none border-l border-border" style={{ width: UNDATED_W }}>
              <div
                className="flex items-center border-b border-border bg-surface-sunken px-3 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                style={{ height: HEADER_H }}
              >
                Undated
              </div>
              {flat.map(({ node }) => (
                <UndatedLane
                  key={node.id}
                  node={node}
                  onOpenProjection={(target) => setProjecting({ node, target })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs text-text-subtle">
        Target markers show the source issue's icon · the red line is today · green = hit, red =
        missed, gray = upcoming · click a recorded value to edit or delete it.
      </p>

      {adding && (
        <RecordModal
          node={adding.node}
          defaultDate={adding.date}
          today={data.today}
          onCancel={() => setAdding(null)}
          onRecord={(date, value) => record(adding.node.kpiId, date, value)}
        />
      )}

      {editing && (
        <EditReadingModal
          node={editing.node}
          reading={editing.reading}
          onCancel={() => setEditing(null)}
          onSave={(value) => record(editing.node.kpiId, editing.reading.date, value)}
          onDelete={() => record(editing.node.kpiId, editing.reading.date, null)}
        />
      )}

      {creating && (
        <CreateKpiModal
          presetParent={creating.presetParent}
          kpiOptions={kpiOptions}
          onCancel={() => setCreating(null)}
          onCreate={(input) => {
            createKpi(input);
            setCreating(null);
          }}
        />
      )}

      {addingTarget && (
        <AddTargetModal
          node={addingTarget.node}
          defaultDate={addingTarget.date}
          searchIssues={searchIssues}
          onCancel={() => setAddingTarget(null)}
          onAdd={(issue, date, value) =>
            submitTarget({
              kpiId: addingTarget.node.kpiId,
              issueId: issue.id,
              issueKey: issue.key,
              issueType: issue.issueType,
              issueTypeIconUrl: issue.iconUrl,
              issueSummary: issue.summary,
              date,
              value,
            })
          }
        />
      )}

      {projecting && (
        <ProjectionModal
          node={projecting.node}
          target={projecting.target}
          siteUrl={siteUrl}
          onClose={() => setProjecting(null)}
          onOpenIssueNewTab={onOpenIssueNewTab}
        />
      )}
    </div>
  );
}

/**
 * Multi-select popover for the project filter — contributing issues can live
 * in any Jira project, so this lists every project key found in the current
 * tree (`availableProjects`) and lets the user narrow the timeline to a
 * subset. "All" (nothing selected) leaves the tree unchanged.
 */
function ProjectFilterControl({
  projects,
  selected,
  onChange,
}: {
  projects: string[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (projects.length === 0) return null;

  // List the selected project keys directly (rather than just a count) so the
  // active filter is legible at a glance; past a few selections, truncate to
  // keep the button from growing unbounded.
  const selectedKeys = projects.filter((key) => selected?.has(key));
  const label =
    selectedKeys.length === 0
      ? 'Project: All'
      : selectedKeys.length <= 3
        ? `Project: ${selectedKeys.join(', ')}`
        : `Project: ${selectedKeys.slice(0, 3).join(', ')} +${selectedKeys.length - 3} more`;

  const toggle = (key: string) => {
    const next = new Set(selected ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next.size === 0 ? null : next);
  };

  return (
    <div className="relative flex-none" ref={rootRef}>
      <button
        type="button"
        className="max-w-[220px] truncate rounded border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-sunken"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <ul
          className="absolute right-0 z-30 mt-1 max-h-64 w-48 overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
          role="listbox"
          aria-label="Filter by Jira project"
        >
          <li>
            <button
              type="button"
              className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
              onClick={() => onChange(null)}
            >
              All
            </button>
          </li>
          {projects.map((key) => (
            <li key={key}>
              <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-surface-sunken">
                <input
                  type="checkbox"
                  checked={selected?.has(key) ?? false}
                  onChange={() => toggle(key)}
                />
                {key}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineRowLabel({
  node,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onRecord,
  onAddTarget,
  onAddChild,
  onOpenIssue,
  siteUrl,
}: {
  node: TimelineNodeDto;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRecord: () => void;
  onAddTarget: () => void;
  onAddChild: () => void;
  onOpenIssue: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  return (
    <div
      className="group flex flex-col justify-center gap-1 border-b border-r border-border bg-surface px-3 py-1.5 last:border-b-0"
      style={{ height: ROW_H }}
    >
      <div className="flex items-center gap-2" style={{ paddingLeft: node.depth * INDENT_STEP }}>
        <button
          className={`grid h-4 w-4 flex-none place-items-center text-text-subtle ${
            hasChildren ? '' : 'invisible'
          }`}
          onClick={onToggleCollapse}
          aria-label={hasChildren ? (collapsed ? 'Expand children' : 'Collapse children') : undefined}
          aria-expanded={hasChildren ? !collapsed : undefined}
          aria-hidden={!hasChildren}
          disabled={!hasChildren}
        >
          <svg fill="none" viewBox="0 0 16 16" role="presentation" className="h-4 w-4">
            <path
              fill="currentColor"
              d={collapsed ? 'm6.03 1.47 6 6a.75.75 0 0 1 .052 1.004l-.052.056-6 6-1.06-1.06L10.44 8 4.97 2.53z' : 'm14.53 6.03-6 6a.75.75 0 0 1-1.004.052l-.056-.052-6-6 1.06-1.06L8 10.44l5.47-5.47z'}
            />
          </svg>
        </button>
        {node.issueKey ? (
          <a
            href={siteUrl ? `${siteUrl}/browse/${node.issueKey}` : `/browse/${node.issueKey}`}
            className="truncate text-sm font-semibold text-brand hover:underline"
            title={`Open ${node.name} (${node.issueKey}) in Jira`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onOpenIssue(node.issueKey);
            }}
          >
            {node.name}
          </a>
        ) : (
          <span className="truncate text-sm font-semibold">{node.name}</span>
        )}
      </div>
      <div className="flex items-center gap-2" style={{ paddingLeft: node.depth * INDENT_STEP + 24 }}>
        <span className="flex-none text-xs text-text-subtle">{node.unit}</span>
        {node.direction && (
          <span className={node.direction === 'increase' ? 'text-[11px] text-success' : 'text-[11px] text-danger'}>
            {node.direction === 'increase' ? '▲' : '▼'}
          </span>
        )}
        <button
          className="ml-auto grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onAddChild}
          aria-label="Add child KPI"
          title="Create child KPI"
        >
          <span className="text-[13px] leading-none">+</span>
        </button>
        <button
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onRecord}
          aria-label="Record a value"
          title="Record a value"
        >
          <span className="text-[13px] leading-none">●</span>
        </button>
        <button
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onAddTarget}
          aria-label="Add a target"
          title="Add a target"
        >
          <span className="text-[11px] leading-none">◇</span>
        </button>
      </div>
    </div>
  );
}

function TimelineRowTrack({
  node,
  axis,
  today,
  onAddValue,
  onAddTarget,
  onEditReading,
  onOpenIssueNewTab,
  siteUrl,
}: {
  node: TimelineNodeDto;
  axis: Axis;
  today: string;
  onAddValue: (date: string) => void;
  onAddTarget: (date: string) => void;
  onEditReading: (reading: TimelineReadingDto) => void;
  onOpenIssueNewTab: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  const plotH = ROW_H;
  // Timeline band scale: squeeze the value domain into 20–80% of the short row,
  // no ticks/labels (the KPI View uses `niceScale` instead — see @ui/plot).
  const yOf = bandScale(node, plotH);
  // Recency-weighted forward projection of the recorded trend (null with < 2
  // readings — nothing to draw). Shared with the KPI View via `projectSeries`.
  const projection = projectSeries(node.readings);

  const todayX = axis.xOf(today);

  const [hover, setHover] = useState<HoverState | null>(null);

  // Hovering anywhere on the row track reports the value at the cursor's date —
  // the measured reading when close to its dot, an interpolation in the past, or
  // the projected value past the latest reading (shared via `computeHover`).
  const onTrackMove = (e: React.MouseEvent<HTMLDivElement>) => {
    setHover(computeHover(node, axis, e, projection));
  };

  // Clicking the track adds a value: snap to a nearby recorded reading (edit /
  // delete it) or, on an empty past date, open the record modal pre-filled with
  // that date. Clicks on target markers and reading dots are handled by those
  // elements; a click that reaches the track is on open space.
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-diamond],[data-reading]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const x = Math.max(0, Math.min(rawX, axis.plotWidth));
    const t = axis.domainStart + (x / axis.plotWidth) * (axis.domainEnd - axis.domainStart);
    const dateISO = new Date(t).toISOString().slice(0, 10);
    // Near an existing target? Leave it to the diamond's own tooltip.
    if (node.targets.some((tg) => tg.date !== null && Math.abs(axis.xOf(tg.date) - rawX) < 8)) return;
    // Past/today opens the record-a-value modal; a future date opens the
    // add-a-target modal — both pre-filled with the clicked date.
    if (dateISO <= today) onAddValue(dateISO);
    else onAddTarget(dateISO);
  };

  return (
    // The track cell carries BOTH the fixed ROW_H and the bottom border so the
    // border-box height absorbs the 1px border — matching the label / undated
    // cells exactly (which do the same). Keeping the border on a height-less
    // wrapper instead would add 1px per row, drifting the plot gridlines out of
    // step with the label column.
    <div
      className="group relative cursor-pointer border-b border-border last:border-b-0"
      style={{ width: axis.plotWidth + PAD_R, height: ROW_H }}
      onClick={onTrackClick}
      onMouseMove={onTrackMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* progressive-load shimmer: relative/rolled-up targets still resolving (FR-20/25) */}
      {node.resolving && (
        <div
          className="absolute inset-2 animate-pulse rounded bg-surface-sunken"
          aria-label="Resolving targets…"
        />
      )}
      {/* quarter gridlines */}
      {axis.quarters.map((q) => (
        <div
          key={q.startMs}
          className="absolute top-0 bottom-0 w-px bg-border"
          style={{ left: axis.xOf(new Date(q.startMs).toISOString().slice(0, 10)) }}
        />
      ))}
      {/* today line */}
      <div
        className="absolute top-0 bottom-0 w-0 border-l border-dashed border-danger opacity-80"
        style={{ left: todayX }}
      />

      {/* sparkline */}
      {node.readings.length === 0 ? (
        <span className="absolute left-12 top-1/2 -translate-y-1/2 text-[11px] text-text-subtle">
          No values yet — click a past date to add
        </span>
      ) : (
        <Sparkline readings={node.readings} axis={axis} yOf={yOf} plotH={plotH} />
      )}

      {/* dashed recency-weighted projection of the recorded trend (≥ 2 readings) */}
      {projection && <ProjectionLine projection={projection} axis={axis} yOf={yOf} plotH={plotH} />}

      {/* clickable reading dots — click to edit or delete the value */}
      {node.readings.map((r, i) => (
        <ReadingDot key={i} reading={r} node={node} axis={axis} y={yOf(r.value)} onEdit={onEditReading} />
      ))}

      {/* target markers (dated only; undated go to the Undated lane) */}
      {node.targets
        .filter((t): t is TimelineTargetDto & { date: string } => t.date !== null)
        .map((t, i) => (
          <TargetMarker
            key={i}
            target={t}
            node={node}
            axis={axis}
            y={yOf(t.value)}
            onOpenIssueNewTab={onOpenIssueNewTab}
            siteUrl={siteUrl}
          />
        ))}

      {/* hover: crosshair follows the cursor; a floating tooltip reports the
          value (measured / interpolated) at that date. */}
      {hover && <PlotCrosshair x={hover.x} />}
      {hover && <PlotTooltip hover={hover} />}
    </div>
  );
}

/** Right-pinned lane cell: chips for a KPI's pending (undated) targets (FR-24). */
function UndatedLane({
  node,
  onOpenProjection,
}: {
  node: TimelineNodeDto;
  onOpenProjection: (target: TimelineTargetDto) => void;
}) {
  return (
    <div
      className="flex flex-wrap content-center items-center gap-1 border-b border-border px-2 last:border-b-0"
      style={{ height: ROW_H }}
    >
      {node.undated.map((t, i) => (
        <button
          key={i}
          type="button"
          className="rounded border border-dashed border-text-subtle px-1.5 py-0.5 text-[11px] text-text-subtle hover:border-brand hover:text-brand"
          title={`Projected ${t.provisional ? '≈ ' : ''}${fmtVal(t.value)} ${node.unit} · date TBD — click for details`}
          onClick={() => onOpenProjection(t)}
        >
          {t.provisional ? '≈ ' : ''}
          {fmtVal(t.value)}
        </button>
      ))}
    </div>
  );
}

function ActionErrorBanner({
  error,
  onDismiss,
  onOpenSettings,
}: {
  error: TimelineActionError;
  onDismiss: () => void;
  onOpenSettings: () => void | Promise<void>;
}) {
  const spaceNotSetUp = error.kind === 'space-not-set-up';
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-lg border border-danger bg-surface px-4 py-3 text-sm"
    >
      <div className="flex-1">
        <p className="font-semibold text-danger">
          {spaceNotSetUp ? 'KPI space isn’t set up' : 'Couldn’t save your change'}
        </p>
        <p className="mt-0.5 text-text-subtle">
          {spaceNotSetUp
            ? 'Create or select the project that stores your KPIs in Settings, then try again.'
            : error.message}
        </p>
        {spaceNotSetUp && (
          <button
            className="mt-2 rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => void onOpenSettings()}
          >
            Open Settings
          </button>
        )}
      </div>
      <button
        className="flex-none rounded px-2 py-1 text-text-subtle hover:text-text"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

/** A KPI candidate for the "+ Add KPI" parent picker — every existing KPI. */
interface KpiParentOption {
  kpiId: string;
  name: string;
  depth: number;
}

function CreateKpiModal({
  presetParent,
  kpiOptions,
  onCancel,
  onCreate,
}: {
  /** Fixed parent from the row-level "add child" (⤵) trigger — no picker shown. */
  presetParent: { kpiId: string; name: string } | null;
  /** Every existing KPI, for the optional parent picker (only used when `presetParent` is null). */
  kpiOptions: KpiParentOption[];
  onCancel: () => void;
  onCreate: (input: CreateKpiInput) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState<'increase' | 'decrease' | 'none'>('increase');
  const [parent, setParent] = useState<KpiParentOption | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    if (name.trim() === '') return;
    onCreate({
      name: name.trim(),
      unit: unit.trim(),
      direction: direction === 'none' ? null : direction,
      parentKpiId: presetParent ? presetParent.kpiId : (parent?.kpiId ?? null),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,30,66,0.54)]"
      onClick={onCancel}
    >
      <div
        className="w-[380px] max-w-[calc(100vw-32px)] rounded-lg bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold">New KPI</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {presetParent ? (
              <>
                Nested under <strong className="text-text">{presetParent.name}</strong>
              </>
            ) : (
              'A new top-level KPI, or choose a parent below'
            )}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Name
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={name}
              placeholder="e.g. Revenue"
              autoFocus
              aria-label="KPI name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Unit
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={unit}
              placeholder="e.g. USD"
              aria-label="KPI unit"
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Direction
            <select
              className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              value={direction}
              aria-label="KPI direction"
              onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease' | 'none')}
            >
              <option value="increase">Higher is better</option>
              <option value="decrease">Lower is better</option>
              <option value="none">No direction</option>
            </select>
          </label>
          {!presetParent && (
            <label className="text-xs text-text-subtle">
              Parent KPI <span className="text-text-subtle">(optional)</span>
              <KpiParentCombobox options={kpiOptions} value={parent} onChange={setParent} />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            onClick={submit}
            disabled={name.trim() === ''}
          >
            Create KPI
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A type-ahead picker over the existing KPI tree for the optional "Parent KPI"
 * field on "+ Add KPI" — synchronous/local-filtered (the whole tree is already
 * loaded), unlike `IssueCombobox`'s async Jira search. Options are indented by
 * `depth` so the hierarchy stays visible while picking.
 */
function KpiParentCombobox({
  options,
  value,
  onChange,
}: {
  options: KpiParentOption[];
  value: KpiParentOption | null;
  onChange: (option: KpiParentOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? options : options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (option: KpiParentOption) => {
    onChange(option);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    }
  };

  if (value) {
    return (
      <div className="mt-0.5 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm">
        <span className="truncate">{value.name}</span>
        <button
          type="button"
          className="ml-auto flex-none rounded px-1 text-text-subtle hover:text-text"
          aria-label="Clear parent KPI"
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="relative mt-0.5" ref={rootRef}>
      <input
        className="w-full rounded border border-border px-2 py-1.5 text-sm"
        placeholder="Search KPIs…"
        aria-label="Search for a parent KPI"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
          role="listbox"
        >
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-text-subtle">No matching KPIs</li>
          )}
          {matches.map((option, i) => (
            <li key={option.kpiId} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${
                  i === active ? 'bg-surface-sunken' : ''
                }`}
                style={{ paddingLeft: 8 + option.depth * 12 }}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option)}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Add a target to a KPI, held on a contributing work issue chosen from a
 * type-ahead issue picker (like Jira's Parent field). The target is due on an
 * absolute date, pre-filled from the clicked position on the timeline.
 */
function AddTargetModal({
  node,
  defaultDate,
  searchIssues,
  onCancel,
  onAdd,
}: {
  node: TimelineNodeDto;
  defaultDate: string;
  searchIssues: (query: string) => Promise<IssuePickerItem[]>;
  onCancel: () => void;
  onAdd: (issue: IssuePickerItem, date: string, value: number) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');
  const [issue, setIssue] = useState<IssuePickerItem | null>(null);

  // Each KPI target lives on a distinct contributing issue — one target per
  // (issue, KPI). Issues already targeting this KPI can't be picked again.
  const excludedKeys = useMemo(
    () => new Set(node.targets.map((t) => t.source.issue)),
    [node.targets],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const num = Number(value.replace(/,/g, ''));
  const valid =
    issue !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    value.trim() !== '' &&
    !Number.isNaN(num);

  const submit = () => {
    if (valid && issue) onAdd(issue, date, num);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,30,66,0.54)]"
      onClick={onCancel}
    >
      <div
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-lg bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold">Add target</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {node.name} · {node.unit}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Issue
            <IssueCombobox
              searchIssues={searchIssues}
              value={issue}
              onChange={setIssue}
              excludedKeys={excludedKeys}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Date
            <input
              type="date"
              className="mt-0.5 h-9 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-subtle">
            Target value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={value}
              placeholder="e.g. 1,300,000"
              aria-label="Target value"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            onClick={submit}
            disabled={!valid}
          >
            Add target
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A type-ahead issue picker — a plain input + filtered dropdown wired to the
 * Jira issue-picker endpoint via `searchIssues`, mirroring how the native Parent
 * field behaves (debounced search, recents on focus, keyboard navigation). Once
 * an issue is chosen it collapses to a compact chip with a clear affordance.
 */
function IssueCombobox({
  searchIssues,
  value,
  onChange,
  excludedKeys,
}: {
  searchIssues: (query: string) => Promise<IssuePickerItem[]>;
  value: IssuePickerItem | null;
  onChange: (item: IssuePickerItem | null) => void;
  /** issue keys that already have a target for this KPI — shown but not selectable */
  excludedKeys?: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<IssuePickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const excluded = excludedKeys ?? EMPTY_KEYS;
  // Keyboard navigation + Enter operate over the selectable (non-excluded) rows.
  const selectable = items.filter((i) => !excluded.has(i.key));

  // Debounced search while the dropdown is open; the latest response wins.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const h = setTimeout(() => {
      void Promise.resolve(searchIssues(query)).then((res) => {
        if (cancelled) return;
        setItems(res);
        setActive(0);
        setLoading(false);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [query, open, searchIssues]);

  // Close the dropdown when clicking outside the control.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (item: IssuePickerItem) => {
    onChange(item);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, selectable.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && selectable[active]) {
        e.preventDefault();
        choose(selectable[active]);
      }
    }
  };

  if (value) {
    return (
      <div className="mt-0.5 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm">
        <span className="flex-none font-medium text-brand">{value.key}</span>
        <span className="truncate text-text-subtle">{value.summary}</span>
        <button
          type="button"
          className="ml-auto flex-none rounded px-1 text-text-subtle hover:text-text"
          aria-label="Clear selected issue"
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="relative mt-0.5" ref={rootRef}>
      <input
        className="w-full rounded border border-border px-2 py-1.5 text-sm"
        placeholder="Search issues by key or summary…"
        aria-label="Search for an issue"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
          role="listbox"
        >
          {loading && <li className="px-2 py-1.5 text-xs text-text-subtle">Searching…</li>}
          {!loading && items.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-text-subtle">No matching issues</li>
          )}
          {!loading &&
            items.map((item) => {
              if (excluded.has(item.key)) {
                return (
                  <li
                    key={item.key}
                    role="option"
                    aria-disabled="true"
                    aria-selected={false}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm opacity-50"
                  >
                    <span className="flex-none font-medium">{item.key}</span>
                    <span className="truncate text-text-subtle">{item.summary}</span>
                    <span className="ml-auto flex-none whitespace-nowrap text-[11px] text-text-subtle">
                      already has a target
                    </span>
                  </li>
                );
              }
              const i = selectable.indexOf(item);
              return (
                <li key={item.key} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${
                      i === active ? 'bg-surface-sunken' : ''
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    <span className="flex-none font-medium text-brand">{item.key}</span>
                    <span className="truncate text-text-subtle">{item.summary}</span>
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
