import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Tooltip from '@atlaskit/tooltip';
import {
  kpiRefOf,
  parseKpiRefInput,
  type KpiOptionDto,
  type KpiRefLookup,
  type KpiSuggestionsDto,
  type SearchKpisResult,
  type TargetSummaryDto,
  type WorkItemRefDto,
} from '@domain/index.js';
import { cachedKpiPickerApi, useLoad, type KpiPickerApi, type Load } from '@ui/data/useKpiPicker/index.js';
import { TypeIcon, WorkItemRef } from '@ui/components/WorkItemRef/index.js';
import { SpaceFilter, SpaceKey } from '@ui/components/SpaceFilter/index.js';
import { KpiRow, KPI_ROW_COLUMNS } from '../KpiRow/index.js';
import { ParentBand } from '../ParentBand/index.js';
import {
  article,
  defaultView,
  groupBySpace,
  listRows,
  menuEntries,
  pickedLabel,
  viewSpace,
  whereLabel,
  withoutTracked,
  type MenuEntry,
  type PickerRow,
  type PickerViewId,
} from './pickerView.js';

/** Lazy loads when no API is given (stories of the opening views only): they say so. */
const NO_API: KpiPickerApi = {
  listKpisInSpaces: () => Promise.reject(new Error('not available here')),
  searchKpis: () => Promise.reject(new Error('not available here')),
  listKpiSpaces: () => Promise.reject(new Error('not available here')),
  lookupKpiRef: () => Promise.reject(new Error('not available here')),
  getKpiCurrentValue: () => Promise.reject(new Error('not available here')),
};

const TYPING_DELAY_MS = 250;

/** The picked KPI's current value, for the line under the field. */
export type CurrentValueState = { pending: true } | { pending: false; value: number | null } | null;

/** One selectable row of the right pane, in keyboard order. */
interface Selectable {
  option: KpiOptionDto;
  toggleId: string | null;
  hasChildren: boolean;
  open: boolean;
}

/**
 * The "Set a KPI target" form's KPI field (spec 11 · 07): looks like a select
 * (`Choose KPI, search, or paste a key…`) and expands, inline, into a two-pane
 * browser — the views tied to this work item on the left (Tracked by parents,
 * This space, Parent spaces then Global KPIs, All KPIs), their KPIs on the
 * right. Only the two views sent with the panel are there on open; the others
 * load when opened, through `api`, and are remembered while the picker lives.
 * Typing searches the selected view; a whole key, an id or a URL is looked up
 * directly in any space. Picking a KPI collapses the browser.
 */
export function KpiPicker({
  suggestions,
  issueKey,
  trackedIds,
  value,
  onChange,
  api,
  currentValue = null,
  inputId,
  defaultOpen = false,
}: {
  suggestions: KpiSuggestionsDto;
  /** this work item's key, for the empty Tracked by parents messages */
  issueKey: string;
  /** KPIs this work item targets: left out everywhere */
  trackedIds: ReadonlySet<string>;
  value: KpiOptionDto | null;
  onChange: (option: KpiOptionDto | null) => void;
  api?: KpiPickerApi;
  currentValue?: CurrentValueState;
  inputId?: string;
  /** start expanded (stories) */
  defaultOpen?: boolean;
}) {
  const loads = useMemo(() => cachedKpiPickerApi(api ?? NO_API), [api]);
  const s = useMemo(() => withoutTracked(suggestions, trackedIds), [suggestions, trackedIds]);
  const menu = useMemo(() => menuEntries(s), [s]);
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState('');
  const [view, setView] = useState<PickerViewId>(() => defaultView(s));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState(-1);
  const [spaceFilter, setSpaceFilter] = useState<{ key: string; name: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const parsed = parseKpiRefInput(text);
  const ref = kpiRefOf(parsed);
  /** what filters the lists: free text, or a typed key/id (a pasted URL is a lookup only) */
  const searchText = parsed.kind === 'text' || parsed.kind === 'key' || parsed.kind === 'id' ? parsed.text : '';

  const openBrowser = () => {
    if (open) return;
    setOpen(true);
    setView(defaultView(s));
    setSpaceFilter(null);
    setActive(-1);
  };
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // ── Lazy loads ────────────────────────────────────────────────────────────
  const space = viewSpace(s, view);
  const spaceLoad = useLoad<KpiOptionDto[]>(
    open && space ? `space:${space.key}:${retry}` : null,
    () => loads.listKpisInSpaces([space!.key]),
  );
  const allSpaceLoad = useLoad<KpiOptionDto[]>(
    open && view === 'all' && spaceFilter && !searchText ? `space:${spaceFilter.key}:${retry}` : null,
    () => loads.listKpisInSpaces([spaceFilter!.key]),
  );
  // One search over every space gives All KPIs' results and every view's "N more" count.
  const everySpaceSearch = useLoad<SearchKpisResult>(
    open && searchText ? `search::${searchText.toLowerCase()}:${retry}` : null,
    () => loads.searchKpis(searchText),
    TYPING_DELAY_MS,
  );
  const oneSpaceSearch = useLoad<SearchKpisResult>(
    open && view === 'all' && spaceFilter && searchText ? `search:${spaceFilter.key}:${searchText.toLowerCase()}:${retry}` : null,
    () => loads.searchKpis(searchText, spaceFilter!.key),
    TYPING_DELAY_MS,
  );
  const lookup = useLoad<KpiRefLookup>(open && ref ? `lookup:${ref}` : null, () => loads.lookupKpiRef(ref!), TYPING_DELAY_MS);

  // ── The right pane ────────────────────────────────────────────────────────
  const selectable: Selectable[] = [];
  const add = (option: KpiOptionDto, row?: PickerRow) => {
    selectable.push({ option, toggleId: row?.hasChildren ? row.toggleId : null, hasChildren: !!row?.hasChildren, open: !!row?.open });
    return selectable.length - 1;
  };
  const notTracked = (options: KpiOptionDto[]) => options.filter((o) => !trackedIds.has(o.id));
  const rowsOf = (options: KpiOptionDto[], place: string, target?: (o: KpiOptionDto) => TargetSummaryDto | null) =>
    listRows(notTracked(options), place, expanded, searchText).map((r) => ({
      ...r,
      target: r.depth === 0 && target ? target(r.option) : null,
    }));

  const withTarget = view === 'tracked' && parsed.kind !== 'url';
  const renderRows = (rows: PickerRow[], hint?: (o: KpiOptionDto) => string) =>
    rows.map((r) => {
      const i = add(r.option, r);
      return (
        <KpiRow
          key={r.toggleId}
          id={optionId(i)}
          option={r.option}
          depth={r.depth}
          hasChildren={r.hasChildren}
          open={r.open}
          active={i === active}
          withTarget={withTarget}
          target={r.target}
          hint={hint?.(r.option)}
          highlight={searchText}
          onPick={() => pick(r.option)}
          onToggle={() => toggle(r.toggleId)}
          onHover={() => setActive(i)}
        />
      );
    });

  /** ids the current view lists (for "N more in other spaces") */
  let viewIds: Set<string> | null = null;
  const body: ReactNode[] = [];

  if (ref) body.push(<div key="pasted">{pastedKey(ref, lookup)}</div>);
  if (parsed.kind !== 'url') {
    if (view === 'tracked') {
      viewIds = new Set(s.trackedByParents.flatMap((b) => b.targets.flatMap((t) => [t.option.id, ...t.subKpis.map((o) => o.id)])));
      s.trackedByParents.forEach((band, bandIndex) => {
        const place = `tracked|${band.item.id}`;
        const rows = band.targets.flatMap((t) =>
          rowsOf([t.option, ...t.subKpis], `${place}|${t.option.id}`, (o) => (o.id === t.option.id ? t.target : null)),
        );
        if (rows.length === 0) return;
        const bandId = `${baseId}-band-${bandIndex}`;
        body.push(
          <div key={place} role="group" aria-labelledby={bandId}>
            <ParentBand id={bandId} item={band.item} first={body.length === (ref ? 1 : 0)} />
            {renderRows(rows)}
          </div>,
        );
      });
      if (body.length === (ref ? 1 : 0)) {
        body.push(
          <Message key="empty">
            {searchText
              ? `No KPIs here match “${searchText}”.`
              : s.hasParents
                ? `No parent of ${issueKey} has a KPI target that isn’t already tracked here.`
                : `${issueKey} is at the top of its hierarchy, so it has no parents.`}
          </Message>,
        );
      }
    } else if (view === 'thisSpace') {
      viewIds = new Set(s.inThisSpace.map((o) => o.id));
      const rows = rowsOf(s.inThisSpace, 'thisSpace');
      if (rows.length) body.push(<div key="list">{renderRows(rows)}</div>);
      else if (searchText) body.push(<Message key="empty">No KPIs here match “{searchText}”.</Message>);
      else
        body.push(
          <Message key="empty">
            No KPIs in {s.thisSpace.name} yet. Find one in{' '}
            <LinkButton onClick={() => switchView('all')}>All KPIs</LinkButton>.
          </Message>,
        );
    } else if (space) {
      body.push(
        <div key="space">
          {loadState(spaceLoad, 'Loading KPIs…', (options) => {
            viewIds = new Set(options.map((o) => o.id));
            const rows = rowsOf(options, view);
            if (rows.length) return <div>{renderRows(rows)}</div>;
            return <Message>{searchText ? `No KPIs here match “${searchText}”.` : `No KPIs in ${space.name}.`}</Message>;
          })}
        </div>,
      );
    } else if (view === 'all') {
      const allLoad = spaceFilter ? (searchText ? oneSpaceSearch : allSpaceLoad) : everySpaceSearch;
      if (!spaceFilter && !searchText) {
        body.push(<Message key="hint">Type to search every KPI you can access, or choose a space.</Message>);
      } else {
        body.push(
          <div key="all">
            {loadState(allLoad as Load<SearchKpisResult | KpiOptionDto[]>, spaceFilter ? 'Loading KPIs…' : 'Searching every space…', (result) => {
              const options = Array.isArray(result) ? result : result.kpis;
              viewIds = new Set(options.map((o) => o.id));
              const groups = groupBySpace(notTracked(options));
              const drawn = groups.map((g) => ({ g, rows: listRows(g.options, `all|${g.space.key}`, expanded, Array.isArray(result) ? searchText : '') }));
              if (drawn.every((d) => d.rows.length === 0)) {
                return <Message>{searchText ? `No KPIs match “${searchText}”.` : `No KPIs in ${spaceFilter?.name ?? 'this space'}.`}</Message>;
              }
              return (
                <>
                  {drawn.map(({ g, rows }) => (
                    <div key={g.space.key} role="group" aria-label={`${g.space.key} ${g.space.name}`}>
                      {!spaceFilter && (
                        <div role="presentation" className="flex items-center gap-1.5 px-3 pb-0.5 pt-1.5 text-xs font-semibold text-text-subtle">
                          <SpaceKey spaceKey={g.space.key} />
                          {g.space.name}
                        </div>
                      )}
                      {renderRows(rows.map((r) => ({ ...r, target: null })))}
                    </div>
                  ))}
                  {!Array.isArray(result) && result.truncated && (
                    <Message>Showing the first {options.length}. Type more to narrow the search.</Message>
                  )}
                </>
              );
            })}
          </div>,
        );
      }
    }
  }

  /** A lazy load's rows once ready (rendered now, so keyboard order and the view's ids are known), else its state. */
  function loadState<T>(load: Load<T>, loading: string, render: (value: T) => ReactNode): ReactNode {
    if (load.status === 'ready') return render(load.value);
    if (load.status === 'error')
      return (
        <Message tone="error">
          Couldn’t load KPIs: {load.message} <LinkButton onClick={() => setRetry((n) => n + 1)}>Try again</LinkButton>
        </Message>
      );
    return (
      <Message>
        <Spinner />
        {loading}
      </Message>
    );
  }

  // "N more in other spaces": from the every-space search, what the view doesn't list.
  let footer: ReactNode = null;
  if (open && searchText && parsed.kind !== 'url' && !(view === 'all' && !spaceFilter)) {
    if (everySpaceSearch.status === 'loading') {
      footer = (
        <Footer>
          <Spinner />
          Searching other spaces…
        </Footer>
      );
    } else if (everySpaceSearch.status === 'ready') {
      const ids = viewIds as Set<string> | null;
      const outside = everySpaceSearch.value.kpis.filter((o) => !trackedIds.has(o.id) && !(ids?.has(o.id) ?? false));
      if (outside.length > 0) {
        const n = `${outside.length}${everySpaceSearch.value.truncated ? '+' : ''}`;
        footer = (
          <Footer>
            {n} more in other spaces ·{' '}
            {view === 'all' ? (
              <LinkButton onClick={() => setSpaceFilter(null)}>Search every space</LinkButton>
            ) : (
              <LinkButton onClick={() => switchView('all')}>Search all KPIs</LinkButton>
            )}
          </Footer>
        );
      }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function pick(option: KpiOptionDto) {
    onChange(option);
    setText('');
    setOpen(false);
    setActive(-1);
  }
  function toggle(toggleId: string, to?: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      const opening = to ?? !next.has(toggleId);
      if (opening) next.add(toggleId);
      else next.delete(toggleId);
      return next;
    });
  }
  function switchView(next: PickerViewId) {
    setView(next);
    setActive(-1);
    if (next !== 'all') setSpaceFilter(null);
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openBrowser();
        return;
      }
      const n = selectable.length;
      if (!n) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter') {
      const row = selectable[active];
      if (open && row) {
        e.preventDefault();
        pick(row.option);
      }
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && open && !searchText) {
      const row = selectable[active];
      if (row?.toggleId) {
        e.preventDefault();
        toggle(row.toggleId, e.key === 'ArrowRight');
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
  };

  // Typing over a picked KPI starts a new search instead of appending to its name.
  const shown = value ? pickedLabel(value) : text;
  const onInput = (next: string) => {
    let typed = next;
    if (value) {
      const label = pickedLabel(value);
      typed = next.startsWith(label) ? next.slice(label.length) : label.startsWith(next) ? '' : next;
      onChange(null);
    }
    setText(typed);
    setActive(typed.trim() ? 0 : -1);
    if (!open) openBrowser();
  };

  const activeId = open && selectable[active] ? optionId(active) : undefined;
  const entryFor = (id: PickerViewId) => menu.find((m) => m.id === id);
  const parentEntries = menu.filter((m) => m.parentSpace);

  return (
    <div
      ref={rootRef}
      className="[container-type:inline-size]"
      onBlur={(e) => {
        // Tabbing (or clicking) into another field collapses the browser.
        if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) close();
      }}
    >
      <div className="flex min-h-8 items-center rounded border-2 border-border bg-surface px-1.5 focus-within:border-[var(--ds-border-focused,#388bff)]">
        {value && (
          <span className="ml-1 flex-none">
            <TypeIcon typeIconUrl={value.typeIconUrl} typeName="KPI" />
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-label={inputId ? undefined : 'KPI'}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          placeholder="Choose KPI, search, or paste a key…"
          value={shown}
          onChange={(e) => onInput(e.target.value)}
          onFocus={(e) => {
            if (value) e.target.select();
            openBrowser();
          }}
          onMouseDown={() => openBrowser()}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent px-0.5 py-1 text-sm text-text outline-none placeholder:text-text-subtlest"
        />
        {(value || text) && (
          <button
            type="button"
            aria-label="Clear KPI"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(null);
              setText('');
              inputRef.current?.focus();
              openBrowser();
            }}
            className="px-1 text-sm text-text-subtle hover:text-text"
          >
            ×
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Close KPI browser' : 'Open KPI browser'}
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) close();
            else {
              inputRef.current?.focus();
              openBrowser();
            }
          }}
          className="px-0.5 text-[11px] text-text-subtle"
        >
          ▼
        </button>
      </div>

      {value && !open && (
        <PickedLine option={value} suggestions={s} currentValue={currentValue} />
      )}

      {open && (
        <div
          data-testid="kpi-browser"
          onMouseDown={(e) => {
            // Keep focus in the field when clicking the browser's background (rows and menu do too).
            if (!(e.target as HTMLElement).closest('input, select, button')) e.preventDefault();
          }}
          className="mt-1 grid h-[420px] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded bg-[var(--ds-surface-overlay,#ffffff)] shadow-[0_8px_12px_#091e4226,0_0_1px_#091e424f] [@container(min-width:620px)]:grid-cols-[200px_minmax(0,1fr)] [@container(min-width:620px)]:grid-rows-1"
        >
          <nav
            aria-label="KPI views"
            className="hidden overflow-auto border-r border-border bg-[var(--ds-surface-sunken,#f7f8f9)] py-1.5 [@container(min-width:620px)]:block"
          >
            <NavEntry entry={entryFor('tracked')!} current={view} onSelect={switchView} />
            <NavEntry entry={entryFor('thisSpace')!} current={view} onSelect={switchView} />
            {parentEntries.length > 0 && (
              <div className="px-3 pb-0.5 pt-2.5 text-[11px] font-bold uppercase tracking-[.04em] text-text-subtlest">Parent spaces</div>
            )}
            {parentEntries.map((m) => (
              <NavEntry key={m.id} entry={m} current={view} onSelect={switchView} />
            ))}
            <div className="mx-3 my-2 border-t border-border" />
            <NavEntry entry={entryFor('all')!} current={view} onSelect={switchView} />
          </nav>
          <div className="border-b border-border px-3 py-2 [@container(min-width:620px)]:hidden">
            <select
              aria-label="KPI view"
              value={view}
              onChange={(e) => switchView(e.target.value as PickerViewId)}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text"
            >
              {menu.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === 'thisSpace' ? `This space (${m.spaceKey})` : m.spaceKey && m.parentSpace ? `${m.spaceKey} · ${m.label}` : m.label}
                  {m.empty ? ' — nothing here' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            {view === 'all' && parsed.kind !== 'url' && (
              <div className="border-b border-border px-3 py-2">
                <SpaceFilter
                  value={spaceFilter}
                  onChange={(next) => {
                    setSpaceFilter(next);
                    setActive(-1);
                  }}
                  loadSpaces={(q, startAt) => loads.listKpiSpaces(q, startAt)}
                />
              </div>
            )}
            {parsed.kind !== 'url' && (
              <div
                aria-hidden
                data-testid="kpi-columns"
                className={`grid gap-3 border-b border-border px-3 pb-1 pt-1.5 text-xs font-semibold text-text-subtle ${withTarget ? KPI_ROW_COLUMNS.withTarget : KPI_ROW_COLUMNS.plain}`}
              >
                <span>KPI</span>
                <span>Unit</span>
                {withTarget && <span>Target</span>}
              </div>
            )}
            <div ref={listRef} id={listboxId} role="listbox" aria-label="KPIs" className="min-h-0 flex-1 overflow-auto pb-1.5">
              {body}
            </div>
            {footer}
          </div>
        </div>
      )}
    </div>
  );

  /** A pasted or typed key/id/URL, looked up directly in any space. */
  function pastedKey(refText: string, l: Load<KpiRefLookup>): ReactNode {
    let content: ReactNode;
    if (l.status !== 'ready') {
      content =
        l.status === 'error' ? (
          <Message tone="error">Couldn’t look up {refText}: {l.message}</Message>
        ) : (
          <Message>
            <Spinner />
            Looking up {refText}…
          </Message>
        );
    } else if (l.value.kind === 'hidden') {
      content = <Message tone="error">You don’t have access to {refText}, or it doesn’t exist.</Message>;
    } else if (l.value.kind === 'notKpi') {
      const item = l.value.item;
      content = (
        <Message tone="error">
          <ItemInline item={item} /> is {article(item.typeName)} {item.typeName}, not a KPI.
        </Message>
      );
    } else {
      const option = l.value.option;
      const moved = !/^\d+$/.test(refText) && option.key !== refText ? refText : null;
      if (trackedIds.has(option.id)) {
        content = (
          <Message>
            <ItemInline item={{ id: option.id, key: option.key, summary: option.name, typeName: 'KPI', typeIconUrl: option.typeIconUrl }} /> is
            already tracked on this work item.
          </Message>
        );
      } else {
        content = (
          <>
            {renderRows(
              [{ option, depth: 0, hasChildren: false, open: false, toggleId: `pasted|${option.id}`, target: null }],
              (o) => `${whereLabel(s, o)} · ${o.space.key}`,
            )}
            {moved && (
              <Message tone="warning">
                {moved} moved to {option.key}. Showing it under its new key.
              </Message>
            )}
          </>
        );
      }
    }
    return (
      <div role="group" aria-label="Pasted key">
        <div
          role="presentation"
          className="flex justify-between gap-2 px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[.04em] text-text-subtlest"
        >
          Pasted key
          <span className="font-medium normal-case tracking-normal">looked up directly, in any space</span>
        </div>
        {content}
      </div>
    );
  }
}

function NavEntry({ entry, current, onSelect }: { entry: MenuEntry; current: PickerViewId; onSelect: (id: PickerViewId) => void }) {
  const on = entry.id === current;
  const button = (tooltipProps?: object) => (
    <button
      type="button"
      {...tooltipProps}
      aria-current={on ? 'true' : undefined}
      data-empty={entry.empty || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(entry.id)}
      className={`flex w-full items-baseline gap-1.5 px-3 py-[5px] text-left text-[13px] hover:bg-[var(--ds-background-neutral-subtle-hovered,#091e420f)] ${
        on
          ? 'bg-[var(--ds-background-selected,#e9f2ff)] font-semibold text-[var(--ds-text-selected,#1868db)] shadow-[inset_2px_0_0_var(--ds-border-selected,#1868db)]'
          : entry.empty
            ? 'text-text-subtlest'
            : 'text-text'
      }`}
    >
      {entry.spaceKey && <SpaceKey spaceKey={entry.spaceKey} faded={entry.empty} />}
      <span className={`truncate ${entry.spaceKey && !on && !entry.empty ? 'font-normal text-text-subtle' : ''}`}>{entry.label}</span>
    </button>
  );
  if (!entry.empty) return button();
  return (
    <Tooltip content="Nothing here" position="right">
      {(tooltipProps) => button(tooltipProps)}
    </Tooltip>
  );
}

function Message({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const toneClass =
    tone === 'warning'
      ? 'mx-2 my-1 rounded-[3px] bg-[var(--ds-background-warning,#fff7d6)] text-warning'
      : tone === 'error'
        ? 'mx-2 my-1 rounded-[3px] bg-[var(--ds-background-danger,#ffeceb)] text-danger'
        : 'text-text-subtle';
  return (
    <div role="status" className={`px-3 py-1.5 text-[13px] ${toneClass}`}>
      {children}
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="border-t border-border px-3 pb-1.5 pt-2 text-xs text-text-subtle">
      {children}
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="font-semibold text-[var(--ds-link,#1868db)] hover:underline"
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-1.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-border border-t-[var(--ds-border-brand,#1868db)] align-[-1px]"
    />
  );
}

function ItemInline({ item }: { item: WorkItemRefDto }) {
  return <WorkItemRef typeIconUrl={item.typeIconUrl} typeName={item.typeName} itemKey={item.key} summary={item.summary} plain className="align-middle" />;
}

/** Under the picked KPI: its space · where it came from · its current value. */
function PickedLine({
  option,
  suggestions,
  currentValue,
}: {
  option: KpiOptionDto;
  suggestions: KpiSuggestionsDto;
  currentValue: CurrentValueState;
}) {
  return (
    <div data-testid="picked-kpi" className="mt-1.5 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-text-subtle">
      <SpaceKey spaceKey={option.space.key} />
      <span>{option.space.name}</span>
      <span aria-hidden>·</span>
      <span>{whereLabel(suggestions, option)}</span>
      {currentValue && (
        <>
          <span aria-hidden>·</span>
          {currentValue.pending ? (
            <span>
              <Spinner />
              current value…
            </span>
          ) : (
            <span>
              Current:{' '}
              <b className="font-semibold text-text">{currentValue.value === null ? 'no readings yet' : currentValue.value.toLocaleString('en-US')}</b>
              {currentValue.value !== null && option.unit ? ` ${option.unit}` : ''}
            </span>
          )}
        </>
      )}
    </div>
  );
}
