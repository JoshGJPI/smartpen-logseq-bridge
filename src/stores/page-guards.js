/**
 * page-guards — what the stores say about one page, for the refusals of
 * writers that work from the disk outside the Editor's save: Claude's
 * transcript edits (lib/mcp-edits.js `editRefusal`) and Relink (lib/relink.js
 * `relinkRefusal`, v3.21.0). One function, so the two refuse on the same
 * flags: a Library draft, any transcript editor open on the page
 * (`transcriptEditorHold()`), a pending Editor transcription, a re-transcribe
 * reset.
 */
import { get } from 'svelte/store';
import { isViewerPageDirty, isTranscriptEditorOpen } from './viewer.js';
import { pageTranscriptions } from './transcription.js';
import { isPageReset } from './transcript-reset.js';
import { strokes } from './strokes.js';

/**
 * Is this a letter-suffixed page (P151b) whose page number is loaded in the
 * Editor? The canvas keys strokes by the integer NCode page, so it can't tell
 * the two apart and its copy couldn't take a direct write's links. Relink
 * (v3.21.0) and sketch writes (v3.24.0) wait until it is off the canvas.
 */
export function suffixOnCanvas(book, page) {
  const m = /^(\d+)[a-zA-Z]$/.exec(String(page));
  return !!m && get(strokes).some((st) => st && st.pageInfo
    && String(st.pageInfo.book) === String(book) && String(st.pageInfo.page) === m[1]);
}

/**
 * @param {string|number} book  book key
 * @param {string|number} page  page id ("42", "151b")
 * @returns {{ label: string, draft: boolean, editorOpen: boolean, pendingTranscription: boolean, reset: boolean }}
 */
export function pageGuardState(book, page) {
  const n = parseInt(String(page), 10);
  const pending = [...get(pageTranscriptions).values()].some(
    (t) => t && t.pageInfo && String(t.pageInfo.book) === String(book) && Number(t.pageInfo.page) === n
  );
  return {
    label: `B${book}/P${page}`,
    draft: isViewerPageDirty(String(book), String(page)),
    editorOpen: isTranscriptEditorOpen(String(book), String(page)),
    pendingTranscription: pending,
    reset: isPageReset(String(book), n) || isPageReset(String(book), String(page)),
  };
}
