/**
 * mcp-edits — Claude's transcript edits, applied by the running app (v3.18.0,
 * docs/MCP-WRITE-SPEC.md).
 *
 * The MCP server posts to main's localhost endpoint (electron/mcp-endpoint.cjs,
 * on only while `allowClaudeEdits` is on); main hands each request here. This
 * store runs the guards (`editRefusal`), reads the page from disk, plans the
 * edits with the pure lib/mcp-edits.js, and on apply saves through
 * `saveTranscriptLines(…, { base })`, the Library Edit save (parentId,
 * keepDiskTaskState, typed boxes, lineId scrub), then `refreshAfterSave()`.
 * Nothing here writes a file except through `savePage()`.
 *
 * Undo: before an edit is saved the page's previous transcript (and the stroke
 * links the save will scrub) go to main's log, `<userData>/mcp-edits/`; undo
 * restores the last entry only while the page is still at the revision that
 * edit wrote. Requests are handled one at a time.
 */
import { writable, get } from 'svelte/store';
import { dataRoot, dataFolderReady, allowClaudeEdits } from './settings.js';
import { pageGuardState } from './page-guards.js';
import { log } from './ui.js';
import { getPage, savePage } from '$lib/storage/local-store.js';
import { saveTranscriptLines } from '$lib/viewer/save-transcript.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import {
  planEdits, untouchedChanged, formatEditListing, describeCounts, editRefusal
} from '$lib/mcp-edits.js';

/** The last edit applied or undone, for the toast: `{ label, n }`. */
export const lastMcpEdit = writable(null);

const label = (book, page) => `B${book}/P${page}`;

function newId() {
  return crypto.randomUUID();
}

/** What the stores say about this page, for editRefusal() (the flags are shared with Relink: page-guards.js). */
function guardState(book, page, requestRoot) {
  return {
    ...pageGuardState(book, page),
    appRoot: get(dataRoot),
    folderReady: get(dataFolderReady),
    requestRoot,
  };
}

function editLog(action, book, page, payload) {
  return window.mcpAPI.editLog(action, book, page, payload).then((r) => {
    if (!r || r.ok === false) throw new Error((r && r.error) || `edit log ${action} failed`);
    return r.result;
  });
}

function announce(text) {
  log(text, 'success');
  lastMcpEdit.update((w) => ({ label: text, n: (w ? w.n : 0) + 1 }));
}

const refuse = (error) => ({ ok: false, error });

/**
 * Plan, and unless dry_run, apply one edit request.
 * @param {{ book: string, page: string, data_root: string, edits: object[], dry_run: boolean, revision?: string }} req
 */
export async function runEdit(req) {
  const { book, page } = req;
  const why = editRefusal(guardState(book, page, req.data_root));
  if (why) return refuse(why);

  const doc = await getPage(book, page);
  if (!doc) return refuse(`No page ${label(book, page)}`);
  const lines = (doc.transcript && doc.transcript.lines) || [];
  if (!lines.length) return refuse(`${label(book, page)} has no transcript; transcribe it in the app first`);
  const revision = (doc.metadata && doc.metadata.lastUpdated) || '';

  if (!req.dry_run) {
    if (!req.revision) return refuse('revision is required to apply: run a dry run first and pass the revision it returns');
    if (req.revision !== revision) return refuse('The page changed since the dry run; run it again');
  }

  const plan = planEdits(lines, req.edits, { newId });
  if (!plan.ok) return refuse(plan.error);
  if (untouchedChanged(lines, plan.lines, plan.touched).length) {
    return refuse('Internal check failed: the edits would change lines they do not name. Nothing was saved');
  }
  const listing = formatEditListing(plan);
  const summary = describeCounts(plan.counts);
  const inkNote = plan.counts.inserted ? '\nInserted lines have no ink linked.' : '';
  if (req.dry_run) {
    return {
      ok: true, dry_run: true, revision, summary,
      text: `Dry run for ${label(book, page)} (${summary}); nothing saved. Apply with dry_run: false and revision "${revision}".${inkNote}\n${listing}`,
    };
  }

  // The undo entry first: the transcript as it was, and the links the save's
  // scrub will clear (strokes on a deleted line).
  const deletedIds = new Set(plan.deleted.map((d) => d.line.id));
  const scrubbed = (doc.strokes || []).filter((s) => s.lineId && deletedIds.has(s.lineId)).map((s) => [s.id, s.lineId]);
  try {
    await editLog('append', book, page, {
      time: new Date().toISOString(), edits: req.edits, revisionBefore: revision, transcript: doc.transcript, scrubbed,
    });
  } catch (e) {
    return refuse(`Could not write the undo log, so nothing was saved: ${e.message}`);
  }

  try {
    const result = await saveTranscriptLines(book, page, plan.lines, { base: lines });
    if (!result || result.success === false) throw new Error((result && result.error) || 'save failed');
  } catch (e) {
    await editLog('drop', book, page).catch(() => {});
    return refuse(`Save failed: ${e.message}`);
  }

  // The page is saved: from here on a failure is a warning, never an error,
  // or Claude would read "nothing landed" and try again.
  const warnings = [];
  let after = null;
  try {
    after = await getPage(book, page);
  } catch (e) {
    warnings.push(`the page could not be read back (${e.message}); check it with get_transcript`);
  }
  const revisionAfter = (after && after.metadata && after.metadata.lastUpdated) || '';
  let undoable = false;
  try {
    if (!revisionAfter) throw new Error('no revision read back');
    await editLog('finish', book, page, { revisionAfter });
    undoable = true;
  } catch (e) {
    warnings.push(`undo_transcript_edit is not available for this edit (${e.message})`);
  }
  const drift = after ? untouchedChanged(lines, (after.transcript && after.transcript.lines) || [], plan.touched) : [];
  if (drift.length) {
    warnings.push(`${drift.length} line(s) no edit named came out different on disk; check the page and undo if it is wrong`);
  }

  await refreshAfterSave([{ book, pageId: page }])
    .catch((e) => log(`Could not refresh the Library after Claude's edit: ${e.message}`, 'warning'));
  announce(`Claude edited ${label(book, page)}: ${summary}`);

  for (const w of warnings) log(`Claude's edit to ${label(book, page)}: ${w}`, 'warning');
  const warn = warnings.map((w) => `\nWARNING: ${w}.`).join('');
  return {
    ok: true, dry_run: false, revision: revisionAfter, summary,
    text: `Saved ${label(book, page)} (${summary})${undoable ? '; undo with undo_transcript_edit' : ''}.${inkNote}${warn}\n${listing}`,
  };
}

/**
 * Undo the last applied Claude edit on a page, if nothing has written the page since.
 * @param {{ book: string, page: string, data_root: string }} req
 */
export async function runUndo(req) {
  const { book, page } = req;
  const why = editRefusal(guardState(book, page, req.data_root));
  if (why) return refuse(why);

  const entry = await editLog('last', book, page);
  if (!entry || !entry.revisionAfter) return refuse(`No Claude edit to undo on ${label(book, page)}`);
  const doc = await getPage(book, page);
  if (!doc) return refuse(`No page ${label(book, page)}`);
  if ((doc.metadata && doc.metadata.lastUpdated) !== entry.revisionAfter) {
    return refuse(`${label(book, page)} was edited since Claude's last edit (${entry.time}); undo it in the app instead`);
  }

  // The transcript exactly as it was; links the edit scrubbed go back to
  // strokes that are still unlinked.
  const relink = new Map(entry.scrubbed || []);
  const strokes = (doc.strokes || []).map((s) => (!s.lineId && relink.has(s.id) ? { ...s, lineId: relink.get(s.id) } : s));
  const result = await savePage(book, page, {
    ...doc,
    strokes,
    transcript: entry.transcript,
    metadata: { ...(doc.metadata || {}), lastUpdated: new Date().toISOString() },
  });
  if (result && result.success === false) return refuse(`Save failed: ${result.error || 'unknown error'}`);
  // Restored: a log failure now is a warning, not an error. An entry left
  // behind can't be applied twice, since the page's revision has moved on.
  let warn = '';
  try {
    await editLog('pop', book, page);
  } catch (e) {
    warn = `\nWARNING: the undo log entry could not be removed (${e.message}).`;
    log(`Undo of Claude's edit to ${label(book, page)}: ${e.message}`, 'warning');
  }

  await refreshAfterSave([{ book, pageId: page }])
    .catch((e) => log(`Could not refresh the Library after the undo: ${e.message}`, 'warning'));
  announce(`Undid Claude's edit to ${label(book, page)}`);
  const lines = (entry.transcript && entry.transcript.lines) || [];
  return {
    ok: true,
    text: `Restored ${label(book, page)} to before Claude's edit of ${entry.time}.${warn}\n`
      + formatEditListing({ lines, marks: new Map(), deleted: [] }),
  };
}

let queue = Promise.resolve();

/** One request from main: `{ reqId, payload }`. Answered through replyEdit(). */
function handleRequest({ reqId, payload }) {
  queue = queue.then(async () => {
    let result;
    try {
      if (!get(allowClaudeEdits)) result = refuse('Claude edits are turned off in the app (Settings → Data folder)');
      else if (payload && payload.action === 'undo') result = await runUndo(payload);
      else result = await runEdit(payload || {});
    } catch (e) {
      result = refuse(e.message || String(e));
    }
    if (result.ok === false) log(`Claude edit refused: ${result.error}`, 'warning');
    window.mcpAPI.replyEdit(reqId, result);
  });
  return queue;
}

/**
 * Start listening (App onMount). The endpoint follows the setting: started when
 * it is turned on, stopped when it is turned off.
 * @returns {() => void} stop
 */
export function initMcpEdits() {
  if (typeof window === 'undefined' || !window.mcpAPI) return () => {};
  window.mcpAPI.onEdit(handleRequest);
  let first = true;
  const unsub = allowClaudeEdits.subscribe(async (on) => {
    const quiet = first;
    first = false;
    if (quiet && !on) return; // off at boot: nothing to stop
    try {
      const r = await window.mcpAPI.setEnabled(!!on);
      if (r && r.ok === false) throw new Error(r.error);
      if (!quiet || on) log(on ? 'Claude can edit transcripts (local endpoint on)' : 'Claude edits turned off', 'info');
    } catch (e) {
      log(`Could not ${on ? 'start' : 'stop'} the endpoint for Claude's edits: ${e.message}`, 'error');
    }
  });
  return unsub;
}
