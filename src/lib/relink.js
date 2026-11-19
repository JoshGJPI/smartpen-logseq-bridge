/**
 * relink — Relink old pages (v3.21.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase B).
 *
 * Pages transcribed before the Aug 2026 line-matching fix have stroke links
 * that `isTrustworthyTranscript()` rejects. Relink sends such a page's ink to
 * MyScript once, aligns that reading with the STORED lines (lib/line-align.js)
 * and takes only the geometry from it: each stored line keeps its id, text,
 * order, indent, parent and task state, and gets MyScript's yBounds and the
 * strokes MyScript's line covers. Unlike the 3.17 Reset, nothing is replaced.
 *
 * This module is the pure half: what is sent (`relinkSendStrokes`), how each
 * line is classified (`classifyRelink`), the word fixes offered (decision 2:
 * shown, kept unless taken), the guards (`relinkRefusal`, the same set as
 * Claude's edits, lib/mcp-edits.js `editRefusal`), and turning the review's
 * decisions into the `relink` spec the save takes (`buildRelinkSpec`;
 * lib/relink-plan.js plans the write from it). stores/relink.js runs it.
 *
 * Lines with a `kind` (Phase E's sketch lines, and any later kind, spec E.7)
 * are never aligned or relinked, and their strokes are never sent.
 *
 * Tested in `src/lib/__tests__/relink.test.js`.
 */
import { alignLinesJoined, movedPairs, similarity, norm, sameLetters, editDistance } from './line-align.js';
import { stripTaskMarker } from './task-markers.js';
import { taskStateOf, stateLabel } from './tasks.js';
import { isTrustworthyTranscript } from './viewer/ink-text.js';

/** Similarity at or above which a pair links without asking. */
export const MATCH_AT = 0.85;
/** Similarity at or above which (and below MATCH_AT) a pair is offered for confirming; below it, no ink. */
export const CONFIRM_AT = 0.6;

/** Leftover ink choices (B.4). Make sketch joins them in Phase E. */
export const LEFTOVER_LEAVE = 'leave';
export const LEFTOVER_ADD = 'add';
export const LEFTOVER_TEXTLESS = 'textless';
/** "Add to #N": the leftover ink goes to the linked stored line above it (its text unchanged). */
export const LEFTOVER_JOIN = 'join';

/** A line that is not plain text (a `kind`, spec E.7): kept, never matched to MyScript. */
export const isKindLine = (l) => !!(l && l.kind);

/** The lines Relink aligns: every line without a `kind`. */
export function textLines(lines) {
  return (lines || []).filter((l) => l && l.id && !isKindLine(l));
}

/**
 * The stored strokes Relink sends: every stroke with ink, minus textless ones
 * ("Not text", left out on purpose) and minus strokes linked to a kind line
 * (a sketch's ink is its own, never text).
 * @param {{ transcript?: {lines?: Array}, strokes?: Array }} doc
 * @returns {Array} stored strokes, in page order
 */
export function relinkSendStrokes(doc) {
  const kindIds = new Set(((doc && doc.transcript && doc.transcript.lines) || []).filter(isKindLine).map((l) => l.id));
  return ((doc && doc.strokes) || []).filter((s) => s && Array.isArray(s.points) && s.points.length > 0
    && s.textless !== true && !(s.lineId && kindIds.has(s.lineId)));
}

const usableYBounds = (yb) => !!yb && Number.isFinite(yb.minY) && Number.isFinite(yb.maxY) && !(yb.minY === 0 && yb.maxY === 0);

/* ----------------------------------------------------------------
 *  Word fixes (decision 2: offered, kept unless taken)
 * ---------------------------------------------------------------- */

/** Whitespace-separated tokens with their place in the text. */
function tokens(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** A token's word with its leading and trailing punctuation split off. */
function splitPunct(word) {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word);
  return m ? { pre: m[1], core: m[2], post: m[3] } : { pre: '', core: word, post: '' };
}

/**
 * Is `to` plausibly `from` misread? Lengths within 2× and at most half the longer
 * word's letters different, rounded up so `teh` → `the` counts (2026-11-19:
 * MyScript glued a neighbouring line's ink onto "We'll" and offered a 55-letter
 * run-on as its fix).
 */
export function plausibleMisreading(from, to) {
  const x = norm(from).replace(/ /g, ''), y = norm(to).replace(/ /g, '');
  if (!x || !y) return false;
  const long = Math.max(x.length, y.length), short = Math.min(x.length, y.length);
  return long <= 2 * short && editDistance(x, y) <= Math.ceil(long / 2);
}

/**
 * Where MyScript's reading of a line differs from the stored text in a word:
 * one fix per substituted word that is plausibly the same word misread
 * (`plausibleMisreading`; case and punctuation aside; added or missing words
 * are not offered). Each fix replaces the stored word's letters only, so
 * its punctuation stays (`boing,` → `boring,`).
 *
 * @param {string} stored  the stored line's text
 * @param {string} reading MyScript's text for the line (a task box is stripped)
 * @returns {Array<{ at: number, msAt: number, from: string, to: string, start: number, end: number }>}
 *   `at` / `msAt`: the word's index in the stored / MyScript tokens; `start` / `end`: the stored word's letters
 */
export function wordFixes(stored, reading) {
  const a = tokens(String(stored || ''));
  const b = tokens(stripTaskMarker(String(reading || '')));
  const na = a.map((t) => norm(t.word)), nb = b.map((t) => norm(t.word));
  const n = a.length, m = b.length;
  // Word-level edit distance, then walk back for the substitutions.
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (na[i - 1] === nb[j - 1] ? 0 : 1));
    }
  }
  const fixes = [];
  for (let i = n, j = m; i > 0 && j > 0;) {
    const same = na[i - 1] === nb[j - 1];
    if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      if (!same && !sameLetters(a[i - 1].word, b[j - 1].word)) {
        const s = splitPunct(a[i - 1].word);
        const to = splitPunct(b[j - 1].word).core;
        if (s.core && to && plausibleMisreading(s.core, to)) {
          const start = a[i - 1].start + s.pre.length;
          fixes.push({ at: i - 1, msAt: j - 1, from: s.core, to, start, end: start + s.core.length });
        }
      }
      i--; j--;
    } else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return fixes.reverse();
}

/**
 * The stored text with the given fixes taken (each replaces its word's letters).
 * @param {string} text
 * @param {Array<{start:number,end:number,to:string}>} fixes  from wordFixes(text, …)
 */
export function applyWordFixes(text, fixes) {
  let out = String(text || '');
  for (const f of [...(fixes || [])].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, f.start) + f.to + out.slice(f.end);
  }
  return out;
}

/* ----------------------------------------------------------------
 *  Classify
 * ---------------------------------------------------------------- */

/**
 * @typedef {Object} RelinkRow
 * @property {'matched'|'confirm'|'noink'|'leftover'} type
 * @property {number|null} n           the stored line's number, #n as get_transcript shows it (null for leftover)
 * @property {string|null} lineId      the stored line (null for leftover)
 * @property {string} text             the stored text ('' for leftover)
 * @property {number} indentLevel
 * @property {string|null} task        'TODO' | 'DONE' | 'WAITING' | 'CANCELLED' | null
 * @property {number|null} ms          index into the MyScript lines (the first; null for noink without partner)
 * @property {number[]} msAll          every MyScript line the row takes (2+ for a line merged by hand)
 * @property {number[]} breaks         word indices of the reading where a further MyScript line starts
 * @property {string} [joinTo]         leftover: the stored line "Add to #N" would give its ink to
 * @property {number} [joinToN]        leftover: that line's #n
 * @property {string} reading          MyScript's text, its lines joined by spaces ('' when none)
 * @property {number|null} sim         similarity of the pair
 * @property {Array} fixes             word fixes (matched / confirm rows)
 * @property {boolean} [moved]         a confirm row whose reading is elsewhere on the page (stored out of place)
 */

/**
 * Align MyScript's lines with the stored text lines and classify each:
 * matched (≥ MATCH_AT), confirm (CONFIRM_AT..MATCH_AT), no ink (below, or no
 * partner); a MyScript line with no accepted partner is ink left over. A no-ink
 * line whose reading sits elsewhere on the page (≥ CONFIRM_AT) becomes a confirm
 * row marked `moved`. Rows come in stored order, leftover ink where it falls.
 *
 * @param {Array} lines         transcript.lines (kind lines are left out)
 * @param {Array<{text:string, yBounds?:object}>} msLines  MyScript's lines
 * @returns {{ rows: RelinkRow[], counts: { matched:number, confirm:number, moved:number, noink:number, leftover:number, tasks:number, kindLines:number } }}
 */
export function classifyRelink(lines, msLines) {
  const stored = textLines(lines);
  const ms = (msLines || []).map((l) => ({ text: String((l && l.text) || ''), yBounds: l && l.yBounds }));
  const counts = { matched: 0, confirm: 0, moved: 0, joined: 0, noink: 0, leftover: 0, tasks: 0, kindLines: (lines || []).filter(isKindLine).length };
  const rows = [];
  const joinText = (bs) => bs.map((k) => ms[k].text).join(' ');
  const storedRow = (l, type, bs, sim, moved = false) => {
    const st = taskStateOf(l);
    const n = (lines || []).indexOf(l) + 1;
    if (st) counts.tasks++;
    counts[type]++;
    if (bs && bs.length > 1) counts.joined++;
    const reading = bs ? joinText(bs) : '';
    rows.push({
      type, n, lineId: l.id, text: l.text || '', indentLevel: l.indentLevel || 0, task: st ? stateLabel(st) : null,
      ms: bs ? bs[0] : null, msAll: bs || [], reading, sim,
      // Where each further MyScript line starts among the reading's words (the dialog marks it ⏎).
      breaks: bs && bs.length > 1 ? lineBreaks(bs.map((k) => ms[k].text)) : [],
      fixes: type === 'noink' ? [] : wordFixes(l.text || '', reading),
      ...(moved ? { moved: true } : {})
    });
  };
  const leftover = (j) => {
    counts.leftover++;
    rows.push({ type: 'leftover', n: null, lineId: null, text: '', indentLevel: 0, task: null, ms: j, msAll: [j], reading: ms[j].text, breaks: [], sim: null, fixes: [] });
  };
  // In order first, where one stored line may take several consecutive MyScript
  // lines (a line merged by hand from two written rows, alignLinesJoined); a pair
  // too unlike (or a reading without bounds) is split into no ink + leftover.
  // Then lines stored out of place (3017/180: a meeting written mid-page, stored
  // at the end) pair with their reading elsewhere on the page (movedPairs, at
  // CONFIRM_AT): confirm rows marked moved. Linking one changes only its yBounds
  // and ink, never its place in the transcript.
  const usableAt = (k) => usableYBounds(ms[k].yBounds);
  const simOf = (a, bs) => (bs.every(usableAt) ? similarity(stored[a].text, joinText(bs)) : 0);
  const joinedOf = new Map();
  const inOrder = [];
  for (const [a, bs] of alignLinesJoined(stored, ms, { usable: usableAt })) {
    if (a === null) inOrder.push([null, bs[0]]);
    else if (bs === null) inOrder.push([a, null]);
    else if (simOf(a, bs) < CONFIRM_AT) inOrder.push([a, null], ...bs.map((k) => [null, k]));
    else {
      joinedOf.set(a, bs);
      inOrder.push([a, bs[0]]);
    }
  }
  for (const [a, b, moved] of movedPairs(inOrder, stored, ms, CONFIRM_AT, usableAt)) {
    if (a === null) { leftover(b); continue; }
    if (b === null) { storedRow(stored[a], 'noink', null, null); continue; }
    const bs = moved ? [b] : joinedOf.get(a) || [b];
    const sim = simOf(a, bs);
    if (moved) {
      counts.moved++;
      storedRow(stored[a], 'confirm', bs, sim, true);
    } else storedRow(stored[a], sim >= MATCH_AT ? 'matched' : 'confirm', bs, sim);
  }
  // Within a run of unpaired rows the alignment's order is arbitrary; put the
  // stored (no ink) rows first, so a leftover's "line above" never skips one.
  for (let i = 0; i < rows.length;) {
    if (rows[i].type !== 'noink' && rows[i].type !== 'leftover') { i++; continue; }
    let j = i;
    while (j < rows.length && (rows[j].type === 'noink' || rows[j].type === 'leftover')) j++;
    const run = rows.slice(i, j);
    rows.splice(i, j - i, ...run.filter((r) => r.type === 'noink'), ...run.filter((r) => r.type === 'leftover'));
    i = j;
  }
  // "Add to #N": a leftover's predecessor in this order, when it is a matched or
  // confirm row (the dialog offers it only while that line is linked).
  let prev = null;
  for (const r of rows) {
    if (r.type !== 'leftover') { prev = r; continue; }
    if (prev && (prev.type === 'matched' || prev.type === 'confirm')) {
      r.joinTo = prev.lineId;
      r.joinToN = prev.n;
    }
  }
  return { rows, counts };
}

/** Word indices (after a leading task box) where the 2nd, 3rd … of several joined lines start. */
function lineBreaks(texts) {
  const out = [];
  let at = 0;
  texts.forEach((t, i) => {
    if (i > 0) out.push(at);
    at += (i === 0 ? stripTaskMarker(t) : String(t)).split(/\s+/).filter(Boolean).length;
  });
  return out;
}

/** Is that stored line linked under these decisions (matched, or a confirm row on Link)? */
export function rowLinked(model, decisions, lineId) {
  const r = ((model && model.rows) || []).find((x) => x.lineId === lineId);
  return !!r && (r.type === 'matched' || (r.type === 'confirm' && decisions.link[r.lineId] !== false));
}

/** Why a relink that links no stored line is refused (it would mark the page trustworthy with all its ink unlinked). */
export const NO_LINKS = 'No stored line would be linked to ink, so there is nothing to save; the page would read as linked with all its ink unlinked';

/** How many stored lines a save of these decisions links (Save is offered only above 0). */
export function linkedCount(model, decisions = defaultDecisions(model)) {
  return ((model && model.rows) || []).filter((r) => r.type === 'matched'
    || (r.type === 'confirm' && decisions.link[r.lineId] !== false)).length;
}

/** Shown when a page changed between its MyScript run and the save. */
export const STALE_NOTE = 'The page changed since it was sent to MyScript, so these links may not fit. Send it again to review fresh ones.';

/**
 * What the Relink dialog does after a save (pure, so it is tested without
 * mounting the dialog). Never 'saving': whatever happened, the dialog leaves the
 * saving phase, so it can close (2026-11-19: it stayed on "Saving…" after a
 * successful save, because close() refuses while saving).
 * @param {{ ok: boolean, stale?: boolean, error?: string }|null|undefined} r  saveRelink's result
 * @returns {{ phase: 'done'|'ask'|'review', close: boolean, error: string, staleNote: string }}
 */
export function afterRelinkSave(r) {
  if (r && r.ok) return { phase: 'done', close: true, error: '', staleNote: '' };
  if (r && r.stale) return { phase: 'ask', close: false, error: '', staleNote: STALE_NOTE };
  return { phase: 'review', close: false, error: (r && r.error) || 'Save failed', staleNote: '' };
}

/** Saved at once in a bulk run: every stored line matched in order, nothing to confirm (moved lines included), no ink left over. */
export function relinkNeedsNoReview(model) {
  const c = model && model.counts;
  return !!c && c.matched > 0 && c.confirm === 0 && !c.moved && c.noink === 0 && c.leftover === 0;
}

/**
 * The review's starting decisions: confirm rows link, leftover ink stays
 * unlinked, no word fix taken.
 * @returns {{ link: Object<string, boolean>, leftover: Object<number, string>, fixes: Object<string, number[]> }}
 */
export function defaultDecisions(model) {
  const link = {}, leftover = {};
  for (const r of (model && model.rows) || []) {
    if (r.type === 'confirm') link[r.lineId] = true;
    if (r.type === 'leftover') leftover[r.ms] = LEFTOVER_LEAVE;
  }
  return { link, leftover, fixes: {} };
}

/**
 * The `relink` spec the save takes (save-page.js `planTranscript(…, { relink })`):
 * the MyScript run plus what the review decided. Each link names every MyScript
 * line its stored line takes (`ms: [..]`: joined lines, and leftovers added to it).
 *
 * @param {Object} run  `{ revision, rotation, originNcodeY, sent: string[], lines: [{text, yBounds}] }`
 * @param {Object} model classifyRelink's result
 * @param {Object} decisions defaultDecisions' shape, as changed by the review
 */
export function buildRelinkSpec(run, model, decisions = defaultDecisions(model)) {
  const links = [], texts = {}, add = [], textless = [];
  const linkFor = new Map();
  for (const r of model.rows) {
    if (r.type === 'matched' || (r.type === 'confirm' && decisions.link[r.lineId] !== false)) {
      const link = { lineId: r.lineId, ms: [...(r.msAll && r.msAll.length ? r.msAll : [r.ms])] };
      links.push(link);
      linkFor.set(r.lineId, link);
      const taken = (decisions.fixes[r.lineId] || []).map((k) => r.fixes[k]).filter(Boolean);
      if (taken.length) {
        const text = applyWordFixes(r.text, taken);
        if (text.trim() && text !== r.text) texts[r.lineId] = text;
      }
    }
  }
  for (const r of model.rows) {
    if (r.type !== 'leftover') continue;
    const choice = decisions.leftover[r.ms] || LEFTOVER_LEAVE;
    if (choice === LEFTOVER_ADD && stripTaskMarker(r.reading)) add.push(r.ms);
    else if (choice === LEFTOVER_TEXTLESS) textless.push(r.ms);
    // "Add to #N": only while that line is linked; otherwise the ink stays unlinked.
    else if (choice === LEFTOVER_JOIN && r.joinTo && linkFor.has(r.joinTo)) linkFor.get(r.joinTo).ms.push(r.ms);
  }
  return {
    revision: run.revision ?? null,
    rotation: run.rotation || 0,
    originNcodeY: run.originNcodeY,
    sent: [...(run.sent || [])],
    myscriptLines: (run.lines || []).map((l) => ({ text: String(l.text || ''), yBounds: l.yBounds || null })),
    links, texts, add, textless
  };
}

/* ----------------------------------------------------------------
 *  Guards (B.6) and the cache
 * ---------------------------------------------------------------- */

/**
 * Why Relink can't run on this page now, or null. The first four are Claude's
 * edit refusals (lib/mcp-edits.js `editRefusal`, same flags, same order), worded
 * for Josh; then Relink's own: a letter-suffixed page whose page number is on the
 * canvas (its canvas copy can't be told apart, so it couldn't take the new
 * links); then the page itself: nothing to do on a trustworthy page, nothing
 * to align on a page with no text lines.
 *
 * @param {{ label: string, draft: boolean, editorOpen: boolean, reset: boolean, pendingTranscription: boolean,
 *           suffixOnCanvas?: boolean }} s  suffixOnCanvas: a letter-suffixed page whose page number is on the canvas
 * @param {Object|null} doc  the page as on disk
 * @param {{ again?: boolean }} [opts]  again: Relink a page already linked (the reader's "Relink again…",
 *   after Josh confirms); every other refusal still applies
 * @returns {string|null}
 */
export function relinkRefusal(s, doc, { again = false } = {}) {
  if (s.draft) return `${s.label} has unsaved transcript edits in the Library; save or cancel them first`;
  if (s.editorOpen) return `${s.label} is open in a transcript editor; close it first`;
  if (s.reset) return `${s.label} is reset for re-transcription in the Editor; transcribe and save it (or undo the reset) first`;
  if (s.pendingTranscription) return `${s.label} has an unsaved transcription in the Editor; save or discard it first`;
  if (s.suffixOnCanvas) {
    return `${s.label} is a letter-suffixed page and its page number is loaded in the Editor, which can't tell the two apart; unload it from the Editor first`;
  }
  if (!doc) return `${s.label} was not found`;
  if (!textLines(doc.transcript && doc.transcript.lines).length) return `${s.label} has no transcript lines to relink`;
  if (!again && isTrustworthyTranscript(doc)) return `${s.label} is already linked to its ink; nothing to relink`;
  if (!relinkSendStrokes(doc).length) return `${s.label} has no ink to send`;
  return null;
}

/** Does a cached MyScript run still belong to the page as it is on disk? */
export function cachedRunValid(entry, revision) {
  return !!entry && typeof entry === 'object' && !!revision && entry.revision === revision
    && Array.isArray(entry.lines) && Array.isArray(entry.sent) && Number.isFinite(entry.originNcodeY);
}

/** The run as cached: only what Relink needs back (no raw response). */
export function runForCache(run) {
  return {
    revision: run.revision,
    time: run.time || new Date().toISOString(),
    rotation: run.rotation || 0,
    originNcodeY: run.originNcodeY,
    sent: [...run.sent],
    lines: (run.lines || []).map((l) => ({ text: String(l.text || ''), yBounds: l.yBounds || null, indentLevel: l.indentLevel || 0 }))
  };
}

/** Candidates grouped by notebook for the preview: `[{ book, pages, lines, tasks }]`, in book order given. */
export function groupCandidates(rows, compareBooks = (a, b) => String(a).localeCompare(String(b))) {
  const by = new Map();
  for (const r of rows || []) {
    const g = by.get(r.book) || { book: r.book, pages: 0, lines: 0, tasks: 0 };
    g.pages++; g.lines += r.lines; g.tasks += r.tasks;
    by.set(r.book, g);
  }
  return [...by.values()].sort((a, b) => compareBooks(a.book, b.book));
}

/**
 * The unreliable pages for the bulk preview: one row per page with its
 * text-line and task counts, newest ink first. `docs` are the pages read from disk.
 * @param {Array<{ book: string, pageId: string, doc: Object }>} docs
 */
export function relinkCandidates(docs) {
  const out = [];
  for (const { book, pageId, doc } of docs || []) {
    if (!doc) continue;
    const lines = textLines(doc.transcript && doc.transcript.lines);
    if (!lines.length || isTrustworthyTranscript(doc) || !relinkSendStrokes(doc).length) continue;
    out.push({
      book, pageId,
      lines: lines.length,
      tasks: lines.filter((l) => taskStateOf(l)).length,
      revision: (doc.metadata && doc.metadata.lastUpdated) || '',
      // When it was last written on (capture time), for "newest first".
      written: (doc.strokes || []).reduce((t, st) => Math.max(t, Number(st && st.startTime) || 0), 0)
    });
  }
  return out.sort((a, b) => b.written - a.written);
}
