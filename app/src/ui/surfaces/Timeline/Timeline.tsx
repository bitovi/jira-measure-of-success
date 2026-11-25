import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Button from '@atlaskit/button/new';
import AddIcon from '@atlaskit/icon/core/add';
import ArrowDownIcon from '@atlaskit/icon/core/arrow-down';
import ArrowUpIcon from '@atlaskit/icon/core/arrow-up';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import ChevronRightIcon from '@atlaskit/icon/core/chevron-right';
import CrossIcon from '@atlaskit/icon/core/cross';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import Select, { AsyncSelect, type ClearIndicatorProps } from '@atlaskit/select';
import Textfield from '@atlaskit/textfield';
import Tooltip from '@atlaskit/tooltip';
import {
  browserTimelineFilters,
  toActionError,
  useTimelineData,
  type TimelineFilterStore,
  type UseTimeline,
} from '@ui/data/useTimelineData/index.js';
import { openKpiSettings, openIssue, openIssueNewTab, getSiteUrl } from '@ui/bridge.js';
import { AccessRefusal } from '@ui/components/AccessRefusal/index.js';
import { DisabledReason } from '@ui/components/DisabledReason/index.js';
import { SpaceKey } from '@ui/components/SpaceFilter/index.js';
import { TypeIcon } from '@ui/components/WorkItemRef/index.js';
import { useKpiAccess } from '@ui/data/useKpiAccess/index.js';
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
  fullRowKpiIds,
  kpiActionBlockedReason,
  kpiEditChanges,
  kpiSpaceKeyOf,
  kpiSpacesOf,
  kpiSubtreeIds,
  NO_KPIS_MESSAGE,
  parentKpiIdOf,
  projectSeries,
  scopeShowsKpi,
  scopeTimeline,
  type KpiSpaceAccess,
  type KpiSpaceRef,
  type AddTargetInput,
  type CreatedKpi,
  type CreateKpiInput,
  type IssuePickerItem,
  type KpiRefLookup,
  type TimelineNodeDto,
  type TimelineReadingDto,
  type TimelineTargetDto,
} from '@domain/index.js';
import { ActionErrorBanner, SETUP_ERRORS } from './components/ActionErrorBanner/index.js';
import { AddKpiDialog, kpiSpaceName } from './components/AddKpiDialog/index.js';
import { CreatedFlag } from './components/CreatedFlag/index.js';
import { ParentField, type ParentOption } from './components/ParentField/index.js';
import { RowActions } from './components/RowActions/index.js';
import { ScopeFilter } from './components/ScopeFilter/index.js';

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
 * Spec 11 · 08: one Timeline across spaces, scoped by a **KPI space** filter
 * (default all KPIs; ancestors outside it as compact context rows) next to
 * **Work from**, both remembered in the browser; Plans-style row actions; Add
 * KPI in a chosen space. Prototype: specs/11-scalable-data/08-timeline-across-spaces/timeline-scope.html.
 *
 * Data comes from an INJECTABLE loader hook (`useData`) — see usePanelData.ts.
 */
const LABEL_W = 300;
const ROW_H = 60;
/** A context row: an ancestor outside the KPI space filter, one short line with no track. */
const CONTEXT_ROW_H = 32;
const HEADER_H = 33;
// Right-pinned "Undated" lane holding projection chips for pending targets (FR-24).
const UNDATED_W = 140;
// Per-depth indent for the label column's chevron + name (Jira Plans style —
// the chevron indents together with the text, not pinned at the left edge).
const INDENT_STEP = 20;

// The page is the module's whole iframe (`layout: blank` in manifest.yml), which
// Jira sizes to the window below its top bar — so `h-screen` is the visible
// area, and only the table scrolls. (With `layout: native` the iframe grows to
// fit its content and the Jira page scrolls instead.) In a window too short to
// fit the table's minimum height (MIN_VISIBLE_ROWS) the page scrolls as a fallback.
const PAGE_CLASS = 'flex h-screen flex-col overflow-y-auto px-6 py-4 text-text';
// The table never shrinks below this many rows (or all of them, if fewer).
const MIN_VISIBLE_ROWS = 3;
// Title (+ loading status) on the left, controls on the right; in a narrow
// window the controls wrap onto their own line instead of pushing the title out.
const TOOLBAR_CLASS = 'flex flex-none flex-wrap items-start justify-end gap-x-4 gap-y-2';
const TITLE_GROUP_CLASS = 'mr-auto flex items-baseline gap-4 self-center';

/** `layout: blank` drops Jira's page heading, so the surface renders its own. */
function PageTitle() {
  return <h1 className="text-xl font-semibold">KPI Timeline</h1>;
}

/** Stable empty set for the issue picker's default `excludedKeys`. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

interface FlatRow {
  node: TimelineNodeDto;
  hasChildren: boolean;
  /** an ancestor kept only for context: compact, faded, no track */
  context: boolean;
}

/** A KPI's space: its key (what access is looked up by) and a label for messages. */
function spaceOf(node: TimelineNodeDto): { key: string; label: string } {
  const key = kpiSpaceKeyOf(node);
  return { key, label: node.space?.name ?? key };
}

/**
 * Why each KPI action is unavailable to this user in that KPI's space (spec 10,
 * per space since spec 11 · 06), or null when allowed. Access that isn't known
 * yet (not looked up, or Jira couldn't answer) allows everything.
 */
function blockedReasons(
  access: KpiSpaceAccess | null,
  space: { label: string },
  kpiKey?: string,
): { record: string | null; edit: string | null; nest: string | null } {
  return {
    record: kpiActionBlockedReason('record', access, space.label, kpiKey),
    edit: kpiActionBlockedReason('edit', access, space.label, kpiKey),
    nest: kpiActionBlockedReason('nest', access, space.label),
  };
}

/** Every loaded KPI, as the Parent field offers them (with keys, overview Q7). */
function parentOptionsOf(roots: readonly TimelineNodeDto[], centralSpaceKey: string | null): ParentOption[] {
  const out: ParentOption[] = [];
  const walk = (nodes: readonly TimelineNodeDto[]) => {
    for (const n of nodes) {
      const key = kpiSpaceKeyOf(n);
      out.push({
        kpiId: n.kpiId,
        key: n.issueKey,
        name: n.name,
        space: { key, name: kpiSpaceName({ key, name: n.space?.name ?? key }, centralSpaceKey) },
      });
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

const keySet = (keys: readonly string[] | undefined): Set<string> => new Set(keys ?? []);

export function Timeline({
  useData = useTimelineData,
  onOpenSettings = openKpiSettings,
  onOpenIssue = openIssue,
  onOpenIssueNewTab = openIssueNewTab,
  loadSiteUrl = getSiteUrl,
  filterStore = browserTimelineFilters,
}: {
  useData?: UseTimeline;
  onOpenSettings?: () => void | Promise<void>;
  onOpenIssue?: (issueKey: string) => void | Promise<void>;
  onOpenIssueNewTab?: (issueKey: string) => void | Promise<void>;
  loadSiteUrl?: () => Promise<string>;
  /** where the KPI space and Work from filters are remembered (spec 11 · 08) */
  filterStore?: TimelineFilterStore;
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
    updateKpi,
    searchIssues,
    addTarget,
    getKpiAccess,
    loadReadings,
    readingsError,
    retryReadings,
    getKpiCreateSpaces,
    lookupKpiRef,
  } = useData();
  // Spec 11 · 06: a KPI's space access is looked up when one of its actions is
  // first used, and remembered per space for the page session.
  const kpiAccess = useKpiAccess(getKpiAccess);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Spec 11 · 08: the KPI space filter and Work from, remembered in the browser.
  const [remembered] = useState(() => filterStore.read());
  const [spaceFilter, setSpaceFilter] = useState<Set<string>>(() => keySet(remembered?.spaces));
  const [workFilter, setWorkFilter] = useState<Set<string>>(() => keySet(remembered?.workFrom));
  const isFirstFiltersRender = useRef(true);
  useEffect(() => {
    if (isFirstFiltersRender.current) {
      isFirstFiltersRender.current = false;
      return;
    }
    filterStore.write({ spaces: [...spaceFilter].sort(), workFrom: [...workFilter].sort() });
  }, [filterStore, spaceFilter, workFilter]);
  const [adding, setAdding] = useState<{ node: TimelineNodeDto; date: string } | null>(null);
  const [editing, setEditing] = useState<{ node: TimelineNodeDto; reading: TimelineReadingDto } | null>(
    null,
  );
  const [creating, setCreating] = useState<{ presetParent: ParentOption | null } | null>(null);
  const [createdFlag, setCreatedFlag] = useState<CreatedKpi | null>(null);
  const [editingKpi, setEditingKpi] = useState<{ node: TimelineNodeDto; mode: 'definition' | 'move' } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [addingTarget, setAddingTarget] = useState<{ node: TimelineNodeDto; date: string } | null>(
    null,
  );
  const [projecting, setProjecting] = useState<{ node: TimelineNodeDto; target: TimelineTargetDto } | null>(
    null,
  );
  // One scroll box for the whole table (both axes): the header row, KPI column
  // and Undated lane are sticky inside it, so they stay visible while the rows
  // scroll. The page is exactly the window's height (`layout: blank` gives us a
  // window-sized iframe), and the box takes whatever height is left.
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

  const centralSpaceKey = data?.centralSpace?.key ?? null;
  // The KPI space filter's options: the loaded KPIs' spaces (no request, overview Q5).
  const kpiSpaces = useMemo(() => (data ? kpiSpacesOf(data.roots) : []), [data]);
  const spaceOptions = useMemo(
    () =>
      kpiSpaces
        .map((s) => ({ key: s.key, name: kpiSpaceName(s, centralSpaceKey) }))
        .sort((a, b) => (a.key === centralSpaceKey ? -1 : b.key === centralSpaceKey ? 1 : a.name.localeCompare(b.name))),
    [kpiSpaces, centralSpaceKey],
  );
  // A remembered space with no KPIs any more is ignored (so the page doesn't open empty).
  const effectiveSpaces = useMemo(
    () => new Set([...spaceFilter].filter((k) => kpiSpaces.some((s) => s.key === k))),
    [spaceFilter, kpiSpaces],
  );
  // Work from: the projects of the work items that set targets.
  const workOptions = useMemo(
    () => (data ? collectContributingProjects(data.roots).map((key) => ({ key, name: key })) : []),
    [data],
  );
  // Work from matches on targets, which don't exist until Phase 2 lands — so
  // until then it doesn't narrow, and the saved choice applies once they arrive.
  const scoped = useMemo(
    () =>
      scopeTimeline(data?.roots ?? [], {
        spaces: effectiveSpaces,
        workFrom: targetsPending ? null : workFilter,
      }),
    [data, effectiveSpaces, workFilter, targetsPending],
  );

  // Readings load only for full rows (spec 11 · 08); context rows need none.
  const pendingReadingIds = useMemo(() => {
    const full = new Set(fullRowKpiIds(scoped));
    const out: string[] = [];
    const walk = (nodes: readonly TimelineNodeDto[]) => {
      for (const n of nodes) {
        if (n.readingsPending && full.has(n.kpiId)) out.push(n.kpiId);
        walk(n.children);
      }
    };
    walk(scoped.roots);
    return out;
  }, [scoped]);
  const pendingReadingKey = pendingReadingIds.join(',');
  useEffect(() => {
    if (pendingReadingKey) loadReadings(pendingReadingKey.split(','));
  }, [pendingReadingKey, loadReadings]);

  const flat = useMemo(() => {
    if (!data) return [];
    const rows: FlatRow[] = [];
    const walk = (nodes: TimelineNodeDto[]) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        rows.push({ node, hasChildren, context: scoped.context.has(node.id) });
        if (hasChildren && !collapsed.has(node.id)) walk(node.children);
      }
    };
    walk(scoped.roots);
    return rows;
  }, [data, scoped, collapsed]);
  // Full rows, collapsed ones included: what the axis and the key count.
  const fullNodes = useMemo(() => {
    const out: TimelineNodeDto[] = [];
    const walk = (nodes: readonly TimelineNodeDto[]) => {
      for (const n of nodes) {
        if (!scoped.context.has(n.id)) out.push(n);
        walk(n.children);
      }
    };
    walk(scoped.roots);
    return out;
  }, [scoped]);
  // Each row shows its space when the rows span more than one.
  const showSpaces = useMemo(() => kpiSpacesOf(scoped.roots).length > 1, [scoped]);

  // Only show the right-pinned Undated lane when at least one KPI actually has
  // undated (pending) targets — otherwise it's just dead space.
  const hasUndated = flat.some(({ node, context }) => !context && node.undated.length > 0);
  // The scroll box also holds the sticky KPI column and Undated lane; the
  // quarter columns get what's left.
  const plotViewportWidth = scrollWidth > 0 ? scrollWidth - LABEL_W - (hasUndated ? UNDATED_W : 0) : 0;

  // Fit-to-data-range date axis (Feature 04, §4a): the domain is the union of
  // every full row's readings + dated targets (always including today), snapped
  // outward to whole quarters, then padded with future quarters to fill the
  // visible plot width. Built from the scoped tree (not collapse state) so
  // expanding/collapsing rows never reflows the axis.
  const axis = useMemo(() => {
    const today = data?.today ?? new Date().toISOString().slice(0, 10);
    return buildAxis(fullNodes.flatMap(axisDatesOf), today, {
      minWidth: plotViewportWidth - PAD_R,
      viewStart: initialViewQuarterStart(today),
    });
  }, [data, fullNodes, plotViewportWidth]);

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

  // Every loaded KPI is a valid parent (any space), not just the visible ones.
  const parentOptions = useMemo(() => (data ? parentOptionsOf(data.roots, centralSpaceKey) : []), [data, centralSpaceKey]);

  // "Move under another KPI": its current parent, and the parents it may move under (not itself or its descendants).
  const moveParents = useMemo(() => {
    if (!data || !editingKpi) return null;
    const blocked = kpiSubtreeIds(data.roots, editingKpi.node.kpiId);
    const parentId = parentKpiIdOf(data.roots, editingKpi.node.kpiId);
    return {
      options: parentOptions.filter((o) => !blocked.has(o.kpiId)),
      parent: parentOptions.find((o) => o.kpiId === parentId) ?? null,
    };
  }, [data, editingKpi, parentOptions]);

  // Key bar (spec 08): counts follow the filters and include collapsed
  // descendants, so expanding/collapsing rows never changes them. Context rows don't count.
  const keySummary = useMemo(() => summarizeKey(fullNodes), [fullNodes]);
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

  /** Run a KPI row action once its space's access allows it (spec 11 · 06). */
  const guardRecord = (node: TimelineNodeDto, actionId: string, proceed: () => void) => {
    const space = spaceOf(node);
    kpiAccess.guard(actionId, space.key, (a) => blockedReasons(a, space, node.issueKey).record, proceed);
  };
  /** The … menu opens once the KPI's space access is known; refused items then show why. */
  const toggleMenu = (node: TimelineNodeDto) => {
    if (menuFor === node.id) return setMenuFor(null);
    setMenuFor(null);
    kpiAccess.guard(`menu:${node.id}`, spaceOf(node).key, () => null, () => setMenuFor(node.id));
  };
  const addChild = (node: TimelineNodeDto) => {
    kpiAccess.dismissRefusal();
    setCreating({ presetParent: parentOptions.find((o) => o.kpiId === node.kpiId) ?? null });
  };
  /** Add KPI: creating needs Create Issues in the chosen space, and Link Issues there with a parent (Q2). */
  const guardCreate = (space: KpiSpaceRef, nesting: boolean, proceed: () => void) =>
    kpiAccess.guard(
      'create',
      space.key,
      (a) => kpiActionBlockedReason('add', a, space.name) ?? (nesting ? kpiActionBlockedReason('nest', a, space.name) : null),
      proceed,
    );
  const showCreated = (kpi: CreatedKpi) => {
    setCreatedFlag(kpi);
    if (kpi.parentKpiId) {
      const parentNodeId = parentOptions.find((o) => o.kpiId === kpi.parentKpiId)?.kpiId;
      if (parentNodeId) setCollapsed((s) => new Set([...s].filter((id) => id !== parentNodeId)));
    }
  };

  if (error)
    return (
      <div className={PAGE_CLASS}>
        <PageTitle />
        <p className="mt-3 text-danger">Failed to load timeline: {error}</p>
      </div>
    );
  if (pending || !data) {
    // Same wrapper and span styling as "Loading targets…" so the two states look identical and sit in the same spot
    return (
      <div className={PAGE_CLASS}>
        <div className={TOOLBAR_CLASS}>
          <div className={TITLE_GROUP_CLASS}>
            <PageTitle />
            <span role="status" className="animate-pulse text-sm text-text-subtle">
              Loading timeline…
            </span>
          </div>
          <div className="mt-1 min-h-[40px] flex-none" />
        </div>
      </div>
    );
  }

  const busyAction = kpiAccess.pendingAction;
  /** What's known to be refused for a row (its space's access once looked up). */
  const rowBlocked = (node: TimelineNodeDto) => {
    const space = spaceOf(node);
    return blockedReasons(kpiAccess.accessOf(space.key), space, node.issueKey);
  };
  const editingBlocked = editingKpi ? rowBlocked(editingKpi.node) : null;
  const filtered = effectiveSpaces.size > 0 || (!targetsPending && workFilter.size > 0);
  const flagSpace = createdFlag?.space;

  return (
    <div className={PAGE_CLASS}>
      <div className={TOOLBAR_CLASS}>
        <div className={TITLE_GROUP_CLASS}>
          <PageTitle />
          {targetsPending && (
            <span role="status" className="animate-pulse text-sm text-text-subtle">
              Loading targets…
            </span>
          )}
        </div>
        {/* min-h reserves the filter control's height so the table doesn't jump when it appears with the targets */}
        <div className="mt-1 flex min-h-[40px] max-w-full flex-wrap items-center justify-end gap-2">
          {spaceOptions.length > 0 && (
            <ScopeFilter label="KPI space" options={spaceOptions} selected={effectiveSpaces} onChange={setSpaceFilter} />
          )}
          {workOptions.length > 0 && (
            <ScopeFilter label="Work from" options={workOptions} selected={workFilter} onChange={setWorkFilter} />
          )}
          <Button
            appearance="primary"
            iconBefore={AddIcon}
            onClick={() => {
              kpiAccess.dismissRefusal();
              setCreating({ presetParent: null });
            }}
          >
            Add KPI
          </Button>
        </div>
      </div>

      {kpiAccess.refusal && !creating && (
        <div className="mt-4 flex-none">
          <AccessRefusal message={kpiAccess.refusal} onDismiss={kpiAccess.dismissRefusal} />
        </div>
      )}

      {targetsError && (
        <div className="flex-none">
          <LoadErrorBanner
            title="Couldn’t load targets"
            body={`Your KPIs and values are shown, but their targets are missing. ${targetsError}`}
            onRetry={retryTargets}
          />
        </div>
      )}
      {readingsError && (
        <div className="flex-none">
          <LoadErrorBanner
            title="Couldn’t load values"
            body={`Some KPIs’ recorded values are missing. ${readingsError}`}
            onRetry={retryReadings}
          />
        </div>
      )}

      <KeyHighlightProvider active={highlight.active}>
        {/* The key and the scroll box are the two halves of one bordered card, but
            separate page flex items: the scroll box is sized to its rows and
            shrinks to the height left in the page (never below its minHeight —
            then the page scrolls), while the key keeps its natural height. */}
        <div className="mt-4 flex-none overflow-hidden rounded-t-lg border border-border bg-surface">
          <PlotKey summary={keySummary} highlight={highlight} />
        </div>
        {/* The one scroll box (both axes). Layering inside it: plot markers
            z-10/20 < quarter header z-[25] < KPI column / Undated lane z-30;
            `isolate` keeps all of that below the toolbar's filter menus. A stable
            scrollbar gutter keeps its width (and so the axis) from changing when
            expanding rows brings in a vertical scrollbar. */}
        <div
          ref={setScrollEl}
          data-testid="timeline-scroll"
          className="isolate overflow-auto rounded-b-lg border border-t-0 border-border bg-surface [scrollbar-gutter:stable]"
          style={{ minHeight: HEADER_H + Math.min(flat.length, MIN_VISIBLE_ROWS) * ROW_H }}
        >
          <div className="flex w-max min-w-full">
            {/* KPI names — sticky to the left edge so only the quarter columns
                pan horizontally. */}
            <div className="sticky left-0 z-30 flex-none bg-surface" style={{ width: LABEL_W }}>
              <div
                className="sticky top-0 z-10 flex items-center border-b border-r border-border bg-surface-sunken px-3 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                style={{ height: HEADER_H }}
              >
                KPI
              </div>
              {flat.length === 0 ? (
                <div className="border-r border-border px-3 py-6 text-sm text-text-subtle">
                  {data.noWorkType ? (
                    <div className="flex flex-col items-start gap-2">
                      <span>
                        <strong className="text-text">{SETUP_ERRORS['type-not-set-up'].title}.</strong>{' '}
                        {SETUP_ERRORS['type-not-set-up'].body}
                      </span>
                      <Button appearance="primary" spacing="compact" onClick={() => void onOpenSettings()}>
                        Open Settings
                      </Button>
                    </div>
                  ) : data.roots.length === 0 ? (
                    <div className="flex flex-col items-start gap-2">
                      <span>{NO_KPIS_MESSAGE}</span>
                      <Button spacing="compact" iconBefore={AddIcon} onClick={() => setCreating({ presetParent: null })}>
                        Add KPI
                      </Button>
                    </div>
                  ) : (
                    <>
                      No KPIs match the filters —{' '}
                      <Button
                        appearance="subtle"
                        spacing="compact"
                        onClick={() => {
                          setSpaceFilter(new Set());
                          setWorkFilter(new Set());
                        }}
                      >
                        show all
                      </Button>
                      .
                    </>
                  )}
                </div>
              ) : (
                flat.map(({ node, hasChildren, context }) => {
                  const blocked = rowBlocked(node);
                  const busy = busyAction === `menu:${node.id}` ? 'menu' : null;
                  return (
                    <TimelineRowLabel
                      key={node.id}
                      node={node}
                      context={context}
                      showSpace={showSpaces}
                      centralSpaceKey={centralSpaceKey}
                      typeIconUrl={data.kpiTypeIconUrl ?? null}
                      hasChildren={hasChildren}
                      collapsed={collapsed.has(node.id)}
                      onToggleCollapse={() => toggleCollapse(node.id)}
                      actions={
                        <RowActions
                          kpiKey={node.issueKey}
                          compact={context}
                          busy={busy}
                          menuOpen={menuFor === node.id}
                          onAddChild={() => addChild(node)}
                          onToggleMenu={() => toggleMenu(node)}
                          onCloseMenu={() => setMenuFor(null)}
                          items={[
                            {
                              label: 'Edit name, unit, direction',
                              disabledReason: blocked.edit,
                              onSelect: () => setEditingKpi({ node, mode: 'definition' }),
                            },
                            {
                              label: 'Move under another KPI…',
                              disabledReason: blocked.nest,
                              onSelect: () => setEditingKpi({ node, mode: 'move' }),
                            },
                            { label: 'Open in Jira', onSelect: () => void onOpenIssue(node.issueKey) },
                          ]}
                        />
                      }
                      onOpenIssue={onOpenIssue}
                      siteUrl={siteUrl}
                    />
                  );
                })
              )}
            </div>

            {/* Quarter columns — pan horizontally under the sticky KPI column. */}
            <div className="flex-1" style={{ minWidth: axis.plotWidth + PAD_R }}>
              {/* Header row: quarter labels (clipped — the last, viewport-filling
                  quarter may be only partly visible) */}
              <div
                className="sticky top-0 z-[25] overflow-hidden border-b border-border bg-surface-sunken"
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

              {/* Data rows (context rows: a short empty strip, no track) */}
              {flat.map(({ node, context }) =>
                context ? (
                  <ContextStrip key={node.id} width={axis.plotWidth + PAD_R} />
                ) : (
                  <TimelineRowTrack
                    key={node.id}
                    node={node}
                    axis={axis}
                    today={data.today}
                    recordBlocked={rowBlocked(node).record}
                    busy={busyAction === `track:${node.id}`}
                    onAddValue={(date) => guardRecord(node, `track:${node.id}`, () => setAdding({ node, date }))}
                    onAddTarget={(date) => setAddingTarget({ node, date })}
                    onEditReading={(reading) => guardRecord(node, `track:${node.id}`, () => setEditing({ node, reading }))}
                    onOpenIssueNewTab={onOpenIssueNewTab}
                    siteUrl={siteUrl}
                  />
                ),
              )}
            </div>

            {/* Right-pinned "Undated" lane — pending targets that can't sit on the
                dated axis. Sticky to the right edge so it never pans (Q10).
                Hidden entirely when no KPI has an undated target. */}
            {hasUndated && (
              <div
                className="sticky right-0 z-30 flex-none border-l border-border bg-surface"
                style={{ width: UNDATED_W }}
              >
                <div
                  className="sticky top-0 z-10 flex items-center border-b border-border bg-surface-sunken px-3 text-xs font-semibold uppercase tracking-wide text-text-subtle"
                  style={{ height: HEADER_H }}
                >
                  Undated
                </div>
                {flat.map(({ node, context }) =>
                  context ? (
                    <ContextStrip key={node.id} />
                  ) : (
                    <UndatedLane
                      key={node.id}
                      node={node}
                      onOpenProjection={(target) => setProjecting({ node, target })}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </KeyHighlightProvider>

      {data.roots.length > 0 && (
        <p className="mt-3 flex-none text-xs text-text-subtle">
          <span className="font-semibold">Tip:</span> click a past date to record a value · click a future date to
          add a target · click a value to edit it · click a target to open its issue.
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
          <AddKpiDialog
            presetParent={creating.presetParent}
            parentOptions={parentOptions}
            typeIconUrl={data.kpiTypeIconUrl ?? null}
            centralSpaceKey={centralSpaceKey}
            loadSpaces={() => getKpiCreateSpaces(kpiSpaces.map((s) => s.key))}
            lookupKpiRef={lookupKpiRef}
            guardCreate={guardCreate}
            checking={busyAction === 'create'}
            refusal={kpiAccess.refusal}
            onCreate={createKpi}
            onCreated={showCreated}
            onClose={() => {
              kpiAccess.dismissRefusal();
              setCreating(null);
            }}
            onOpenSettings={onOpenSettings}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {editingKpi && moveParents && (
          <EditKpiModal
            mode={editingKpi.mode}
            node={editingKpi.node}
            parent={moveParents.parent}
            parentOptions={moveParents.options}
            typeIconUrl={data.kpiTypeIconUrl ?? null}
            lookupKpiRef={lookupKpiRef}
            nestBlocked={editingBlocked?.nest ?? null}
            onCancel={() => setEditingKpi(null)}
            onOpenSettings={onOpenSettings}
            onSave={async (input) => {
              const node = editingKpi.node;
              const before = {
                name: node.name,
                unit: node.unit,
                direction: node.direction,
                parentKpiId: moveParents.parent?.kpiId ?? null,
              };
              await updateKpi(kpiEditChanges(node.kpiId, before, input));
              setEditingKpi(null);
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

      {createdFlag && (
        <CreatedFlag
          kpiKey={createdFlag.issueKey}
          name={createdFlag.name}
          spaceLabel={flagSpace ? `${kpiSpaceName(flagSpace, centralSpaceKey)} (${flagSpace.key})` : null}
          hidden={filtered && !scopeShowsKpi(scoped, createdFlag.kpiId)}
          onShow={() => {
            if (flagSpace && effectiveSpaces.size > 0) setSpaceFilter(new Set([...effectiveSpaces, flagSpace.key]));
            if (workFilter.size > 0) setWorkFilter(new Set());
          }}
          onOpen={() => void onOpenIssue(createdFlag.issueKey)}
          onDismiss={() => setCreatedFlag(null)}
        />
      )}
    </div>
  );
}

/** A context row's cell in the plot and Undated lane: as tall as the row, empty. */
function ContextStrip({ width }: { width?: number }) {
  return (
    <div
      aria-hidden
      className="border-b border-border bg-surface-sunken last:border-b-0"
      style={{ height: CONTEXT_ROW_H, ...(width !== undefined ? { width } : {}) }}
    />
  );
}

/**
 * A KPI's label cell: `{KPI icon} {name}` with the name as the link (no key,
 * spec 11 · 08), its space when the rows span several, unit and direction, and
 * the Plans-style row actions on hover. A context row (an ancestor outside the
 * KPI space filter) is one faded 32px line: name and space.
 */
function TimelineRowLabel({
  node,
  context,
  showSpace,
  centralSpaceKey,
  typeIconUrl,
  hasChildren,
  collapsed,
  onToggleCollapse,
  actions,
  onOpenIssue,
  siteUrl,
}: {
  node: TimelineNodeDto;
  context: boolean;
  showSpace: boolean;
  centralSpaceKey: string | null;
  typeIconUrl: string | null;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  actions: React.ReactNode;
  onOpenIssue: (issueKey: string) => void | Promise<void>;
  siteUrl: string;
}) {
  const spaceKey = kpiSpaceKeyOf(node);
  const spaceName = kpiSpaceName({ key: spaceKey, name: node.space?.name ?? spaceKey }, centralSpaceKey);
  return (
    <div
      className={`group relative flex flex-col justify-center gap-1 border-b border-r border-border px-3 last:border-b-0 hover:bg-[var(--ds-surface-hovered,#f1f2f4)] ${
        context ? 'bg-surface-sunken' : 'bg-surface py-1.5'
      }`}
      style={{ height: context ? CONTEXT_ROW_H : ROW_H }}
      title={context ? 'Outside the KPI space filter: shown for context' : undefined}
      data-context-row={context || undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: node.depth * INDENT_STEP }}>
        <button
          className={`grid h-4 w-4 flex-none place-items-center text-text-subtle ${hasChildren ? '' : 'invisible'}`}
          onClick={onToggleCollapse}
          aria-label={hasChildren ? (collapsed ? 'Expand children' : 'Collapse children') : undefined}
          aria-expanded={hasChildren ? !collapsed : undefined}
          aria-hidden={!hasChildren}
          disabled={!hasChildren}
        >
          {collapsed ? <ChevronRightIcon label="" size="small" /> : <ChevronDownIcon label="" size="small" />}
        </button>
        <span className={context ? 'opacity-60' : ''}>
          <TypeIcon typeIconUrl={typeIconUrl} typeName="KPI" />
        </span>
        <Tooltip content={`Open ${node.name} in Jira`}>
          {(tooltipProps) => (
            <a
              {...tooltipProps}
              href={siteUrl ? `${siteUrl}/browse/${node.issueKey}` : `/browse/${node.issueKey}`}
              className={`min-w-0 truncate hover:underline ${
                context ? 'text-[13px] font-medium text-text-subtlest' : 'text-sm font-medium text-text'
              }`}
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
        {showSpace && (
          <span title={spaceName} className={context ? 'opacity-60' : ''}>
            <SpaceKey spaceKey={spaceKey} />
          </span>
        )}
      </div>
      {!context && (
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: node.depth * INDENT_STEP + 44 }}>
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
        </div>
      )}
      {actions}
    </div>
  );
}

function TimelineRowTrack({
  node,
  axis,
  today,
  recordBlocked = null,
  busy = false,
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
  /** true while a click waits on the KPI's space access (spec 11 · 06) */
  busy?: boolean;
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
      aria-busy={resolving || busy || undefined}
      data-access-pending={busy || undefined}
      data-kpi-track={node.issueKey}
      className={`group relative border-b border-border last:border-b-0 ${busy ? 'cursor-progress' : 'cursor-pointer'}`}
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

      {/* sparkline (values still loading: the KPI just came into scope, spec 11 · 08) */}
      {node.readingsPending ? (
        <span role="status" className="absolute left-12 top-1/2 -translate-y-1/2 animate-pulse text-[11px] text-text-subtle">
          Loading values…
        </span>
      ) : node.readings.length === 0 ? (
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


/**
 * A later part of the load failed (targets, or values for KPIs that came into
 * scope): the KPIs stay on screen, so this is an inline, retryable banner
 * rather than the full-screen error.
 */
function LoadErrorBanner({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-lg border border-danger bg-surface px-4 py-3 text-sm"
    >
      <div className="flex-1">
        <p className="font-semibold text-danger">{title}</p>
        <p className="mt-0.5 text-text-subtle">{body}</p>
        <div className="mt-2">
          <Button appearance="primary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
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


/**
 * A KPI's … menu dialogs: **Edit name, unit, direction** (`definition`) or
 * **Move under another KPI…** (`move`, the Parent field, any space).
 */
function EditKpiModal({
  mode,
  node,
  parent: initialParent,
  parentOptions,
  typeIconUrl,
  lookupKpiRef,
  nestBlocked = null,
  onCancel,
  onSave,
  onOpenSettings,
}: {
  mode: 'definition' | 'move';
  node: TimelineNodeDto;
  /** its current parent */
  parent: ParentOption | null;
  /** the KPIs it may move under (not itself or its descendants) */
  parentOptions: ParentOption[];
  typeIconUrl: string | null;
  lookupKpiRef?: (ref: string) => Promise<KpiRefLookup>;
  /** why moving is disabled (no Link Issues, spec 10) */
  nestBlocked?: string | null;
  onCancel: () => void;
  /** Resolves once saved; rejects with the failure (shown in the modal). */
  onSave: (input: Omit<CreateKpiInput, 'projectId'> & { parentKpiId: string | null }) => Promise<void>;
  onOpenSettings: () => void | Promise<void>;
}) {
  const { saving, error, clearError, run } = useModalSave();
  const initialDirection = DIRECTION_OPTIONS.find((o) => o.value === (node.direction ?? 'none')) ?? DIRECTION_OPTIONS[0];
  const [name, setName] = useState(node.name);
  const [unit, setUnit] = useState(node.unit);
  const [direction, setDirection] = useState<DirectionOption>(initialDirection);
  const [parent, setParent] = useState<ParentOption | null>(initialParent);
  const nameRef = useRef<HTMLInputElement>(null);
  const parentKpiId = parent?.kpiId ?? null;
  const unchanged =
    name.trim() === node.name &&
    unit.trim() === node.unit &&
    direction === initialDirection &&
    parentKpiId === (initialParent?.kpiId ?? null);
  const canSave = name.trim() !== '' && !unchanged;
  const submit = () => {
    if (!canSave || saving) return;
    void run(() =>
      onSave({
        name: name.trim(),
        unit: unit.trim(),
        direction: direction.value === 'none' ? null : direction.value,
        parentKpiId,
      }),
    );
  };

  return (
    <Modal
      onClose={onCancel}
      width={mode === 'move' ? 560 : 380}
      autoFocus={mode === 'definition' ? nameRef : undefined}
      shouldCloseOnEscapePress={!saving}
      shouldCloseOnOverlayClick={!saving}
    >
      <ModalHeader>
        <ModalTitle>{mode === 'move' ? 'Move under another KPI' : 'Edit KPI'}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalSubtitle>
          {mode === 'move' ? (
            <>
              Choose the parent for <strong className="text-text">{node.name}</strong>, or clear it for a top-level KPI
            </>
          ) : (
            <>
              Changes apply everywhere <strong className="text-text">{node.name}</strong> is used
            </>
          )}
        </ModalSubtitle>
        {error !== null && (
          <div className="-mt-2 mb-4">
            <ActionErrorBanner error={toActionError(error)} onDismiss={clearError} onOpenSettings={onOpenSettings} />
          </div>
        )}
        {mode === 'definition' ? (
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
          </div>
        ) : (
          <DisabledReason reason={nestBlocked}>
            <div className="w-full pb-48">
              <ParentField
                options={parentOptions}
                value={parent}
                onChange={setParent}
                typeIconUrl={typeIconUrl}
                lookupKpiRef={lookupKpiRef}
                disabled={saving || nestBlocked !== null}
                label="Parent KPI"
              />
            </div>
          </DisabledReason>
        )}
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onCancel} isDisabled={saving}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={submit} isDisabled={!canSave} isLoading={saving}>
          {mode === 'move' ? 'Move' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
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

