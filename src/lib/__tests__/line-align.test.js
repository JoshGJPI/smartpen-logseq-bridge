import { describe, it, expect } from 'vitest';
import { alignLines, similarity, norm, editDistance, sameLetters, alignText } from '../line-align.js';

describe('alignLines', () => {
  it('pairs similar lines and leaves missing ones unpaired', () => {
    const s = [{ text: 'alpha beta' }, { text: 'gamma' }, { text: 'delta epsilon' }];
    const r = [{ text: 'alpha betta' }, { text: 'new line here' }, { text: 'delta epsilon' }];
    const pairs = alignLines(s, r);
    expect(pairs[0]).toEqual([0, 0]);
    expect(pairs[3]).toEqual([2, 2]);
    expect(pairs.slice(1, 3)).toEqual(expect.arrayContaining([[1, null], [null, 1]]));
    expect(alignLines([], [{ text: 'x' }])).toEqual([[null, 0]]);
  });

  it('handles empty inputs', () => {
    expect(alignLines([], [])).toEqual([]);
    expect(alignLines([{ text: 'x' }], [])).toEqual([[0, null]]);
  });

  it('keeps order: a line out of place is left unpaired, not crossed', () => {
    const s = [{ text: 'first line' }, { text: 'second line here' }, { text: 'third one' }];
    const r = [{ text: 'second line here' }, { text: 'third one' }, { text: 'first line' }];
    const pairs = alignLines(s, r).filter(([a, b]) => a !== null && b !== null);
    for (let k = 1; k < pairs.length; k++) {
      expect(pairs[k][0]).toBeGreaterThan(pairs[k - 1][0]);
      expect(pairs[k][1]).toBeGreaterThan(pairs[k - 1][1]);
    }
  });

  it('compares text with the task marker stripped (a ☑ reading matches a DONE line)', () => {
    const stored = [{ text: 'order steel for 5444' }, { text: 'call Tom' }];
    const ms = [{ text: '☑ order steel for 5444' }, { text: '☐ call Tom' }];
    expect(alignLines(stored, ms)).toEqual([[0, 0], [1, 1]]);
    expect(similarity('order steel', '☑ order steel')).toBe(1);
    expect(similarity('order steel', '[x] order steel')).toBe(1);
    expect(similarity('call Tom', 'TODO call Tom')).toBe(1);
  });

  it('a lowercase todo stays text, as on transcription', () => {
    expect(alignText('todo list')).toBe('todo list');
  });
});

describe('similarity and helpers', () => {
  it('ignores case and punctuation', () => {
    expect(similarity('Call Tom.', 'call tom')).toBe(1);
    expect(norm('  IBC-2024!! ')).toBe('ibc 2024');
    expect(sameLetters('IBC 2024', 'IBC2024')).toBe(true);
  });

  it('scores a one-letter misreading high and different lines low', () => {
    expect(similarity('boing', 'boring')).toBeGreaterThan(0.8);
    expect(similarity('alpha', 'zzzzzz')).toBeLessThan(0.3);
    expect(similarity('', '')).toBe(1);
  });

  it('editDistance works on strings and arrays', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance(['a', 'b'], ['a', 'c'])).toBe(1);
  });
});
