/**
 * lib/line-kinds.js (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.2 / E.5 / E.7):
 * the sketch line format, its box, its scan text and summary (mirrored in
 * electron/task-summary.cjs), placement by y, and the unknown-kind rule.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  KIND_SKETCH, SKETCH_SUMMARY_MAX, isKindLine, isSketchLine, sketchLabel, kindFields, normalizeKindLine, strokeBox,
  withKindBounds, kindLineIds, lineScanText, kindMarkdownText, buildSketchSummary, normalizeSketchSummary,
  placeKindLine, insertKindLine, reinsertKindLines
} from '../line-kinds.js';
import { buildTranscriptionText, linesFromText, scopeLinesOf, tagScope } from '../tag-scope.js';
import { lineToMarkdown, linesToLogseqMarkdown } from '../viewer/transcript-markdown.js';
import { transcriptHtml } from '../print/print-html.js';

const require = createRequire(import.meta.url);
const main = require('../../../electron/task-summary.cjs');

const st = (id, y0, y1, lineId = null, x = 10) => ({ id, lineId, points: [[x, y0], [x + 2, y1]] });
const sk = (id, text = 'Plan', extra = {}) => ({ id, kind: 'sketch', text, indentLevel: 1, parentId: null, checked: null, yBounds: null, ...extra });

describe('the format', () => {
  it('knows a kind line, a sketch, and any other kind', () => {
    expect(isKindLine(sk('a'))).toBe(true);
    expect(isSketchLine(sk('a'))).toBe(true);
    expect(isKindLine({ id: 'b', kind: 'table', text: 't' })).toBe(true);
    expect(isSketchLine({ id: 'b', kind: 'table', text: 't' })).toBe(false);
    for (const l of [null, undefined, {}, { kind: '' }, { kind: 3 }, { text: 'x' }]) expect(isKindLine(l)).toBe(false);
  });

  it('a label is one trimmed line, "Sketch" when empty', () => {
    expect(sketchLabel('  Floor plan ')).toBe('Floor plan');
    expect(sketchLabel('a\nb')).toBe('a b');
    for (const v of ['', '   ', null, undefined, 4]) expect(sketchLabel(v)).toBe('Sketch');
  });

  it('kindFields carries kind and bounds only, and nothing for a text line', () => {
    const b = { minX: 1, maxX: 2, minY: 3, maxY: 4 };
    expect(kindFields(sk('a', 'x', { bounds: b, extra: 1 }))).toEqual({ kind: 'sketch', bounds: b });
    expect(kindFields(sk('a'))).toEqual({ kind: 'sketch' });
    expect(kindFields({ id: 'a', text: 'x', checked: false })).toEqual({});
  });

  it('a kind line is never a task, has no yBounds, and an empty sketch label falls back', () => {
    expect(normalizeKindLine({ ...sk('a', ''), checked: false, marker: 'WAITING', yBounds: { minY: 1, maxY: 2 } }))
      .toEqual({ ...sk('a', 'Sketch'), checked: null, yBounds: null });
    const text = { id: 't', text: '', checked: false };
    expect(normalizeKindLine(text)).toBe(text);
  });

  it('strokeBox is the Ncode box, rounded; null with no points', () => {
    expect(strokeBox([st('1', 5, 9.123), st('2', 2, 3, null, 40)])).toEqual({ minX: 10, maxX: 42, minY: 2, maxY: 9.12 });
    expect(strokeBox([])).toBeNull();
    expect(strokeBox([{ points: [] }])).toBeNull();
  });

  it('withKindBounds recomputes a sketch\'s box from its strokes, null without any, and leaves the rest', () => {
    const lines = [{ id: 'T', text: 't' }, sk('S'), { id: 'K', kind: 'table', text: 'k', bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } }];
    const out = withKindBounds(lines, [st('1', 50, 60, 'S'), st('2', 1, 2, 'T')]);
    expect(out[1].bounds).toEqual({ minX: 10, maxX: 12, minY: 50, maxY: 60 });
    expect(out[0]).toBe(lines[0]);
    expect(out[2]).toBe(lines[2]);
    expect(withKindBounds(out, [st('1', 50, 60, 'S')])).toBe(out);   // unchanged: same array
    expect(withKindBounds(out, [])[1].bounds).toBeNull();
    const plain = [{ id: 'T', text: 't' }];
    expect(withKindBounds(plain, [])).toBe(plain);
  });

  it('kindLineIds', () => {
    const lines = [{ id: 'T' }, sk('S'), { id: 'K', kind: 'table' }];
    expect([...kindLineIds(lines)]).toEqual(['S', 'K']);
  });
});

describe('text forms', () => {
  it('scan text: [sketch] label, [kind] text for another kind, text otherwise', () => {
    expect(lineScanText(sk('a', 'Floor plan'))).toBe('[sketch] Floor plan');
    expect(lineScanText(sk('a', ''))).toBe('[sketch] Sketch');
    expect(lineScanText({ kind: 'table', text: 'beam sizes' })).toBe('[table] beam sizes');
    expect(lineScanText({ text: '  indented' })).toBe('indented');
  });

  it('markdown and copy write [sketch: label], never a task marker', () => {
    expect(kindMarkdownText(sk('a', 'Floor plan'))).toBe('[sketch: Floor plan]');
    expect(lineToMarkdown({ ...sk('a', 'Floor plan'), indentLevel: 2, checked: false })).toBe('\t\t- [sketch: Floor plan]');
    expect(linesToLogseqMarkdown([{ text: 'site', indentLevel: 0 }, sk('a', 'Floor plan')])).toBe('- site\n\t- [sketch: Floor plan]');
  });

  it('print shows the label behind a SKETCH tag in the transcript column', () => {
    const html = transcriptHtml([sk('a', 'Floor <plan>')]);
    expect(html).toContain('SKETCH');
    expect(html).toContain('Floor &lt;plan&gt;');
    expect(html).not.toContain('class="box"');
  });

  it('transcriptionText writes a sketch as [sketch] label, and reads back at its indent', () => {
    const lines = [{ id: 'A', text: '6226-001 visit', indentLevel: 0 }, sk('S', 'Floor plan'), { id: 'B', text: 'heater', indentLevel: 1 }];
    const text = buildTranscriptionText(lines);
    expect(text).toBe('6226-001 visit\n  [sketch] Floor plan\n  heater');
    expect(linesFromText(text)[1]).toEqual({ id: null, text: '[sketch] Floor plan', indentLevel: 1 });
  });

  it('block scope from transcriptionText equals block scope from the lines, sketch lines included (Phase D)', () => {
    const lines = [
      { id: 'A', text: '6226-001 visit', indentLevel: 0 }, sk('S', 'Floor plan'), { id: 'B', text: 'heater', indentLevel: 1 },
      { id: 'C', text: '5444-006 weld', indentLevel: 0 }, sk('S2', 'Weld setup 6226-001'),
    ];
    for (const tag of ['6226-001', '5444-006']) {
      const a = tagScope(scopeLinesOf(lines), tag);
      const b = tagScope(linesFromText(buildTranscriptionText(lines)), tag);
      expect([...a.covered]).toEqual([...b.covered]);
      expect(a.roots).toEqual(b.roots);
    }
    expect([...tagScope(scopeLinesOf(lines), '6226-001').covered]).toEqual([0, 1, 2, 4]);
  });
});

describe('scan summary (E.5) — renderer and main agree', () => {
  const lines = [
    { id: 'A', text: 'visit' }, sk('S1', 'Floor plan'), { id: 'K', kind: 'table', text: 'x' }, sk('S2', ''),
    sk('S3', 'x'.repeat(200)), { kind: 'sketch', text: 'no id' }
  ];

  it('one entry per sketch line with an id: id, label, line index; labels clipped', () => {
    const out = buildSketchSummary(lines);
    expect(out.map((s) => [s.id, s.lineIndex])).toEqual([['S1', 1], ['S2', 3], ['S3', 4]]);
    expect(out[1].label).toBe('Sketch');
    expect(out[2].label).toHaveLength(80);
    expect(main.buildSketchSummary(lines)).toEqual(out);
  });

  it('keeps at most 20 (scalar-small)', () => {
    const many = Array.from({ length: 30 }, (_, i) => sk(`S${i}`, `s${i}`));
    expect(buildSketchSummary(many)).toHaveLength(SKETCH_SUMMARY_MAX);
    expect(main.buildSketchSummary(many)).toEqual(buildSketchSummary(many));
  });

  it('main\'s lineScanText is the renderer\'s', () => {
    for (const l of lines) expect(main.lineScanText(l)).toBe(lineScanText(l));
    for (const bad of [undefined, null, [], 'x']) expect(main.buildSketchSummary(bad)).toEqual(buildSketchSummary(bad));
  });

  it('normalizeSketchSummary drops malformed entries (older mains: none)', () => {
    expect(normalizeSketchSummary(undefined)).toEqual([]);
    expect(normalizeSketchSummary([{ id: 'a', lineIndex: 2, label: '' }, { id: 'b' }, null, { id: '', lineIndex: 1 }]))
      .toEqual([{ id: 'a', label: 'Sketch', lineIndex: 2 }]);
  });
});

describe('placement by y (E.2)', () => {
  // A at y 10, its child A1 at y 30, B at y 80; the sketch's ink at y 40–60.
  const lines = [{ id: 'A', text: 'A', indentLevel: 0 }, { id: 'A1', text: 'A1', indentLevel: 1 }, { id: 'B', text: 'B', indentLevel: 0 }];
  const strokes = [st('a', 10, 12, 'A'), st('a1', 30, 32, 'A1'), st('b', 80, 82, 'B'), st('k1', 40, 60), st('k2', 45, 50)];
  const inkIds = new Set(['k1', 'k2']);

  it('on a trusted page: under the nearest text line above its ink, one level deeper', () => {
    expect(placeKindLine(lines, strokes, { inkIds, trusted: true })).toEqual({ at: 2, indentLevel: 2, parentId: 'A1', under: 1 });
  });

  it('after the anchor\'s deeper lines whose ink starts above it, so sketches under one line stay in page order', () => {
    const l2 = [{ id: 'A', text: 'A', indentLevel: 0 }, sk('S0', 'first', { indentLevel: 1 }), { id: 'B', text: 'B', indentLevel: 0 }];
    const s2 = [st('a', 10, 12, 'A'), st('s0', 20, 25, 'S0'), st('b', 80, 82, 'B'), st('k1', 40, 60)];
    expect(placeKindLine(l2, s2, { inkIds: new Set(['k1']), trusted: true })).toMatchObject({ at: 2, indentLevel: 1, parentId: 'A' });
    // A sketch higher on the page than the existing one goes before it.
    const s3 = [st('a', 10, 12, 'A'), st('s0', 40, 45, 'S0'), st('b', 80, 82, 'B'), st('k1', 15, 18)];
    expect(placeKindLine(l2, s3, { inkIds: new Set(['k1']), trusted: true })).toMatchObject({ at: 1, indentLevel: 1, parentId: 'A' });
  });

  it('ink taken from a text line no longer counts for that line', () => {
    const s = [st('a', 10, 12, 'A'), st('b', 40, 42, 'B'), st('k1', 41, 60, 'B')];
    const l = [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }];
    expect(placeKindLine(l, s, { inkIds: new Set(['k1']), trusted: true })).toMatchObject({ under: 1 });
    expect(placeKindLine(l, [st('a', 10, 12, 'A'), st('k1', 41, 60, 'B')], { inkIds: new Set(['k1']), trusted: true })).toMatchObject({ under: 0 });
  });

  it('with no text line above: at the start, level 0', () => {
    expect(placeKindLine(lines, [...strokes, st('top', 1, 2)], { inkIds: new Set(['top']), trusted: true }))
      .toEqual({ at: 0, indentLevel: 0, parentId: null, under: -1 });
  });

  it('on an untrusted page, or with no ink: at the end, level 0', () => {
    expect(placeKindLine(lines, strokes, { inkIds, trusted: false })).toEqual({ at: 3, indentLevel: 0, parentId: null, under: -1 });
    expect(placeKindLine(lines, strokes, { inkIds: new Set(['none']), trusted: true })).toMatchObject({ at: 3, indentLevel: 0 });
  });

  it('insertKindLine puts the line there with its indent and parent', () => {
    const out = insertKindLine(lines, sk('S', 'Plan', { indentLevel: 0 }), strokes, { inkIds, trusted: true });
    expect(out.lines.map((l) => l.id)).toEqual(['A', 'A1', 'S', 'B']);
    expect(out.lines[2]).toMatchObject({ indentLevel: 2, parentId: 'A1' });
  });

  it('reinsertKindLines puts a replaced transcript\'s sketches back by y, using the new links', () => {
    const old = [{ id: 'A' }, sk('S'), { id: 'B' }];
    const fresh = [{ id: 'N1', text: 'n1', indentLevel: 0 }, { id: 'N2', text: 'n2', indentLevel: 0 }];
    const ink = [st('x', 10, 12, 'A'), st('k', 40, 60, 'S'), st('y', 80, 82, 'B')];
    const link = { x: 'N1', y: 'N2' };
    const out = reinsertKindLines(old, fresh, ink, (s) => (s.lineId === 'S' ? 'S' : link[s.id] || null));
    expect(out.map((l) => l.id)).toEqual(['N1', 'S', 'N2']);
    expect(out[1]).toMatchObject({ indentLevel: 1, parentId: 'N1', kind: KIND_SKETCH });
    // Kept already: nothing added twice.
    expect(reinsertKindLines(old, out, ink, () => null)).toBe(out);
  });
});
