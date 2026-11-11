import { useEffect, useState } from 'react';

const MENUS = '[role="listbox"], [role="menu"]';
const GAP = 8;

/**
 * The issue panel lives in a Forge iframe that is sized to its content's layout
 * height. Select / dropdown menus are absolutely positioned, so they don't add to
 * that height and get clipped at the bottom of the iframe.
 *
 * While a menu inside `root` is open, this pads the bottom of `root` by however
 * far the menu hangs past it, so the iframe grows to fit. The padding is removed
 * when the menu closes. Returns a callback ref for the root element.
 */
export function useMenuRoom() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!root) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      root.style.paddingBottom = '';
      const menus = root.querySelectorAll<HTMLElement>(MENUS);
      if (menus.length === 0) return;
      const rootBottom = root.getBoundingClientRect().bottom;
      let overhang = 0;
      menus.forEach((m) => {
        overhang = Math.max(overhang, m.getBoundingClientRect().bottom - rootBottom);
      });
      if (overhang > 0) {
        const base = parseFloat(getComputedStyle(root).paddingBottom) || 0;
        root.style.paddingBottom = `${Math.ceil(base + overhang + GAP)}px`;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      root.style.paddingBottom = '';
    };
  }, [root]);
  return setRoot;
}

/**
 * Select props for menus inside the panel. react-select measures the space below
 * a menu before `useMenuRoom` has grown the iframe, and would shrink the menu to
 * that sliver; equal min/max heights stop that, so the menu opens full height
 * and the panel grows to fit it.
 */
export const panelMenuProps = {
  menuPlacement: 'bottom',
  minMenuHeight: 300,
  maxMenuHeight: 300,
} as const;
