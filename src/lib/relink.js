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
import { alignLines, similarity, norm, sameLetters } from './line-align.js';
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
 * Where MyScript's reading of a line differs from the stored text in a word:
 * one fix per substituted word (case and punctuation aside; added or missing
 * words are not offered). Each fix replaces the stored word's letters only, so
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
        if (s.core && to) {
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
 * @property {number|null} ms          index into the MyScript lines (null for noink without partner)
 * @property {string} reading          MyScript's text ('' when none)
 * @property {number|null} sim         similarity of the pair
 * @property {Array} fixes             word fixes (matched / confirm rows)
 */

/**
 * Align MyScript's lines with the stored text lines and classify each:
 * matched (≥ MATCH_AT), confirm (CONFIRM_AT..MATCH_AT), no ink (below, or no
 * partner); a MyScript line with no accepted partner is ink left over. Rows
 * come in alignment order (stored order, leftover ink where it falls).
 *
 * @param {Array} lines         transcript.lines (kind lines are left out)
 * @param {Array<{text:string, yBounds?:object}>} msLines  MyScript's lines
 * @returns {{ rows: RelinkRow[], counts: { matched:number, confirm:number, noink:number, leftover:number, tasks:number, kindLines:number } }}
 */
export function classifyRelink(lines, msLines) {
  const stored = textLines(lines);
  const ms = (msLines || []).map((l) => ({ text: String((l && l.text) || ''), yBounds: l && l.yBounds }));
  const counts = { matched: 0, confirm: 0, noink: 0, leftover: 0, tasks: 0, kindLines: (lines || []).filter(isKindLine).length };
  const rows = [];
  const storedRow = (l, type, j, sim) => {
    const st = taskStateOf(l);
    const n = (lines || []).indexOf(l) + 1;
    if (st) counts.tasks++;
    counts[type]++;
    rows.push({
      type, n, lineId: l.id, text: l.text || '', indentLevel: l.indentLevel || 0, task: st ? stateLabel(st) : null,
      ms: j, reading: j === null ? '' : ms[j].text, sim,
      fixes: type === 'noink' ? [] : wordFixes(l.text || '', ms[j].text)
    });
  };
  const leftover = (j) => {
    counts.leftover++;
    rows.push({ type: 'leftover', n: null, lineId: null, text: '', indentLevel: 0, task: null, ms: j, reading: ms[j].text, sim: null, fixes: [] });
  };
  for (const [a, b] of alignLines(stored, ms)) {
    if (a === null) { leftover(b); continue; }
    if (b === null) { storedRow(stored[a], 'noink', null, null); continue; }
    // A MyScript line without usable bounds can't link ink.
    const sim = usableYBounds(ms[b].yBounds) ? similarity(stored[a].text, ms[b].text) : 0;
    if (sim >= MATCH_AT) storedRow(stored[a], 'matched', b, sim);
    else if (sim >= CONFIRM_AT) storedRow(stored[a], 'confirm', b, sim);
    else {
      storedRow(stored[a], 'noink', null, null);
      leftover(b);
    }
  }
  return { rows, counts };
}

/** Why a relink that links no stored line is refused (it would mark the page trustworthy with all its ink unlinked). */
export const NO_LINKS = 'No stored line would be linked to ink, so there is nothing to save; the page would read as linked with all its ink unlinked';

/** How many stored lines a save of these decisions links (Save is offered only above 0). */
export function linkedCount(model, decisions = defaultDecisions(model)) {
  return ((model && model.rows) || []).filter((r) => r.type === 'matched'
    || (r.type === 'confirm' && decisions.link[r.lineId] !== false)).length;
}

/** Saved at once in a bulk run: every stored line matched, nothing to confirm, no ink left over. */
export function relinkNeedsNoReview(model) {
  const c = model && model.counts;
  return !!c && c.matched > 0 && c.confirm === 0 && c.noink === 0 && c.leftover === 0;
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
 * the MyScript run plus what the review decided.
 *
 * @param {Object} run  `{ revision, rotation, originNcodeY, sent: string[], lines: [{text, yBounds}] }`
 * @param {Object} model classifyRelink's result
 * @param {Object} decisions defaultDecisions' shape, as changed by the review
 */
export function buildRelinkSpec(run, model, decisions = defaultDecisions(model)) {
  const links = [], texts = {}, add = [], textless = [];
  for (const r of model.rows) {
    if (r.type === 'matched' || (r.type === 'confirm' && decisions.link[r.lineId] !== false)) {
      links.push({ lineId: r.lineId, ms: r.ms });
      const taken = (decisions.fixes[r.lineId] || []).map((k) => r.fixes[k]).filter(Boolean);
      if (taken.length) {
        const text = applyWordFixes(r.text, taken);
        if (text.trim() && text !== r.text) texts[r.lineId] = text;
      }
    } else if (r.type === 'leftover') {
      const choice = decisions.leftover[r.ms] || LEFTOVER_LEAVE;
      if (choice === LEFTOVER_ADD && stripTaskMarker(r.reading)) add.push(r.ms);
      else if (choice === LEFTOVER_TEXTLESS) textless.push(r.ms);
    }
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
 * @returns {string|null}
 */
export function relinkRefusal(s, doc) {
  if (s.draft) return `${s.label} has unsaved transcript edits in the Library; save or cancel them first`;
  if (s.editorOpen) return `${s.label} is open in a transcript editor; close it first`;
  if (s.reset) return `${s.label} is reset for re-transcription in the Editor; transcribe and save it (or undo the reset) first`;
  if (s.pendingTranscription) return `${s.label} has an unsaved transcription in the Editor; save or discard it first`;
  if (s.suffixOnCanvas) {
    return `${s.label} is a letter-suffixed page and its page number is loaded in the Editor, which can't tell the two apart; unload it from the Editor first`;
  }
  if (!doc) return `${s.label} was not found`;
  if (!textLines(doc.transcript && doc.transcript.lines).length) return `${s.label} has no transcript lines to relink`;
  if (isTrustworthyTranscript(doc)) return `${s.label} is already linked to its ink; nothing to relink`;
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
