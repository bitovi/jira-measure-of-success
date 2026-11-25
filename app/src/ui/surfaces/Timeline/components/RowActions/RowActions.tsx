import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import AddIcon from '@atlaskit/icon/core/add';
import ShowMoreHorizontalIcon from '@atlaskit/icon/core/show-more-horizontal';
import Tooltip from '@atlaskit/tooltip';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  /** set: the item shows disabled, with this reason under it */
  disabledReason?: string | null;
}

const CHECKING = 'Checking your permissions…';

/**
 * A KPI row's actions, as Jira Plans draws them (spec 11 · 08): on row hover,
 * two 32×32 subtle buttons at the right end of the KPI cell — **Create child
 * KPI** (+) and **More actions** (…). The menu opens once the KPI's space
 * access is known (`busy` meanwhile); refused items show disabled with why.
 * The parent row needs the `group` class.
 */
export function RowActions({
  kpiKey,
  compact = false,
  busy = null,
  menuOpen,
  items,
  onAddChild,
  onToggleMenu,
  onCloseMenu,
}: {
  /** names the KPI in the buttons' accessible names */
  kpiKey: string;
  /** a 32px context row: 28px buttons */
  compact?: boolean;
  /** which button waits on the space's access */
  busy?: 'child' | 'menu' | null;
  menuOpen: boolean;
  items: RowMenuItem[];
  onAddChild: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}) {
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const size = compact ? 'h-7 w-7' : 'h-8 w-8';
  const button = `grid ${size} flex-none place-items-center rounded-md text-[var(--ds-icon-subtle,#505258)] hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]`;
  const visible = menuOpen || busy !== null;
  return (
    <span
      className={`absolute right-1 top-1/2 z-10 flex -translate-y-1/2 rounded-md bg-inherit transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <Tooltip content={busy === 'child' ? CHECKING : 'Create child KPI'}>
        {(tooltipProps) => (
          <button
            {...tooltipProps}
            type="button"
            className={`${button} ${busy === 'child' ? 'animate-pulse cursor-progress' : ''}`}
            aria-label={`Create child KPI for ${kpiKey}`}
            aria-busy={busy === 'child' || undefined}
            onClick={busy ? undefined : onAddChild}
          >
            <AddIcon label="" />
          </button>
        )}
      </Tooltip>
      <Tooltip content={busy === 'menu' ? CHECKING : menuOpen ? null : 'More actions'}>
        {(tooltipProps) => (
          <button
            {...tooltipProps}
            ref={(el) => {
              moreRef.current = el;
              const tipRef = tooltipProps.ref as React.Ref<HTMLButtonElement> | undefined;
              if (typeof tipRef === 'function') tipRef(el);
              else if (tipRef) (tipRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
            }}
            type="button"
            className={`${button} ${busy === 'menu' ? 'animate-pulse cursor-progress' : ''} ${
              menuOpen ? 'bg-[var(--ds-background-selected,#e9f2ff)] text-[var(--ds-icon-selected,#1868db)]' : ''
            }`}
            aria-label={`More actions for ${kpiKey}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-busy={busy === 'menu' || undefined}
            onClick={busy ? undefined : onToggleMenu}
          >
            <ShowMoreHorizontalIcon label="" />
          </button>
        )}
      </Tooltip>
      {menuOpen && (
        <RowMenu
          anchor={moreRef}
          label={`More actions for ${kpiKey}`}
          items={items}
          onClose={() => {
            onCloseMenu();
            moreRef.current?.focus();
          }}
        />
      )}
    </span>
  );
}

/** The … menu, in a body portal (the Timeline's scroll box would clip it), under its button. */
function RowMenu({
  anchor,
  label,
  items,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  label: string;
  items: RowMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 2, right: Math.max(8, window.innerWidth - rect.right) });
  }, [anchor]);
  useEffect(() => {
    if (pos) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [pos]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [anchor, onClose]);

  const onKey = (e: KeyboardEvent) => {
    const all = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      all[(at + step + all.length) % all.length]?.focus();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKey}
      style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
      className="fixed z-[600] min-w-[220px] max-w-[320px] rounded-md bg-[var(--ds-surface-overlay,#ffffff)] py-1 text-sm text-text shadow-[0_8px_12px_#1e1f2126,0_0_1px_#1e1f214f]"
    >
      {items.map((item) => {
        const disabled = !!item.disabledReason;
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            aria-disabled={disabled || undefined}
            aria-description={item.disabledReason ?? undefined}
            onClick={() => {
              if (disabled) return;
              onClose();
              item.onSelect();
            }}
            className={`block w-full px-3 py-1.5 text-left ${
              disabled ? 'cursor-not-allowed' : 'hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]'
            } focus:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)] focus:outline-none`}
          >
            <span className={disabled ? 'text-[var(--ds-text-disabled,#080f214a)]' : ''}>{item.label}</span>
            {disabled && <span className="mt-0.5 block text-xs text-text-subtle">{item.disabledReason}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
