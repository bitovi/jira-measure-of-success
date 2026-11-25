import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import ChevronDownIcon from '@atlaskit/icon/core/chevron-down';
import CrossIcon from '@atlaskit/icon/core/cross';
import { kpiRefOf, parseKpiRefInput, type KpiRefLookup } from '@domain/index.js';
import { SpaceKey } from '@ui/components/SpaceFilter/index.js';
import { TypeIcon } from '@ui/components/WorkItemRef/index.js';
import { useLoad } from '@ui/data/useKpiPicker/index.js';

/** A KPI the Parent field can pick: picker style, with its key (overview Q7). */
export interface ParentOption {
  kpiId: string;
  key: string;
  name: string;
  space: { key: string; name: string };
}

const MAX_OPTIONS = 50;

/**
 * Jira's Parent field from the create dialog (spec 11 · 08): a collapsed
 * "Parent" row until clicked (or already filled in), then a type-to-search
 * select whose options are two lines (`{space} {KPI icon} {key}` / name);
 * clearable for a top-level KPI. Matches names, keys and space names in the
 * loaded KPIs; a whole key, id or `/browse/` URL is also looked up directly
 * (07's `lookupKpiRef`), for a KPI's old key or one created since the load.
 */
export function ParentField({
  options,
  value,
  onChange,
  typeIconUrl,
  lookupKpiRef,
  disabled = false,
  disabledReason = null,
  label = 'Parent',
}: {
  options: ParentOption[];
  value: ParentOption | null;
  onChange: (next: ParentOption | null) => void;
  typeIconUrl: string | null;
  lookupKpiRef?: (ref: string) => Promise<KpiRefLookup>;
  disabled?: boolean;
  /** shown under the field when it's disabled (no Link Issues, spec 10) */
  disabledReason?: string | null;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(value !== null);
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listId = useId();

  useEffect(() => {
    if (menu) inputRef.current?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });

  const q = text.trim().toLowerCase();
  const local = options
    .filter(
      (o) =>
        !q || o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q) || o.space.name.toLowerCase().includes(q),
    )
    .slice(0, MAX_OPTIONS);
  const ref = kpiRefOf(parseKpiRefInput(text));
  const exact = ref ? options.find((o) => o.key === ref || o.kpiId === ref) : undefined;
  const lookup = useLoad<KpiRefLookup>(menu && ref && !exact && lookupKpiRef ? `ref:${ref}` : null, () => lookupKpiRef!(ref!), 250);
  const found = lookup.status === 'ready' && lookup.value.kind === 'kpi' ? lookup.value.option : null;
  const looked: ParentOption | null = found
    ? (options.find((o) => o.kpiId === found.id) ?? { kpiId: found.id, key: found.key, name: found.name, space: found.space })
    : null;
  const shown = looked && !local.some((o) => o.kpiId === looked.kpiId) ? [looked, ...local] : local;
  const lookupNote =
    lookup.status === 'loading'
      ? `Looking up ${ref}…`
      : lookup.status === 'ready' && lookup.value.kind === 'notKpi'
        ? `${lookup.value.item.key} isn’t a KPI.`
        : lookup.status === 'ready' && lookup.value.kind === 'hidden'
          ? `No KPI ${ref} that you can see.`
          : lookup.status === 'error'
            ? `Couldn’t look up ${ref}: ${lookup.message}`
            : null;

  function closeMenu() {
    setMenu(false);
    setText('');
    setHi(0);
  }
  const pick = (o: ParentOption) => {
    onChange(o);
    closeMenu();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHi((h) => Math.max(0, Math.min(shown.length - 1, h + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[hi]) pick(shown[hi]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      if (!value) setExpanded(false);
    }
  };

  if (!expanded && !value) {
    return (
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          setExpanded(true);
          setMenu(true);
        }}
        className="flex min-h-[47px] w-full items-center gap-2 rounded-lg px-1.5 text-left text-[var(--ds-text-subtle,#505258)] hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <TypeIcon typeIconUrl={typeIconUrl} typeName="KPI" />
        {label}
        {disabledReason && <span className="ml-auto text-xs">{disabledReason}</span>}
      </button>
    );
  }

  const frame = 'flex min-h-[40px] w-full items-center gap-1.5 rounded-md bg-surface px-2 text-left text-text';
  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={inputId} className="mb-1 block text-sm text-[var(--ds-text-subtle,#505258)]">
        {label}
      </label>
      {menu ? (
        <div className={`${frame} border-2 border-[var(--ds-border-focused,#1868db)] px-[7px]`}>
          <input
            id={inputId}
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setHi(0);
            }}
            onKeyDown={onKey}
            placeholder="Select parent"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown[hi] ? `${listId}-${shown[hi].kpiId}` : undefined}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-text outline-none"
          />
          <ChevronDownIcon label="" size="small" />
        </div>
      ) : (
        <div className={`${frame} border border-[var(--ds-border-bold,#8c8f97)]`}>
          <button
            id={inputId}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            onClick={() => setMenu(true)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left disabled:cursor-not-allowed"
          >
            {value ? (
              <>
                <SpaceKey spaceKey={value.space.key} />
                <TypeIcon typeIconUrl={typeIconUrl} typeName="KPI" />
                <span className="flex-none text-[var(--ds-link,#1868db)]">{value.key}</span>
                <span className="min-w-0 truncate">{value.name}</span>
              </>
            ) : (
              <span className="text-text-subtle">Select parent</span>
            )}
          </button>
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear parent"
              onClick={() => onChange(null)}
              className="grid h-6 w-6 place-items-center rounded text-text-subtle hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]"
            >
              <CrossIcon label="" size="small" />
            </button>
          )}
          <ChevronDownIcon label="" size="small" />
        </div>
      )}
      {disabledReason && <p className="mt-1 text-xs text-text-subtle">{disabledReason}</p>}
      {menu && (
        <div
          id={listId}
          role="listbox"
          aria-label="Parent KPIs"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-[700] max-h-[300px] overflow-auto rounded-lg bg-[var(--ds-surface-overlay,#ffffff)] py-1.5 shadow-[0_8px_12px_#1e1f2126,0_0_1px_#1e1f214f]"
        >
          {shown.map((o, i) => (
            <div
              key={o.kpiId}
              id={`${listId}-${o.kpiId}`}
              role="option"
              aria-selected={i === hi}
              aria-label={`${o.key} ${o.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(o)}
              className={`cursor-pointer border-l-2 px-4 py-2 ${
                i === hi ? 'border-[var(--ds-border-selected,#1868db)] bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]' : 'border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 text-sm text-[var(--ds-text-subtle,#505258)]" title={o.space.name}>
                <SpaceKey spaceKey={o.space.key} />
                <TypeIcon typeIconUrl={typeIconUrl} typeName="KPI" />
                <span className="text-[var(--ds-link,#1868db)]">{o.key}</span>
              </div>
              <div className="mt-0.5 text-sm text-text">{o.name}</div>
            </div>
          ))}
          {lookupNote && <p className="px-4 py-2 text-sm text-text-subtle">{lookupNote}</p>}
          {shown.length === 0 && !lookupNote && <p className="px-4 py-2 text-sm text-text-subtle">No KPIs match</p>}
        </div>
      )}
    </div>
  );
}
