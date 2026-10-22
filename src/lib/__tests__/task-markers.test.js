/**
 * Tests for task-markers.js — reading a task box (or a typed TODO / DONE) at
 * the start of a transcript line.
 *
 * The cases come from real transcripts: MyScript gives `☐` / `☑` at the line
 * start, sometimes followed by a list dash; a bare `✓` is a remark and stays
 * text; `WAITING` lines are plain text until there is a third state.
 */

import { describe, it, expect } from 'vitest';
import { parseTaskMarker, stripTaskMarker } from '../task-markers.js';

const todo = (text) => ({ checked: false, text });
const done = (text) => ({ checked: true, text });
const plain = (text) => ({ checked: null, text });

describe('parseTaskMarker — boxes', () => {
  it('reads an empty box as TODO', () => {
    expect(parseTaskMarker('☐ Call Troy to discuss landing')).toEqual(todo('Call Troy to discuss landing'));
  });

  it('reads a ticked or crossed box as DONE', () => {
    expect(parseTaskMarker('☑ Check on PO')).toEqual(done('Check on PO'));
    expect(parseTaskMarker('☒ Check on PO')).toEqual(done('Check on PO'));
  });

  it('reads typed brackets, either case of x', () => {
    expect(parseTaskMarker('[ ] Send calcs')).toEqual(todo('Send calcs'));
    expect(parseTaskMarker('[x] Send calcs')).toEqual(done('Send calcs'));
    expect(parseTaskMarker('[X] Send calcs')).toEqual(done('Send calcs'));
  });

  it('strips a glyph with no space after it', () => {
    expect(parseTaskMarker('☐Call Troy')).toEqual(todo('Call Troy'));
  });

  it('strips a stray list dash after the box', () => {
    expect(parseTaskMarker('☐ - preferred bott. flange')).toEqual(todo('preferred bott. flange'));
    expect(parseTaskMarker('☑ – done thing')).toEqual(done('done thing'));
  });

  it('keeps a dash that is part of the text', () => {
    expect(parseTaskMarker('☐ -3 psf uplift')).toEqual(todo('-3 psf uplift'));
  });

  it('ignores leading whitespace', () => {
    expect(parseTaskMarker('   ☐ Indented task')).toEqual(todo('Indented task'));
  });

  it('strips only the first marker', () => {
    expect(parseTaskMarker('☐ ☐ twice')).toEqual(todo('☐ twice'));
  });
});

describe('parseTaskMarker — typed keywords', () => {
  it('reads TODO and DONE as whole capital words', () => {
    expect(parseTaskMarker('TODO ask Jeff for drawings')).toEqual(todo('ask Jeff for drawings'));
    expect(parseTaskMarker('DONE Juan will send')).toEqual(done('Juan will send'));
  });

  it('accepts a colon after the keyword', () => {
    expect(parseTaskMarker('TODO: fee estimate')).toEqual(todo('fee estimate'));
  });

  it('leaves other cases and longer words alone', () => {
    expect(parseTaskMarker('Todo list for Friday')).toEqual(plain('Todo list for Friday'));
    expect(parseTaskMarker('todo: later')).toEqual(plain('todo: later'));
    expect(parseTaskMarker('TODOs from the call')).toEqual(plain('TODOs from the call'));
    expect(parseTaskMarker('DONEGAL site')).toEqual(plain('DONEGAL site'));
  });

  it('does not read WAITING (no third state yet)', () => {
    expect(parseTaskMarker('WAITING Juan will email')).toEqual(plain('WAITING Juan will email'));
  });
});

describe('parseTaskMarker — not a task', () => {
  it('leaves a bare tick, a bullet and a mid-line box as text', () => {
    expect(parseTaskMarker('✓ Looks like walls')).toEqual(plain('✓ Looks like walls'));
    expect(parseTaskMarker('✔ ok')).toEqual(plain('✔ ok'));
    expect(parseTaskMarker('• item')).toEqual(plain('• item'));
    expect(parseTaskMarker('Call ☐ Troy')).toEqual(plain('Call ☐ Troy'));
  });

  it('returns the text unchanged, whitespace included', () => {
    expect(parseTaskMarker('  plain line ')).toEqual(plain('  plain line '));
  });

  it('leaves a marker with nothing after it as it is', () => {
    expect(parseTaskMarker('☐')).toEqual(plain('☐'));
    expect(parseTaskMarker('☑  ')).toEqual(plain('☑  '));
    expect(parseTaskMarker('TODO')).toEqual(plain('TODO'));
    expect(parseTaskMarker('☐ - ')).toEqual(plain('☐ - '));
  });

  it('handles empty, null and non-string input', () => {
    expect(parseTaskMarker('')).toEqual(plain(''));
    expect(parseTaskMarker(null)).toEqual(plain(''));
    expect(parseTaskMarker(undefined)).toEqual(plain(''));
    expect(parseTaskMarker(42)).toEqual(plain(''));
  });
});

describe('stripTaskMarker', () => {
  it('gives the trimmed text without a marker', () => {
    expect(stripTaskMarker('☐ Call Troy')).toBe('Call Troy');
    expect(stripTaskMarker('  Call Troy ')).toBe('Call Troy');
    expect(stripTaskMarker(null)).toBe('');
  });
});
