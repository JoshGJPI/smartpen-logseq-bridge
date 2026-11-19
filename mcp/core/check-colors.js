/**
 * render_page's checking options: ink coloured by transcript line
 * (`color_by_line`) and the strokes Deselect Decorative would take
 * (`show_decorative`). Read-only; both only change stroke colours.
 *
 * resvg renders without fonts, so the image carries no labels: the colour of a
 * line's ink is named in the text key beside it. Colours cycle by line position
 * in the transcript, so neighbouring lines always differ.
 */
import { detectDecorativeIndices } from '../../src/lib/stroke-filter.js';
import { isTrustworthyTranscript } from '../../src/lib/viewer/ink-text.js';
import { taskStateOf, stateLabel } from '../../src/lib/tasks.js';

/** Eight line colours, distinct on white and from the red and the dark ink. */
export const LINE_PALETTE = Object.freeze([
  { name: 'blue', hex: '#1f6fd1' },
  { name: 'orange', hex: '#e07a00' },
  { name: 'green', hex: '#1e9e3a' },
  { name: 'purple', hex: '#8a3ec2' },
  { name: 'teal', hex: '#0a9a96' },
  { name: 'brown', hex: '#8b5a2b' },
  { name: 'pink', hex: '#e0408f' },
  { name: 'olive', hex: '#7d8a00' }
]);
export const DECORATIVE = Object.freeze({ name: 'red', hex: '#e01b1b' });

/** A stored stroke in the canvas shape the decorative detector reads. */
function toCanvasStroke(s, pageInfo) {
  return {
    pageInfo,
    startTime: s.startTime,
    endTime: s.endTime,
    dotArray: (s.points || []).map((p) => ({ x: p[0], y: p[1], timestamp: p[2] ?? null, f: p[3] ?? 0 }))
  };
}

/**
 * Stroke ids Deselect Decorative would take on this page, and how many of each kind.
 * Runs on every stroke of the page in raw Ncode, as the Editor does on a loaded page.
 * @returns {{ids: Set<string>, stats: {boxes: number, underlines: number, circles: number}}}
 */
export function decorativeStrokes(doc) {
  const strokes = (doc && doc.strokes) || [];
  const pageInfo = { ...(doc && doc.pageInfo) };
  const usable = strokes.filter((s) => s && Array.isArray(s.points) && s.points.length > 0);
  const { indices, stats } = detectDecorativeIndices(usable.map((s) => toCanvasStroke(s, pageInfo)));
  return { ids: new Set(indices.map((i) => usable[i].id)), stats };
}

const lineState = (l) => {
  const state = taskStateOf(l);
  return state ? `${stateLabel(state)} ` : '';
};

/**
 * Colouring plan for one page.
 * @param {object} doc  PageDoc
 * @param {{byLine: boolean, decorative: boolean}} opts
 * @returns {{colorOf: (s) => string|null, key: string[]}} colorOf null = default ink
 */
export function checkColoring(doc, { byLine, decorative }) {
  const strokes = (doc && doc.strokes) || [];
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  const key = [];
  let lineColor = null;

  if (byLine) {
    if (!lines.length) {
      key.push('color_by_line: page not transcribed, ink drawn plain.');
    } else if (!isTrustworthyTranscript(doc)) {
      key.push('color_by_line: this page\'s stroke-to-line links are unreliable (transcribed before the line-matching fix), ink drawn plain. Re-transcribing the page fixes it.');
    } else {
      lineColor = new Map();
      const counts = new Map();
      for (const s of strokes) if (s && s.lineId) counts.set(s.lineId, (counts.get(s.lineId) || 0) + 1);
      key.push('Ink coloured by transcript line (colours repeat every 8 lines; dark = linked to no line):');
      lines.forEach((l, i) => {
        const c = LINE_PALETTE[i % LINE_PALETTE.length];
        lineColor.set(l.id, c.hex);
        const n = counts.get(l.id) || 0;
        key.push(`${String(i + 1).padStart(3)}. ${c.name.padEnd(6)} ${n ? `(${n} strokes)` : '(NO INK LINKED)'} `
          + `${'  '.repeat(l.indentLevel || 0)}${lineState(l)}${l.text}`);
      });
      const unlinked = strokes.filter((s) => s && !(s.lineId && lineColor.has(s.lineId))).length;
      const textless = strokes.filter((s) => s && s.textless === true).length;
      key.push(`${unlinked} stroke(s) linked to no line (dark): untranscribed ink, decorative strokes left out, or ink MyScript did not place`
        + (textless ? `; ${textless} of them left out as Not text on purpose.` : '.'));
    }
  }

  let deco = null;
  if (decorative) {
    const found = decorativeStrokes(doc);
    deco = found.ids;
    const linked = strokes.filter((s) => s && s.lineId && deco.has(s.id)).length;
    const { boxes, underlines, circles } = found.stats;
    key.push(`show_decorative: ${deco.size} stroke(s) in red are what Deselect Decorative would take`
      + (deco.size
        ? ` (${boxes} box, ${underlines} underline, ${circles} circle; ${linked} already linked to a line).`
          + ' Check no task box (☐ / ☑) is red: a box left out loses its TODO / DONE.'
        : '.'));
  }

  const colorOf = (s) => {
    if (deco && deco.has(s.id)) return DECORATIVE.hex;
    if (lineColor && s.lineId && lineColor.has(s.lineId)) return lineColor.get(s.lineId);
    return null;
  };
  return { colorOf, key };
}
