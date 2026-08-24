/**
 * Canvas session operations — things that act on what is currently loaded,
 * rather than on what is stored.
 *
 * Lives here rather than in strokes.js because it has to touch the stores that
 * import strokes.js (selection, pending-changes, point-edit); putting it there
 * would be an import cycle.
 */
import { get } from 'svelte/store';
import { strokes, removeStrokesForPage, strokeIndicesForPage } from './strokes.js';
import { adjustSelectionAfterDeletion } from './selection.js';
import { adjustDeletionsAfterRemoval, pendingChanges } from './pending-changes.js';
import { pointEditMode, exitPointEditMode } from './point-edit.js';
import { filteredStrokes } from './filtered-strokes.js';
import { pageTranscriptions, clearPageTranscription } from './transcription.js';
import { log } from './ui.js';

/**
 * What unloading this page would cost — unsaved work that only exists on the
 * canvas and would be gone.
 *
 * Read from `pendingChanges`, the same diff the save dialog and the page
 * label's `*` use, so the warning cannot disagree with them.
 *
 * @param {string|number} book - book KEY ("388" or "388v2")
 * @param {string|number} page - NCode page number
 * @returns {{strokes: number, additions: number, edits: number,
 *            modifications: number, deletions: number, transcription: boolean,
 *            hasUnsaved: boolean}}
 */
export function describePageUnload(book, page) {
  const bookKey = String(book);
  const pageNum = Number(page);
  const indices = strokeIndicesForPage(bookKey, pageNum);

  const changes = get(pendingChanges)?.get(`B${bookKey}/P${pageNum}`);
  const additions = changes?.additions?.length || 0;
  const edits = changes?.edits?.length || 0;
  const modifications = changes?.modifications?.length || 0;
  const deletions = changes?.deletions?.length || 0;

  const transcription = [...get(pageTranscriptions).values()].some(
    t => String(t?.pageInfo?.book) === bookKey && Number(t?.pageInfo?.page) === pageNum
  );

  return {
    strokes: indices.length,
    additions,
    edits,
    modifications,
    deletions,
    transcription,
    hasUnsaved: additions > 0 || edits > 0 || modifications > 0 || deletions > 0 || transcription
  };
}

/**
 * Take one page off the canvas, leaving its PageDoc untouched.
 *
 * The whole job is keeping the index-keyed stores honest. `strokes` is an
 * array, and several stores hold positions into it, so removing from the middle
 * shifts everything after it:
 *   - `selectedIndices` — a stale index selects the wrong stroke.
 *   - `deletedIndices`  — a stale index DELETES the wrong stroke at next save.
 *   - `selectedPoints`  — keyed "strokeIndex:pointIndex"; there is no sensible
 *     shift for a mode the user is actively pointing at, so the mode exits.
 *   - `filteredStrokes` — {stroke, index} from the last decorative detection;
 *     scratch data, cleared and rebuilt on the next run.
 *
 * `pagePositions` / `pageScales` are keyed by page, not index, and are left in
 * place deliberately: re-importing the page should bring back where you put it.
 *
 * @param {string|number} book - book KEY
 * @param {string|number} page - NCode page number
 * @param {{silent?: boolean}} [options]
 * @returns {number} how many strokes left the canvas
 */
export function unloadPageFromCanvas(book, page, options = {}) {
  const bookKey = String(book);
  const pageNum = Number(page);

  const before = get(strokes).length;
  const removed = removeStrokesForPage(bookKey, pageNum);
  if (removed.length === 0) {
    if (!options.silent) log(`No strokes loaded for B${bookKey}/P${pageNum}`, 'warning');
    return 0;
  }

  // Point-edit selections cannot survive a reindex, and the mode is only ever
  // entered deliberately — leaving it is clearer than silently repointing it.
  if (get(pointEditMode)) exitPointEditMode();

  adjustSelectionAfterDeletion(removed);
  adjustDeletionsAfterRemoval(removed);

  if (get(filteredStrokes).length > 0) filteredStrokes.set([]);

  // A pending transcription for a page that is no longer loaded has no strokes
  // to attach to; leaving it would list a phantom page in Transcripts → Review.
  for (const [pageKey, entry] of get(pageTranscriptions)) {
    if (String(entry?.pageInfo?.book) === bookKey && Number(entry?.pageInfo?.page) === pageNum) {
      clearPageTranscription(pageKey);
    }
  }

  if (!options.silent) {
    log(
      `Removed B${bookKey}/P${pageNum} from the canvas — ${removed.length} stroke(s). ` +
      `Saved data is untouched.`,
      'info'
    );
  }

  // Sanity: the store should be exactly `removed.length` shorter.
  const after = get(strokes).length;
  if (after !== before - removed.length) {
    console.warn(
      `[canvas] unloadPageFromCanvas: expected ${before - removed.length} strokes, got ${after}`
    );
  }

  return removed.length;
}
