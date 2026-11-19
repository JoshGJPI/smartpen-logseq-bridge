/**
 * line-align — align two lists of transcript lines in order, with gaps
 * (v3.21.0; moved here from mcp/core/transcript-check.js so the app's Relink
 * and the MCP's check_transcript share one implementation).
 *
 * Dynamic programming over a normalized edit distance per line: each pair
 * scores its similarity (0..1), a line left unmatched costs GAP, and two lines
 * less alike than MATCH_MIN are treated as different lines rather than a
 * misreading. Text is compared with a leading task marker stripped
 * (`parseTaskMarker`), so MyScript's `☑ order steel` matches a DONE line whose
 * text is `order steel`, and case, punctuation and spacing are ignored.
 *
 * Pure. Tested in `src/lib/__tests__/line-align.test.js` (and through the MCP's
 * transcript-check tests).
 */
import { stripTaskMarker } from './task-markers.js';

/** Lowercase letters, digits and a few signs, everything else one space. */
export const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9$%&?#@']+/g, ' ').trim();

/** The words of a text, normalized. */
export const words = (t) => norm(t).split(' ').filter(Boolean);

/** Same letters and digits in the same order: case, punctuation and spacing aside (`IBC 2024` / `IBC2024`). */
export const sameLetters = (a, b) => norm(a).replace(/ /g, '') === norm(b).replace(/ /g, '');

/** Levenshtein distance over two strings or two arrays. */
export function editDistance(a, b) {
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

/** The text a line is compared by: its leading task marker (☐, ☑, [ ], [x], TODO, DONE) stripped. */
export const alignText = (t) => stripTaskMarker(String(t || ''));

/** 1 for the same text (marker, case and punctuation aside), down to 0. */
export function similarity(a, b) {
  const x = norm(alignText(a)), y = norm(alignText(b));
  return 1 - editDistance(x, y) / Math.max(1, x.length, y.length);
}

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
