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
  const strokes = ((doc && doc.strokes) || [])
    .filter((s) => s && Array.isArray(s.points) && s.points.length > 1)
    .map((s) => ({ t: Number(s.startTime) || 0, b: box(s) }))
    .filter((s) => s.b && s.b.h >= LETTER.minH && s.b.h <= LETTER.maxH && s.b.w <= LETTER.maxW)
    .sort((a, b) => a.t - b.t);

  // Strokes in writing order: each joins the row at its height whose ends it's near.
  const rows = [];
  for (const { t, b } of strokes) {
    const r = rows.find((r) => Math.abs(r.cy - b.cy) <= ROW_Y_TOL && b.x0 <= r.x1 + ROW_X_GAP && b.x1 >= r.x0 - ROW_X_GAP);
    if (r) {
      r.n++;
      r.x0 = Math.min(r.x0, b.x0);
      r.x1 = Math.max(r.x1, b.x1);
      r.cy += (b.cy - r.cy) / r.n;
      r.t = Math.min(r.t, t);
    } else {
      rows.push({ cy: b.cy, x0: b.x0, x1: b.x1, n: 1, t });
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
  const rows = [];
  const tally = { matched: 0, exact: 0, minor: 0, wording: 0, indent: 0, state: 0, missing: 0, extra: 0, words: 0, wordDiffs: 0 };
  for (const [a, b] of alignLines(stored, ref)) {
    const s = a === null ? null : stored[a];
    const r = b === null ? null : ref[b];
    if (s && r) {
      tally.matched++;
      const wd = editDistance(words(s.text), words(r.text));
      tally.words += words(r.text).length;
      tally.wordDiffs += wd;
      const kind = s.text === r.text ? 'exact' : wd === 0 ? 'minor' : 'wording';
      tally[kind]++;
      const indent = s.level !== r.level;
      const state = (s.state || null) !== (r.state || null);
      if (indent) tally.indent++;
      if (state) tally.state++;
      rows.push({ kind, indent, state, stored: s, ref: r });
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
  return { rows, tally, unlinked, storedLines: stored.length, refLines: ref.length, swollen: swollenLines(stored) };
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
  const out = [
    `Stored ${d.storedLines} line(s), reference ${d.refLines}; matched ${t.matched}: ${t.exact} exact, ${t.minor} case/punctuation only, `
    + `${t.wording} worded differently (${pct}% of reference words differ); indent differs on ${t.indent}, task state on ${t.state}; `
    + `${t.missing} stored line(s) not in the reference, ${t.extra} reference line(s) not stored. `
    + `${d.unlinked} stroke(s) linked to no line.`,
    ...(d.swollen || []).map((s) => `LINKS BROKEN? #${s.n} has ${s.strokes} strokes (median line ${s.median})`
      + (s.emptyAfter ? ` and ${s.emptyAfter} later line(s) have none` : '')
      + ': ink from other rows, usually a drawing in the MyScript batch, is linked to it. Fix by re-transcribing the page '
      + 'with the drawing deselected, not by editing text.'),
    'Differences (stored = what is on disk now, ref = the reference; #n = stored line number, (k) = strokes linked to it):'
  ];
  for (const r of d.rows) {
    if (r.kind === 'exact' && !r.indent && !r.state) continue;
    if (r.kind === 'stored-only') { out.push(`#${r.stored.n} (${r.stored.strokes}) STORED ONLY  ${show(r.stored)}`); continue; }
    if (r.kind === 'reference-only') { out.push(`   REFERENCE ONLY  ${show(r.ref)}`); continue; }
    const tags = [r.kind === 'wording' && 'wording', r.kind === 'minor' && 'case/punct', r.indent && 'indent', r.state && 'state'].filter(Boolean);
    out.push(`#${r.stored.n} (${r.stored.strokes}) ${tags.join(', ')}${r.stored.strokes ? '' : ', NO INK LINKED'}\n    stored: ${show(r.stored)}\n    ref:    ${show(r.ref)}`);
  }
  const noInk = d.rows.filter((r) => r.stored && r.stored.strokes === 0 && r.kind === 'exact' && !r.indent && !r.state);
  for (const r of noInk) out.push(`#${r.stored.n} (0) NO INK LINKED  ${show(r.stored)}`);
  if (out.length === 2) out.push('(none)');
  return out.join('\n');
}

/** The ink rows as text for the tool reply. */
export function formatRows(rows) {
  if (!rows.length) return 'No written rows found (no letter-sized ink).';
  const days = [...new Set(rows.map((r) => r.day).filter(Boolean))];
  const head = `${rows.length} written row(s), top to bottom. column = indent column from the left margin (one step ≈ ${COLUMN_MM} mm); `
    + 'wrap? = starts deeper under a row that reached the right edge: a wrapped sentence OR a sub-item, the text decides.'
    + (days.length > 1 ? ` Rows were written on ${days.length} days (${days.join(', ')}).` : '');
  const body = rows.map((r) => `y ${String(r.y).padStart(3)} mm  column ${r.column}  left ${r.left.toFixed(1).padStart(5)}  right ${String(r.right).padStart(3)}  `
    + `${String(r.letters).padStart(3)} strokes${days.length > 1 ? `  ${r.day}` : ''}${r.wrap ? '  wrap?' : ''}`);
  return [head, ...body].join('\n');
}
