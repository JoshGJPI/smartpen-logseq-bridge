import { describe, it, expect } from 'vitest';
import { alignLines, alignLinesJoined, movedPairs, MOVED_MIN, similarity, norm, editDistance, sameLetters, alignText } from '../line-align.js';

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

describe('movedPairs (moved here from the MCP, v3.21.0)', () => {
  const stored = [{ text: 'first line' }, { text: 'third one' }, { text: 'meeting with Tom' }];
  const ref = [{ text: 'first line' }, { text: 'meeting with Tom' }, { text: 'third one' }];

  it("pairs a line stored out of place with its reading elsewhere, in the stored line's place", () => {
    const out = movedPairs(alignLines(stored, ref), stored, ref);
    expect(out).toContainEqual([2, 1, true]);
    expect(out.some(([a, b]) => a === null && b === 1)).toBe(false);
  });

  it('takes a threshold and a filter on the reference side', () => {
    const pairs = [[0, null], [null, 0]];
    const s = [{ text: 'order steel beams' }], r = [{ text: 'order steal bean today' }];
    expect(similarity(s[0].text, r[0].text)).toBeLessThan(MOVED_MIN);
    expect(movedPairs(pairs, s, r)).toEqual(pairs);
    expect(movedPairs(pairs, s, r, 0.6)).toEqual([[0, 0, true]]);
    expect(movedPairs(pairs, s, r, 0.6, () => false)).toEqual(pairs);
  });
});

describe('alignLinesJoined (v3.21.0): one stored line may take consecutive reference lines', () => {
  const merged = "We'll need to provide a coating for the concrete to accommodate being submerged full time";

  it('a line merged by hand from two rows takes both readings', () => {
    const s = [{ text: 'intro line here' }, { text: merged }, { text: 'next line' }];
    const r = [{ text: 'intro line here' }, { text: "We'll need to provide a coating for the concrete to accommodate" },
      { text: 'being submerged full time' }, { text: 'next line' }];
    expect(similarity(merged, r[1].text)).toBeLessThan(0.85);
    expect(alignLinesJoined(s, r)).toEqual([[0, [0]], [1, [1, 2]], [2, [3]]]);
  });

  it('three rows join too, up to maxJoin', () => {
    const s = [{ text: 'alpha beta gamma delta epsilon zeta' }];
    const r = [{ text: 'alpha beta' }, { text: 'gamma delta' }, { text: 'epsilon zeta' }];
    expect(alignLinesJoined(s, r)).toEqual([[0, [0, 1, 2]]]);
    expect(alignLinesJoined(s, r, { maxJoin: 2 })).not.toEqual([[0, [0, 1, 2]]]);
  });

  it('never joins a neighbour: two stored lines each matching one reading stay one-to-one', () => {
    const s = [{ text: 'order steel beams' }, { text: 'call Tom about footing' }];
    const r = [{ text: 'order steel beams' }, { text: 'call Tom about footing' }];
    expect(alignLinesJoined(s, r)).toEqual([[0, [0]], [1, [1]]]);
    // A short stray mark after a long line is left over, not joined on.
    expect(alignLinesJoined([{ text: 'check deflection at the landing beam' }], [{ text: 'check deflection at the landing beam' }, { text: 'xx' }]))
      .toEqual([[0, [0]], [null, [1]]]);
  });

  it('skips readings the filter rules out, and handles empty input', () => {
    const s = [{ text: 'alpha beta gamma delta' }];
    const r = [{ text: 'alpha beta' }, { text: 'gamma delta' }];
    expect(alignLinesJoined(s, r, { usable: (k) => k !== 1 })[0][1]).toEqual([0]);
    expect(alignLinesJoined([], [])).toEqual([]);
    expect(alignLinesJoined([{ text: 'x' }], [])).toEqual([[0, null]]);
  });
});
