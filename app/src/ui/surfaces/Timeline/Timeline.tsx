import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import AddIcon from '@atlaskit/icon/core/add';
import ArrowDownIcon from '@atlaskit/icon/core/arrow-down';
import ArrowUpIcon from '@atlaskit/icon/core/arrow-up';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import CrossIcon from '@atlaskit/icon/core/cross';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import Select, { AsyncSelect, CheckboxSelect, type ClearIndicatorProps } from '@atlaskit/select';
import Textfield from '@atlaskit/textfield';
import Tooltip from '@atlaskit/tooltip';
import {
  toActionError,
  useTimelineData,
  type UseTimeline,
  type TimelineActionError,
} from '@ui/data/useTimelineData/index.js';
import { openKpiSettings, openIssue, openIssueNewTab, getSiteUrl } from '@ui/bridge.js';
import { DisabledReason } from '@ui/components/DisabledReason/index.js';
import {
  buildAxis,
  axisDatesOf,
  initialScrollLeft,
  initialViewQuarterStart,
  scrollShiftForAxisChange,
  useBandScale,
  useClientWidth,
  computeHover,
  fmtVal,
  ModalField,
  ModalSubtitle,
  PAD_R,
  useModalSave,
  PlotCrosshair,
  PlotTooltip,
  ProjectionLine,
  ProjectionModal,
  PlotKey,
  KeyHighlightProvider,
  Dimmable,
  flattenNodes,
  summarizeKey,
  undatedKeyKinds,
  useKeyHighlight,
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
  kpiPermissionMessage,
  kpiSpaceNoAccessMessage,
  projectSeries,
  type KpiSpaceAccess,
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
 * range is genuinely wider than the viewport. A narrower range is padded with
 * future quarters so the plot fills the viewport. Sparklines of recorded readings,
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

/**
 * Why each KPI-space action is unavailable to this user (spec 10), or null when
 * allowed. No `access` (no KPI space yet, or an older backend) allows everything.
 */
function blockedReasons(access: KpiSpaceAccess | undefined): {
  browse: string | null;
  add: string | null;
  record: string | null;
  nest: string | null;
} {
  return {
    browse: access && !access.browse ? kpiSpaceNoAccessMessage() : null,
    add: access && !access.create ? kpiPermissionMessage('add') : null,
    record: access && !access.edit ? kpiPermissionMessage('record') : null,
    nest: access && !access.link ? kpiPermissionMessage('nest') : null,
  };
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
  const {
    data,
    pending,
    targetsPending,
    targetsError,
    retryTargets,
    error,
    record: recordValue,
    createKpi,
    searchIssues,
    addTarget,
  } = useData();
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [measureScroll, scrollWidth] = useClientWidth<HTMLDivElement>();
  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      measureScroll(el);
    },
    [measureScroll],
  );
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
  // The filter matches on the projects of each KPI's targets, which don't exist
  // until Phase 2 lands — so until then every KPI shows (shimmering) and the
  // saved selection is applied the moment targets arrive.
  const filteredRoots = useMemo(
    () => (data ? filterTimelineByProjects(data.roots, targetsPending ? null : selectedProjects) : []),
    [data, selectedProjects, targetsPending],
  );

  // Fit-to-data-range date axis (Feature 04, §4a): the domain is the union of
  // every visible KPI's readings + dated targets (always including today),
  // snapped outward to whole quarters, then padded with future quarters to fill
  // the visible plot width. Built from the project-filtered tree (not
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
    return buildAxis(dates, today, {
      minWidth: scrollWidth - PAD_R,
      viewStart: initialViewQuarterStart(today),
    });
  }, [data, filteredRoots, scrollWidth]);

  // Scroll behavior (spec 06 P4). Once per page load, open with the current
  // quarter at the left edge (the previous one during its first month). After
  // that, whenever the axis grows to the LEFT (an earlier target arrived, or the
  // filter changed), shift scrollLeft by the added width so what is on screen
  // doesn't move; growth to the right moves nothing. Never resets the user's scroll.
  // The initial scroll waits for the viewport to be measured: until then the axis
  // has no room to the right of the current quarter and scrollLeft would be clamped.
  const didInitialScroll = useRef(false);
  const prevDomainStart = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !data) return;
    if (!didInitialScroll.current) {
      if (scrollWidth <= 0) {
        prevDomainStart.current = axis.domainStart;
        return;
      }
      didInitialScroll.current = true;
      el.scrollLeft = initialScrollLeft(axis, data.today);
    } else if (prevDomainStart.current !== null && prevDomainStart.current !== axis.domainStart) {
      el.scrollLeft += scrollShiftForAxisChange(axis, prevDomainStart.current);
    }
    prevDomainStart.current = axis.domainStart;
  }, [data, axis, scrollWidth]);

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

  // Full flattened KPI list (ignores `collapsed`) for the "Add KPI" parent
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

  // Key bar (spec 08): counts follow the project filter and include collapsed
  // descendants, so expanding/collapsing rows never changes them.
  const keySummary = useMemo(() => summarizeKey(flattenNodes(filteredRoots)), [filteredRoots]);
  const highlight = useKeyHighlight(keySummary);

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const record = async (kpiId: string, date: string, value: number | null) => {
    await recordValue(kpiId, date, value);
    setAdding(null);
    setEditing(null);
  };

  const submitTarget = async (input: AddTargetInput) => {
    await addTarget(input);
    setAddingTarget(null);
  };

  if (error) return <div className="p-6 text-danger">Failed to load timeline: {error}</div>;
  if (pending || !data) {
    // Same wrapper and span styling as "Loading targets…" so the two states look identical and sit in the same spot
    return (
      <div className="p-6 text-text">
        <div className="flex items-start justify-end gap-4">
          <span role="status" className="mr-auto mt-3 animate-pulse text-sm text-text-subtle">
            Loading timeline…
          </span>
          <div className="mt-1 min-h-[40px] flex-none" />
        </div>
      </div>
    );
  }

  // Only show the right-pinned Undated lane when at least one KPI actually has
  // undated (pending) targets — otherwise it's just dead space.
  const hasUndated = flat.some(({ node }) => node.undated.length > 0);
  const blocked = blockedReasons(data.access);

  return (
    <div className="p-6 text-text">
      <div className="flex items-start justify-end gap-4">
        {targetsPending && (
          <span role="status" className="mr-auto mt-3 animate-pulse text-sm text-text-subtle">
            Loading targets…
          </span>
        )}
        {/* min-h reserves the filter control's height so the table doesn't jump when it appears with the targets */}
        <div className="mt-1 flex min-h-[40px] flex-none items-center gap-2">
          <ProjectFilterControl
            projects={availableProjects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
          <DisabledReason reason={blocked.add}>
            <Button
              appearance="primary"
              iconBefore={AddIcon}
              isDisabled={blocked.add !== null}
              onClick={() => setCreating({ presetParent: null })}
            >
              Add KPI
            </Button>
          </DisabledReason>
        </div>
      </div>

      {targetsError && <TargetsErrorBanner message={targetsError} onRetry={retryTargets} />}

      <KeyHighlightProvider active={highlight.active}>
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          <PlotKey summary={keySummary} highlight={highlight} className="border-b border-border" />
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
                  {blocked.browse ? (
                    blocked.browse
                  ) : data.roots.length === 0 ? (
                    <>
                      No KPIs yet — use <strong className="text-text">Add KPI</strong> to create
                      your first one.
                    </>
                  ) : (
                    <>
                      No KPIs match the selected project filter — try{' '}
                      <Button appearance="subtle" spacing="compact" onClick={() => setSelectedProjects(null)}>
                        clearing it
                      </Button>
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
                    recordBlocked={blocked.record}
                    addChildBlocked={blocked.add ?? blocked.nest}
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
            <div ref={setScrollEl} className="min-w-0 flex-1 overflow-x-auto">
              <div style={{ width: axis.plotWidth + PAD_R }}>
                {/* Header row: quarter labels (clipped — the last, viewport-filling
                    quarter may be only partly visible) */}
                <div
                  className="relative overflow-hidden border-b border-border bg-surface-sunken"
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
                    recordBlocked={blocked.record}
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
      </KeyHighlightProvider>

      {!blocked.browse && (
        <p className="mt-3 text-xs text-text-subtle">
          <span className="font-semibold">Tip:</span>{' '}
          {blocked.record
            ? 'click a future date to add a target · click a target to open its issue.'
            : 'click a past date to record a value · click a future date to add a target · click a value to edit it · click a target to open its issue.'}
        </p>
      )}

      <ModalTransition>
        {adding && (
          <RecordModal
            node={adding.node}
            defaultDate={adding.date}
            today={data.today}
            onCancel={() => setAdding(null)}
            onRecord={(date, value) => record(adding.node.kpiId, date, value)}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {editing && (
          <EditReadingModal
            node={editing.node}
            reading={editing.reading}
            onCancel={() => setEditing(null)}
            onSave={(value) => record(editing.node.kpiId, editing.reading.date, value)}
            onDelete={() => record(editing.node.kpiId, editing.reading.date, null)}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {creating && (
          <CreateKpiModal
            presetParent={creating.presetParent}
            kpiOptions={kpiOptions}
            nestBlocked={blocked.nest}
            onCancel={() => setCreating(null)}
            onOpenSettings={onOpenSettings}
            onCreate={async (input) => {
              await createKpi(input);
              setCreating(null);
            }}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {addingTarget && (
          <AddTargetModal
            node={addingTarget.node}
            defaultDate={addingTarget.date}
            searchIssues={searchIssues}
            onOpenSettings={onOpenSettings}
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
      </ModalTransition>

      <ModalTransition>
        {projecting && (
          <ProjectionModal
            node={projecting.node}
            target={projecting.target}
            siteUrl={siteUrl}
            onClose={() => setProjecting(null)}
            onOpenIssueNewTab={onOpenIssueNewTab}
          />
        )}
      </ModalTransition>
    </div>
  );
}

/**
 * Multi-select popover for the project filter — contributing issues can live
 * in any Jira project, so this lists every project key found in the current
 * tree (`availableProjects`) and lets the user narrow the timeline to a
 * subset. "All" (nothing selected) leaves the tree unchanged.
 */
type ProjectOption = { label: string; value: string };
const ALL_PROJECTS = '__all__';

function ProjectFilterControl({
  projects,
  selected,
  onChange,
}: {
  projects: string[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  if (projects.length === 0) return null;

  // List the selected project keys directly (rather than just a count) so the
  // active filter is legible at a glance; past a few selections, truncate to
  // keep the control from growing unbounded.
  const selectedKeys = projects.filter((key) => selected?.has(key));
  const label =
    selectedKeys.length === 0
      ? 'Project: All'
      : selectedKeys.length <= 3
        ? `Project: ${selectedKeys.join(', ')}`
        : `Project: ${selectedKeys.slice(0, 3).join(', ')} +${selectedKeys.length - 3} more`;

  const options: ProjectOption[] = [
    { label: 'All', value: ALL_PROJECTS },
    ...projects.map((key) => ({ label: key, value: key })),
  ];
  // "All" shows as checked exactly when nothing is selected.
  const value = selectedKeys.length === 0 ? [options[0]] : options.filter((o) => selected?.has(o.value));

  return (
    <div className="w-[220px] flex-none">
      <CheckboxSelect<ProjectOption>
        aria-label="Filter by Jira project"
        isSearchable={false}
        isClearable={false}
        options={options}
        value={value}
        controlShouldRenderValue={false}
        hideSelectedOptions={false}
        placeholder={label}
        styles={{
          menu: (base) => ({ ...base, zIndex: 30 }),
          placeholder: (base) => ({ ...base, color: 'var(--ds-text, #172B4D)' }),
        }}
        onChange={(next, meta) => {
          if (meta.option?.value === ALL_PROJECTS) return onChange(null);
          const keys = next.map((o) => o.value).filter((v) => v !== ALL_PROJECTS);
          onChange(keys.length === 0 ? null : new Set(keys));
        }}
      />
    </div>
  );
}

function TimelineRowLabel({
  node,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onRecord,
  recordBlocked = null,
  addChildBlocked = null,
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
  /** why recording a value is disabled (spec 10), or null */
  recordBlocked?: string | null;
  /** why adding a child KPI is disabled (spec 10), or null */
  addChildBlocked?: string | null;
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
          {collapsed ? <ChevronRightIcon label="" size="small" /> : <ChevronDownIcon label="" size="small" />}
        </button>
        {node.issueKey ? (
          <Tooltip content={`Open ${node.name} (${node.issueKey}) in Jira`}>
            {(tooltipProps) => (
              <a
                {...tooltipProps}
                href={siteUrl ? `${siteUrl}/browse/${node.issueKey}` : `/browse/${node.issueKey}`}
                className="truncate text-sm font-semibold text-brand hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onOpenIssue(node.issueKey);
                }}
              >
                {node.name}
              </a>
            )}
          </Tooltip>
        ) : (
          <span className="truncate text-sm font-semibold">{node.name}</span>
        )}
      </div>
      <div className="relative flex min-w-0 items-center gap-2" style={{ paddingLeft: node.depth * INDENT_STEP + 24 }}>
        <span className="min-w-0 truncate text-xs text-text-subtle" title={node.unit || 'No unit'}>
          {node.unit || '—'}
        </span>
        {node.direction && (
          <span
            className={`flex-none ${node.direction === 'increase' ? 'text-success' : 'text-danger'}`}
            title={node.direction === 'increase' ? 'Higher is better' : 'Lower is better'}
          >
            {node.direction === 'increase' ? (
              <ArrowUpIcon label="Higher is better" size="small" />
            ) : (
              <ArrowDownIcon label="Lower is better" size="small" />
            )}
          </span>
        )}
        {/* Overlaid (not in flow) so long units get the full width at rest; actions cover the tail on hover/focus. */}
        <div className="absolute inset-y-0 right-0 flex items-center gap-2 bg-surface pl-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <RowAction
            tooltip="Create child KPI"
            label="Add child KPI"
            glyph="+"
            glyphClass="text-[13px]"
            onClick={onAddChild}
            disabledReason={addChildBlocked}
          />
          <RowAction
            tooltip="Record a value"
            label="Record a value"
            glyph="●"
            glyphClass="text-[13px]"
            onClick={onRecord}
            disabledReason={recordBlocked}
          />
          <RowAction tooltip="Add a target" label="Add a target" glyph="◇" glyphClass="text-[11px]" onClick={onAddTarget} />
        </div>
      </div>
    </div>
  );
}

/** Hover-revealed text-glyph action in a row label (glyphs are part of the design, so no icon set). */
function RowAction({
  tooltip,
  label,
  glyph,
  glyphClass,
  onClick,
  disabledReason = null,
}: {
  tooltip: string;
  label: string;
  glyph: string;
  glyphClass: string;
  onClick: () => void;
  /** when set, the action is disabled and its tooltip says why (spec 10) */
  disabledReason?: string | null;
}) {
  const disabled = disabledReason !== null;
  return (
    // aria-disabled (not `disabled`) keeps the button focusable and hoverable so the reason can show.
    <Tooltip content={disabledReason ?? tooltip}>
      {(tooltipProps) => (
        <button
          {...tooltipProps}
          className={`grid h-[22px] w-[22px] flex-none place-items-center rounded text-text-subtle ${
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-sunken hover:text-brand'
          }`}
          onClick={disabled ? undefined : onClick}
          aria-label={label}
          aria-disabled={disabled || undefined}
        >
          <span className={`${glyphClass} leading-none`}>{glyph}</span>
        </button>
      )}
    </Tooltip>
  );
}

function TimelineRowTrack({
  node,
  axis,
  today,
  recordBlocked = null,
  onAddValue,
  onAddTarget,
  onEditReading,
  onOpenIssueNewTab,
  siteUrl,
}: {
  node: TimelineNodeDto;
  axis: Axis;
  today: string;
  /** why the user can't record values (spec 10); past dates and dots are then inert */
  recordBlocked?: string | null;
  onAddValue: (date: string) => void;
  onAddTarget: (date: string) => void;
  onEditReading: (reading: TimelineReadingDto) => void;
  onOpenIssueNewTab: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  const plotH = ROW_H;
  // Timeline band scale: squeeze the value domain into 25–75% of the short row,
  // no ticks/labels (the KPI View uses `niceScale` instead — see @ui/plot). It
  // glides to the wider range when the row's targets arrive (`settled` = done).
  const { yOf, settled } = useBandScale(node, plotH);
  // Recency-weighted forward projection of the recorded trend (null with < 2
  // readings — nothing to draw). Shared with the KPI View via `projectSeries`.
  const projection = projectSeries(node.readings);

  const todayX = axis.xOf(today);

  const [hover, setHover] = useState<HoverState | null>(null);

  // Hovering anywhere on the row track reports the value at the cursor's date —
  // the measured reading when close to its dot, an interpolation in the past, or
  // the projected value past the latest reading (shared via `computeHover`).
  const resolving = node.resolving === true;
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
    const t = axis.msAt(x);
    const dateISO = new Date(t).toISOString().slice(0, 10);
    // Near an existing target? Leave it to the diamond's own tooltip.
    if (node.targets.some((tg) => tg.date !== null && Math.abs(axis.xOf(tg.date) - rawX) < 8)) return;
    // Past/today opens the record-a-value modal; a future date opens the
    // add-a-target modal — both pre-filled with the clicked date.
    if (dateISO > today) onAddTarget(dateISO);
    else if (!recordBlocked) onAddValue(dateISO);
  };

  return (
    // The track cell carries BOTH the fixed ROW_H and the bottom border so the
    // border-box height absorbs the 1px border — matching the label / undated
    // cells exactly (which do the same). Keeping the border on a height-less
    // wrapper instead would add 1px per row, drifting the plot gridlines out of
    // step with the label column.
    <div
      aria-busy={resolving || undefined}
      className="group relative cursor-pointer border-b border-border last:border-b-0"
      style={{ width: axis.plotWidth + PAD_R, height: ROW_H }}
      onClick={onTrackClick}
      onMouseMove={onTrackMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* quarter gridlines */}
      {axis.quarters.map((q) => (
        <div
          key={q.startMs}
          className="absolute top-0 bottom-0 w-px bg-border"
          style={{ left: axis.xOf(new Date(q.startMs).toISOString().slice(0, 10)) }}
        />
      ))}
      {/* today line — solid brand blue (red is reserved for "missed") */}
      <div
        className="absolute top-0 bottom-0 w-0 border-l-2 border-brand opacity-60"
        style={{ left: todayX - 1 }}
      />
      {/* Can't record: the past side of the track isn't clickable (future clicks
          still add targets), so drop the pointer cursor there. Clicks pass through
          to the track, which ignores past dates. */}
      {recordBlocked && (
        <div
          className="absolute top-0 bottom-0 left-0 cursor-default"
          style={{ width: Math.max(0, Math.min(todayX, axis.plotWidth + PAD_R)) }}
        />
      )}

      {/* sparkline */}
      {node.readings.length === 0 ? (
        <span className="absolute left-12 top-1/2 -translate-y-1/2 text-[11px] text-text-subtle">
          {recordBlocked ? 'No values yet' : 'No values yet — click a past date to add'}
        </span>
      ) : (
        <Sparkline readings={node.readings} axis={axis} yOf={yOf} plotH={plotH} />
      )}

      {/* dashed recency-weighted projection of the recorded trend (≥ 2 readings) */}
      {projection && <ProjectionLine projection={projection} axis={axis} yOf={yOf} plotH={plotH} />}

      {/* clickable reading dots — click to edit or delete the value */}
      {node.readings.map((r, i) => (
        <ReadingDot
          key={i}
          reading={r}
          node={node}
          axis={axis}
          y={yOf(r.value)}
          onEdit={onEditReading}
          editBlocked={recordBlocked}
        />
      ))}

      {/* target markers (dated only; undated go to the Undated lane) */}
      {settled &&
        node.targets
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
        <Dimmable key={i} kinds={undatedKeyKinds(t)}>
          <Tooltip
            content={`Projected ${t.provisional ? '≈ ' : ''}${fmtVal(t.value)} ${node.unit} · date TBD — click for details`}
          >
            <Button spacing="compact" onClick={() => onOpenProjection(t)}>
              {t.provisional ? '≈ ' : ''}
              {fmtVal(t.value)}
            </Button>
          </Tooltip>
        </Dimmable>
      ))}
    </div>
  );
}

/** Errors a Jira admin fixes in Settings: shown with an "Open Settings" button instead of the raw message. */
const SETUP_ERRORS = {
  'space-not-set-up': {
    title: 'KPI space isn’t set up',
    body: 'Create or select the project that stores your KPIs in Settings, then try again.',
  },
  'hierarchy-not-set-up': {
    title: 'KPI nesting isn’t set up',
    body: 'Choose the Jira issue link type that nests KPIs in Settings, then try again — or leave the parent empty.',
  },
} as const;

function ActionErrorBanner({
  error,
  onDismiss,
  onOpenSettings,
}: {
  error: TimelineActionError;
  onDismiss: () => void;
  onOpenSettings: () => void | Promise<void>;
}) {
  const setup = error.kind === 'generic' ? null : SETUP_ERRORS[error.kind];
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-lg border border-danger bg-surface px-4 py-3 text-sm"
    >
      <div className="flex-1">
        <p className="font-semibold text-danger">{setup ? setup.title : 'Couldn’t save your change'}</p>
        <p className="mt-0.5 text-text-subtle">{setup ? setup.body : error.message}</p>
        {setup && (
          <div className="mt-2">
            <Button appearance="primary" onClick={() => void onOpenSettings()}>
              Open Settings
            </Button>
          </div>
        )}
      </div>
      <Button appearance="subtle" spacing="compact" aria-label="Dismiss" onClick={onDismiss}>
        <CrossIcon label="" size="small" />
      </Button>
    </div>
  );
}

/**
 * Phase 2 (targets) failed: the KPIs and readings are still on screen, so this
 * is an inline, retryable banner rather than the full-screen error.
 */
function TargetsErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-lg border border-danger bg-surface px-4 py-3 text-sm"
    >
      <div className="flex-1">
        <p className="font-semibold text-danger">Couldn’t load targets</p>
        <p className="mt-0.5 text-text-subtle">
          Your KPIs and values are shown, but their targets are missing. {message}
        </p>
        <div className="mt-2">
          <Button appearance="primary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A KPI candidate for the "Add KPI" parent picker — every existing KPI. */
interface KpiParentOption {
  kpiId: string;
  name: string;
  depth: number;
}

/** Clear affordance for the pickers, drawn with the Atlassian cross icon. */
function ClearIndicator<T>({ innerProps }: ClearIndicatorProps<T, false>) {
  return (
    <div
      {...innerProps}
      aria-hidden="true"
      className="flex cursor-pointer items-center px-2 text-text-subtle hover:text-text"
    >
      <CrossIcon label="" size="small" />
    </div>
  );
}

/**
 * Selects inside the scrollable ModalBody: render the menu in a body-level portal
 * (above the dialog and its footer) so it is never clipped or covered.
 */
const MODAL_MENU_PROPS = {
  menuPosition: 'fixed',
  menuPortalTarget: typeof document === 'undefined' ? undefined : document.body,
  styles: { menuPortal: (base: object) => ({ ...base, zIndex: 1000 }) },
} as const;

type DirectionOption = { label: string; value: 'increase' | 'decrease' | 'none' };
const DIRECTION_OPTIONS: DirectionOption[] = [
  { label: 'Higher is better', value: 'increase' },
  { label: 'Lower is better', value: 'decrease' },
  { label: 'No direction', value: 'none' },
];

function CreateKpiModal({
  presetParent,
  kpiOptions,
  nestBlocked = null,
  onCancel,
  onCreate,
  onOpenSettings,
}: {
  /** Fixed parent from the row-level "add child" (⤵) trigger — no picker shown. */
  presetParent: { kpiId: string; name: string } | null;
  /** Every existing KPI, for the optional parent picker (only used when `presetParent` is null). */
  kpiOptions: KpiParentOption[];
  /** why nesting is disabled (no Link Issues, spec 10): the parent picker is disabled with this reason */
  nestBlocked?: string | null;
  onCancel: () => void;
  /** Resolves once the KPI is saved; rejects with the failure (shown in the modal). */
  onCreate: (input: CreateKpiInput) => Promise<void>;
  onOpenSettings: () => void | Promise<void>;
}) {
  const { saving, error, clearError, run } = useModalSave();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState<DirectionOption>(DIRECTION_OPTIONS[0]);
  const [parent, setParent] = useState<KpiParentOption | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    if (name.trim() === '' || saving) return;
    void run(() =>
      onCreate({
        name: name.trim(),
        unit: unit.trim(),
        direction: direction.value === 'none' ? null : direction.value,
        parentKpiId: presetParent ? presetParent.kpiId : (parent?.kpiId ?? null),
      }),
    );
  };

  return (
    <Modal
      onClose={onCancel}
      width={380}
      autoFocus={nameRef}
      shouldCloseOnEscapePress={!saving}
      shouldCloseOnOverlayClick={!saving}
    >
      <ModalHeader>
        <ModalTitle>New KPI</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalSubtitle>
          {presetParent ? (
            <>
              Nested under <strong className="text-text">{presetParent.name}</strong>
            </>
          ) : (
            'A new top-level KPI, or choose a parent below'
          )}
        </ModalSubtitle>
        {error !== null && (
          <div className="-mt-2 mb-4">
            <ActionErrorBanner
              error={toActionError(error)}
              onDismiss={clearError}
              onOpenSettings={onOpenSettings}
            />
          </div>
        )}
        <div className="flex flex-col gap-3">
          <ModalField label="Name" htmlFor="kpi-name">
            <Textfield
              id="kpi-name"
              ref={nameRef}
              value={name}
              placeholder="e.g. Revenue"
              aria-label="KPI name"
              isDisabled={saving}
              onChange={(e: FormEvent<HTMLInputElement>) => setName(e.currentTarget.value)}
            />
          </ModalField>
          <ModalField label="Unit" htmlFor="kpi-unit">
            <Textfield
              id="kpi-unit"
              value={unit}
              placeholder="e.g. USD"
              aria-label="KPI unit"
              isDisabled={saving}
              onChange={(e: FormEvent<HTMLInputElement>) => setUnit(e.currentTarget.value)}
            />
          </ModalField>
          <ModalField label="Direction" htmlFor="kpi-direction">
            <Select<DirectionOption>
              inputId="kpi-direction"
              aria-label="KPI direction"
              options={DIRECTION_OPTIONS}
              value={direction}
              isSearchable={false}
              isDisabled={saving}
              {...MODAL_MENU_PROPS}
              onChange={(o) => o && setDirection(o)}
            />
          </ModalField>
          {!presetParent && (
            <ModalField
              label={
                <>
                  Parent KPI <span className="text-text-subtle">(optional)</span>
                </>
              }
              htmlFor="kpi-parent"
            >
              <DisabledReason reason={nestBlocked}>
                <div className="w-full">
                  <KpiParentSelect
                    options={kpiOptions}
                    value={parent}
                    onChange={setParent}
                    isDisabled={saving || nestBlocked !== null}
                  />
                </div>
              </DisabledReason>
            </ModalField>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onCancel} isDisabled={saving}>
          Cancel
        </Button>
        <Button
          appearance="primary"
          onClick={submit}
          isDisabled={name.trim() === ''}
          isLoading={saving}
        >
          Create KPI
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Optional "Parent KPI" picker on "Add KPI" — a searchable Select over the
 * already-loaded KPI tree (local filtering, unlike the async issue picker).
 * Options are indented by `depth` in the menu so the hierarchy stays visible.
 */
function KpiParentSelect({
  options,
  value,
  onChange,
  isDisabled = false,
}: {
  options: KpiParentOption[];
  value: KpiParentOption | null;
  onChange: (option: KpiParentOption | null) => void;
  isDisabled?: boolean;
}) {
  return (
    <Select<KpiParentOption>
      inputId="kpi-parent"
      aria-label="Search for a parent KPI"
      placeholder="Search KPIs…"
      options={options}
      value={value}
      isClearable
      isDisabled={isDisabled}
      {...MODAL_MENU_PROPS}
      components={{ ClearIndicator }}
      getOptionValue={(o) => o.kpiId}
      getOptionLabel={(o) => o.name}
      formatOptionLabel={(o, { context }) => (
        <span style={context === 'menu' ? { paddingLeft: o.depth * 12 } : undefined}>{o.name}</span>
      )}
      noOptionsMessage={() => 'No matching KPIs'}
      onChange={(o) => onChange(o ?? null)}
    />
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
  onOpenSettings,
}: {
  node: TimelineNodeDto;
  defaultDate: string;
  searchIssues: (query: string) => Promise<IssuePickerItem[]>;
  onCancel: () => void;
  /** Resolves once the target is saved; rejects with the failure (shown in the modal). */
  onAdd: (issue: IssuePickerItem, date: string, value: number) => Promise<void>;
  onOpenSettings: () => void | Promise<void>;
}) {
  const { saving, error, clearError, run } = useModalSave();
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');
  const [issue, setIssue] = useState<IssuePickerItem | null>(null);

  // Each KPI target lives on a distinct contributing issue — one target per
  // (issue, KPI). Issues already targeting this KPI can't be picked again.
  const excludedKeys = useMemo(
    () => new Set(node.targets.map((t) => t.source.issue)),
    [node.targets],
  );

  const num = Number(value.replace(/,/g, ''));
  const valid =
    issue !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    value.trim() !== '' &&
    !Number.isNaN(num);

  const submit = () => {
    if (valid && issue && !saving) void run(() => onAdd(issue, date, num));
  };

  return (
    <Modal
      onClose={onCancel}
      width={420}
      shouldCloseOnEscapePress={!saving}
      shouldCloseOnOverlayClick={!saving}
    >
      <ModalHeader>
        <ModalTitle>Add target</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalSubtitle>
          {node.name} · {node.unit || '—'}
        </ModalSubtitle>
        {error !== null && (
          <div className="-mt-2 mb-4">
            <ActionErrorBanner
              error={toActionError(error)}
              onDismiss={clearError}
              onOpenSettings={onOpenSettings}
            />
          </div>
        )}
        <div className="flex flex-col gap-3">
          <ModalField label="Issue" htmlFor="target-issue">
            <IssueSelect
              searchIssues={searchIssues}
              value={issue}
              onChange={setIssue}
              excludedKeys={excludedKeys}
              isDisabled={saving}
            />
          </ModalField>
          <ModalField label="Date" htmlFor="target-date">
            <Textfield
              id="target-date"
              type="date"
              value={date}
              isDisabled={saving}
              onChange={(e: FormEvent<HTMLInputElement>) => setDate(e.currentTarget.value)}
            />
          </ModalField>
          <ModalField label="Target value" htmlFor="target-value">
            <Textfield
              id="target-value"
              value={value}
              placeholder="e.g. 1,300,000"
              aria-label="Target value"
              isDisabled={saving}
              onChange={(e: FormEvent<HTMLInputElement>) => setValue(e.currentTarget.value)}
            />
          </ModalField>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onCancel} isDisabled={saving}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={submit} isDisabled={!valid} isLoading={saving}>
          Add target
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * A type-ahead issue picker — an async Select wired to the Jira issue-picker
 * endpoint via `searchIssues` (recents on open, then search as you type).
 * Issues in `excludedKeys` are listed but disabled.
 */
function IssueSelect({
  searchIssues,
  value,
  onChange,
  excludedKeys,
  isDisabled = false,
}: {
  searchIssues: (query: string) => Promise<IssuePickerItem[]>;
  value: IssuePickerItem | null;
  onChange: (item: IssuePickerItem | null) => void;
  isDisabled?: boolean;
  /** issue keys that already have a target for this KPI — shown but not selectable */
  excludedKeys?: ReadonlySet<string>;
}) {
  const excluded = excludedKeys ?? EMPTY_KEYS;
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Debounced: only the call that survives 180ms of typing hits the endpoint.
  const loadOptions = (query: string) =>
    new Promise<IssuePickerItem[]>((resolve) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void Promise.resolve(searchIssues(query)).then(resolve);
      }, query === '' ? 0 : 180);
    });

  return (
    <AsyncSelect<IssuePickerItem>
      inputId="target-issue"
      aria-label="Search for an issue"
      placeholder="Search issues by key or summary…"
      defaultOptions
      cacheOptions={false}
      loadOptions={loadOptions}
      value={value}
      autoFocus
      openMenuOnFocus
      isClearable
      isDisabled={isDisabled}
      {...MODAL_MENU_PROPS}
      components={{ ClearIndicator }}
      filterOption={null}
      getOptionValue={(i) => i.key}
      getOptionLabel={(i) => `${i.key} ${i.summary}`}
      isOptionDisabled={(i) => excluded.has(i.key)}
      formatOptionLabel={(i, { context }) => (
        <span className="flex items-center gap-2">
          <span className="flex-none font-medium text-brand">{i.key}</span>
          <span className="truncate text-text-subtle">{i.summary}</span>
          {context === 'menu' && excluded.has(i.key) && (
            <span className="ml-auto flex-none whitespace-nowrap text-[11px] text-text-subtle">
              already has a target
            </span>
          )}
        </span>
      )}
      noOptionsMessage={() => 'No matching issues'}
      loadingMessage={() => 'Searching…'}
      onChange={(i) => onChange(i ?? null)}
    />
  );
}

