/**
 * lib/viewer/ink-text.js (reading-first package D): when a page's transcript
 * lines may be linked to its ink, and which ink.
 *
 * What matters: a page matched by the pre-Aug-2026 code is never trusted, even
 * after a Book View edit gave it a fresh lastTranscribed, because its lineIds
 * point at the wrong strokes; a page matched by the fixed code is.
 */
import { describe, it, expect } from 'vitest';
import { isTrustworthyTranscript, strokesByLine, TRUST_SINCE } from '$lib/viewer/ink-text.js';
import { yBoundsToNcode, MYSCRIPT_INK_ORIGIN_MM, NCODE_TO_MM } from '$lib/myscript-api.js';

/** A stroke spanning Ncode y0..y1, linked to a line. */
const s = (id, y0, y1, lineId) => ({ id, lineId, points: [[10, y0], [20, y1]] });
/** MyScript-mm yBounds for a line whose ink spans Ncode y0..y1 in a batch starting at `origin`. */
const mm = (y0, y1, origin) => ({
  minY: (y0 - origin) * NCODE_TO_MM + MYSCRIPT_INK_ORIGIN_MM,
  maxY: (y1 - origin) * NCODE_TO_MM + MYSCRIPT_INK_ORIGIN_MM
});

/** Fixed-code page: lines 4 Ncode tall from y=20, origin 20. Links match the converted bands. */
function fixedPage(lastTranscribed = '2026-09-15T10:00:00Z') {
  const origin = 20;
  const lines = [], strokes = [];
  for (let i = 0; i < 6; i++) {
    const y0 = 20 + i * 6, y1 = y0 + 4;
    lines.push({ id: `L${i}`, text: `line ${i}`, yBounds: mm(y0, y1, origin) });
    strokes.push(s(`a${i}`, y0, y1, `L${i}`), s(`b${i}`, y0 + 1, y1 - 1, `L${i}`));
  }
  return { transcript: { lastTranscribed, lines }, strokes };
}

/** Pre-fix page: each stroke was linked to the line whose RAW mm yBounds overlapped its Ncode Y ± 5. */
function preFixPage(lastTranscribed = '2026-06-03T10:00:00Z') {
  const lines = [], strokes = [];
  for (let i = 0; i < 6; i++) {
    const yb = { minY: 10 + i * 7, maxY: 15 + i * 7 };
    lines.push({ id: `L${i}`, text: `line ${i}`, yBounds: yb });
    strokes.push(s(`a${i}`, yb.minY + 1, yb.maxY - 1, `L${i}`), s(`b${i}`, yb.minY - 4, yb.minY - 2, `L${i}`));
  }
  return { transcript: { lastTranscribed, lines }, strokes };
}

describe('isTrustworthyTranscript', () => {
  it('fixture sanity: fixed-page links sit inside the converted line bands', () => {
    const doc = fixedPage();
    const band = yBoundsToNcode(doc.transcript.lines[2].yBounds, 20);
    expect(band.minY).toBeCloseTo(32, 5);
    expect(band.maxY).toBeCloseTo(36, 5);
  });

  it('trusts a page matched by the fixed code', () => {
    expect(isTrustworthyTranscript(fixedPage())).toBe(true);
  });

  it('never trusts a page carrying the pre-fix signature', () => {
    expect(isTrustworthyTranscript(preFixPage())).toBe(false);
  });

  it('a pre-fix page edited later (fresh lastTranscribed) is still not trusted', () => {
    expect(isTrustworthyTranscript(preFixPage('2026-10-10T09:00:00Z'))).toBe(false);
  });

  it('a page last transcribed before Aug 2026 is not trusted, whatever its links', () => {
    expect(isTrustworthyTranscript(fixedPage('2026-07-31T23:59:00Z'))).toBe(false);
    expect(isTrustworthyTranscript(fixedPage(`${TRUST_SINCE}T00:00:00Z`))).toBe(true);
  });

  it('no links, no lines, no doc, no date: not trusted', () => {
    const d = fixedPage();
    expect(isTrustworthyTranscript({ ...d, strokes: d.strokes.map((x) => ({ ...x, lineId: null })) })).toBe(false);
    expect(isTrustworthyTranscript({ ...d, transcript: { ...d.transcript, lines: [] } })).toBe(false);
    expect(isTrustworthyTranscript({ ...d, transcript: { ...d.transcript, lastTranscribed: null } })).toBe(false);
    expect(isTrustworthyTranscript(null)).toBe(false);
    expect(isTrustworthyTranscript({})).toBe(false);
  });

  it('ignores links to lines with no usable yBounds (0-0 marker, missing)', () => {
    const d = fixedPage();
    d.transcript.lines[0].yBounds = { minY: 0, maxY: 0 };
    d.transcript.lines[1].yBounds = null;
    expect(isTrustworthyTranscript(d)).toBe(true);
  });

  it('ignores strokes with no points and dangling links', () => {
    const d = fixedPage();
    d.strokes.push({ id: 'x', lineId: 'L0', points: [] }, { id: 'y', lineId: 'gone', points: [[1, 1]] });
    expect(isTrustworthyTranscript(d)).toBe(true);
  });
});

describe('strokesByLine', () => {
  it('groups strokes by their stored lineId', () => {
    const m = strokesByLine(fixedPage().strokes, fixedPage().transcript.lines);
    expect(m.size).toBe(6);
    expect(m.get('L3').map((x) => x.id)).toEqual(['a3', 'b3']);
  });

  it('ignores unlinked strokes and links to deleted lines', () => {
    const m = strokesByLine([s('a', 1, 2, null), s('b', 1, 2, 'gone'), s('c', 1, 2, 'L0')], [{ id: 'L0' }]);
    expect([...m.keys()]).toEqual(['L0']);
    expect(m.get('L0').map((x) => x.id)).toEqual(['c']);
  });

  it('empty for nothing', () => {
    expect(strokesByLine(null, null).size).toBe(0);
    expect(strokesByLine([], [{ id: 'L0' }]).size).toBe(0);
  });
});
