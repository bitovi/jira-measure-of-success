import { useEffect, useRef, useState } from 'react';
import Button, { IconButton } from '@atlaskit/button/new';
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import ArrowDownIcon from '@atlaskit/icon/core/arrow-down';
import ArrowUpIcon from '@atlaskit/icon/core/arrow-up';
import CheckMarkIcon from '@atlaskit/icon/core/check-mark';
import ShowMoreHorizontalIcon from '@atlaskit/icon/core/show-more-horizontal';
import InlineEdit from '@atlaskit/inline-edit';
import Lozenge from '@atlaskit/lozenge';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@atlaskit/modal-dialog';
import type { PanelRowDto } from '@domain/index.js';
import { EstimateLine } from '@ui/components/EstimateLine/index.js';
import { TargetEditor } from '../TargetEditor/index.js';
import {
  PILL,
  applyDraft,
  betAmount,
  betWhen,
  draftFromRow,
  estimate,
  isValidDraft,
  isValidNumber,
  nudgeFor,
  pillFor,
  sameDraft,
  type TargetDraft,
} from '@ui/targetText.js';

/**
 * A saved KPI target (mock v3 — specs/03-relative-dates-and-values/issue-panel-v3.html).
 *
 *   Number of Stores ▲                               [Upcoming] •••
 *   +10% · 3 months after due date      Estimated target 275 by Apr 15, 2027 · from 250 now
 *   [ Due date passed — record a value to lock in the target.        Record a value ]
 *
 * The bet (what the PM typed) is an Atlaskit InlineEdit: click it to edit in
 * place (IP-8/Q10). Clicking the date part focuses the date input; anything else
 * focuses the amount. ••• has Edit (same inline edit) and Remove (confirmed).
 * The estimate updates live while editing. Width-responsive via a container query.
 *
 * `preview` renders the same card read-only (the "Set a KPI target" preview).
 * A `kpiMissing` row (its KPI issue was deleted) shows the bet read-only with a
 * "KPI deleted" lozenge and a notice; Remove is the only action.
 */
export function TargetCard({
  row: savedRow,
  currentValue,
  preview = false,
  busy = false,
  onSave,
  onRemove,
  onRecord,
}: {
  row: PanelRowDto;
  currentValue: number | null;
  preview?: boolean;
  /** a save is in flight (the panel isn't optimistic) */
  busy?: boolean;
  onSave?: (draft: TargetDraft) => void;
  onRemove?: () => void;
  onRecord?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // Saves aren't optimistic: show the confirmed bet until the panel reloads the
  // row, and drop it if the save ends without a new row (it failed).
  const [pending, setPending] = useState<TargetDraft | null>(null);
  useEffect(() => setPending(null), [savedRow]);
  useEffect(() => {
    if (!busy) setPending(null);
  }, [busy]);
  const row = pending ? applyDraft(savedRow, pending, currentValue) : savedRow;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const focusPart = useRef<'amount' | 'when'>('amount');
  const amountRef = useRef<HTMLInputElement>(null);
  // Set by ••• → Edit: the menu returns focus to its trigger as it closes, which
  // would blur (and auto-confirm) the just-opened editor — bounce focus back.
  const refocusFromMenu = useRef(false);
  const whenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      refocusFromMenu.current = false;
      return;
    }
    const input = (focusPart.current === 'when' ? whenRef : amountRef).current;
    focusPart.current = 'amount';
    input?.focus();
    if (input && input.type !== 'date' && input.type !== 'number') input.select();
  }, [editing]);

  // While Phase 2 (readings + rolled-up dates) loads, the status and its nudge are unknown.
  // A target on a deleted KPI has neither: it can only be removed.
  const missing = !!row.kpiMissing;
  const pill = row.resolving || missing ? null : pillFor(row);
  const nudge = row.resolving || missing ? null : nudgeFor(row);
  const saved = draftFromRow(row);
  const amount = betAmount(row.targetType, row.target, row.unit);
  const when = betWhen(row.dueTiming);

  const startEdit = (part: 'amount' | 'when') => {
    focusPart.current = part;
    setEditing(true);
  };

  return (
    <article
      role="group"
      aria-label={row.name}
      className={`rounded-md border border-border bg-surface px-3 pt-2 [container-type:inline-size] ${editing ? 'pb-12' : 'pb-2.5'}`}
    >
      <header className="flex min-h-6 items-center gap-1.5">
        <span className="flex min-w-0 items-center gap-1 text-sm leading-5 text-text-subtle">
          <span className="truncate">{row.name}</span>
          <DirectionIcon direction={row.direction} />
        </span>
        <span className="ml-auto flex-none">
          {row.resolving && (
            <span
              aria-hidden="true"
              className="inline-block h-4 w-16 animate-pulse rounded-sm bg-[var(--ds-skeleton,#091e420f)] align-middle"
            />
          )}
          {pill && (
            <Lozenge appearance={PILL[pill].appearance}>
              <span className="inline-flex items-center gap-0.5">
                {PILL[pill].label}
                {pill === 'met' && <CheckMarkIcon label="" size="small" />}
              </span>
            </Lozenge>
          )}
          {missing && <Lozenge appearance="removed">KPI deleted</Lozenge>}
        </span>
        {!preview && (
          <DropdownMenu<HTMLButtonElement>
            shouldRenderToParent
            placement="bottom-end"
            trigger={({ triggerRef, onFocus, ...props }) => (
              <IconButton
                {...props}
                onFocus={() => {
                  onFocus?.();
                  if (!refocusFromMenu.current) return;
                  refocusFromMenu.current = false;
                  amountRef.current?.focus();
                }}
                ref={triggerRef}
                icon={ShowMoreHorizontalIcon}
                label={`Actions for ${row.name}`}
                appearance="subtle"
                spacing="compact"
              />
            )}
          >
            <DropdownItemGroup>
              {!missing && (
                <DropdownItem
                  onClick={() => {
                    refocusFromMenu.current = true;
                    startEdit('amount');
                  }}
                >
                  Edit
                </DropdownItem>
              )}
              <DropdownItem onClick={() => setConfirmingRemove(true)}>Remove</DropdownItem>
            </DropdownItemGroup>
          </DropdownMenu>
        )}
      </header>

      {/* From 460px of card width the estimate sits to the right of the bet. */}
      <div
        className={
          editing
            ? ''
            : '[@container(min-width:460px)]:flex [@container(min-width:460px)]:items-baseline [@container(min-width:460px)]:justify-between [@container(min-width:460px)]:gap-4'
        }
      >
        {preview || missing ? (
          <div className="py-1">
            <Bet amount={amount} when={when} />
          </div>
        ) : (
          // Cancel the read view's 2px border + 4px padding (left edge) and Field's 8px top margin.
          <div className="-mx-1.5 -mt-2 min-w-0 [@container(min-width:460px)]:flex-none">
            <InlineEdit<TargetDraft>
              isEditing={editing}
              defaultValue={saved}
              editButtonLabel={`Edit target: ${amount} · ${when}`}
              readViewFitContainerWidth
              validate={(d) => (!isValidNumber(d.value) ? 'Enter a number' : !isValidDraft(d) ? 'Enter a date' : undefined)}
              onEdit={() => setEditing(true)}
              onCancel={() => setEditing(false)}
              onConfirm={(d) => {
                setEditing(false);
                if (sameDraft(d, saved)) return;
                setPending(d);
                onSave?.(d);
              }}
              readView={() => (
                <div className="px-1 py-0.5">
                  <Bet amount={amount} when={when} onPartClick={(part) => (focusPart.current = part)} />
                </div>
              )}
              editView={({ value, onChange, errorMessage }) => (
                <div className="px-1.5">
                  <TargetEditor draft={value} onChange={onChange} amountRef={amountRef} whenRef={whenRef} />
                  {errorMessage && (
                    <p role="alert" className="mt-1 text-xs font-medium text-danger">
                      {errorMessage}
                    </p>
                  )}
                  <Estimate row={applyDraft(row, value, currentValue)} currentValue={currentValue} className="mt-1.5" />
                </div>
              )}
            />
          </div>
        )}
        {!editing && !missing && (
          <Estimate
            row={row}
            currentValue={currentValue}
            className="[@container(min-width:460px)]:min-w-0 [@container(min-width:460px)]:text-right"
          />
        )}
      </div>

      {nudge && !editing && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-[var(--ds-background-warning,#fff7d6)] px-2 py-1 text-xs font-medium leading-4 text-warning">
          <span className="py-1">{nudge}</span>
          {onRecord && (
            <span className="ml-auto">
              <Button appearance="subtle" spacing="compact" onClick={onRecord}>
                Record a value
              </Button>
            </span>
          )}
        </div>
      )}

      {missing && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded bg-[var(--ds-background-neutral,#091e420f)] px-2 py-1 text-xs leading-4 text-text-subtle">
          <span className="py-1">
            This KPI was deleted or moved out of the KPI space, so this target can’t be tracked.
          </span>
          {!preview && (
            <span className="ml-auto">
              <Button appearance="subtle" spacing="compact" onClick={() => setConfirmingRemove(true)}>
                Remove target
              </Button>
            </span>
          )}
        </div>
      )}

      {confirmingRemove && (
        <Modal onClose={() => setConfirmingRemove(false)} width="small">
          <ModalHeader>
            <ModalTitle appearance="danger">Remove this KPI target?</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-text">
              {row.name} · {amount} · {when}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={() => setConfirmingRemove(false)}>
              Cancel
            </Button>
            <Button
              appearance="danger"
              onClick={() => {
                setConfirmingRemove(false);
                onRemove?.();
              }}
            >
              Remove
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </article>
  );
}

function DirectionIcon({ direction }: { direction: PanelRowDto['direction'] }) {
  if (!direction) return null;
  const up = direction === 'increase';
  return (
    <span className={`flex flex-none ${up ? 'text-success' : 'text-danger'}`}>
      {up ? <ArrowUpIcon label="Higher is better" size="small" /> : <ArrowDownIcon label="Lower is better" size="small" />}
    </span>
  );
}

/** The bet headline — what was typed, one style end to end. */
function Bet({
  amount,
  when,
  onPartClick,
}: {
  amount: string;
  when: string;
  onPartClick?: (part: 'amount' | 'when') => void;
}) {
  return (
    <p
      className="flex flex-wrap items-baseline gap-x-1.5 text-base font-semibold leading-6 text-text tabular-nums [@container(min-width:460px)]:flex-nowrap [@container(min-width:460px)]:whitespace-nowrap"
    >
      <span onClick={() => onPartClick?.('amount')}>{amount}</span>
      <span aria-hidden="true" className="font-normal text-text-subtlest">
        ·
      </span>
      <span onClick={() => onPartClick?.('when')}>{when}</span>
    </p>
  );
}

/**
 * The estimate line, or a same-height shimmer while the row is `resolving`
 * (its readings and rolled-up dates are still loading — spec 07).
 */
function Estimate({ row, currentValue, className = '' }: { row: PanelRowDto; currentValue: number | null; className?: string }) {
  if (!row.resolving) return <EstimateLine est={estimate(row, currentValue)} className={className} />;
  return (
    <p role="status" className={`text-sm leading-5 ${className}`}>
      <span className="sr-only">Loading estimate…</span>
      <span
        aria-hidden="true"
        data-testid="estimate-shimmer"
        className="inline-block h-3 w-44 max-w-full animate-pulse rounded bg-[var(--ds-skeleton,#091e420f)] align-middle"
      />
    </p>
  );
}
