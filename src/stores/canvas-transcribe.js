/**
 * canvas-transcribe — the Editor's Transcribe: sends each page's unlinked
 * strokes (of the selection, else the whole canvas) to MyScript, one page per
 * request, and keeps the result per page in stores/transcription.js for the
 * save. `transcriptionProgress` drives ActionBar's progress popup.
 */
import { writable, get } from 'svelte/store';
import { setPageTranscription, setIsTranscribing } from './transcription.js';
import { hasMyScriptCredentials, getMyScriptCredentials } from './settings.js';
import { pageOrientations } from './orientation.js';
import { contextInkPageKeys } from './context-ink.js';
import { log, setActiveTab } from './ui.js';
import { transcribeStrokes } from '$lib/myscript-api.js';
import { rotationFor, rotateCanvasStrokes } from '$lib/page-orientation.js';
import { groupStrokesForTranscription, countPartlyLoadedPages } from '$lib/canvas-save-plan.js';
import { plural } from '$lib/plural.js';

const IDLE = Object.freeze({
  active: false,
  currentPage: 0,
  totalPages: 0,
  currentBook: 0,
  currentPageNum: 0,
  successCount: 0,
  errorCount: 0,
  elapsedSeconds: 0
});

/** The running transcription, for the progress popup. */
export const transcriptionProgress = writable({ ...IDLE });

/**
 * Transcribe `strokesToSend`. Pages whose strokes are all linked already are
 * skipped; a page that fails is logged and the rest carry on.
 *
 * @param {Array} strokesToSend  the selected strokes, else every canvas stroke
 * @param {{ selection?: boolean }} [opts]  whether they are a selection (log wording)
 */
export async function transcribeCanvas(strokesToSend, { selection = false } = {}) {
  if (!get(hasMyScriptCredentials)) {
    log('Please configure MyScript API credentials in Settings', 'warning');
    return;
  }
  if (!strokesToSend || strokesToSend.length === 0) {
    log('No strokes available for transcription', 'warning');
    return;
  }

  // A date-range load puts only part of a page on the canvas, and MyScript only
  // ever sees what is loaded: a real transcript of a partial page, merged into
  // the stored one. Worth saying out loud rather than discovering later.
  const partial = countPartlyLoadedPages(strokesToSend, get(contextInkPageKeys));
  if (partial > 0) {
    log(
      `${partial} ${plural(partial, 'page is', 'pages are')} only partly loaded (date range) — `
      + 'transcription will cover the loaded strokes only',
      'warning'
    );
  }

  const pages = [...groupStrokesForTranscription(strokesToSend).entries()]
    .filter(([, p]) => p.untranscribedStrokes.length > 0);
  const totalPages = pages.length;
  if (totalPages === 0) {
    log(`All ${selection ? 'selected ' : ''}strokes have already been transcribed`, 'info');
    return;
  }

  setIsTranscribing(true);
  const totalUntranscribed = pages.reduce((sum, [, p]) => sum + p.untranscribedStrokes.length, 0);
  log(`Transcribing ${totalUntranscribed} untranscribed ${selection ? 'selected ' : ''}${plural(totalUntranscribed, 'stroke')} from ${totalPages} ${plural(totalPages, 'page')}…`, 'info');

  const startTime = Date.now();
  transcriptionProgress.set({ ...IDLE, active: true, totalPages });
  const tick = setInterval(() => {
    transcriptionProgress.update((p) => ({ ...p, elapsedSeconds: Math.floor((Date.now() - startTime) / 1000) }));
  }, 1000);

  try {
    const { appKey, hmacKey } = getMyScriptCredentials();
    let successCount = 0;
    let errorCount = 0;

    for (const [index, [pageKey, pageData]] of pages.entries()) {
      const { book, page } = pageData.pageInfo;
      transcriptionProgress.update((p) => ({ ...p, currentPage: index + 1, currentBook: book, currentPageNum: page }));

      try {
        log(`Transcribing ${pageData.untranscribedStrokes.length} new ${plural(pageData.untranscribedStrokes.length, 'stroke')} on B${book}/P${page}…`, 'info');

        // A page written with the notebook sideways is sent turned upright
        // (copies; the canvas keeps raw Ncode), or MyScript reads it as
        // vertical scribble. Its yBounds then come back in that upright frame,
        // so the turned copies are also what the batch origin is measured on,
        // and the rotation rides on the transcription for the save-time
        // stroke match (save-page.js strokesInTranscriptionFrame).
        const rotation = rotationFor(get(pageOrientations), book, page);
        const sentStrokes = rotateCanvasStrokes(pageData.untranscribedStrokes, rotation);

        const result = await transcribeStrokes(sentStrokes, appKey, hmacKey);

        // The strokes actually sent are passed so only they get linked on save.
        setPageTranscription(
          pageKey,
          rotation ? { ...result, rotation } : result,
          pageData.pageInfo,
          pageData.allStrokes.length,
          sentStrokes
        );

        const lineCount = result.lines?.length || 0;
        log(`✓ B${book}/P${page}: ${result.text?.length || 0} characters, ${lineCount} ${plural(lineCount, 'line')}`, 'success');
        successCount++;
        transcriptionProgress.update((p) => ({ ...p, successCount }));
      } catch (error) {
        log(`✗ Failed to transcribe B${book}/P${page}: ${error.message}`, 'error');
        errorCount++;
        transcriptionProgress.update((p) => ({ ...p, errorCount }));
      }
    }

    setActiveTab('transcription');
    if (successCount > 0) log(`Transcription complete: ${successCount}/${totalPages} ${plural(totalPages, 'page')} successful`, 'success');
    if (errorCount > 0) log(`${errorCount} ${plural(errorCount, 'page')} failed to transcribe`, 'error');
  } catch (error) {
    log(`Transcription failed: ${error.message}`, 'error');
  } finally {
    clearInterval(tick);
    transcriptionProgress.set({ ...IDLE });
    setIsTranscribing(false);
  }
}
