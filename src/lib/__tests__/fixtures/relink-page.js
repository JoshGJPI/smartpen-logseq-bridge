/**
 * A page built like 3017/123 for the Relink tests (v3.21.0, spec B.7): 28
 * lines, 5 tasks (one CANCELLED, one WAITING), transcribed before the Aug 2026
 * line matching, so `isTrustworthyTranscript()` rejects it; and a MyScript run
 * of the same page as Relink would get it back. Synthetic text, no real notes.
 *
 * Line i is written at Ncode y 10 + 4i (2 units tall, three strokes; rows 2 apart, beyond the match tolerance). The
 * stored links are the old, wrong kind: every stroke points at the line before.
 */
import { NCODE_TO_MM, MYSCRIPT_INK_ORIGIN_MM } from '../../myscript-api.js';

export const ORIGIN = 10;
export const rowY = (i) => ORIGIN + 4 * i;
/** Ncode y → the millimetres MyScript reports for a batch anchored at ORIGIN. */
export const mm = (y, origin = ORIGIN) => (y - origin) * NCODE_TO_MM + MYSCRIPT_INK_ORIGIN_MM;

const TEXTS = [
  '5444-006 Stair framing review', 'met w/ structural team', 'beam sizes on grid C', 'check deflection at landing',
  'stringer connection detail', 'boing plate at top', 'confirm anchor spacing', 'coordinate with architect',
  'send markups Friday', 'P2026-141 Retaining wall', 'soil report pending', 'wall height 9 ft max',
  'drainage behind wall', 'order rebar schedule', 'call Tom re: footing', 'Lunch notes', 'parking lot layout',
  'curb ramp slopes', 'ADA path check', 'site visit Tuesday', 'bring tape and camera', 'photos of cracks',
  'Crack widths up to 1/8 in', 'monitor for movement', 'Budget review', 'hours to date 42', 'remaining fee ok',
  'invoice next week'
];

const INDENT = [0, 1, 2, 2, 2, 2, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 2, 2, 0, 1, 1, 1];

/** id, state: lines 3 (DONE), 8 (TODO), 13 (CANCELLED), 14 (WAITING), 20 (TODO). */
const TASKS = { 3: { checked: true }, 8: { checked: false }, 13: { checked: true, marker: 'CANCELLED' },
  14: { checked: false, marker: 'WAITING' }, 20: { checked: false } };

export function makeOldPage() {
  const lines = [];
  const stack = [];
  TEXTS.forEach((text, i) => {
    const level = INDENT[i];
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const id = `L${String(i).padStart(2, '0')}`;
    lines.push({
      id, text, indentLevel: level, parentId: stack.length ? stack[stack.length - 1].id : null,
      checked: TASKS[i] ? TASKS[i].checked : null, ...(TASKS[i] && TASKS[i].marker ? { marker: TASKS[i].marker } : {}),
      // Pre-fix yBounds: raw millimetres of an unknown batch.
      yBounds: { minY: 3 + 7 * i, maxY: 8 + 7 * i }
    });
    stack.push({ level, id });
  });
  const strokes = [];
  let t = 1765313500000;
  TEXTS.forEach((_, i) => {
    for (let k = 0; k < 3; k++) {
      t += 1000;
      const y = rowY(i);
      strokes.push({
        id: `s${t}`, startTime: t, endTime: t + 400,
        lineId: i > 0 ? lines[i - 1].id : lines[0].id,
        points: [[20 + 10 * k, y, t, 400], [25 + 10 * k, y + 2, t + 10, 400]]
      });
    }
  });
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 123 },
    metadata: { lastUpdated: '2026-07-02T15:00:00.000Z', totalStrokes: strokes.length, bounds: { minX: 20, maxX: 45, minY: 10, maxY: rowY(27) + 2 } },
    transcript: { lastTranscribed: '2026-06-30T12:00:00.000Z', lines },
    strokes
  };
}

/**
 * MyScript's reading of the page: same lines in order, DONE lines read with a
 * box, and "boing" read as "boring" (a word fix). `overrides[i]` replaces line
 * i's text; `extra` adds lines (y in Ncode).
 */
export function makeRun(doc, { overrides = {}, extra = [], drop = [] } = {}) {
  const lines = [];
  TEXTS.forEach((text, i) => {
    if (drop.includes(i)) return;
    let t = overrides[i] ?? text;
    if (i === 3) t = `☑ ${t}`;
    if (i === 5 && overrides[i] === undefined) t = 'boring plate at top';
    lines.push({ text: t, yBounds: { minY: mm(rowY(i)), maxY: mm(rowY(i) + 2) } });
  });
  for (const e of extra) lines.push({ text: e.text, yBounds: { minY: mm(e.y), maxY: mm(e.y + 2) } });
  lines.sort((a, b) => a.yBounds.minY - b.yBounds.minY);
  return {
    revision: doc.metadata.lastUpdated,
    rotation: 0,
    originNcodeY: ORIGIN,
    sent: doc.strokes.filter((s) => s.textless !== true).map((s) => s.id),
    lines
  };
}

/**
 * A page with lines Josh merged by hand (like #8, "We'll need to provide a
 * coating … being submerged full time"): stored line 5 holds rows 5 and 6, line
 * 17 holds rows 17, 18 and 19; the merged-away lines are gone. The ink stays as
 * written, so MyScript (makeRun) reads those rows as separate lines.
 */
export function makeMergedPage() {
  const doc = makeOldPage();
  const L = doc.transcript.lines;
  const text = (i) => TEXTS[i];
  L[5] = { ...L[5], text: `${text(5)} ${text(6)}` };
  L[17] = { ...L[17], text: `${text(17)} ${text(18)} ${text(19)}` };
  const gone = new Set(['L06', 'L18', 'L19']);
  doc.transcript.lines = L.filter((l) => !gone.has(l.id)).map((l) => (gone.has(l.parentId) ? { ...l, parentId: 'L17' } : l));
  return doc;
}

/**
 * A page built like 3017/180: a meeting block (lines 10–12 of makeOldPage, a
 * header and its two children) written mid-page but transcribed later, so
 * stored at the END of the transcript. Its ink stays where it was written, so
 * MyScript (makeRun) reads the meeting back in the middle of the page.
 */
export function makeMovedPage() {
  const doc = makeOldPage();
  const lines = doc.transcript.lines;
  const block = lines.splice(10, 3);
  block[0] = { ...block[0], indentLevel: 0, parentId: null };
  block[1] = { ...block[1], indentLevel: 1, parentId: block[0].id };
  block[2] = { ...block[2], indentLevel: 1, parentId: block[0].id };
  lines.push(...block);
  return doc;
}
