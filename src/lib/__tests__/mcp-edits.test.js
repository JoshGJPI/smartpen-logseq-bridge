import { describe, it, expect } from 'vitest';
import {
  planEdits, untouchedChanged, formatEditListing, describeCounts, sameFolder, editRefusal, MAX_OPS
} from '../mcp-edits.js';

const line = (id, text, indentLevel = 0, extra = {}) => ({
  id, text, indentLevel, parentId: null, checked: null, yBounds: { minY: 1, maxY: 2 }, ...extra
});

// 3017/180-ish: a heading, a name MyScript misread, a sketch label, a task.
const page = () => [
  line('a', 'Prototyping Concrete Masonry Storm Shelters'),
  line('b', 'Brad Russell, AlA, P.E., S.E.', 1),
  line('c', 'Typical, A-Block, H-Block', 1),
  line('d', 'Is certification required?', 2),
  line('e', 'call Brad', 1, { checked: false }),
  line('f', '11/6/26'),
  line('g', 'notes from the call', 1),
];

let n = 0;
const newId = () => `new${++n}`;
const run = (edits, lines = page()) => planEdits(lines, edits, { newId });
const ids = (r) => r.lines.map((l) => l.id).join('');

describe('planEdits: set_text', () => {
  it('replaces the text of #n when expect matches', () => {
    const r = run([{ op: 'set_text', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', text: 'Brad Russell, AIA, P.E., S.E.' }]);
    expect(r.ok).toBe(true);
    expect(r.lines[1].text).toBe('Brad Russell, AIA, P.E., S.E.');
    expect(r.marks.get('b')).toBe('~');
    expect(r.counts).toEqual({ changed: 1, inserted: 0, deleted: 0, moved: 0 });
  });
  it('trims and joins newlines; refuses empty text and state words', () => {
    expect(run([{ op: 'set_text', line: 1, expect: page()[0].text, text: '  two\nrows ' }]).lines[0].text).toBe('two rows');
    expect(run([{ op: 'set_text', line: 1, expect: page()[0].text, text: '  ' }]).error).toMatch(/empty/);
    for (const w of ['WAITING on Brad', 'CANCELLED', 'DOING x', 'NOW: y', 'LATER z']) {
      expect(run([{ op: 'set_text', line: 1, expect: page()[0].text, text: w }]).error).toMatch(/task states are set in the app/);
    }
    expect(run([{ op: 'set_text', line: 1, expect: page()[0].text, text: 'Nowhere' }]).ok).toBe(true);
  });
  it('a typed box makes a plain line a task, but is only text on a task', () => {
    const plain = run([{ op: 'set_text', line: 3, expect: 'Typical, A-Block, H-Block', text: '[ ] order blocks' }]);
    expect(plain.lines[2]).toMatchObject({ text: 'order blocks', checked: false });
    const task = run([{ op: 'set_text', line: 5, expect: 'call Brad', text: 'DONE call Brad' }]);
    expect(task.lines[4]).toMatchObject({ text: 'DONE call Brad', checked: false });
  });
  it('a task\'s own label in front (as get_transcript prints it) is allowed in expect and dropped from text', () => {
    const r = run([{ op: 'set_text', line: 5, expect: 'TODO call Brad', text: 'TODO call Brad Russell' }]);
    expect(r.ok).toBe(true);
    expect(r.lines[4]).toMatchObject({ text: 'call Brad Russell', checked: false });
    const waiting = page();
    waiting[4] = { ...waiting[4], marker: 'WAITING' };
    const w = run([{ op: 'set_text', line: 5, expect: 'WAITING call Brad', text: 'WAITING call Brad today' }], waiting);
    expect(w.ok).toBe(true);
    expect(w.lines[4]).toMatchObject({ text: 'call Brad today', checked: false, marker: 'WAITING' });
    // another state's label is not the line's own: expect mismatches, text keeps it
    expect(run([{ op: 'set_text', line: 5, expect: 'DONE call Brad', text: 'x' }]).error).toMatch(/#5 reads/);
    // a plain line has no label to drop
    expect(run([{ op: 'set_text', line: 2, expect: 'TODO Brad Russell, AlA, P.E., S.E.', text: 'x' }]).error).toMatch(/#2 reads/);
    expect(run([{ op: 'delete', line: 5, expect: 'TODO call Brad', task_ok: true }]).ok).toBe(true);
  });
  it('refuses when expect does not match, or is missing', () => {
    expect(run([{ op: 'set_text', line: 2, expect: 'Brad Russell', text: 'x' }]).error).toMatch(/#2 reads "Brad Russell, AlA/);
    expect(run([{ op: 'set_text', line: 2, text: 'x' }]).error).toMatch(/expect .* is required/);
    expect(run([{ op: 'set_text', line: 99, expect: 'x', text: 'x' }]).error).toMatch(/no line #99/);
  });
});

describe('planEdits: set_indent', () => {
  it('moves the line and its subtree by the same amount', () => {
    const r = run([{ op: 'set_indent', line: 3, expect: 'Typical, A-Block, H-Block', level: 2 }]);
    expect(r.lines.map((l) => l.indentLevel)).toEqual([0, 1, 2, 3, 1, 0, 1]);
    expect(r.marks.get('d')).toBe('~');
  });
  it('with_children: false moves the line alone', () => {
    const r = run([{ op: 'set_indent', line: 3, expect: 'Typical, A-Block, H-Block', level: 0, with_children: false }]);
    expect(r.ok).toBe(false); // #4 at 2 under a line at 0
    const r2 = run([{ op: 'set_indent', line: 4, expect: 'Is certification required?', level: 1, with_children: false }]);
    expect(r2.lines[3].indentLevel).toBe(1);
  });
  it('keeps a line at most one deeper than the line above, and in 0–8', () => {
    expect(run([{ op: 'set_indent', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', level: 3 }]).error).toMatch(/more than one deeper/);
    expect(run([{ op: 'set_indent', line: 1, expect: page()[0].text, level: 1 }]).error).toMatch(/level 1/);
    expect(run([{ op: 'set_indent', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', level: 9 }]).error).toMatch(/0–8/);
    expect(run([{ op: 'set_indent', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', level: 1.5 }]).ok).toBe(false);
  });
  it('a no-op indent touches nothing', () => {
    const r = run([{ op: 'set_indent', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', level: 1 }]);
    expect(r.marks.size).toBe(0);
    expect(r.lines[1]).toEqual(page()[1]);
  });
});

describe('planEdits: move', () => {
  it('moves lines to the top in the order given (3017/180: the 11/6 meeting)', () => {
    const r = run([{ op: 'move', lines: [6, 7], expect_first: '11/6/26', to: 'top' }]);
    expect(ids(r)).toBe('fgabcde');
    expect(r.marks.get('f')).toBe('↕');
    expect(r.counts.moved).toBe(2);
  });
  it('to bottom, and after a line', () => {
    expect(ids(run([{ op: 'move', lines: [1, 2, 3, 4, 5], expect_first: page()[0].text, to: 'bottom' }]))).toBe('fgabcde');
    // a child left first on the page is caught
    expect(run([{ op: 'move', lines: [1], expect_first: page()[0].text, to: 'bottom' }]).error).toMatch(/#2 would be at level 1/);
    expect(ids(run([{ op: 'move', lines: [5], expect_first: 'call Brad', to: { after: 1 } }]))).toBe('aebcdfg');
  });
  it('refuses after one of the moving lines, a duplicate, or a bad target', () => {
    expect(run([{ op: 'move', lines: [6, 7], expect_first: '11/6/26', to: { after: 7 } }]).error).toMatch(/one of them/);
    expect(run([{ op: 'move', lines: [6, 6], expect_first: '11/6/26', to: 'top' }]).error).toMatch(/twice/);
    expect(run([{ op: 'move', lines: [6], expect_first: '11/6/26', to: 'middle' }]).error).toMatch(/to must be/);
    expect(run([{ op: 'move', lines: [6], expect_first: 'nope', to: 'top' }]).error).toMatch(/reads "11\/6\/26"/);
  });
  it('refuses a move that leaves a line two levels under the one above', () => {
    expect(run([{ op: 'move', lines: [4], expect_first: 'Is certification required?', to: 'top' }]).error)
      .toMatch(/more than one deeper/);
  });
});

describe('planEdits: insert', () => {
  it('inserts after #n with no ink and plain state', () => {
    const r = run([{ op: 'insert', after: 1, expect: page()[0].text, level: 1, text: 'Jason Thompson' }]);
    expect(r.lines[1]).toMatchObject({ text: 'Jason Thompson', indentLevel: 1, checked: null, yBounds: null });
    expect(r.marks.get(r.lines[1].id)).toBe('+');
    expect(r.counts.inserted).toBe(1);
  });
  it('after: 0 is the first line; a typed box makes a task', () => {
    const r = run([{ op: 'insert', after: 0, level: 0, text: 'TODO send notes' }]);
    expect(r.lines[0]).toMatchObject({ text: 'send notes', checked: false });
  });
  it('numbers refer to the transcript before the call', () => {
    const r = run([
      { op: 'insert', after: 0, level: 0, text: 'Header' },
      { op: 'set_text', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', text: 'Brad Russell, AIA, P.E., S.E.' },
    ]);
    expect(r.lines[2].text).toBe('Brad Russell, AIA, P.E., S.E.');
  });
  it('refuses a level too deep for where it lands', () => {
    expect(run([{ op: 'insert', after: 0, level: 1, text: 'x' }]).error).toMatch(/inserted line "x"/);
  });
});

describe('planEdits: delete', () => {
  it('removes the line and outdents its children one level', () => {
    const r = run([{ op: 'delete', line: 3, expect: 'Typical, A-Block, H-Block' }]);
    expect(ids(r)).toBe('abdefg');
    expect(r.lines[2]).toMatchObject({ id: 'd', indentLevel: 1 });
    expect(r.deleted).toEqual([{ n: 3, line: page()[2] }]);
    expect(r.counts).toEqual({ changed: 1, inserted: 0, deleted: 1, moved: 0 });
  });
  it('a task needs task_ok', () => {
    expect(run([{ op: 'delete', line: 5, expect: 'call Brad' }]).error).toMatch(/TODO task; pass task_ok/);
    expect(run([{ op: 'delete', line: 5, expect: 'call Brad', task_ok: true }]).ok).toBe(true);
  });
  it('a later op on a deleted line is refused', () => {
    expect(run([
      { op: 'delete', line: 3, expect: 'Typical, A-Block, H-Block' },
      { op: 'set_text', line: 3, expect: 'Typical, A-Block, H-Block', text: 'x' },
    ]).error).toMatch(/edit 2 .*deleted by an earlier edit/);
  });
});

describe('planEdits: the call as a whole', () => {
  it('is all-or-nothing and never mutates its input', () => {
    const src = page();
    const copy = JSON.parse(JSON.stringify(src));
    const r = planEdits(src, [
      { op: 'set_text', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', text: 'ok' },
      { op: 'set_text', line: 3, expect: 'wrong', text: 'x' },
    ], { newId });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^edit 2 \(set_text\)/) });
    expect(src).toEqual(copy);
  });
  it('refuses no edits, too many, an unknown op, an empty transcript', () => {
    expect(run([]).error).toMatch(/No edits/);
    const many = Array.from({ length: MAX_OPS + 1 }, () => ({ op: 'set_text', line: 1, expect: page()[0].text, text: 'x' }));
    expect(run(many).error).toMatch(/at most 60/);
    expect(run([{ op: 'retick', line: 1 }]).error).toMatch(/unknown op/);
    expect(run([{ op: 'insert', after: 0, level: 0, text: 'x' }], []).error).toMatch(/no transcript/);
  });
  it('untouched lines are the same objects', () => {
    const src = page();
    const r = planEdits(src, [{ op: 'set_text', line: 2, expect: src[1].text, text: 'x' }], { newId });
    for (const i of [0, 2, 3, 4, 5, 6]) expect(r.lines[i]).toBe(src[i]);
    expect(untouchedChanged(src, r.lines, r.touched)).toEqual([]);
  });
});

describe('untouchedChanged', () => {
  it('names an untouched line that changed or went missing, ignoring parentId and stray fields', () => {
    const src = page();
    const after = src.map((l) => ({ ...l, parentId: 'zz' }));
    after[2] = { ...after[2], text: 'changed' };
    after.pop();
    expect(untouchedChanged(src, after, new Set(['b']))).toEqual(['c', 'g']);
    const stray = [{ ...src[0], marker: 'WAITING' }]; // marker beside checked: null is dropped by the save
    expect(untouchedChanged(stray, [src[0]], new Set())).toEqual([]);
  });
});

describe('formatEditListing', () => {
  it('prints get_transcript bullets with marks, new numbers and deleted lines', () => {
    const r = run([
      { op: 'set_text', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', text: 'Brad Russell, AIA, P.E., S.E.' },
      { op: 'delete', line: 3, expect: 'Typical, A-Block, H-Block' },
      { op: 'move', lines: [6, 7], expect_first: '11/6/26', to: 'top' },
    ]);
    const out = formatEditListing(r);
    expect(out.split('\n').slice(0, 4)).toEqual([
      '↕  #1   - 11/6/26',
      '↕  #2     - notes from the call',
      '   #3   - Prototyping Concrete Masonry Storm Shelters',
      '~  #4     - Brad Russell, AIA, P.E., S.E.',
    ]);
    expect(out).toContain('   #6     - TODO call Brad');
    expect(out).toContain('Deleted:\n-  was #3    - Typical, A-Block, H-Block');
    expect(describeCounts(r.counts)).toBe('2 changed, 2 moved, 1 deleted');
  });
});

describe('sameFolder', () => {
  it('ignores case, slash direction and a trailing slash', () => {
    expect(sameFolder('C:\\Users\\joshg\\stroke-data', 'c:/users/joshg/stroke-data/')).toBe(true);
    expect(sameFolder('C:\\a', 'C:\\b')).toBe(false);
    expect(sameFolder('', '')).toBe(false);
  });
});

describe('editRefusal', () => {
  const ok = {
    appRoot: 'C:\\data', folderReady: true, requestRoot: 'C:/data', label: 'B3017/P180',
    editorOpen: false, draft: false, pendingTranscription: false, reset: false,
  };
  it('null when nothing stands in the way', () => {
    expect(editRefusal(ok)).toBeNull();
  });
  it('refuses each case with a reason', () => {
    expect(editRefusal({ ...ok, folderReady: false })).toMatch(/no data folder/);
    expect(editRefusal({ ...ok, requestRoot: 'D:\\other' })).toMatch(/MCP reads D:\\other/);
    expect(editRefusal({ ...ok, draft: true })).toMatch(/unsaved transcript edits in the Library/);
    expect(editRefusal({ ...ok, editorOpen: true })).toMatch(/open in a transcript editor/);
    expect(editRefusal({ ...ok, reset: true })).toMatch(/reset for re-transcription/);
    expect(editRefusal({ ...ok, pendingTranscription: true })).toMatch(/unsaved transcription in the Editor/);
  });
});
