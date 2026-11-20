/**
 * Block scope (v3.23.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase D.1, D.5):
 * roots for projects and people, case and possessives, nested roots, block ends,
 * hand add / remove, the whole-page fallback, and scope from a scan record's
 * transcriptionText equal to scope from the lines. Made-up lines, no real notes.
 */

import { describe, it, expect } from 'vitest';
import {
  linesFromText, buildTranscriptionText, scopeLinesOf, personNames, nameFromKey, textNamesAny, rootMatcher, hasBlockScope, blockEnd, tagScope,
  pageScopes, coveredLineIds, taskInScope, peopleForTasks, blocksOf, tagBlockEntries, mentionedNotTagged, rootsOnLine
} from '../tag-scope.js';
import { buildTaskSummary } from '../tasks.js';
import { mainFunctions } from '../../../mcp/__fixtures__/app-side.js';

const info = {
  rich: { type: 'person', label: 'Rich' },
  tom: { type: 'person', label: 'Tom', aliases: ['Thomas', 'T. Burns'] },
  loren: { type: 'person' },
  framing: { aliases: ['framed'] }
};

const L = (id, text, indentLevel = 0, extra = {}) => ({ id, text, indentLevel, checked: null, ...extra });

// Two meetings and a stray mention, as a page is often written.
const page = [
  L('a0', '10/14/26', 0),
  L('a1', '10:00 5444-006 Rich update', 0),
  L('a2', 'Stair stringers', 1),
  L('a3', 'schedule coord. meeting w/ Tom', 2, { checked: false }),
  L('a4', 'Tom’s detail for the landing', 3),
  L('a5', 'guard rail', 2),
  L('a6', 'Compare with 2327-018', 1),
  L('b0', '11:00 Site walk', 0),
  L('b1', 'rich mix of trades on site', 1),
  L('b2', 'Thomas to send RFI', 1, { checked: false }),
  L('b3', 'Tomorrow: pour', 1),
  L('c0', 'Lunch', 0)
];
const text = (lines) => lines.map((l) => `${'  '.repeat(l.indentLevel || 0)}${l.text || ''}`).join('\n');
const idx = (lines, ids) => ids.map((id) => lines.findIndex((l) => l.id === id));

describe('names', () => {
  it('a person answers to the display name and aliases, the key capitalised when there is no name', () => {
    expect(personNames('tom', info)).toEqual(['Tom', 'Thomas', 'T. Burns']);
    expect(personNames('loren', info)).toEqual(['Loren']);
    expect(nameFromKey('tom-b')).toBe('Tom B');
    expect(textNamesAny('Isaiah to call', personNames('isaiah', { isaiah: { type: 'person' } }))).toBe(true);
    expect(textNamesAny('isaiah to call', personNames('isaiah', { isaiah: { type: 'person' } }))).toBe(false);
    expect(personNames('framing', info)).toEqual([]);    // a topic
    expect(personNames('5444-006', info)).toEqual([]);   // a project
  });

  it('matches whole words, case-sensitive (decision 4), possessives allowed', () => {
    const rich = ['Rich'];
    expect(textNamesAny('10:00 Rich update', rich)).toBe(true);
    expect(textNamesAny('rich mix', rich)).toBe(false);
    expect(textNamesAny('Richard called', rich)).toBe(false);
    expect(textNamesAny('Enrich it', rich)).toBe(false);
    expect(textNamesAny("Rich's call", rich)).toBe(true);
    expect(textNamesAny('Rich’s call', rich)).toBe(true);
    expect(textNamesAny('(Rich)', rich)).toBe(true);
    expect(textNamesAny('w/ T.  Burns', ['T. Burns'])).toBe(true);   // inner space runs
    expect(textNamesAny('', rich)).toBe(false);
    expect(textNamesAny('Rich', [])).toBe(false);
  });

  it('a project root is the number found in the line, the pattern only', () => {
    const m = rootMatcher('5444-006', info);
    expect(m('10:00 5444-006 Rich update')).toBe(true);
    expect(m('10:00 5444–006')).toBe(true);
    expect(m('15444-006')).toBe(false);
    expect(m('P5444-006')).toBe(false);   // that is the proposal P5444-006
    expect(rootMatcher('framing', info)).toBeNull();
    expect(hasBlockScope('framing', info)).toBe(false);
    expect(hasBlockScope('rich', info)).toBe(true);
  });
});

describe('tagScope', () => {
  it('a block is the root and every deeper line after it', () => {
    const s = tagScope(page, '5444-006', { info });
    expect(s.roots).toEqual(idx(page, ['a1']));
    expect(s.blocks).toEqual([{ root: 1, end: 7 }]);
    expect([...s.covered].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.wholePage).toBe(false);
    expect(blockEnd(page, 1)).toBe(7);
    expect(blockEnd(page, 11)).toBe(12);
  });

  it('a nested root covers only itself and its own children, not its siblings', () => {
    const s = tagScope(page, 'tom', { info });
    // a3 (w/ Tom) with its child a4, and b2 (Thomas); not a5 (a sibling of a3), not b3 ("Tomorrow")
    expect(s.roots).toEqual(idx(page, ['a3', 'a4', 'b2']));
    expect(s.blocks).toEqual([{ root: 3, end: 5 }, { root: 9, end: 10 }]);   // a4 is inside a3's block
    expect([...s.covered].sort((a, b) => a - b)).toEqual([3, 4, 9]);
  });

  it('case-sensitive: "Rich update" heads a block, "rich mix" does not', () => {
    const s = tagScope(page, 'rich', { info });
    expect(s.matched).toEqual(idx(page, ['a1']));
  });

  it('no root: the tag covers the whole page', () => {
    const s = tagScope(page, 'loren', { info });
    expect(s.wholePage).toBe(true);
    expect(s.covered.size).toBe(page.length);
    expect(s.blocks).toEqual([]);
  });

  it('topics have no block scope', () => {
    expect(tagScope(page, 'framing', { info })).toBeNull();
    expect(pageScopes(page, ['framing', 'rich', '5444-006'], info)).toHaveProperty('rich');
    expect(Object.keys(pageScopes(page, ['framing', 'rich', '5444-006'], info))).toEqual(['rich', '5444-006']);
  });

  it('a hand add makes a root where the name is not written', () => {
    const s = tagScope(page, 'loren', { info, correction: { add: ['b0'] } });
    expect(s.wholePage).toBe(false);
    expect(s.added).toEqual(idx(page, ['b0']));
    expect([...s.covered].sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
  });

  it('a hand remove drops a root that matched by accident', () => {
    const s = tagScope(page, 'tom', { info, correction: { remove: ['b2'] } });
    expect(s.removed).toEqual(idx(page, ['b2']));
    expect(s.roots).toEqual(idx(page, ['a3', 'a4']));
    const all = tagScope(page, 'rich', { info, correction: { remove: ['a1'] } });
    expect(all.wholePage).toBe(true);   // nothing left: the whole page again
  });

  it('ids no longer on the page are ignored', () => {
    const s = tagScope(page, 'rich', { info, correction: { add: ['gone'], remove: ['gone-too'] } });
    expect(s.roots).toEqual(idx(page, ['a1']));
  });

  it('scope from transcriptionText equals scope from the lines (no corrections)', () => {
    const fromText = linesFromText(text(page));
    expect(fromText.map((l) => [l.text, l.indentLevel])).toEqual(page.map((l) => [l.text, l.indentLevel]));
    for (const tag of ['rich', 'tom', 'loren', '5444-006', '2327-018']) {
      const a = tagScope(page, tag, { info });
      const b = tagScope(fromText, tag, { info });
      expect({ ...b, covered: [...b.covered] }).toEqual({ ...a, covered: [...a.covered] });
    }
  });

  it('linesFromText: empty lines and empty text', () => {
    expect(linesFromText(null)).toEqual([]);
    expect(linesFromText('')).toEqual([]);
    expect(linesFromText('a\n  \n    b')).toEqual([
      { id: null, text: 'a', indentLevel: 0 },
      { id: null, text: '', indentLevel: 1 },
      { id: null, text: 'b', indentLevel: 2 }
    ]);
  });

  it('an empty line at the root’s level ends its block, from text and from lines alike', () => {
    const lines = [L('r', 'Rich', 0), L('k', 'kid', 1), L('e', '', 0), L('x', 'after', 1)];
    const a = tagScope(lines, 'rich', { info });
    const b = tagScope(linesFromText(text(lines)), 'rich', { info });
    expect([...a.covered]).toEqual([0, 1]);
    expect([...b.covered]).toEqual([0, 1]);
  });

  it('scopeLinesOf keeps only id, text and indent', () => {
    expect(scopeLinesOf([{ id: 'x', text: 'T', indentLevel: 1.7, checked: true, yBounds: {} }, null]))
      .toEqual([{ id: 'x', text: 'T', indentLevel: 1 }]);
  });
});

describe('coveredLineIds (for Phase E)', () => {
  it('takes lines and returns covered line ids per tag on the page', () => {
    expect(coveredLineIds(page, ['tom', 'framing'], info)).toEqual({ tom: ['a3', 'a4', 'b2'] });
    expect(coveredLineIds(page, ['tom'], info, { tom: { remove: ['b2'] } })).toEqual({ tom: ['a3', 'a4'] });
    expect(coveredLineIds(linesFromText(text(page)), ['tom'], info)).toEqual({ tom: [] });   // no ids
  });
});

describe('tasks in scope (D.3)', () => {
  const tasks = buildTaskSummary(page);
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const fromText = linesFromText(text(page));

  it('by the task’s own text, a head’s text, or the whole page', () => {
    const s = tagScope(fromText, 'rich', { info });
    expect(taskInScope(byId.a3, s, fromText, rootMatcher('rich', info), null)).toBe(true);   // under "Rich update"
    expect(taskInScope(byId.b2, s, fromText, rootMatcher('rich', info), null)).toBe(false);
    const t = tagScope(fromText, 'tom', { info });
    expect(taskInScope(byId.b2, t, fromText, rootMatcher('tom', info), null)).toBe(true);   // "Thomas" in its own text
    const w = tagScope(fromText, 'loren', { info });
    expect(taskInScope(byId.b2, w, fromText, rootMatcher('loren', info), null)).toBe(true);   // whole page
  });

  it('a hand-added root among its heads, and a removed one', () => {
    const add = { add: ['b0'] };
    const s = tagScope(fromText, 'rich', { info, correction: add });   // text lines: only "Rich update" is a root here
    expect(s.wholePage).toBe(false);
    expect(taskInScope(byId.b2, s, fromText, rootMatcher('rich', info), null)).toBe(false);
    expect(taskInScope(byId.b2, s, fromText, rootMatcher('rich', info), add)).toBe(true);   // b0 is among its heads
    const rm = { remove: ['b2'] };
    const t = tagScope(page, 'tom', { info, correction: rm });
    expect(taskInScope(byId.b2, t, fromText, rootMatcher('tom', info), rm)).toBe(false);
  });

  it('with lines that have ids, the covered ids decide', () => {
    const s = tagScope(page, 'loren', { info, correction: { add: ['b0'] } });
    expect(taskInScope(byId.b2, s, page, rootMatcher('loren', info), { add: ['b0'] })).toBe(true);
    expect(taskInScope(byId.a3, s, page, rootMatcher('loren', info), { add: ['b0'] })).toBe(false);
  });

  it('peopleForTasks: only Person tags on the page', () => {
    const m = peopleForTasks(tasks, fromText, ['rich', 'tom', '5444-006', 'framing'], info);
    expect(m.get('a3')).toEqual(['rich', 'tom']);
    expect(m.get('b2')).toEqual(['tom']);
    expect(peopleForTasks(tasks, fromText, ['5444-006'], info).size).toBe(0);
  });
});

describe('blocks for a tag page (D.2)', () => {
  const rec = (book, pageId, lines) => ({ book, page: Number(pageId), pageId, transcriptionText: text(lines) });

  it('blocksOf: root, children with depth, a whole-page entry', () => {
    const s = tagScope(page, '5444-006', { info });
    const [b] = blocksOf(page, s);
    expect(b.rootText).toBe('10:00 5444-006 Rich update');
    expect(b.children.map((c) => [c.text, c.depth])).toEqual([
      ['Stair stringers', 1], ['schedule coord. meeting w/ Tom', 2], ['Tom’s detail for the landing', 3],
      ['guard rail', 2], ['Compare with 2327-018', 1]
    ]);
    expect(blocksOf(page, s, 2)[0].more).toBe(3);
    expect(blocksOf(page, tagScope(page, 'loren', { info }))).toEqual([{ root: 0, rootText: '', children: [], more: 0, wholePage: true }]);
  });

  it('tagBlockEntries: newest page first, from the scan text; corrections need lines with ids', () => {
    const recs = [rec('3017', '170', page), rec('3017', '171', [L('z', 'Rich: call back', 0)]), rec('3017', '172', [])];
    const dates = new Map([['3017/170', { first: '2026-10-14', last: '2026-10-14', lastMs: 1 }], ['3017/171', { first: '2026-11-02', last: '2026-11-02', lastMs: 2 }]]);
    const out = tagBlockEntries(recs, { tag: 'rich', info, dates });
    expect(out.map((e) => [e.key, e.rootText])).toEqual([['3017/171', 'Rich: call back'], ['3017/170', '10:00 5444-006 Rich update']]);
    expect(out[0].rootId).toBeNull();
    const withLines = tagBlockEntries(recs, {
      tag: 'rich', info, dates, blocks: { '3017/170': { rich: { add: ['b0'] } } }, scopeLines: new Map([['3017/170', page]])
    });
    expect(withLines.filter((e) => e.key === '3017/170').map((e) => e.rootId)).toEqual(['a1', 'b0']);
    expect(tagBlockEntries(recs, { tag: 'framing', info })).toEqual([]);
  });

  it('mentionedNotTagged: names the person, page not tagged; never anything else', () => {
    const recs = [rec('3017', '170', page), rec('3017', '171', [L('z', 'rich mix', 0)]), rec('3017', '173', [L('y', 'Rich called', 0)])];
    const out = mentionedNotTagged(recs, 'rich', info, { '3017/170': ['rich'] });
    expect(out.map((m) => [m.key, m.line])).toEqual([['3017/173', 'Rich called']]);
    expect(mentionedNotTagged(recs, 'framing', info, {})).toEqual([]);
  });

  it('rootsOnLine: the tags a line heads, and whether by its text', () => {
    expect(rootsOnLine(page, 'a1', ['rich', '5444-006', 'tom'], info)).toEqual([
      { tag: 'rich', byText: true }, { tag: '5444-006', byText: true }
    ]);
    expect(rootsOnLine(page, 'b0', ['loren'], info, { loren: { add: ['b0'] } })).toEqual([{ tag: 'loren', byText: false }]);
    expect(rootsOnLine(page, 'nope', ['rich'], info)).toEqual([]);
  });
});

describe('transcriptionText: a line’s own leading spaces (v3.23.0)', () => {
  const main = mainFunctions(['buildTranscriptionText']);
  const lines = [
    L('r', 'Rich update', 0), L('k1', '  typed with spaces', 1), L('k2', '   three', 1), L('x', 'next', 0), L('e', '', 1)
  ];

  it('main and the renderer build the same text, without a line’s own leading spaces', () => {
    expect(main.buildTranscriptionText(lines)).toBe(buildTranscriptionText(lines));
    expect(buildTranscriptionText(lines)).toBe(['Rich update', '  typed with spaces', '  three', 'next', '  '].join('\n'));
    for (const input of [null, [], undefined]) expect(main.buildTranscriptionText(input)).toBe(buildTranscriptionText(input));
  });

  it('so every line reads back at its stored indent and the scope matches the lines', () => {
    const back = linesFromText(buildTranscriptionText(lines));
    expect(back.map((l) => l.indentLevel)).toEqual(lines.map((l) => l.indentLevel));
    const a = tagScope(lines, 'rich', { info });
    const b = tagScope(back, 'rich', { info });
    expect([...b.covered]).toEqual([...a.covered]);
  });
});
