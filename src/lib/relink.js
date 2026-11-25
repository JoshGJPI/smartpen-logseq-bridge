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
import { alignLinesJoined, movedPairs, similarity, norm, words, sameLetters, editDistance } from './line-align.js';
import { stripTaskMarker } from './task-markers.js';
import { taskStateOf, stateLabel } from './tasks.js';
import { isTrustworthyTranscript } from './viewer/ink-text.js';
import { detectDecorativeIndices } from './stroke-filter.js';

/** Similarity at or above which a pair links without asking. */
export const MATCH_AT = 0.85;
/** Similarity at or above which (and below MATCH_AT) a pair is offered for confirming; below it, no ink. */
export const CONFIRM_AT = 0.6;

/** Leftover ink choices (B.4). Make sketch joins them in Phase E. */
export const LEFTOVER_LEAVE = 'leave';
export const LEFTOVER_ADD = 'add';
export const LEFTOVER_TEXTLESS = 'textless';
/**
 * "Add to #N": the leftover ink goes to a stored text line (its text unchanged unless a
 * word fix is taken). The row suggests one (`joinTo`, the nearby line whose words it
 * shares most); the review may pick any other (`decisions.joinTo[ms]`, v3.28.0). A line
 * with no ink that takes it becomes linked to it.
 */
export const LEFTOVER_JOIN = 'join';
/**
 * "Make sketch" (v3.24.0, spec B.4 / E.3): the leftover ink becomes a sketch line.
 * Every row the review marks so goes into ONE sketch (a drawing is usually read
 * as several MyScript lines), labelled "Sketch", placed by y, in the same write.
 */
export const LEFTOVER_SKETCH = 'sketch';

/** A line that is not plain text (a `kind`, spec E.7): kept, never matched to MyScript. */
export const isKindLine = (l) => !!(l && l.kind);

/** The lines Relink aligns: every line without a `kind`. */
export function textLines(lines) {
  return (lines || []).filter((l) => l && l.id && !isKindLine(l));
}

/**
 * The stored strokes Relink sends: every stroke with ink, minus textless ones
 * ("Not text", left out on purpose) and minus strokes linked to a kind line
 * (a sketch's ink is its own, never text). With `ids` (Relink selection), only those.
 * @param {{ transcript?: {lines?: Array}, strokes?: Array }} doc
 * @param {string[]|null} [ids]
 * @returns {Array} stored strokes, in page order
 */
export function relinkSendStrokes(doc, ids = null) {
  const want = ids ? new Set(ids) : null;
  const kindIds = new Set(((doc && doc.transcript && doc.transcript.lines) || []).filter(isKindLine).map((l) => l.id));
  return ((doc && doc.strokes) || []).filter((s) => s && Array.isArray(s.points) && s.points.length > 0
    && s.textless !== true && !(s.lineId && kindIds.has(s.lineId)) && (!want || want.has(s.id)));
}

/**
 * Hold back decorative ink before a Relink run (2026-11-19, Josh's run on
 * 3017/125: underlines and a table's rules made MyScript misread whole lines).
 * Runs lib/stroke-filter.js on the strokes AS SENT (turned upright, so an
 * underline is horizontal), with its own rules: never a task box, never a
 * strike-through. Held-back strokes are not sent; the save unlinks them, and
 * flags them Not text unless the review unticks "Mark them Not text".
 *
 * @param {Array} sendCanvas  the turned canvas copies, in the order of `ids`
 * @param {string[]} ids      their stored ids
 * @returns {{ send: Array, sent: string[], heldBack: string[], stats: { underlines: number, boxes: number, circles: number } }}
 */
export function holdBackDecorative(sendCanvas, ids) {
  const list = sendCanvas || [];
  const none = { underlines: 0, boxes: 0, circles: 0 };
  const { indices, stats } = detectDecorativeIndices(list);
  const held = new Set(indices);
  // Never hold back every stroke: with nothing left to send there is nothing to relink.
  if (!held.size || held.size >= list.length) return { send: list, sent: [...ids], heldBack: [], stats: none };
  return {
    send: list.filter((_, i) => !held.has(i)),
    sent: ids.filter((_, i) => !held.has(i)),
    heldBack: ids.filter((_, i) => held.has(i)),
    stats: { underlines: stats.underlines || 0, boxes: stats.boxes || 0, circles: stats.circles || 0 }
  };
}

/** "3 underlines, 1 box": what a run held back, for the review. */
export function heldBackLabel(stats, n) {
  const st = stats || {};
  const parts = [[st.underlines, 'underline', 'underlines'], [st.boxes, 'box', 'boxes'], [st.circles, 'circle', 'circles']]
    .filter(([k]) => k > 0).map(([k, one, many]) => `${k} ${k === 1 ? one : many}`);
  return parts.length ? parts.join(', ') : `${n} decorative stroke${n === 1 ? '' : 's'}`;
}

/**
 * The Editor's "Relink selection…" (v3.21.0): which page and strokes the
 * selection names, or why it can't run. One page only (a selection over several
 * pages is refused: select one page's strokes). Refused while the page has
 * unsaved canvas changes: Relink writes from the disk, and the canvas would then
 * disagree with it. A partly loaded page is fine: only the selected strokes are
 * sent, and the save treats every other stroke on disk the same way, loaded or not.
 *
 * @param {Array} all          the strokes store's value
 * @param {Iterable<number>} indices  the selection
 * @param {Map} pending        pendingChanges' value (`B{book}/P{page}` → buckets)
 * @returns {{ ok: true, book: string, pageId: string, ids: string[] } | { ok: false, error: string }}
 */
export function selectionRelinkTarget(all, indices, pending = new Map()) {
  const picked = [...(indices || [])].map((i) => all && all[i]).filter((s) => s && s.pageInfo && !s.deleted);
  if (!picked.length) return { ok: false, error: 'Select the strokes to relink first' };
  const pages = new Set(picked.map((s) => `B${s.pageInfo.book}/P${s.pageInfo.page}`));
  if (pages.size > 1) {
    return { ok: false, error: `The selection covers ${pages.size} pages; Relink selection works on one page at a time, so select one page's strokes` };
  }
  const { book, page } = picked[0].pageInfo;
  const key = `B${book}/P${page}`;
  const c = pending && pending.get ? pending.get(key) : null;
  const dirty = !!c && ['additions', 'edits', 'modifications', 'deletions', 'retimes', 'moves'].some((b) => (c[b] || []).length > 0);
  if (dirty) return { ok: false, error: `${key} has unsaved changes in the Editor; Relink works from the saved page, so save first` };
  return { ok: true, book: String(book), pageId: String(page), ids: [...new Set(picked.map((s) => `s${s.startTime}`))] };
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
 * @property {string} [joinTo]         leftover: the stored line "Add to #N" suggests (joinSuggestion)
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
  // "Add to #N": the nearby stored line the leftover most likely belongs to.
  rows.forEach((r, i) => {
    if (r.type !== 'leftover') return;
    const to = joinSuggestion(rows, i);
    if (to) { r.joinTo = to.lineId; r.joinToN = to.n; }
  });
  return { rows, counts, msTexts: ms.map((l) => l.text) };
}

/** How far "Add to #N" looks for its suggestion: stored rows back (stopping at a linked one) and forward. */
const JOIN_BACK = 5, JOIN_AHEAD = 2;

/**
 * The stored line a leftover row most likely belongs to (v3.28.0; 2026-11-25, Josh's
 * B553/P1: "replaced" read on its own belonged to the line BELOW, and the readings of
 * two no-ink lines came back as leftovers with nothing to add them to). Candidates: the
 * stored rows above it back to and including the nearest linked one (at most JOIN_BACK),
 * and the next JOIN_AHEAD below. Each scores the share of the leftover's words found in
 * its stored text; the best wins, a no-ink line over a linked one on a tie, then the
 * nearer above. With no shared word, the stored row just above.
 */
function joinSuggestion(rows, i) {
  const back = [], ahead = [];
  for (let k = i - 1; k >= 0 && back.length < JOIN_BACK; k--) {
    const r = rows[k];
    if (r.type === 'leftover') continue;
    back.push(r);
    if (r.type !== 'noink') break;
  }
  for (let k = i + 1; k < rows.length && ahead.length < JOIN_AHEAD; k++) if (rows[k].type !== 'leftover') ahead.push(rows[k]);
  const want = words(stripTaskMarker(rows[i].reading));
  let best = null, bestScore = 0;
  if (want.length) {
    for (const r of [...back, ...ahead]) {
      const have = new Set(words(r.text));
      const score = want.filter((w) => have.has(w)).length / want.length;
      const tieWin = score === bestScore && best && best.type !== 'noink' && r.type === 'noink';
      if (score > 0 && (score > bestScore || tieWin)) { best = r; bestScore = score; }
    }
  }
  return best || back[0] || null;
}

/** The stored line a leftover row's ink goes to under these decisions, or null (not "Add to", or no such line). */
export function leftoverTarget(model, decisions, r) {
  if (!r || r.type !== 'leftover' || !decisions) return null;
  if (((decisions.leftover || {})[r.ms] || LEFTOVER_LEAVE) !== LEFTOVER_JOIN) return null;
  const id = ((decisions.joinTo || {})[r.ms]) || r.joinTo;
  return id && ((model && model.rows) || []).some((x) => x.lineId === id) ? id : null;
}

/** A stored row's own MyScript line(s) count under these decisions (matched, or a confirm row on Link). */
const ownLinked = (r, decisions) => r.type === 'matched' || (r.type === 'confirm' && decisions.link[r.lineId] !== false);

/**
 * The rows as the review shows and saves them (v3.28.0): each stored line that takes
 * leftover ink ("Add to #N") gets those MyScript lines with its own (in reading order),
 * its reading joined, and its word fixes measured against that joined reading, so a
 * no-ink line that takes its ink is offered MyScript's words to Use (its text is kept
 * unless one is taken). Such a row has `added: [ms…]` and is linked; a confirm row on
 * Don't link takes only the added ink. A leftover row given away has `addedTo` (the
 * line's #n). Rows without either are the model's own.
 */
export function reviewRows(model, decisions) {
  const rows = (model && model.rows) || [];
  if (!decisions) return rows;
  const extra = new Map();
  const targetOf = new Map();
  for (const r of rows) {
    const id = leftoverTarget(model, decisions, r);
    if (!id) continue;
    targetOf.set(r.ms, id);
    if (!extra.has(id)) extra.set(id, []);
    extra.get(id).push(r.ms);
  }
  if (!extra.size) return rows;
  const texts = model.msTexts || [];
  const nOf = new Map(rows.filter((r) => r.lineId).map((r) => [r.lineId, r.n]));
  return rows.map((r) => {
    if (r.type === 'leftover') return targetOf.has(r.ms) ? { ...r, addedTo: nOf.get(targetOf.get(r.ms)) } : r;
    const more = r.lineId ? extra.get(r.lineId) : null;
    if (!more) return r;
    const own = ownLinked(r, decisions) ? (r.msAll.length ? r.msAll : r.ms != null ? [r.ms] : []) : [];
    const msAll = [...new Set([...own, ...more])].sort((a, b) => a - b);
    const lineTexts = msAll.map((k) => String(texts[k] ?? ''));
    const reading = lineTexts.join(' ');
    return {
      ...r, ms: msAll[0], msAll, reading, added: [...more].sort((a, b) => a - b),
      breaks: msAll.length > 1 ? lineBreaks(lineTexts) : [],
      fixes: wordFixes(r.text || '', reading)
    };
  });
}

/**
 * Change one leftover row's choice (and, for "Add to", its line: none = the row's
 * suggestion). Word fixes taken on a line whose reading this changes are kept where
 * the same fix is still offered and dropped otherwise (they index the row's fixes).
 * @returns {Object} the new decisions
 */
export function setLeftoverChoice(model, decisions, ms, value, lineId = null) {
  const before = reviewRows(model, decisions);
  const next = {
    ...decisions,
    leftover: { ...decisions.leftover, [ms]: value },
    joinTo: { ...(decisions.joinTo || {}) },
    fixes: { ...decisions.fixes }
  };
  if (value === LEFTOVER_JOIN && lineId) next.joinTo[ms] = lineId;
  else delete next.joinTo[ms];
  const after = reviewRows(model, next);
  const fixKey = (f) => `${f.start}:${f.end}:${f.to}`;
  before.forEach((r, i) => {
    const a = after[i];
    if (!r.lineId || r.fixes === a.fixes || !next.fixes[r.lineId]) return;
    const taken = new Set(next.fixes[r.lineId].map((k) => r.fixes[k]).filter(Boolean).map(fixKey));
    const kept = a.fixes.map((f, k) => (taken.has(fixKey(f)) ? k : -1)).filter((k) => k >= 0);
    if (kept.length) next.fixes[r.lineId] = kept;
    else delete next.fixes[r.lineId];
  });
  return next;
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

/** Is that stored line linked under these decisions (matched, a confirm row on Link, or a line given leftover ink)? */
export function rowLinked(model, decisions, lineId) {
  const rows = (model && model.rows) || [];
  const r = rows.find((x) => x.lineId === lineId);
  return !!r && (ownLinked(r, decisions) || rows.some((x) => leftoverTarget(model, decisions, x) === lineId));
}

/** Why a relink that links no stored line is refused (it would mark the page trustworthy with all its ink unlinked). */
export const NO_LINKS = 'No stored line would be linked to ink, so there is nothing to save; the page would read as linked with all its ink unlinked';

/** How many stored lines a save of these decisions links (Save is offered only above 0). */
export function linkedCount(model, decisions = defaultDecisions(model)) {
  return reviewRows(model, decisions).filter((r) => r.lineId && (ownLinked(r, decisions) || r.added)).length;
}

/**
 * The review's counts as the choices stand (v3.28.0), for the counts line and the footer:
 *   matched     matched rows; confirm: confirm rows (moved: of them), dontLink: of them set to Don't link
 *   noink       stored lines that end with no ink (no-ink rows, and Don't-link rows, given none)
 *   given       stored lines with no ink of their own that took leftover ink
 *   leftover    every leftover row; unlinked: still Leave unlinked (an "Add to" naming no line counts here)
 *   addedTo / newLines / textless / sketch   leftover rows per choice; fixes: word fixes taken; linked: linkedCount
 *   tasks / kindLines   from the classification (never changed by the review)
 */
export function reviewCounts(model, decisions = defaultDecisions(model)) {
  const c = (model && model.counts) || {};
  const out = {
    matched: 0, confirm: 0, moved: c.moved || 0, dontLink: 0, noink: 0, given: 0,
    leftover: 0, unlinked: 0, addedTo: 0, newLines: 0, textless: 0, sketch: 0,
    fixes: Object.values(decisions.fixes || {}).reduce((n, l) => n + l.length, 0),
    linked: 0, tasks: c.tasks || 0, kindLines: c.kindLines || 0
  };
  // A leftover merged into the new line above is part of that line, not a line of its own (v3.30.0).
  const merged = new Set(addedGroups(model, decisions).flatMap((g) => g.ms.slice(1)));
  for (const r of reviewRows(model, decisions)) {
    if (r.type === 'leftover') {
      out.leftover++;
      const v = (decisions.leftover || {})[r.ms] || LEFTOVER_LEAVE;
      if (r.addedTo) out.addedTo++;
      else if (v === LEFTOVER_ADD && stripTaskMarker(r.reading)) { if (!merged.has(r.ms)) out.newLines++; }
      else if (v === LEFTOVER_TEXTLESS) out.textless++;
      else if (v === LEFTOVER_SKETCH) out.sketch++;
      else out.unlinked++;
      continue;
    }
    const own = ownLinked(r, decisions);
    if (r.type === 'matched') out.matched++;
    if (r.type === 'confirm') { out.confirm++; if (!own) out.dontLink++; }
    if (own || r.added) out.linked++;
    if (!own && r.added) out.given++;
    if (!own && !r.added) out.noink++;
  }
  return out;
}

/** The footer's "Also: …" list (v3.28.0): what the save does besides linking. '' when nothing. */
export function reviewSummary(k) {
  const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return [
    k.fixes && s(k.fixes, 'word fix', 'word fixes'),
    k.addedTo && `${s(k.addedTo, 'leftover', 'leftovers')} added to lines`,
    k.newLines && s(k.newLines, 'new line', 'new lines'),
    k.sketch && `1 sketch (from ${s(k.sketch, 'row', 'rows')})`,
    k.textless && `${k.textless} left out as Not text`,
    k.dontLink && `${k.dontLink} not linked`
  ].filter(Boolean).join(', ');
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
 * unlinked, no word fix taken, held-back decorative ink marked Not text.
 * @returns {{ link: Object<string, boolean>, leftover: Object<number, string>, joinTo: Object<number, string>,
 *   fixes: Object<string, number[]>, heldBackTextless: boolean }}  joinTo: the line an "Add to" leftover picked
 *   (none = the row's suggestion); fixes index reviewRows()' row fixes
 */
export function defaultDecisions(model) {
  const link = {}, leftover = {};
  for (const r of (model && model.rows) || []) {
    if (r.type === 'confirm') link[r.lineId] = true;
    if (r.type === 'leftover') leftover[r.ms] = LEFTOVER_LEAVE;
  }
  return { link, leftover, joinTo: {}, fixes: {}, heldBackTextless: true, newText: {}, newIndent: {}, mergeUp: {} };
}

/* ----------------------------------------------------------------
 *  New lines from leftover ink (v3.30.0): edit text, indent, merge
 * ---------------------------------------------------------------- */

/** Is this leftover row set to "Add as new line" (with something to read)? */
export function isNewLineRow(decisions, r) {
  return !!r && r.type === 'leftover' && ((decisions && decisions.leftover) || {})[r.ms] === LEFTOVER_ADD && !!stripTaskMarker(r.reading);
}

/**
 * The new lines the review makes, in page order (v3.30.0, Josh 2026-11-25: fix the
 * untranscribed part of a relinked page in the review). Each "Add as new line" row
 * is a line of its own unless it is merged into the new line just above it
 * (`decisions.mergeUp[ms]`; only valid while the row right above is a new line
 * too). A line's text is what the review typed (`newText[head]`), else MyScript's
 * readings joined; its indent is `newIndent[head]` (null = placed as before,
 * lib/relink-plan.js placeNewLines).
 * @returns {Array<{ head: number, ms: number[], text: string, reading: string, edited: boolean, indent: number|null }>}
 */
export function addedGroups(model, decisions) {
  const rows = (model && model.rows) || [];
  const out = [];
  let prevNew = false;
  for (const r of rows) {
    const isNew = isNewLineRow(decisions, r);
    if (isNew && prevNew && (decisions.mergeUp || {})[r.ms] && out.length) {
      const g = out[out.length - 1];
      g.ms.push(r.ms);
      g.reading = `${g.reading} ${r.reading.trim()}`;
    } else if (isNew) {
      out.push({ head: r.ms, ms: [r.ms], reading: r.reading.trim(), text: '', edited: false, indent: null });
    }
    prevNew = isNew;
  }
  for (const g of out) {
    const typed = (decisions.newText || {})[g.head];
    g.edited = typeof typed === 'string' && !!typed.trim();
    g.text = g.edited ? typed.trim() : g.reading;
    const ind = (decisions.newIndent || {})[g.head];
    g.indent = Number.isInteger(ind) && ind >= 0 ? ind : null;
  }
  return out;
}

/** Can this row merge into the new line above it (both new lines, adjacent in the review)? */
export function canMergeUp(model, decisions, r) {
  const rows = (model && model.rows) || [];
  const i = rows.indexOf(r) >= 0 ? rows.indexOf(r) : rows.findIndex((x) => x.type === 'leftover' && r && x.ms === r.ms);
  return i > 0 && isNewLineRow(decisions, rows[i]) && isNewLineRow(decisions, rows[i - 1]);
}

/**
 * Merge a new line into the one above (`on`), or split it off again. Typed text on
 * the line above takes the merged reading on the end (and gives it back on a
 * split); the merged row's own typed text and indent are dropped.
 * @returns {Object} the new decisions
 */
export function setMergeUp(model, decisions, ms, on) {
  const before = addedGroups(model, decisions);
  const next = { ...decisions, mergeUp: { ...(decisions.mergeUp || {}) }, newText: { ...(decisions.newText || {}) }, newIndent: { ...(decisions.newIndent || {}) } };
  const r = ((model && model.rows) || []).find((x) => x.type === 'leftover' && x.ms === ms);
  if (!r) return decisions;
  const reading = r.reading.trim();
  if (on) {
    if (!canMergeUp(model, decisions, r)) return decisions;
    const rows = model.rows;
    const aboveMs = rows[rows.indexOf(r) - 1].ms;
    const own = before.find((g) => g.head === ms);
    const above = before.find((g) => g.ms.includes(aboveMs));
    next.mergeUp[ms] = true;
    // Typed text on either side is kept: the line above's text, then this line's (its text covers its own merged rows).
    if (above && own && (above.edited || own.edited)) next.newText[above.head] = `${above.text} ${own.text}`;
    delete next.newIndent[ms];
    delete next.newText[ms];
  } else {
    const g = before.find((x) => x.ms.includes(ms) && x.head !== ms);
    delete next.mergeUp[ms];
    if (g && (decisions.newText || {})[g.head]) {
      const t = String(decisions.newText[g.head]).trim();
      if (t.endsWith(` ${reading}`)) next.newText[g.head] = t.slice(0, -reading.length - 1);
    }
  }
  return next;
}

/** Type a new line's text, kept as typed (blank is written as MyScript's reading; null forgets it). */
export function setNewText(decisions, head, text) {
  const newText = { ...(decisions.newText || {}) };
  if (typeof text === 'string') newText[head] = text;
  else delete newText[head];
  return { ...decisions, newText };
}

/** Set a new line's indent (null = where it would be placed). */
export function setNewIndent(decisions, head, indent) {
  const newIndent = { ...(decisions.newIndent || {}) };
  if (Number.isInteger(indent) && indent >= 0) newIndent[head] = indent;
  else delete newIndent[head];
  return { ...decisions, newIndent };
}

/**
 * The `relink` spec the save takes (save-page.js `planTranscript(…, { relink })`):
 * the MyScript run plus what the review decided. Each link names every MyScript
 * line its stored line takes (`ms: [..]`: joined lines, and leftovers added to it).
 *
 * Held-back decorative ink (`run.heldBack`) goes with it: the save unlinks those
 * strokes, and flags them Not text while `decisions.heldBackTextless` (the default).
 *
 * @param {Object} run  `{ revision, rotation, originNcodeY, sent: string[], heldBack?: string[], lines: [{text, yBounds}] }`
 * @param {Object} model classifyRelink's result
 * @param {Object} decisions defaultDecisions' shape, as changed by the review
 */
export function buildRelinkSpec(run, model, decisions = defaultDecisions(model)) {
  const links = [], texts = {}, add = [], textless = [], sketch = [];
  // reviewRows: a line given leftover ink ("Add to #N") already takes it in msAll.
  for (const r of reviewRows(model, decisions)) {
    if (r.lineId && (ownLinked(r, decisions) || r.added)) {
      links.push({ lineId: r.lineId, ms: [...(r.msAll && r.msAll.length ? r.msAll : [r.ms])] });
      const taken = (decisions.fixes[r.lineId] || []).map((k) => r.fixes[k]).filter(Boolean);
      if (taken.length) {
        const text = applyWordFixes(r.text, taken);
        if (text.trim() && text !== r.text) texts[r.lineId] = text;
      }
    }
  }
  // New lines (v3.30.0): one entry per line, its MyScript lines, the text to write, an indent if set.
  for (const g of addedGroups(model, decisions)) add.push({ ms: [...g.ms], text: g.text, ...(g.indent != null ? { indent: g.indent } : {}) });
  for (const r of model.rows) {
    if (r.type !== 'leftover') continue;
    const choice = decisions.leftover[r.ms] || LEFTOVER_LEAVE;
    if (choice === LEFTOVER_ADD) continue;
    else if (choice === LEFTOVER_TEXTLESS) textless.push(r.ms);
    else if (choice === LEFTOVER_SKETCH) sketch.push(r.ms);
  }
  return {
    revision: run.revision ?? null,
    rotation: run.rotation || 0,
    originNcodeY: run.originNcodeY,
    sent: [...(run.sent || [])],
    heldBack: [...(run.heldBack || [])],
    heldBackTextless: decisions.heldBackTextless !== false,
    ...(run.selection ? { selection: true } : {}),
    myscriptLines: (run.lines || []).map((l) => ({ text: String(l.text || ''), yBounds: l.yBounds || null })),
    links, texts, add, textless, sketch
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
 * @param {{ again?: boolean, ids?: string[]|null }} [opts]  again: Relink a page already linked (the reader's
 *   "Relink again…", after Josh confirms); every other refusal still applies. ids: the Editor's "Relink
 *   selection…" sends only these strokes (a deliberate pass, so a linked page is not refused either)
 * @returns {string|null}
 */
export function relinkRefusal(s, doc, { again = false, ids = null } = {}) {
  if (s.draft) return `${s.label} has unsaved transcript edits in the Library; save or cancel them first`;
  if (s.editorOpen) return `${s.label} is open in a transcript editor; close it first`;
  if (s.reset) return `${s.label} is reset for re-transcription in the Editor; transcribe and save it (or undo the reset) first`;
  if (s.pendingTranscription) return `${s.label} has an unsaved transcription in the Editor; save or discard it first`;
  if (s.suffixOnCanvas) {
    return `${s.label} is a letter-suffixed page and its page number is loaded in the Editor, which can't tell the two apart; unload it from the Editor first`;
  }
  if (!doc) return `${s.label} was not found`;
  if (!textLines(doc.transcript && doc.transcript.lines).length) return `${s.label} has no transcript lines to relink`;
  if (!again && !ids && isTrustworthyTranscript(doc)) return `${s.label} is already linked to its ink; nothing to relink`;
  if (ids) {
    const want = new Set(ids);
    if (!(doc.strokes || []).some((st) => st && want.has(st.id))) return `The selected strokes are not saved on ${s.label}; save first`;
    if (!relinkSendStrokes(doc, ids).length) return 'None of the selected strokes can be sent (they are Not text, or a sketch\'s ink)';
  } else if (!relinkSendStrokes(doc).length) return `${s.label} has no ink to send`;
  return null;
}

/**
 * Does a cached MyScript run still belong to the page as it is on disk? An entry
 * without `heldBack` predates the decorative filter (it sent the underlines too),
 * so it is invalid and the page is sent again.
 */
export function cachedRunValid(entry, revision) {
  return !!entry && typeof entry === 'object' && !!revision && entry.revision === revision
    && Array.isArray(entry.lines) && Array.isArray(entry.sent) && Number.isFinite(entry.originNcodeY)
    && Array.isArray(entry.heldBack);
}

/** The run as cached: only what Relink needs back (no raw response). */
export function runForCache(run) {
  return {
    revision: run.revision,
    time: run.time || new Date().toISOString(),
    rotation: run.rotation || 0,
    originNcodeY: run.originNcodeY,
    sent: [...run.sent],
    heldBack: [...(run.heldBack || [])],
    heldBackStats: { underlines: 0, boxes: 0, circles: 0, ...(run.heldBackStats || {}) },
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
