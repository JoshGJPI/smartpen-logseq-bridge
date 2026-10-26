/**
 * menu-keys — what a key does while a small popup menu is open (the ⋯
 * OverflowMenu, the bulk bar's "Remove a tag ▾").
 *
 * Menus listen on the window in the CAPTURE phase and preventDefault() every
 * key they handle, so the views behind them, which listen in the bubble phase
 * and stand down on `defaultPrevented` (the reader's ←/→ page turns and its
 * Escape, the page grid's Escape out of Select), leave those keys alone.
 * Without that, ←/→ turned the page under an open task menu and Escape in
 * "Remove a tag ▾" dropped the whole selection.
 */

/**
 * @param {KeyboardEvent|{key: string, isComposing?: boolean}} e
 * @param {boolean} open  the menu is showing
 * @returns {'close'|'next'|'prev'|'first'|'last'|'swallow'|null}  null: not the menu's key
 */
export function menuKeyAction(e, open) {
  if (!open || !e || e.isComposing) return null;
  switch (e.key) {
    case 'Escape': return 'close';
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'prev';
    case 'Home': return 'first';
    case 'End': return 'last';
    // Kept from the page behind (a page turn would unmount the menu).
    case 'ArrowLeft':
    case 'ArrowRight': return 'swallow';
    default: return null;
  }
}

/**
 * The item to focus after a move, wrapping around; -1 when there is none.
 * @param {number} current  index focused now (-1 for none)
 * @param {number} count
 * @param {'next'|'prev'|'first'|'last'} action
 */
export function menuFocusIndex(current, count, action) {
  if (count <= 0) return -1;
  if (action === 'first') return 0;
  if (action === 'last') return count - 1;
  if (action === 'next') return current < 0 ? 0 : (current + 1) % count;
  if (action === 'prev') return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current;
}
