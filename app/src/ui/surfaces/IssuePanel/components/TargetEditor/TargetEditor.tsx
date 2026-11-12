import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import Select, { type StylesConfig } from '@atlaskit/select';
import Textfield from '@atlaskit/textfield';
import type { DueTiming, TargetType } from '@domain/index.js';
import { isIsoDate, type TargetDraft } from '@ui/targetText.js';
import { panelMenuProps } from '../../useMenuRoom.js';

type SelectOption = { label: string; value: string };

const VALUE_TYPES: SelectOption[] = [
  { label: '% change', value: 'percent' },
  { label: 'more', value: 'relative' },
  { label: 'total', value: 'absolute' },
];

const PLACEHOLDER: Record<TargetType, string> = { percent: 'e.g. +2', relative: 'e.g. +100', absolute: 'e.g. 250' };

const DATE_TYPES: SelectOption[] = [
  { label: 'months after due date', value: 'relative' },
  { label: 'on a date', value: 'absolute' },
];

/** Narrow (in-card) layouts stack; from 560px the value and date sit side by side. */
const ROWS = 'grid grid-cols-1 gap-2 [@container(min-width:560px)]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]';

/**
 * Esc on an open Select menu should only close the menu. Without this it also
 * bubbles to a surrounding InlineEdit, which cancels the whole edit.
 */
function useMenuEscapeGuard() {
  const menuOpen = useRef(false);
  return {
    onMenuOpen: () => {
      menuOpen.current = true;
    },
    onMenuClose: () => {
      menuOpen.current = false;
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && menuOpen.current) e.stopPropagation();
    },
  };
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-0.5 block text-xs leading-4 text-text-subtle">
      {children}
    </label>
  );
}

/**
 * One bordered control holding an input and its type select — `[ +2 | % change ▾ ]`.
 * The Atlaskit parts render with `appearance="none"`; this wrapper supplies the
 * input border, hover and focus ring from design tokens. No `overflow:hidden`:
 * the Select menu renders inline and would be clipped.
 */
function Combo({ children }: { children: ReactNode }) {
  return (
    <div
      className={
        'flex min-h-8 items-stretch rounded-[3px] border border-[var(--ds-border-input,#8590a2)] ' +
        'bg-[var(--ds-background-input,#ffffff)] hover:bg-[var(--ds-background-input-hovered,#f7f8f9)] ' +
        'focus-within:border-[var(--ds-border-focused,#388bff)] focus-within:bg-[var(--ds-background-input-pressed,#ffffff)] ' +
        'focus-within:shadow-[inset_0_0_0_1px_var(--ds-border-focused,#388bff)]'
      }
    >
      {children}
    </div>
  );
}

/** The type half of a Combo: a divider on its left and a sunken fill, like the mock. */
const segmentStyles: StylesConfig<SelectOption, false> = {
  control: (base) => ({
    ...base,
    minHeight: 30,
    height: '100%',
    borderRadius: '0 2px 2px 0',
    borderWidth: 0,
    borderLeft: '1px solid var(--ds-border, #091e4224)',
    backgroundColor: 'var(--ds-background-neutral-subtle-hovered, #091e420f)',
    boxShadow: 'none',
    cursor: 'pointer',
  }),
};

/**
 * The bet editor — the same controls in the "Set a KPI target" form and in a
 * saved card's inline edit (mock v3):
 *
 *   Target value  [ +2        ][ % change ▾ ]     Target date  [ 3 ][ months after due date ▾ ]
 *
 * The amount and its type read as one phrase, as do the offset/date and its type.
 * `amountRef` / `whenRef` let the caller focus whichever part the user clicked.
 */
export function TargetEditor({
  draft,
  onChange,
  amountRef,
  whenRef,
}: {
  draft: TargetDraft;
  onChange: (next: TargetDraft) => void;
  amountRef?: Ref<HTMLInputElement>;
  whenRef?: Ref<HTMLInputElement>;
}) {
  const amountId = useId();
  const whenId = useId();
  const valueGuard = useMenuEscapeGuard();
  const dateGuard = useMenuEscapeGuard();
  const due = draft.due;
  const setDue = (next: DueTiming) => onChange({ ...draft, due: next });

  // Local text buffer for the offset so it can hold a transient "" or "-" while
  // typing a signed offset, instead of snapping to 0. Resynced from the draft on
  // external changes (type switch, form reset) but not mid-edit.
  const [offsetText, setOffsetText] = useState(String(due.offsetMonths));
  const editingOffset = useRef(false);
  useEffect(() => {
    if (!editingOffset.current) setOffsetText(String(due.offsetMonths));
  }, [due.offsetMonths]);

  return (
    <div className={ROWS}>
      <div className="min-w-0">
        <FieldLabel htmlFor={amountId}>Target value</FieldLabel>
        <Combo>
          <div className="min-w-[4.5rem] flex-1">
            <Textfield
              id={amountId}
              ref={amountRef}
              appearance="none"
              isCompact
              inputMode="decimal"
              value={draft.value}
              placeholder={PLACEHOLDER[draft.targetType]}
              onChange={(e: FormEvent<HTMLInputElement>) => onChange({ ...draft, value: e.currentTarget.value })}
            />
          </div>
          <div className="w-[7.5rem] flex-none">
            <Select<SelectOption>
              aria-label="Value type"
              appearance="none"
              spacing="compact"
              styles={segmentStyles}
              {...panelMenuProps}
              options={VALUE_TYPES}
              value={VALUE_TYPES.find((o) => o.value === draft.targetType)}
              isSearchable={false}
              {...valueGuard}
              onChange={(o) => o && onChange({ ...draft, targetType: o.value as TargetType })}
            />
          </div>
        </Combo>
      </div>

      <div className="min-w-0">
        <FieldLabel htmlFor={whenId}>Target date</FieldLabel>
        <Combo>
          {due.mode === 'relative' ? (
            <div className="w-[4.5rem] flex-none [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none [&_input]:[-moz-appearance:textfield]">
              <Textfield
                id={whenId}
                ref={whenRef}
                appearance="none"
                isCompact
                type="number"
                step={1}
                aria-label="Months after due date"
                value={offsetText}
                onFocus={() => {
                  editingOffset.current = true;
                }}
                onBlur={() => {
                  editingOffset.current = false;
                  setOffsetText(String(due.offsetMonths));
                }}
                onChange={(e: FormEvent<HTMLInputElement>) => {
                  const raw = e.currentTarget.value;
                  setOffsetText(raw);
                  const n = parseInt(raw, 10);
                  setDue({ ...due, offsetMonths: Number.isNaN(n) ? 0 : n });
                }}
              />
            </div>
          ) : (
            <div className="w-[9.5rem] min-w-[8rem] flex-[0_1_auto]">
              <Textfield
                id={whenId}
                ref={whenRef}
                appearance="none"
                isCompact
                type="date"
                aria-label="Target date"
                value={due.absolute ?? ''}
                onChange={(e: FormEvent<HTMLInputElement>) => setDue({ ...due, absolute: e.currentTarget.value })}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Select<SelectOption>
              aria-label="Date type"
              appearance="none"
              spacing="compact"
              styles={segmentStyles}
              {...panelMenuProps}
              options={DATE_TYPES}
              value={DATE_TYPES.find((o) => o.value === due.mode)}
              isSearchable={false}
              {...dateGuard}
              onChange={(o) => {
                if (!o) return;
                setDue(
                  o.value === 'absolute'
                    ? { ...due, mode: 'absolute', absolute: due.absolute ?? '' }
                    : { ...due, mode: 'relative', anchor: 'issueDueDate', absolute: isIsoDate(due.absolute) ? due.absolute : null },
                );
              }}
            />
          </div>
        </Combo>
      </div>
    </div>
  );
}
