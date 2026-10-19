/**
 * Pure helpers for the collapsible left panel (reading-first package B).
 *
 * The store (`stores/left-panel.js`) owns the state and the persistence; the
 * decisions that can be wrong without anyone noticing live here, where they can
 * be tested without a DOM: how a stored value is read, and whether a keypress is
 * the collapse shortcut.
 */

/** localStorage key for the collapsed flag. */
export const LEFT_PANEL_KEY = 'smartpen-left-panel-collapsed';

/**
 * Read the stored flag. Anything but an explicit collapsed marker means
 * expanded, so a missing, corrupt or hand-edited value can never leave the
 * panel hidden with no obvious way back.
 * @param {string|null|undefined} raw
 * @returns {boolean} true when the panel should start collapsed
 */
export function parseCollapsed(raw) {
  return raw === '1';
}

/** @param {boolean} collapsed */
export function serializeCollapsed(collapsed) {
  return collapsed ? '1' : '0';
}

/**
 * True when the event target is somewhere the user is typing, so a bare
 * character key belongs to that field and not to a shortcut.
 * @param {EventTarget|null|undefined} el
 */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable === true) return true;
  // isContentEditable is not implemented everywhere (and an ancestor can supply
  // it), so also read the attribute: "", "true" and "plaintext-only" all edit.
  const attr = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
  return attr !== null && attr !== undefined && attr.toLowerCase() !== 'false';
}

/**
 * Is this keydown the "toggle the left panel" shortcut (`[`)?
 * Never while typing, never with Ctrl/Alt/Meta (Ctrl+[ is outdent in the
 * transcript editor, and Alt/Meta combos belong to the OS), never mid-IME, and
 * never when something else already handled the key.
 * @param {KeyboardEvent} e
 */
export function isPanelToggleKey(e) {
  if (!e || e.key !== '[') return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.isComposing || e.defaultPrevented) return false;
  return !isTypingTarget(e.target);
}
