import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import { SpaceKey } from '@ui/components/SpaceFilter/index.js';

export interface ScopeOption {
  key: string;
  /** shown next to the key chip; the key alone when it's the same */
  name: string;
}

/**
 * A Timeline filter (spec 11 · 08): `KPI space: All ▾` or `Work from: All ▾`,
 * opening a searchable checkbox list ("Find a space…") built from what's on
 * the page, with "Show all" to clear it. Nothing chosen = everything.
 */
export function ScopeFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: ScopeOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    findRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const chosen = options.filter((o) => selected.has(o.key));
  const summary =
    chosen.length === 0 ? 'All' : chosen.length === 1 ? chosen[0].name : `${chosen.length} spaces`;
  const q = find.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.key.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  const close = () => {
    setOpen(false);
    setFind('');
    buttonRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative flex-none" onKeyDown={onKey}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={`inline-flex h-10 min-w-[200px] max-w-[300px] items-center gap-2 rounded-md border pl-3 pr-2.5 text-left text-sm text-text ${
          chosen.length
            ? 'border-[var(--ds-border-selected,#1868db)] bg-[var(--ds-background-selected,#e9f2ff)]'
            : 'border-[var(--ds-border-bold,#8c8f97)] bg-surface hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">
          {label}: {summary}
        </span>
        <ChevronDownIcon label="" size="small" />
      </button>
      {open && (
        <div
          id={listId}
          className="absolute right-0 top-[calc(100%+4px)] z-40 w-[300px] rounded-md bg-[var(--ds-surface-overlay,#ffffff)] py-2 shadow-[0_8px_12px_#1e1f2126,0_0_1px_#1e1f214f]"
        >
          <input
            ref={findRef}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find a space…"
            aria-label={`Find a space (${label})`}
            autoComplete="off"
            className="mx-2 mb-1.5 w-[calc(100%-16px)] rounded-md border border-[var(--ds-border-bold,#8c8f97)] bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-[var(--ds-border-focused,#388bff)]"
          />
          <div role="group" aria-label={label} className="max-h-[280px] overflow-auto">
            {shown.map((o) => (
              <label
                key={o.key}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]"
              >
                <input type="checkbox" checked={selected.has(o.key)} onChange={() => toggle(o.key)} />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.name !== o.key && <SpaceKey spaceKey={o.key} />}
              </label>
            ))}
            {shown.length === 0 && <p className="px-3 py-1.5 text-sm text-text-subtle">No spaces match</p>}
          </div>
          {chosen.length > 0 && (
            <div className="mt-1.5 border-t border-border px-3 pt-1.5 text-right">
              <button
                type="button"
                onClick={() => {
                  onChange(new Set());
                  close();
                }}
                className="text-sm font-medium text-[var(--ds-link,#1868db)] hover:underline"
              >
                Show all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
