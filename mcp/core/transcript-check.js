/**
 * check_transcript: help check a page's transcript against its ink.
 *
 * Two halves, both read-only:
 *   - inkRows(): the written rows of a page, measured from stroke geometry, with
 *     each row's left margin turned into an indent column. Carries no transcript
 *     text, so it can be read before the transcript without biasing a blind
 *     reading of the page.
 *   - diffTranscript(): the stored transcript aligned line by line with a
 *     reference transcript (Claude's own reading), reporting wording and indent
 *     differences, missing and extra lines, and each stored line's stroke count.
 *
 * Rows come from letter-sized strokes (boxes, long underlines and sketches don't
 * set a margin). A row that starts deeper right under a row that reached the
 * right edge may be a wrapped sentence rather than a sub-item: geometry can't
 * tell the two apart, so it is only flagged ("wrap?") and the text decides.
 */
import { dayKey } from '../../src/lib/timeline.js';
import { taskStateOf, stateLabel } from '../../src/lib/tasks.js';

/** 1 Ncode unit in mm (the pen SDK's figure, as in myscript-api.js and stroke-filter.js; not imported so the MCP stays clear of the MyScript client). */
const NCODE_TO_MM = 2.371;
/** One indent step on the page, mm. Measured on JPI Dotted pages (columns ~14.5, 20, 24.5, 29.3, 33.8, 38.4 mm). */
export const COLUMN_MM = 4.6;
const LETTER = { minH: 0.8, maxH: 9, maxW: 25 };   // mm
const ROW_Y_TOL = 2.2;                              // mm between a stroke's centre and its row's
const ROW_X_GAP = 25;                               // mm a stroke may sit beyond a row's ends and still join it
const MIN_ROW_LETTERS = 3;
const WRAP_RIGHT_MM = 25;                           // "reached the right edge" = within this of the page's rightmost row

function box(s) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of s.points || []) {
    if (!p) continue;
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  if (!(x0 <= x1)) return null;
  return {
    x0: x0 * NCODE_TO_MM, x1: x1 * NCODE_TO_MM, cy: ((y0 + y1) / 2) * NCODE_TO_MM,
    h: (y1 - y0) * NCODE_TO_MM, w: (x1 - x0) * NCODE_TO_MM
  };
}

/**
 * The written rows of a page, top to bottom.
 * @param {object} doc PageDoc
 * @returns {Array<{y:number,left:number,right:number,column:number,letters:number,day:string|null,wrap:boolean}>}
 */
export function inkRows(doc) {
  const lineIds = new Set(((doc && doc.transcript && doc.transcript.lines) || []).map((l) => l.id));
  const strokes = ((doc && doc.strokes) || [])
    .filter((s) => s && Array.isArray(s.points) && s.points.length > 1)
    .map((s) => ({ t: Number(s.startTime) || 0, b: box(s), linked: !!(s.lineId && lineIds.has(s.lineId)) }))
    .filter((s) => s.b && s.b.h >= LETTER.minH && s.b.h <= LETTER.maxH && s.b.w <= LETTER.maxW)
    .sort((a, b) => a.t - b.t);

  // Strokes in writing order: each joins the row at its height whose ends it's near.
  const rows = [];
  for (const { t, b, linked } of strokes) {
    const r = rows.find((r) => Math.abs(r.cy - b.cy) <= ROW_Y_TOL && b.x0 <= r.x1 + ROW_X_GAP && b.x1 >= r.x0 - ROW_X_GAP);
    if (r) {
      r.n++;
      if (linked) r.linked++;
      r.x0 = Math.min(r.x0, b.x0);
      r.x1 = Math.max(r.x1, b.x1);
      r.cy += (b.cy - r.cy) / r.n;
      r.t = Math.min(r.t, t);
    } else {
      rows.push({ cy: b.cy, x0: b.x0, x1: b.x1, n: 1, linked: linked ? 1 : 0, t });
    }
  }
  const kept = rows.filter((r) => r.n >= MIN_ROW_LETTERS).sort((a, b) => a.cy - b.cy);
  if (!kept.length) return [];
  const base = Math.min(...kept.map((r) => r.x0));
  const right = Math.max(...kept.map((r) => r.x1));
  return kept.map((r, i) => {
    const prev = kept[i - 1];
    return {
      y: Math.round(r.cy),
      left: Math.round(r.x0 * 10) / 10,
      right: Math.round(r.x1),
      column: Math.max(0, Math.round((r.x0 - base) / COLUMN_MM)),
      letters: r.n,
      linked: r.linked,
      day: r.t ? dayKey(r.t) : null,
      wrap: !!prev && r.x0 > prev.x0 + 2 && prev.x1 > right - WRAP_RIGHT_MM && r.cy - prev.cy < 9
    };
  });
}

const MARKER = /^(TODO|DONE|WAITING|CANCELLED)\s+/;

/**
 * A reference transcript as markdown bullets: "- text", nested by tabs (one per
 * level) or by spaces (the smallest indent used is one level). A leading TODO /
 * DONE / WAITING / CANCELLED is the line's state. Lines without a bullet are
 * skipped (headings, notes).
 * @returns {Array<{level:number, text:string, state:string|null}>}
 */
export function parseReference(md) {
  const rows = String(md || '').replace(/\r/g, '').split('\n')
    .map((raw) => raw.match(/^([ \t]*)[-*]\s+(.*)$/))
    .filter(Boolean)
    .map(([, ws, body]) => ({ ws, body: body.trim() }))
    .filter((r) => r.body);
  const spaceUnit = Math.min(...rows.map((r) => r.ws.replace(/\t/g, '').length).filter((n) => n > 0), Infinity);
  return rows.map(({ ws, body }) => {
    const tabs = (ws.match(/\t/g) || []).length;
    const spaces = ws.replace(/\t/g, '').length;
    const level = tabs + (spaces && Number.isFinite(spaceUnit) ? Math.round(spaces / spaceUnit) : 0);
    const m = body.match(MARKER);
    return { level, text: m ? body.slice(m[0].length) : body, state: m ? m[1] : null };
  });
}

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9$%&?#@']+/g, ' ').trim();
const words = (t) => norm(t).split(' ').filter(Boolean);
/** Same letters and digits in the same order: case, punctuation and spacing aside (`IBC 2024` / `IBC2024`). */
const sameLetters = (a, b) => norm(a).replace(/ /g, '') === norm(b).replace(/ /g, '');

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const similarity = (a, b) => {
  const x = norm(a), y = norm(b);
  return 1 - editDistance(x, y) / Math.max(1, x.length, y.length);
};

const GAP = -0.2;          // cost of leaving a line unmatched
const MATCH_MIN = 0.4;     // below this two lines are different lines, not a misreading

/**
 * Align stored lines with reference lines (order kept; either side may have
 * lines the other lacks).
 * @param {Array<{text:string}>} stored
 * @param {Array<{text:string}>} ref
 * @returns {Array<[number|null, number|null]>} index pairs
 */
export function alignLines(stored, ref) {
  const n = stored.length, m = ref.length;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));   // 1 = both, 2 = stored only, 3 = ref only
  for (let i = 1; i <= n; i++) { score[i][0] = i * GAP; move[i][0] = 2; }
  for (let j = 1; j <= m; j++) { score[0][j] = j * GAP; move[0][j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similarity(stored[i - 1].text, ref[j - 1].text);
      let best = score[i - 1][j - 1] + (s >= MATCH_MIN ? s : -1), mv = 1;
      if (score[i - 1][j] + GAP > best) { best = score[i - 1][j] + GAP; mv = 2; }
      if (score[i][j - 1] + GAP > best) { best = score[i][j - 1] + GAP; mv = 3; }
      score[i][j] = best;
      move[i][j] = mv;
    }
  }
  const pairs = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const mv = move[i][j];
    if (mv === 1) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (mv === 2) { pairs.push([i - 1, null]); i--; }
    else { pairs.push([null, j - 1]); j--; }
  }
  return pairs.reverse();
}

const stateOf = (l) => {
  const s = taskStateOf(l);
  return s ? stateLabel(s) : null;
};

/**
 * Compare a page's stored transcript with a reference.
 * @param {object} doc PageDoc
 * @param {string} referenceMd markdown bullets (parseReference)
 */
export function diffTranscript(doc, referenceMd) {
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  const counts = new Map();
  let unlinked = 0;
  const ids = new Set(lines.map((l) => l.id));
  for (const s of (doc && doc.strokes) || []) {
    if (s && s.lineId && ids.has(s.lineId)) counts.set(s.lineId, (counts.get(s.lineId) || 0) + 1);
    else unlinked++;
  }
  const stored = lines.map((l, i) => ({
    n: i + 1, level: l.indentLevel || 0, text: l.text || '', state: stateOf(l), strokes: counts.get(l.id) || 0
  }));
  const ref = parseReference(referenceMd);
  const pairs = movedPairs(alignLines(stored, ref), stored, ref);
  const rows = [];
  const tally = { matched: 0, exact: 0, minor: 0, wording: 0, indent: 0, state: 0, moved: 0, missing: 0, extra: 0, words: 0, wordDiffs: 0 };
  for (const [a, b, moved] of pairs) {
    const s = a === null ? null : stored[a];
    const r = b === null ? null : ref[b];
    if (s && r) {
      tally.matched++;
      const same = sameLetters(s.text, r.text);
      const wd = same ? 0 : editDistance(words(s.text), words(r.text));
      tally.words += words(r.text).length;
      tally.wordDiffs += wd;
      const kind = s.text === r.text ? 'exact' : wd === 0 ? 'minor' : 'wording';
      tally[kind]++;
      const indent = s.level !== r.level;
      const state = (s.state || null) !== (r.state || null);
      if (indent) tally.indent++;
      if (state) tally.state++;
      const row = { kind, indent, state, stored: s, ref: r };
      if (moved) {
        tally.moved++;
        row.moved = { after: b > 0 ? ref[b - 1].text : null };
      }
      rows.push(row);
    } else if (s) {
      tally.missing++;
      rows.push({ kind: 'stored-only', stored: s });
    } else {
      tally.extra++;
      tally.words += words(r.text).length;
      tally.wordDiffs += words(r.text).length;
      rows.push({ kind: 'reference-only', ref: r });
    }
  }
  return {
    rows, tally, unlinked, totalStrokes: ((doc && doc.strokes) || []).length,
    storedLines: stored.length, refLines: ref.length, swollen: swollenLines(stored)
  };
}

/** A stored-only and a reference-only line this alike are one line in another place, not two missing lines. */
const MOVED_MIN = 0.75;

/**
 * Pair the lines the in-order alignment left on both sides that are the same line out of order (3017/180: a
 * meeting written at the top of the page but transcribed later, so stored at the end). Best matches first; each
 * pair takes the stored line's place in the result and is marked moved. Unpaired lines stay as they were.
 * @param {Array<[number|null, number|null]>} pairs alignLines' result
 * @returns {Array<[number|null, number|null, boolean?]>}
 */
export function movedPairs(pairs, stored, ref) {
  const sOnly = pairs.filter(([a, b]) => b === null).map(([a]) => a);
  const rOnly = pairs.filter(([a]) => a === null).map(([, b]) => b);
  const cands = [];
  for (const a of sOnly) {
    for (const b of rOnly) {
      const s = similarity(stored[a].text, ref[b].text);
      if (s >= MOVED_MIN) cands.push({ a, b, s });
    }
  }
  cands.sort((x, y) => y.s - x.s || Math.abs(x.a - x.b) - Math.abs(y.a - y.b));
  const refFor = new Map();
  const taken = new Set();
  for (const c of cands) {
    if (refFor.has(c.a) || taken.has(c.b)) continue;
    refFor.set(c.a, c.b);
    taken.add(c.b);
  }
  if (!refFor.size) return pairs;
  const out = [];
  for (const [a, b] of pairs) {
    if (a === null && taken.has(b)) continue;
    if (b === null && refFor.has(a)) out.push([a, refFor.get(a), true]);
    else out.push([a, b]);
  }
  return out;
}

/** Below this share of the page's strokes linked to a line, a transcribed page is called partly transcribed. */
export const PARTLY_TRANSCRIBED_BELOW = 0.75;

/** Strokes linked to an existing transcript line. */
export function linkedStrokeCount(doc) {
  const ids = new Set(((doc && doc.transcript && doc.transcript.lines) || []).map((l) => l.id));
  let n = 0;
  for (const s of (doc && doc.strokes) || []) if (s && s.lineId && ids.has(s.lineId)) n++;
  return n;
}

/**
 * A warning when much of a transcribed page's ink is in no line (3017/186: 6 lines saved, 1,019 of 1,209 strokes
 * never sent to MyScript), else ''. Boxes, underlines and sketches are left out on purpose, so a few unlinked
 * strokes are normal. Only for pages whose links can be trusted (pass `trusted`).
 */
export function partlyTranscribedNote(linked, total, trusted = true) {
  if (!trusted || !total) return '';
  const share = linked / total;
  if (share >= PARTLY_TRANSCRIBED_BELOW) return '';
  return `PARTLY TRANSCRIBED? ${total - linked} of ${total} strokes (${Math.round(100 * (1 - share))}%) are linked to no line: `
    + 'most likely ink that was never sent to MyScript (written on another day, or not selected). Transcribe it in the app '
    + '(load the page by page, not by date) before checking the text.';
}

/** A line holding this many times the median line's strokes (and at least SWOLLEN_MIN) has ink from other rows. */
const SWOLLEN_FACTOR = 4;
const SWOLLEN_MIN = 150;

/**
 * Lines that took far more strokes than a line of writing holds. On 3017/182 a drawing in the MyScript batch
 * stretched one line's box over the drawing and shifted every line after it: that line got 479 strokes and the
 * five below it none. Text edits can't fix it; re-transcribing with the drawing deselected can.
 * @returns {Array<{n:number, strokes:number, median:number, emptyAfter:number}>}
 */
export function swollenLines(stored) {
  const counts = stored.map((l) => l.strokes).filter((n) => n > 0).sort((a, b) => a - b);
  if (counts.length < 3) return [];
  const median = counts[Math.floor(counts.length / 2)];
  const limit = Math.max(SWOLLEN_MIN, SWOLLEN_FACTOR * median);
  return stored
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.strokes > limit)
    .map(({ l, i }) => ({ n: l.n, strokes: l.strokes, median, emptyAfter: stored.slice(i + 1).filter((x) => x.strokes === 0).length }));
}

const show = (l) => `L${l.level} ${l.state ? `${l.state} ` : ''}${l.text}`;

/** The diff as text for the tool reply. */
export function formatDiff(d) {
  const t = d.tally;
  const pct = t.words ? ((100 * t.wordDiffs) / t.words).toFixed(1) : '0.0';
  const moved = t.moved || 0;
  const out = [
    `Stored ${d.storedLines} line(s), reference ${d.refLines}; matched ${t.matched}: ${t.exact} exact, ${t.minor} case/punctuation/spacing only, `
    + `${t.wording} worded differently (${pct}% of reference words differ); indent differs on ${t.indent}, task state on ${t.state}`
    + (moved ? `, out of order ${moved}` : '') + '; '
    + `${t.missing} stored line(s) not in the reference, ${t.extra} reference line(s) not stored. `
    + `${d.unlinked} stroke(s) linked to no line.`,
    ...(moved ? [`OUT OF ORDER: ${moved} stored line(s) sit somewhere else than on the page (marked MOVED below, with the line they follow `
      + 'in the reference). Usually ink transcribed later and appended at the end; reorder them in the app (tick them, then Move).'] : []),
    ...(d.swollen || []).map((s) => `LINKS BROKEN? #${s.n} has ${s.strokes} strokes (median line ${s.median})`
      + (s.emptyAfter ? ` and ${s.emptyAfter} later line(s) have none` : '')
      + ': ink from other rows, usually a drawing in the MyScript batch, is linked to it. Fix by re-transcribing the page '
      + 'with the drawing deselected, not by editing text.'),
    ...(d.partly ? [d.partly] : [])
  ];
  const head = out.length;
  out.push('Differences (stored = what is on disk now, ref = the reference; #n = stored line number, (k) = strokes linked to it):');
  for (const r of d.rows) {
    if (r.kind === 'exact' && !r.indent && !r.state && !r.moved) continue;
    if (r.kind === 'stored-only') { out.push(`#${r.stored.n} (${r.stored.strokes}) STORED ONLY  ${show(r.stored)}`); continue; }
    if (r.kind === 'reference-only') { out.push(`   REFERENCE ONLY  ${show(r.ref)}`); continue; }
    const tags = [
      r.moved && `MOVED (on the page it follows ${r.moved.after === null ? 'nothing: it is first' : `"${r.moved.after}"`})`,
      r.kind === 'wording' && 'wording', r.kind === 'minor' && 'case/punct/spacing', r.indent && 'indent', r.state && 'state'
    ].filter(Boolean);
    const both = r.kind === 'exact' && !r.indent && !r.state ? '' : `\n    stored: ${show(r.stored)}\n    ref:    ${show(r.ref)}`;
    out.push(`#${r.stored.n} (${r.stored.strokes}) ${tags.join(', ')}${r.stored.strokes ? '' : ', NO INK LINKED'}${both || `  ${show(r.stored)}`}`);
  }
  const noInk = d.rows.filter((r) => r.stored && r.stored.strokes === 0 && r.kind === 'exact' && !r.indent && !r.state && !r.moved);
  for (const r of noInk) out.push(`#${r.stored.n} (0) NO INK LINKED  ${show(r.stored)}`);
  if (out.length === head + 1) out.push('(none)');
  return out.join('\n');
}

/**
 * The ink rows as text for the tool reply.
 * @param {object} [opts] `links: true` marks rows with no stroke in any transcript line ("not transcribed"); pass it
 *   only for a transcribed page whose links can be trusted.
 */
export function formatRows(rows, { links = false } = {}) {
  if (!rows.length) return 'No written rows found (no letter-sized ink).';
  const days = [...new Set(rows.map((r) => r.day).filter(Boolean))];
  const bare = links ? rows.filter((r) => !r.linked).length : 0;
  const head = `${rows.length} written row(s), top to bottom. column = indent column from the left margin (one step ≈ ${COLUMN_MM} mm); `
    + 'wrap? = starts deeper under a row that reached the right edge: a wrapped sentence OR a sub-item, the text decides.'
    + (days.length > 1 ? ` Rows were written on ${days.length} days (${days.join(', ')}).` : '')
    + (bare ? ` not transcribed = no stroke of the row is in any transcript line (${bare} of ${rows.length} rows).` : '');
  const body = rows.map((r) => `y ${String(r.y).padStart(3)} mm  column ${r.column}  left ${r.left.toFixed(1).padStart(5)}  right ${String(r.right).padStart(3)}  `
    + `${String(r.letters).padStart(3)} strokes${days.length > 1 ? `  ${r.day}` : ''}${r.wrap ? '  wrap?' : ''}`
    + (links && !r.linked ? '  not transcribed' : ''));
  return [head, ...body].join('\n');
}
