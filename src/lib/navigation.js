/**
 * Navigation spine (reading-first package C): the three destinations of the
 * right pane and the rule for leaving one.
 *
 * Destinations are a view over the two existing store fields, not new state:
 *   library  = viewerMode 'book',   bookViewMode 'books'
 *   timeline = viewerMode 'book',   bookViewMode 'timeline'
 *   editor   = viewerMode 'editor'  (bookViewMode left alone, so it is kept)
 *
 * The store (`stores/viewer.js` `navigateTo`) applies the plan; the decision
 * lives here so it can be tested without a DOM or `window.confirm`.
 */

export const DESTINATIONS = ['library', 'timeline', 'editor'];

export const DESTINATION_LABELS = { library: 'Library', timeline: 'Timeline', editor: 'Editor' };

/** The one wording for every route that would drop unsaved transcript edits. */
export const DISCARD_PROMPT = 'You have unsaved transcript edits. Discard them?';

/** @param {unknown} dest */
export function isDestination(dest) {
  return DESTINATIONS.includes(dest);
}

/**
 * @param {'editor'|'book'} viewerMode
 * @param {'books'|'timeline'} bookViewMode
 * @returns {'library'|'timeline'|'editor'}
 */
export function destinationOf(viewerMode, bookViewMode) {
  if (viewerMode !== 'book') return 'editor';
  return bookViewMode === 'books' ? 'library' : 'timeline';
}

/**
 * Store values for a destination. The Editor leaves `bookViewMode` as it is
 * (null here), so coming back from the Editor returns to the last reading view.
 * @param {'library'|'timeline'|'editor'} dest
 * @returns {{viewerMode: 'editor'|'book', bookViewMode: 'books'|'timeline'|null}}
 */
export function modesFor(dest) {
  if (dest === 'library') return { viewerMode: 'book', bookViewMode: 'books' };
  if (dest === 'timeline') return { viewerMode: 'book', bookViewMode: 'timeline' };
  return { viewerMode: 'editor', bookViewMode: null };
}

/**
 * What navigating from `from` to `to` needs.
 *
 * Unsaved transcript edits live only in the Library's transcript pane, which is
 * unmounted by going anywhere else, so any destination but the Library asks
 * first. That is exactly the old pair of rules (`switchView('editor')` and
 * `switchBookMode('timeline')` both asked when dirty; the moves into Book View
 * and into Books never did). Unsaved STROKES never prompt: they stay in memory
 * on the canvas whichever view is showing, and the close dialog in the main
 * process covers quitting.
 *
 * @param {{from: string, to: string, viewerDirty?: boolean}} state
 * @returns {'same'|'go'|'confirm'}
 */
export function planNavigation({ from, to, viewerDirty = false }) {
  if (from === to) return 'same';
  if (viewerDirty && to !== 'library') return 'confirm';
  return 'go';
}
