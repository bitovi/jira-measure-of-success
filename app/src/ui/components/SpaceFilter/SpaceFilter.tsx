import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { KpiPickerSpace, ListKpiSpacesResult } from '@domain/index.js';
import { useLoad } from '@ui/data/useKpiPicker/index.js';

/** A space key as a small chip (`PROG`), next to the space's name. */
export function SpaceKey({ spaceKey, faded = false }: { spaceKey: string; faded?: boolean }) {
  return (
    <span
      className={`flex-none rounded-[3px] bg-[var(--ds-background-neutral,#091e420f)] px-1 font-mono text-[11px] font-semibold leading-4 text-text ${faded ? 'opacity-60' : ''}`}
    >
      {spaceKey}
    </span>
  );
}

/**
 * A searchable space chooser (spec 11 · 07, All KPIs' Space filter): a button
 * (`Space: Any space ▾`) opening a list with its own "Find a space…" box,
 * because a site can have hundreds of spaces. Enter picks the first match, ×
 * clears the choice, Esc closes just the list. Spaces load a page at a time.
 */
export function SpaceFilter({
  value,
  onChange,
  loadSpaces,
  label = 'Space',
  onOpenChange,
}: {
  value: KpiPickerSpace | null;
  onChange: (space: KpiPickerSpace | null) => void;
  loadSpaces: (query: string, startAt?: number) => Promise<ListKpiSpacesResult>;
  label?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [find, setFind] = useState('');
  const [pages, setPages] = useState(1);
  /** Enter was pressed while the matches were loading: pick the first once they arrive */
  const [enterPending, setEnterPending] = useState(false);
  const listId = useId();
  const findRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
    if (!next) {
      setFind('');
      setPages(1);
    }
  };
  useEffect(() => {
    if (open) findRef.current?.focus();
  }, [open]);

  const query = find.trim();
  const loaded = useLoad<KpiPickerSpace[] & { next?: number | null }>(
    open ? `${pages}:${query.toLowerCase()}` : null,
    async () => {
      const out: KpiPickerSpace[] = [];
      let next: number | null = 0;
      for (let p = 0; p < pages && next !== null; p += 1) {
        const page: ListKpiSpacesResult = await loadSpaces(query, next);
        out.push(...page.spaces);
        next = page.nextStartAt;
      }
      return Object.assign(out, { next });
    },
    query ? 200 : 0,
  );
  const spaces = loaded.status === 'ready' ? loaded.value : [];
  const pick = (space: KpiPickerSpace | null) => {
    onChange(space);
    setOpen(false);
    setEnterPending(false);
    buttonRef.current?.focus();
  };
  useEffect(() => {
    if (enterPending && loaded.status === 'ready') {
      if (loaded.value[0]) pick(loaded.value[0]);
      else setEnterPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterPending, loaded]);
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!query) pick(null);
      else if (loaded.status === 'ready') {
        if (spaces[0]) pick(spaces[0]);
      } else setEnterPending(true);
    }
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-xs text-text-subtle">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value ? `${value.key} ${value.name}` : 'Any space'}`}
        onClick={() => setOpen(!open)}
        className="inline-flex max-w-[260px] items-center gap-1.5 rounded border border-border bg-surface px-2 py-0.5 text-[13px] text-text hover:bg-[var(--ds-background-neutral-subtle-hovered,#091e420f)]"
      >
        {value ? (
          <>
            <SpaceKey spaceKey={value.key} />
            <span className="truncate">{value.name}</span>
          </>
        ) : (
          'Any space'
        )}
        <span aria-hidden className="text-[11px] text-text-subtle">
          ▾
        </span>
      </button>
      {value && (
        <button
          type="button"
          aria-label="Any space"
          title="Any space"
          onClick={() => pick(null)}
          className="px-1 text-[15px] leading-none text-text-subtle hover:text-text"
        >
          ×
        </button>
      )}
      {open && (
        <div className="absolute left-10 top-full z-[3] mt-1 w-[280px] rounded bg-[var(--ds-surface-overlay,#ffffff)] py-1.5 shadow-[0_8px_12px_#091e4226,0_0_1px_#091e424f]">
          <input
            ref={findRef}
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setPages(1);
              setEnterPending(false);
            }}
            onKeyDown={onFindKey}
            placeholder="Find a space…"
            aria-label="Find a space"
            aria-controls={listId}
            autoComplete="off"
            className="mx-2 mb-1.5 w-[calc(100%-16px)] rounded border-2 border-[var(--ds-border-focused,#388bff)] bg-surface px-1.5 py-0.5 text-sm text-text outline-none"
          />
          <div id={listId} role="listbox" aria-label="Spaces" className="max-h-[220px] overflow-auto">
            {!query && (
              <SpaceOption selected={value === null} onPick={() => pick(null)}>
                Any space
              </SpaceOption>
            )}
            {spaces.map((s) => (
              <SpaceOption key={s.key} selected={value?.key === s.key} onPick={() => pick(s)}>
                <SpaceKey spaceKey={s.key} />
                <span className="truncate">{s.name}</span>
              </SpaceOption>
            ))}
            {loaded.status === 'loading' && <p className="px-3 py-1 text-[13px] text-text-subtle">Loading spaces…</p>}
            {loaded.status === 'error' && <p className="px-3 py-1 text-[13px] text-danger">Couldn’t load spaces: {loaded.message}</p>}
            {loaded.status === 'ready' && spaces.length === 0 && query && (
              <p className="px-3 py-1 text-[13px] text-text-subtle">No space matches “{query}”.</p>
            )}
            {loaded.status === 'ready' && loaded.value.next != null && (
              <button
                type="button"
                onClick={() => setPages((n) => n + 1)}
                className="w-full px-3 py-1 text-left text-[13px] font-semibold text-[var(--ds-link,#1868db)]"
              >
                More spaces…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SpaceOption({ selected, onPick, children }: { selected: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`flex cursor-pointer items-center gap-1.5 px-3 py-1 text-[13px] text-text hover:bg-[var(--ds-background-neutral-subtle-hovered,#091e420f)] ${selected ? 'bg-[var(--ds-background-selected,#e9f2ff)]' : ''}`}
    >
      {children}
    </div>
  );
}
