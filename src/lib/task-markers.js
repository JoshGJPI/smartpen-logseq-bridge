/**
 * task-markers — read a task box at the start of a transcript line.
 *
 * MyScript returns a hand-drawn box as `☐` and a ticked one as `☑`, at the
 * start of the line's text. A transcript line already has a place for that
 * state (`checked`: null | false = TODO | true = DONE), which the reader and
 * the LogSeq copy both render, so the box belongs there rather than in the
 * text. Typed markers (`[ ]`, `[x]`, `TODO`, `DONE`) are read the same way, so
 * a line typed into the transcript by hand and a line read from ink agree.
 *
 *   ☐  [ ]  TODO        → checked: false
 *   ☑  ☒  [x]  [X]  DONE → checked: true
 *   anything else       → checked: null, text unchanged
 *
 * Deliberately not markers:
 *   - a bare tick (`✓`, `✔`) with no box: in the real data it marks a remark,
 *     not a task;
 *   - a glyph anywhere but the start of the line;
 *   - `Todo` / `todo` / `TODOs`: the keywords are whole words in capitals only,
 *     because "Todo list for Friday" is a heading, and the capitals are how a
 *     LogSeq marker is written (the only place a typed TODO comes from);
 *   - `WAITING`: there is no third state yet (it will be set by hand, not read
 *     from text), so a `WAITING …` line stays plain text;
 *   - a marker with nothing after it: an empty box on its own line has no task
 *     to hold, so the line is left as it is rather than emptied.
 *
 * Pure, no imports, so the transcription merge, the one-off conversion of old
 * pages and anything later (a task list) can share it.
 */

/** Leading markers, longest first. `[x]` matches either case. */
const GLYPH_MARKERS = [
  { re: /^\[ \]/, checked: false },
  { re: /^\[[xX]\]/, checked: true },
  { re: /^☐/, checked: false },
  { re: /^[☑☒]/, checked: true },
];

/** Keywords must be a whole word: followed by the end, a space or a colon. */
const KEYWORD_MARKERS = [
  { re: /^TODO(?=$|[\s:])/, checked: false },
  { re: /^DONE(?=$|[\s:])/, checked: true },
];

/**
 * What follows a marker: an optional colon (`TODO: …`), then whitespace and a
 * stray list dash (`☐ - preferred bott. flange…`, the dash written as a bullet
 * after the box).
 */
const AFTER_MARKER = /^:?\s*(?:[-–—]\s+)?/;

/**
 * @param {string|null|undefined} text  a transcript line's text
 * @returns {{ checked: boolean|null, text: string }}
 *   `checked` is null when the line carries no marker; `text` is then the input
 *   unchanged (`''` for null/undefined). With a marker, `text` is the rest of the
 *   line with the marker and the space after it removed.
 */
export function parseTaskMarker(text) {
  const raw = typeof text === 'string' ? text : '';
  const s = raw.trimStart();
  for (const m of [...GLYPH_MARKERS, ...KEYWORD_MARKERS]) {
    const hit = m.re.exec(s);
    if (!hit) continue;
    const rest = s.slice(hit[0].length).replace(AFTER_MARKER, '').trim();
    if (!rest) break;
    return { checked: m.checked, text: rest };
  }
  return { checked: null, text: raw };
}

/**
 * The line's text without a leading task marker: what two readings of the same
 * line are compared on (the duplicate check, the conversion).
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function stripTaskMarker(text) {
  return parseTaskMarker(text).text.trim();
}
