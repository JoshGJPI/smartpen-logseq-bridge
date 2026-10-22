/**
 * task-state — the one write path for a task's state (v3.4.0): a tick in the
 * Tasks view or on a reader transcript line.
 *
 * Reads the PageDoc fresh, changes that ONE line (`checked`, and `marker` for
 * WAITING), bumps `metadata.lastUpdated` and writes through local-store
 * savePage() (atomic in main). Never touches strokes, the line's text, any
 * other line, or `transcript.lastTranscribed`: that date says when MyScript
 * last matched lines to ink, and isTrustworthyTranscript() (ink-text.js)
 * reads it.
 *
 * Refused, with nothing written:
 *   - the page has an unsaved transcript draft in the reader (the draft's save
 *     would write the old state back over the tick),
 *   - the page or the line no longer exists, or the line is not a task.
 *
 * Afterwards the copies the reading views hold are brought in step without a
 * full rescan (only `tasks` and `lastUpdated` change, and no ink): the scan
 * record's summary, the reader's cached doc, and the open reader page
 * (`noteTaskWritten`). Thumbnails, the search index and the capture-date
 * index don't depend on task state.
 */

import { getPage, savePage } from '$lib/storage/local-store.js';
import { invalidatePage } from '$lib/viewer/page-cache.js';
import { isViewerPageDirty, noteTaskWritten, applyTaskStateToRecord } from '$stores';
import { isTaskState, taskStateOf, withTaskState, stateLabel } from '$lib/tasks.js';

/** An expected refusal; `code` is 'dirty' | 'no-page' | 'no-line' | 'not-task' | 'bad-state'. */
export class TaskStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TaskStateError';
    this.code = code;
  }
}

/**
 * The PageDoc with one line in a new state, or null when it is already there.
 * Pure (exported for tests).
 * @returns {{ doc: object, prev: string } | null}
 */
export function docWithTaskState(doc, lineId, state, now = new Date().toISOString()) {
  const lines = (doc && doc.transcript && Array.isArray(doc.transcript.lines)) ? doc.transcript.lines : [];
  const idx = lines.findIndex((l) => l && l.id === lineId);
  if (idx < 0) throw new TaskStateError('no-line', 'That line is no longer in the page’s transcript.');
  const prev = taskStateOf(lines[idx]);
  if (!prev) throw new TaskStateError('not-task', 'That line is not a task.');
  if (prev === state) return null;
  const next = lines.slice();
  next[idx] = withTaskState(lines[idx], state);
  return {
    prev,
    doc: {
      ...doc,
      transcript: { ...doc.transcript, lines: next },
      metadata: { ...(doc.metadata || {}), lastUpdated: now }
    }
  };
}

/**
 * Set one task line's state on disk.
 * @param {string} book  book key ("388", "388v2")
 * @param {string} pageId  incl. any suffix
 * @param {string} lineId
 * @param {'todo'|'done'|'waiting'} state
 * @returns {Promise<{ changed: boolean, prev: string, state: string, lastUpdated: string|null }>}
 * @throws {TaskStateError} a refusal (nothing written), or the write's own error
 */
export async function setTaskState(book, pageId, lineId, state) {
  const where = `B${book}/P${pageId}`;
  if (!isTaskState(state)) throw new TaskStateError('bad-state', `Unknown task state: ${state}`);
  if (isViewerPageDirty(String(book), String(pageId))) {
    throw new TaskStateError('dirty', `${where} has unsaved transcript edits. Save or cancel them first.`);
  }
  const doc = await getPage(book, pageId);
  if (!doc) throw new TaskStateError('no-page', `${where} is no longer in the data folder.`);

  const now = new Date().toISOString();
  const out = docWithTaskState(doc, lineId, state, now);
  if (!out) return { changed: false, prev: state, state, lastUpdated: doc.metadata?.lastUpdated || null };

  // The draft check again: a draft could have started while the page was read.
  if (isViewerPageDirty(String(book), String(pageId))) {
    throw new TaskStateError('dirty', `${where} has unsaved transcript edits. Save or cancel them first.`);
  }
  await savePage(book, pageId, out.doc);

  applyTaskStateToRecord(book, pageId, lineId, state, now);
  invalidatePage(String(book), String(pageId));
  noteTaskWritten(book, pageId, lineId, state);
  return { changed: true, prev: out.prev, state, lastUpdated: now };
}

/** "Marked DONE · B3017 p.142" for the toast. */
export function taskChangeLabel(state, book, pageId) {
  return `Marked ${stateLabel(state)} · B${book} p.${pageId}`;
}
