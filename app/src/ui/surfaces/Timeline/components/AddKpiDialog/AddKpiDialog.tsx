import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Button from '@atlaskit/button/new';
import CrossIcon from '@atlaskit/icon/core/cross';
import Modal from '@atlaskit/modal-dialog';
import type { CreatedKpi, CreateKpiInput, KpiCreateSpaces, KpiDirection, KpiRefLookup, KpiSpaceRef } from '@domain/index.js';
import { SpaceKey } from '@ui/components/SpaceFilter/index.js';
import { TypeIcon } from '@ui/components/WorkItemRef/index.js';
import { useLoad } from '@ui/data/useKpiPicker/index.js';
import { toActionError } from '@ui/data/useTimelineData/index.js';
import { ActionErrorBanner } from '../ActionErrorBanner/index.js';
import { ParentField, type ParentOption } from '../ParentField/index.js';
import { kpiSpaceName } from './kpiSpaceName.js';

/**
 * Add KPI, as Jira's modernised "Create New Work Item" dialog (spec 11 · 08):
 * 800px, a **Space** chip (the spaces offering the KPI work type where the user
 * can create, `getKpiCreateSpaces`) and a fixed **Type: KPI** chip in the
 * header; the KPI name as a large summary; Unit, Direction, Parent. The space
 * is filled in only when there's no choice to make (the resolver's
 * `preselect`); "Choose a space." shows only if Create is pressed without one.
 * Creating with a parent asks the chosen space's access first (Link Issues,
 * `guardCreate`). **Create another** keeps the dialog open.
 */
export function AddKpiDialog({
  presetParent,
  parentOptions,
  typeIconUrl,
  centralSpaceKey = null,
  loadSpaces,
  lookupKpiRef,
  guardCreate,
  checking = false,
  refusal = null,
  onCreate,
  onCreated,
  onClose,
  onOpenSettings,
}: {
  /** filled in from a row's + */
  presetParent: ParentOption | null;
  parentOptions: ParentOption[];
  typeIconUrl: string | null;
  centralSpaceKey?: string | null;
  loadSpaces: () => Promise<KpiCreateSpaces>;
  lookupKpiRef?: (ref: string) => Promise<KpiRefLookup>;
  /** run `proceed` once the space's access allows creating there (and nesting, with a parent) */
  guardCreate: (space: KpiSpaceRef, nesting: boolean, proceed: () => void) => void;
  /** `guardCreate` is waiting on the space's access */
  checking?: boolean;
  /** why `guardCreate` refused */
  refusal?: string | null;
  onCreate: (input: CreateKpiInput) => Promise<CreatedKpi>;
  onCreated: (kpi: CreatedKpi) => void;
  onClose: () => void;
  onOpenSettings: () => void | Promise<void>;
}) {
  const spaces = useLoad<KpiCreateSpaces>('spaces', loadSpaces);
  const [space, setSpace] = useState<KpiSpaceRef | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState<KpiDirection>('increase');
  const [parent, setParent] = useState<ParentOption | null>(presetParent);
  const [another, setAnother] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  const unitId = useId();

  const offered = spaces.status === 'ready' ? spaces.value.spaces : [];
  useEffect(() => {
    if (spaces.status === 'ready' && space === undefined) {
      setSpace(spaces.value.spaces.find((s) => s.id === spaces.value.preselect) ?? null);
    }
  }, [spaces, space]);

  const none = spaces.status === 'ready' && offered.length === 0;
  const blocked = none || spaces.status === 'error';
  const why =
    spaces.status === 'error'
      ? `Couldn’t load the spaces you can create KPIs in: ${spaces.message}`
      : none
        ? 'You can’t create KPIs in any space.'
        : tried && !space
          ? 'Choose a space.'
          : tried && !name.trim()
            ? 'Enter a name for the KPI.'
            : refusal
              ? refusal
              : checking
                ? 'Checking your permissions…'
                : null;
  const whyIsError = why !== null && why !== 'Checking your permissions…';

  const submit = () => {
    setTried(true);
    if (blocked || saving || checking || !space || !name.trim()) return;
    const chosen = space;
    guardCreate(chosen, parent !== null, () => {
      setSaving(true);
      setError(null);
      onCreate({ projectId: chosen.id, name: name.trim(), unit: unit.trim(), direction, parentKpiId: parent?.kpiId ?? null }).then(
        (kpi) => {
          onCreated(kpi);
          if (!another) return onClose();
          setSaving(false);
          setTried(false);
          setName('');
          nameRef.current?.focus();
        },
        (e: unknown) => {
          setSaving(false);
          setError(e ?? new Error('Save failed'));
        },
      );
    });
  };

  return (
    <Modal
      onClose={onClose}
      width={800}
      label={parent ? `Create KPI under ${parent.name}` : 'Create KPI'}
      autoFocus={nameRef}
      shouldCloseOnEscapePress={!saving}
      shouldCloseOnOverlayClick={!saving}
    >
      <div className="flex items-center justify-between px-6 pb-4 pt-6">
        <div className="flex items-center gap-1">
          <SpaceChip
            spaces={spaces.status === 'ready' ? offered : null}
            value={space ?? null}
            missing={tried && !space}
            centralSpaceKey={centralSpaceKey}
            disabled={saving}
            onChange={setSpace}
          />
          <span aria-hidden className="mx-1 h-4 border-l border-[var(--ds-border-bold,#7d818a)]" />
          <span
            aria-label="Type: KPI"
            title="KPIs are always the KPI work type"
            className="inline-flex h-6 items-center gap-2 px-3 font-medium text-[var(--ds-text-subtle,#505258)]"
          >
            <TypeIcon typeIconUrl={typeIconUrl} typeName="KPI" />
            KPI
          </span>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={saving}
          className="grid h-8 w-8 place-items-center rounded-md text-[var(--ds-icon-subtle,#505258)] hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]"
        >
          <CrossIcon label="" />
        </button>
      </div>
      <div className="px-6 pb-2 pt-0.5">
        {error !== null && (
          <div className="-mt-2 mb-2">
            <ActionErrorBanner error={toActionError(error)} onDismiss={() => setError(null)} onOpenSettings={onOpenSettings} />
          </div>
        )}
        <textarea
          ref={nameRef}
          rows={1}
          value={name}
          disabled={saving}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="KPI name"
          aria-label="Summary (KPI name)"
          className="block min-h-10 w-full resize-none rounded-md bg-transparent p-1.5 text-xl font-[653] leading-7 text-text outline-none placeholder:text-[var(--ds-text-subtlest,#6b6e76)] hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)] focus:bg-transparent"
        />
        <div className="mx-1.5 mb-1 mt-3 flex flex-col gap-1">
          <label htmlFor={unitId} className="mt-2 text-sm text-[var(--ds-text-subtle,#505258)]">
            Unit
          </label>
          <input
            id={unitId}
            value={unit}
            disabled={saving}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. %, $M, days"
            className="min-h-10 rounded-md border border-[var(--ds-border-bold,#8c8f97)] bg-surface px-2 text-sm text-text outline-none focus:border-2 focus:border-[var(--ds-border-focused,#1868db)] focus:px-[7px]"
          />
          <span id={`${unitId}-dir`} className="mt-2 text-sm text-[var(--ds-text-subtle,#505258)]">
            Direction
          </span>
          <div role="group" aria-labelledby={`${unitId}-dir`} className="inline-flex self-start overflow-hidden rounded border border-border bg-surface">
            {(['increase', 'decrease'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={direction === d}
                disabled={saving}
                onClick={() => setDirection(d)}
                className={`border-r border-border px-2.5 py-1 text-[13px] last:border-r-0 ${
                  direction === d ? 'bg-[var(--ds-background-selected,#e9f2ff)] font-semibold text-[var(--ds-text-selected,#1868db)]' : 'text-text'
                }`}
              >
                {d === 'increase' ? '↑ Higher is better' : '↓ Lower is better'}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-1.5 my-2">
          <ParentField
            options={parentOptions}
            value={parent}
            onChange={setParent}
            typeIconUrl={typeIconUrl}
            lookupKpiRef={lookupKpiRef}
            disabled={saving}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-3">
        <span role={whyIsError ? 'alert' : undefined} className={`text-xs ${whyIsError ? 'text-danger' : 'text-text-subtle'}`}>
          {why}
        </span>
        <div className="flex flex-none items-center gap-4">
          <label className="inline-flex items-center gap-1.5 text-sm text-text">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} />
            Create another
          </label>
          <Button appearance="primary" onClick={submit} isDisabled={blocked} isLoading={saving || checking}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The header's Space chip: `{KEY} name ▾`, opening a searchable list of the spaces you can create KPIs in. */
function SpaceChip({
  spaces,
  value,
  missing,
  centralSpaceKey,
  disabled,
  onChange,
}: {
  /** null while loading */
  spaces: KpiSpaceRef[] | null;
  value: KpiSpaceRef | null;
  missing: boolean;
  centralSpaceKey: string | null;
  disabled: boolean;
  onChange: (space: KpiSpaceRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const [hi, setHi] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
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

  const chip = 'inline-flex h-6 items-center gap-2 whitespace-nowrap rounded px-3 font-medium';
  if (spaces === null) return <span className={`${chip} text-text-subtle`}>Loading spaces…</span>;
  if (spaces.length === 0) return <span className={`${chip} text-danger`}>No space available</span>;

  const label = (s: KpiSpaceRef) => kpiSpaceName(s, centralSpaceKey);
  const q = find.trim().toLowerCase();
  const shown = spaces.filter((s) => !q || s.key.toLowerCase().includes(q) || label(s).toLowerCase().includes(q));
  const pick = (s: KpiSpaceRef) => {
    onChange(s);
    setOpen(false);
    setFind('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, Math.min(shown.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[hi]) pick(shown[hi]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <span ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Space: ${value ? `${label(value)} (${value.key})` : 'none chosen'}`}
        onClick={() => {
          setOpen((o) => !o);
          setFind('');
          setHi(0);
        }}
        className={`${chip} hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)] ${
          missing ? 'text-danger' : 'text-[var(--ds-text-subtle,#505258)]'
        }`}
      >
        {value ? (
          <>
            <SpaceKey spaceKey={value.key} />
            <span className="max-w-[220px] truncate">{label(value)}</span>
          </>
        ) : (
          'Choose a space'
        )}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-[700] w-[320px] rounded-md bg-[var(--ds-surface-overlay,#ffffff)] py-2 font-normal text-text shadow-[0_8px_12px_#1e1f2126,0_0_1px_#1e1f214f]">
          <input
            ref={findRef}
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setHi(0);
            }}
            onKeyDown={onKey}
            placeholder="Find a space…"
            aria-label="Find a space"
            aria-controls={listId}
            autoComplete="off"
            className="mx-2 mb-1.5 w-[calc(100%-16px)] rounded-md border-2 border-[var(--ds-border-focused,#388bff)] bg-surface px-2 py-0.5 text-sm text-text outline-none"
          />
          <div id={listId} role="listbox" aria-label="Spaces" className="max-h-[240px] overflow-auto">
            {shown.map((s, i) => (
              <div
                key={s.id}
                role="option"
                aria-selected={value?.id === s.id}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(s)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                  i === hi || value?.id === s.id ? 'bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{label(s)}</span>
                <SpaceKey spaceKey={s.key} />
              </div>
            ))}
            {shown.length === 0 && <p className="px-3 py-1.5 text-sm text-text-subtle">No spaces match</p>}
          </div>
          <p className="mt-1.5 border-t border-border px-3 pt-1.5 text-xs text-text-subtle">
            Spaces with the KPI work type where you can create work items
          </p>
        </div>
      )}
    </span>
  );
}
