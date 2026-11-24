/**
 * electron/ink-trust.cjs: main's mirror of lib/viewer/ink-text.js
 * isTrustworthyTranscript(), for the capture-date index's `linked` (the
 * Library left panel's "to relink" count).
 *
 * What matters: both give the same answer on the same doc, and pageLinked()
 * reads the hybrid serializer's layout (shell first) and a plain one alike,
 * null for a page without transcript lines.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';

const require = createRequire(import.meta.url);
const main = require('../../../electron/ink-trust.cjs');

const s = (id, y0, y1, lineId) => ({ id, lineId, points: [[10, y0], [20, y1]] });

/** Links that sit well apart from their line's raw yBounds (fixed-code style). */
function fixedPage(lastTranscribed = '2026-09-15T10:00:00Z') {
  const lines = [], strokes = [];
  for (let i = 0; i < 6; i++) {
    lines.push({ id: `L${i}`, text: `line ${i}`, yBounds: { minY: 2 + i * 8, maxY: 7 + i * 8 } });
    strokes.push(s(`a${i}`, 40 + i * 6, 44 + i * 6, `L${i}`));
  }
  return { version: '2.0', transcript: { lastTranscribed, lines }, strokes };
}

/** Every link overlaps its line's raw yBounds (pre-fix signature). */
function preFixPage(lastTranscribed = '2026-10-10T09:00:00Z') {
  const lines = [], strokes = [];
  for (let i = 0; i < 6; i++) {
    const yb = { minY: 10 + i * 7, maxY: 15 + i * 7 };
    lines.push({ id: `L${i}`, text: `line ${i}`, yBounds: yb });
    strokes.push(s(`a${i}`, yb.minY + 1, yb.maxY - 1, `L${i}`));
  }
  return { version: '2.0', transcript: { lastTranscribed, lines }, strokes };
}

/** The hybrid layout: shell pretty-printed, "strokes" last, one stroke per line. */
function hybrid(doc) {
  const { strokes, ...shell } = doc;
  const head = JSON.stringify(shell, null, 2).replace(/\n}$/, '');
  return `${head},\n  "strokes": [\n${strokes.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]\n}`;
}

const docs = {
  fixed: fixedPage(),
  preFix: preFixPage(),
  old: fixedPage('2026-07-01T00:00:00Z'),
  unlinked: { ...fixedPage(), strokes: fixedPage().strokes.map((x) => ({ ...x, lineId: null })) },
  noLines: { ...fixedPage(), transcript: { lastTranscribed: '2026-09-15', lines: [] } },
  noDate: { ...fixedPage(), transcript: { ...fixedPage().transcript, lastTranscribed: null } }
};

describe('ink-trust.cjs mirrors isTrustworthyTranscript', () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(`same answer: ${name}`, () => {
      expect(main.isTrustworthyTranscript(doc)).toBe(isTrustworthyTranscript(doc));
    });
  }

  it('fixtures cover both answers', () => {
    expect(isTrustworthyTranscript(docs.fixed)).toBe(true);
    expect(isTrustworthyTranscript(docs.preFix)).toBe(false);
  });

  it('same threshold date', async () => {
    const { TRUST_SINCE } = await import('$lib/viewer/ink-text.js');
    expect(main.TRUST_SINCE).toBe(TRUST_SINCE);
  });
});

describe('pageLinked(raw)', () => {
  it('reads the hybrid layout and a plain one alike', () => {
    for (const doc of Object.values(docs)) {
      const want = doc.transcript.lines.length ? isTrustworthyTranscript(doc) : null;
      expect(main.pageLinked(hybrid(doc))).toBe(want);
      expect(main.pageLinked(JSON.stringify(doc))).toBe(want);
    }
  });

  it('a page without a transcript is null; bad JSON throws', () => {
    expect(main.pageLinked(JSON.stringify({ version: '2.0', strokes: [] }))).toBe(null);
    expect(() => main.pageLinked('{')).toThrow();
  });
});
