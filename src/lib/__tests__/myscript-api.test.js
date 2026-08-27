/**
 * Tests for parseMyScriptResponse — specifically the Y-bounds calculation
 * and the interpolation fix for lines that fail word matching.
 *
 * Bug context (2026-03-24):
 *   Lines whose words couldn't be matched to the JIIX word list (numbered items
 *   like "5)", special chars like "□", keywords like "WAITING") previously fell
 *   back to `lineY = lineIdx × 20` — a pixel value with no relationship to Ncode
 *   stroke coordinates.  estimateLineStrokeIds() found no strokes at those pixel
 *   positions, strokeIds.size === 0, and the filter dropped the lines, truncating
 *   the saved transcript.
 *
 *   Fix: fallback is now {0,0}, and a second interpolation pass fills the gaps
 *   from neighbouring lines that did get valid word-match bounds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseMyScriptResponse,
  yBoundsToNcode,
  batchOriginY,
  NCODE_TO_MM,
  MYSCRIPT_INK_ORIGIN_MM
} from '../myscript-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal MyScript JIIX word object */
function word(label, x, y, width = 20, height = 8) {
  return { label, 'bounding-box': { x, y, width, height } };
}

/**
 * Build a minimal MyScript JIIX response.
 * `label`  - full transcribed text (newline-separated lines)
 * `words`  - array of word objects that have bounding boxes
 */
function response(label, words = []) {
  return { label, words };
}

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('parseMyScriptResponse — basic parsing', () => {
  it('returns an empty lines array for an empty response', () => {
    const result = parseMyScriptResponse(response(''));
    expect(result.lines).toHaveLength(0);
  });

  it('returns one line per newline-separated segment', () => {
    const result = parseMyScriptResponse(response('Hello\nWorld'));
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].text).toBe('Hello');
    expect(result.lines[1].text).toBe('World');
  });

  it('strips blank lines from the label', () => {
    const result = parseMyScriptResponse(response('Hello\n\nWorld'));
    expect(result.lines).toHaveLength(2);
  });

  it('sets canonical to normalised text', () => {
    const result = parseMyScriptResponse(response('Hello'));
    expect(result.lines[0].canonical).toBe('Hello');
  });

  it('normalises checkbox symbols in canonical', () => {
    const result = parseMyScriptResponse(response('☐ Done\n☑ Also done'));
    expect(result.lines[0].canonical).toBe('[ ] Done');
    expect(result.lines[1].canonical).toBe('[x] Also done');
  });

  it('sets syncStatus to "unsaved" on every line', () => {
    const result = parseMyScriptResponse(response('Line one\nLine two'));
    result.lines.forEach(l => expect(l.syncStatus).toBe('unsaved'));
  });

  it('sets blockUuid to null on every line', () => {
    const result = parseMyScriptResponse(response('Line one'));
    expect(result.lines[0].blockUuid).toBeNull();
  });

  it('exposes the full text on the result object', () => {
    const result = parseMyScriptResponse(response('Hello\nWorld'));
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('World');
  });
});

// ---------------------------------------------------------------------------
// Y-bounds — lines WITH word matches
// ---------------------------------------------------------------------------

describe('parseMyScriptResponse — Y-bounds from word matches', () => {
  it('uses the bounding-box y of the leftmost matched word', () => {
    const r = response('Hello World', [
      word('World', 50, 30),
      word('Hello', 10, 32),   // leftmost x=10
    ]);
    const result = parseMyScriptResponse(r);
    const line = result.lines[0];
    // leftmost word is Hello at x=10, y=32
    expect(line.yBounds.minY).toBeCloseTo(32);
  });

  it('expands maxY by word height', () => {
    const r = response('Hello', [word('Hello', 10, 30, 40, 10)]);
    const result = parseMyScriptResponse(r);
    const line = result.lines[0];
    expect(line.yBounds.minY).toBeCloseTo(30);
    expect(line.yBounds.maxY).toBeCloseTo(40);   // 30 + height 10
  });

  it('picks the overall min/max Y across all matched words on a line', () => {
    const r = response('A B C', [
      word('A', 10, 28, 10, 8),   // 28–36
      word('B', 25, 30, 10, 10),  // 30–40
      word('C', 45, 26, 10, 7),   // 26–33
    ]);
    const result = parseMyScriptResponse(r);
    const line = result.lines[0];
    expect(line.yBounds.minY).toBeCloseTo(26);
    expect(line.yBounds.maxY).toBeCloseTo(40);
  });

  it('produces non-zero yBounds when any word is matched', () => {
    const r = response('5) Dean confirmed', [
      word('Dean', 25, 60, 20, 8),
      word('confirmed', 50, 62, 40, 8),
    ]);
    const result = parseMyScriptResponse(r);
    const line = result.lines[0];
    expect(line.yBounds.minY).toBeGreaterThan(0);
    expect(line.yBounds.maxY).toBeGreaterThan(0);
    expect(line.yBounds.maxY).toBeGreaterThan(line.yBounds.minY);
  });
});

// ---------------------------------------------------------------------------
// Y-bounds — lines WITHOUT word matches (the fixed fallback)
// ---------------------------------------------------------------------------

describe('parseMyScriptResponse — Y-bounds fallback (no word match)', () => {
  it('gives {0,0} to a lone line when no words exist in the response', () => {
    // No words at all in the response
    const r = response('5) Item five', []);
    const result = parseMyScriptResponse(r);
    // No neighbours to interpolate from, so stays 0-0
    expect(result.lines[0].yBounds.minY).toBe(0);
    expect(result.lines[0].yBounds.maxY).toBe(0);
  });

  it('no longer uses lineIdx × 20 as fallback (old bug)', () => {
    // If the old bug were present, a line at index 5 would get y = 100.
    // After the fix, it should be interpolated or 0.
    const r = response(
      'L0\nL1\nL2\nL3\nL4\nUnmatched fifth line',
      [] // No words at all → all lines get 0-0, no interpolation possible
    );
    const result = parseMyScriptResponse(r);
    const fifthLine = result.lines[5];
    // Must NOT be 100 (lineIdx 5 × 20)
    expect(fifthLine.yBounds.minY).not.toBe(100);
    expect(fifthLine.yBounds.maxY).not.toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Y-bounds — interpolation across lines with/without word matches
// ---------------------------------------------------------------------------

describe('parseMyScriptResponse — Y-bounds interpolation', () => {
  /**
   * Scenario that mirrors the real-world bug:
   *   Line 0  — matched  → yBounds 5–13
   *   Line 1  — UNmatched (e.g. "5) Dean confirmed")
   *   Line 2  — matched  → yBounds 25–33
   *
   * Expected: line 1 interpolated between line 0 and line 2.
   */
  it('interpolates a single unmatched line between two matched lines', () => {
    const r = response(
      'First line\n5) Unmatched\nThird line',
      [
        word('First', 5, 5, 30, 8),   // line 0: y=5, maxY=13
        word('line', 40, 5, 20, 8),
        word('Third', 5, 25, 30, 8),  // line 2: y=25, maxY=33
        word('line', 40, 25, 20, 8),
      ]
    );
    const result = parseMyScriptResponse(r);
    const unmatched = result.lines[1];

    // Must have non-zero bounds (interpolated)
    expect(unmatched.yBounds.minY).toBeGreaterThan(0);
    expect(unmatched.yBounds.maxY).toBeGreaterThan(0);

    // Must sit between line 0's maxY and line 2's minY
    expect(unmatched.yBounds.minY).toBeGreaterThanOrEqual(result.lines[0].yBounds.maxY);
    expect(unmatched.yBounds.maxY).toBeLessThanOrEqual(result.lines[2].yBounds.minY + 5);
  });

  it('extrapolates a trailing unmatched line after the last matched line', () => {
    const r = response(
      'First line\nSecond line\n□ Checkbox unmatched',
      [
        word('First',  5, 5, 30, 8),
        word('line',  40, 5, 20, 8),
        word('Second', 5, 18, 35, 8),
        word('line',  45, 18, 20, 8),
        // "□" and "Checkbox" are NOT in the word list
      ]
    );
    const result = parseMyScriptResponse(r);
    const checkbox = result.lines[2];

    expect(checkbox.yBounds.minY).toBeGreaterThan(0);
    expect(checkbox.yBounds.maxY).toBeGreaterThan(checkbox.yBounds.minY);
    // Must come after the last matched line
    expect(checkbox.yBounds.minY).toBeGreaterThanOrEqual(result.lines[1].yBounds.maxY);
  });

  it('extrapolates a leading unmatched line before the first matched line', () => {
    const r = response(
      'WAITING do something\nMatched line here',
      [
        // "WAITING" is NOT in the word list
        word('Matched', 5, 20, 40, 8),
        word('line',   50, 20, 20, 8),
        word('here',   75, 20, 20, 8),
      ]
    );
    const result = parseMyScriptResponse(r);
    const waiting = result.lines[0];

    expect(waiting.yBounds.minY).toBeGreaterThan(0);
    expect(waiting.yBounds.maxY).toBeGreaterThan(waiting.yBounds.minY);
    // Must come before the first matched line
    expect(waiting.yBounds.maxY).toBeLessThanOrEqual(result.lines[1].yBounds.minY + 2);
  });

  it('interpolates multiple consecutive unmatched lines', () => {
    const r = response(
      'Matched start\n7) Item seven\n8) Item eight\n9) Item nine\nMatched end',
      [
        word('Matched', 5,  5, 40, 8),
        word('start',  50,  5, 30, 8),
        // items 7, 8, 9 have NO matching words
        word('Matched', 5, 50, 40, 8),
        word('end',    50, 50, 20, 8),
      ]
    );
    const result = parseMyScriptResponse(r);
    const item7 = result.lines[1];
    const item8 = result.lines[2];
    const item9 = result.lines[3];

    // All three should have non-zero, interpolated bounds
    [item7, item8, item9].forEach(line => {
      expect(line.yBounds.minY).toBeGreaterThan(0);
      expect(line.yBounds.maxY).toBeGreaterThan(line.yBounds.minY);
    });

    // They should be monotonically ordered (each line below the previous)
    expect(item8.yBounds.minY).toBeGreaterThanOrEqual(item7.yBounds.minY);
    expect(item9.yBounds.minY).toBeGreaterThanOrEqual(item8.yBounds.minY);
  });

  it('all matched lines still return the same bounds as before', () => {
    const r = response(
      'Line A\nLine B',
      [
        word('Line', 5, 10, 20, 8),
        word('A',   30, 10, 10, 8),
        word('Line', 5, 25, 20, 8),
        word('B',   30, 25, 10, 8),
      ]
    );
    const result = parseMyScriptResponse(r);
    // Both lines matched → bounds come from word bounding boxes directly
    expect(result.lines[0].yBounds.minY).toBeCloseTo(10);
    expect(result.lines[0].yBounds.maxY).toBeCloseTo(18);
    expect(result.lines[1].yBounds.minY).toBeCloseTo(25);
    expect(result.lines[1].yBounds.maxY).toBeCloseTo(33);
  });
});

// ---------------------------------------------------------------------------
// Indentation detection
// ---------------------------------------------------------------------------

describe('parseMyScriptResponse — indentation', () => {
  it('assigns indentLevel 0 to all lines when x positions are the same', () => {
    const r = response(
      'Line A\nLine B\nLine C',
      [
        word('Line', 10, 5, 20, 8), word('A', 35, 5, 10, 8),
        word('Line', 10, 18, 20, 8), word('B', 35, 18, 10, 8),
        word('Line', 10, 31, 20, 8), word('C', 35, 31, 10, 8),
      ]
    );
    const result = parseMyScriptResponse(r);
    result.lines.forEach(l => expect(l.indentLevel).toBe(0));
  });

  it('assigns higher indentLevel to lines with greater x offset', () => {
    const r = response(
      'Parent\n  Child',
      [
        word('Parent', 5,  5, 30, 8),
        word('Child',  30, 18, 30, 8),  // indented
      ]
    );
    const result = parseMyScriptResponse(r);
    expect(result.lines[0].indentLevel).toBe(0);
    expect(result.lines[1].indentLevel).toBeGreaterThan(0);
  });
});


describe('batchOriginY — the anchor a batch of strokes will be measured from', () => {
  const stroke = (...ys) => ({ dotArray: ys.map((y, i) => ({ x: i, y })) });

  it('is the topmost dot of the strokes being sent', () => {
    expect(batchOriginY([stroke(40, 43), stroke(60, 63)])).toBe(40);
  });

  it('is the SUBSET origin, not the page — the whole reason it is measured here', () => {
    // The ActionBar sends untranscribed strokes only. Handed just the lower
    // block, the batch starts 20 units down and every yBounds that comes back
    // is relative to that.
    expect(batchOriginY([stroke(60, 63)])).toBe(60);
  });

  it('round-trips through yBoundsToNcode', () => {
    const strokes = [stroke(51.4, 55.2)];
    const origin = batchOriginY(strokes);
    // What MyScript reports for ink sitting at the very top of the batch.
    const back = yBoundsToNcode({ minY: MYSCRIPT_INK_ORIGIN_MM, maxY: MYSCRIPT_INK_ORIGIN_MM + NCODE_TO_MM }, origin);
    expect(back.minY).toBeCloseTo(51.4, 6);
  });

  it('skips strokes with no dots and reports Infinity when nothing is usable', () => {
    expect(batchOriginY([{ dotArray: [] }, stroke(12)])).toBe(12);
    expect(batchOriginY([])).toBe(Infinity);
    expect(batchOriginY(null)).toBe(Infinity);
  });

  it('ignores a non-numeric y rather than poisoning the minimum', () => {
    // NaN loses every comparison, so it can never become the minimum.
    expect(batchOriginY([{ dotArray: [{ x: 0, y: NaN }, { x: 1, y: 30 }] }])).toBe(30);
  });
});

describe('yBoundsToNcode — MyScript millimetres back to Ncode', () => {
  const ORIGIN = 7.59; // a real page's stroke bounds minY

  it('maps the topmost ink to the batch origin', () => {
    // convertStrokesToMyScript shifts the topmost dot onto the request padding,
    // so a line starting at the ink origin is at the top of the strokes.
    const r = yBoundsToNcode({ minY: MYSCRIPT_INK_ORIGIN_MM, maxY: MYSCRIPT_INK_ORIGIN_MM + NCODE_TO_MM }, ORIGIN);
    expect(r.minY).toBeCloseTo(ORIGIN, 6);
    expect(r.maxY).toBeCloseTo(ORIGIN + 1, 6);
  });

  it('divides by the Ncode scale rather than comparing millimetres directly', () => {
    // The bug this exists to prevent: treating 40mm as Ncode 40 put a line's
    // highlight far below the page.
    const r = yBoundsToNcode({ minY: 40, maxY: 47.113 }, 0);
    expect(r.minY).toBeCloseTo((40 - MYSCRIPT_INK_ORIGIN_MM) / NCODE_TO_MM, 6);
    expect(r.maxY - r.minY).toBeCloseTo(3, 6);
    expect(r.minY).toBeLessThan(40);
  });

  it('is monotonic across lines down the page', () => {
    const a = yBoundsToNcode({ minY: 1.65, maxY: 7.34 }, ORIGIN);
    const b = yBoundsToNcode({ minY: 6.32, maxY: 13.6 }, ORIGIN);
    expect(b.minY).toBeGreaterThan(a.minY);
    expect(b.maxY).toBeGreaterThan(a.maxY);
  });

  it('offsets by the origin so a partial batch shifts as a whole', () => {
    const at0 = yBoundsToNcode({ minY: 20, maxY: 25 }, 0);
    const at50 = yBoundsToNcode({ minY: 20, maxY: 25 }, 50);
    expect(at50.minY - at0.minY).toBeCloseTo(50, 6);
    expect(at50.maxY - at0.maxY).toBeCloseTo(50, 6);
  });

  it('rejects the 0-0 no-word-match marker rather than placing it at the top', () => {
    expect(yBoundsToNcode({ minY: 0, maxY: 0 }, ORIGIN)).toBeNull();
  });

  it('rejects missing or non-finite input', () => {
    expect(yBoundsToNcode(null, ORIGIN)).toBeNull();
    expect(yBoundsToNcode(undefined, ORIGIN)).toBeNull();
    expect(yBoundsToNcode({ minY: NaN, maxY: 5 }, ORIGIN)).toBeNull();
    expect(yBoundsToNcode({ minY: 1, maxY: Infinity }, ORIGIN)).toBeNull();
    expect(yBoundsToNcode({ minY: 1, maxY: 5 }, NaN)).toBeNull();
  });
});
