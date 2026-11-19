/**
 * Tests for lib/tags.js: normalizing tags, the sidecar's maps and edits,
 * project-number suggestions, and what the Library derives from tags.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTag, isProjectTag, compareTags, normalizeTagList, tagKey, parseTagKey, recordTagKey,
  normalizeTagsFile, withPageList, addTagToKeys, removeTagFromKeys, renameTagInMap,
  deleteTagFromMap, tagExists, diffTagMaps, rollbackPatch, findProjectNumbers,
  suggestProjectNumbers, splitSuggestionLine, buildTagIndex, recordsForKeys, untaggedRecords,
  tagCards, untaggedCard, sortTagCards, tagStats, filterByTags, filterChoices, rankFilterChoices, tagOptions, tagEnterChoice, backspaceRemovesTag,
  parseTagSort, parseGroupBy, planTagCarry, MAX_TAG_LENGTH,
  parseTagView, parseCollapsedGroups, parseTagPageSort, sortTagPageTiles,
  normalizeTagInfo, tagTypeOf, tagLabel, projectKind, tagNames, tagAnswersTo, withTagInfo, withTagType,
  renameTagInfo, deleteTagInfo, diffTagInfo, rollbackInfoPatch, groupByTagType, createRows, sortTagStats,
  TAG_TYPES, TAG_GROUP_LABELS, MAX_INFO_TEXT, MAX_INFO_NOTE, MAX_ALIASES, renameIsMerge, withInfoOnlyTags
} from '$lib/tags.js';

const rec = (book, pageId, extra = {}) => ({
  book: String(book),
  pageId: String(pageId),
  page: parseInt(pageId, 10),
  suffix: String(pageId).replace(/^\d+/, ''),
  ...extra
});
const byKey = (records) => new Map(records.map((r) => [`${r.book}/${r.pageId}`, r]));

describe('normalizeTag', () => {
  it('normalizes project numbers: capital P, plain hyphen, no brackets or spaces', () => {
    expect(normalizeTag('P2026-141')).toBe('P2026-141');
    expect(normalizeTag('p2026-141')).toBe('P2026-141');
    expect(normalizeTag('P2026–141')).toBe('P2026-141'); // en dash
    expect(normalizeTag('P2026—141')).toBe('P2026-141'); // em dash
    expect(normalizeTag('P2026−141')).toBe('P2026-141'); // minus sign
    expect(normalizeTag('P 2026-141')).toBe('P2026-141');
    expect(normalizeTag('  p 2026 - 141 ')).toBe('P2026-141');
    expect(normalizeTag('[[P2026-141]]')).toBe('P2026-141');
    expect(normalizeTag('2327-018')).toBe('2327-018');
    expect(normalizeTag('[[2327-018]]')).toBe('2327-018');
  });

  it('does not turn letters into digits, so P2O26-141 is a keyword', () => {
    expect(normalizeTag('P2O26-141')).toBe('p2o26-141');
    expect(isProjectTag(normalizeTag('P2O26-141'))).toBe(false);
  });

  it('normalizes keywords: lowercase, whitespace to dash, limited characters', () => {
    expect(normalizeTag('Beam')).toBe('beam');
    expect(normalizeTag('  site   visit ')).toBe('site-visit');
    expect(normalizeTag('RFI #3!')).toBe('rfi-3');
    expect(normalizeTag('roof_framing')).toBe('roof_framing');
    expect(normalizeTag('Café')).toBe('cafe');
    expect(normalizeTag('#beam')).toBe('beam');
    expect(normalizeTag('[[beam]]')).toBe('beam');
    expect(normalizeTag('a -- b')).toBe('a-b');
  });

  it(`caps keywords at ${MAX_TAG_LENGTH} characters without a trailing dash`, () => {
    const long = 'x'.repeat(60);
    expect(normalizeTag(long)).toHaveLength(MAX_TAG_LENGTH);
    expect(normalizeTag(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
  });

  it('rejects what is empty after normalizing', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('!!!')).toBeNull();
    expect(normalizeTag('---')).toBeNull();
    expect(normalizeTag('[[]]')).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
    expect(normalizeTag({})).toBeNull();
  });

  it('accepts a number', () => {
    expect(normalizeTag(42)).toBe('42');
  });
});

describe('isProjectTag / compareTags / normalizeTagList', () => {
  it('knows project numbers', () => {
    expect(isProjectTag('P2026-141')).toBe(true);
    expect(isProjectTag('2327-018')).toBe(true);
    expect(isProjectTag('p2026-141')).toBe(false); // not normalized
    expect(isProjectTag('beam')).toBe(false);
    expect(isProjectTag(null)).toBe(false);
  });

  it('sorts project numbers first, then keywords, de-duplicated', () => {
    expect(normalizeTagList(['beam', 'P2026-141', 'Beam', 'footing', 'p2026-141', '2327-018', '', null]))
      .toEqual(['2327-018', 'P2026-141', 'beam', 'footing']);
    expect([...['b', 'P2026-141', 'a']].sort(compareTags)).toEqual(['P2026-141', 'a', 'b']);
  });

  it('a list that is not an array is empty', () => {
    expect(normalizeTagList('beam')).toEqual([]);
    expect(normalizeTagList(undefined)).toEqual([]);
  });
});

describe('page keys', () => {
  it('builds and parses keys for volumes and suffixed pages', () => {
    expect(tagKey('388v2', '151b')).toBe('388v2/151b');
    expect(tagKey('3017', 42)).toBe('3017/42');
    expect(parseTagKey('388v2/151b')).toEqual({ book: '388v2', pageId: '151b' });
  });

  it('refuses keys that are not pages', () => {
    expect(tagKey('388v1', '4')).toBeNull();
    expect(tagKey('388', '../x')).toBeNull();
    expect(tagKey(null, '1')).toBeNull();
    expect(parseTagKey('B388/1')).toBeNull();
  });

  it('keys a scan record by its pageId', () => {
    expect(recordTagKey(rec('388v2', '151b'))).toBe('388v2/151b');
    expect(recordTagKey({ book: '388', page: 7 })).toBe('388/7');
    expect(recordTagKey(null)).toBeNull();
  });
});

describe('normalizeTagsFile', () => {
  it('keeps valid keys and normalized, non-empty lists', () => {
    expect(normalizeTagsFile({
      version: 1,
      pages: { '3017/42': ['beam', 'p2026-141'], '388v2/7': ['2327-018'], '388v1/2': ['x'], 'junk': ['y'], '1/1': [] },
      dismissed: { '3017/42': ['2327-018'], '3017/43': 'nope' }
    })).toEqual({
      pages: { '3017/42': ['P2026-141', 'beam'], '388v2/7': ['2327-018'] },
      dismissed: { '3017/42': ['2327-018'] },
      info: {}
    });
  });

  it('missing, corrupt or wrongly shaped input is empty', () => {
    const empty = { pages: {}, dismissed: {}, info: {} };
    expect(normalizeTagsFile(null)).toEqual(empty);
    expect(normalizeTagsFile('garbage')).toEqual(empty);
    expect(normalizeTagsFile({ pages: [] })).toEqual(empty);
    expect(normalizeTagsFile({})).toEqual(empty);
  });
});

describe('edits', () => {
  const base = { '388/1': ['beam'], '388/2': ['beam', 'footing'], '388v2/151b': ['P2026-141'] };

  it('withPageList sets, normalizes, and removes an emptied page', () => {
    expect(withPageList(base, '388/3', ['Roof'])['388/3']).toEqual(['roof']);
    expect('388/1' in withPageList(base, '388/1', [])).toBe(false);
    expect(base['388/1']).toEqual(['beam']); // input untouched
  });

  it('adds and removes a tag across pages', () => {
    const added = addTagToKeys(base, ['388/1', '388/3'], 'P2026-141');
    expect(added['388/1']).toEqual(['P2026-141', 'beam']);
    expect(added['388/3']).toEqual(['P2026-141']);
    const removed = removeTagFromKeys(added, ['388/1', '388/2', '388/3'], 'beam');
    expect(removed['388/1']).toEqual(['P2026-141']);
    expect(removed['388/2']).toEqual(['footing']);
    expect(removed['388/3']).toEqual(['P2026-141']);
  });

  it('an invalid tag changes nothing', () => {
    expect(addTagToKeys(base, ['388/1'], '!!!')).toBe(base);
    expect(removeTagFromKeys(base, ['388/1'], '')).toBe(base);
  });

  it('renames, and renaming onto an existing tag merges', () => {
    expect(renameTagInMap(base, 'beam', 'beams')['388/2']).toEqual(['beams', 'footing']);
    const merged = renameTagInMap(base, 'footing', 'beam');
    expect(merged['388/2']).toEqual(['beam']);
    expect(tagExists(merged, 'footing')).toBe(false);
    expect(renameTagInMap(base, 'beam', 'beam')).toBe(base);
  });

  it('deletes a tag everywhere, dropping emptied pages', () => {
    const next = deleteTagFromMap(base, 'P2026-141');
    expect('388v2/151b' in next).toBe(false);
    expect(next['388/1']).toEqual(['beam']);
  });

  it('diffs two maps into a patch', () => {
    const next = { ...base, '388/1': ['beam', 'roof'], '388/9': ['x'] };
    delete next['388/2'];
    expect(diffTagMaps(base, next)).toEqual({ '388/1': ['beam', 'roof'], '388/2': null, '388/9': ['x'] });
    expect(diffTagMaps(base, base)).toEqual({});
  });

  it('rollback restores only pages the failed write still owns', () => {
    const prev = { '388/1': ['beam'] };
    const patch = { '388/1': ['beam', 'roof'], '388/2': ['x'] };
    // 388/2 changed again after the failed write: leave it.
    const now = { '388/1': ['beam', 'roof'], '388/2': ['y'] };
    expect(rollbackPatch(now, patch, prev)).toEqual({ '388/1': ['beam'], '388/2': ['y'] });
    // A removal is undone too.
    expect(rollbackPatch({}, { '388/1': null }, prev)).toEqual({ '388/1': ['beam'] });
  });
});

describe('suggestProjectNumbers', () => {
  const lines = (...texts) => texts.map((text, i) => ({ id: `l${i}`, text }));
  const tags = (ls, opts) => suggestProjectNumbers(ls, opts).map((s) => s.tag);

  it('matches every form in the mockup 2 table', () => {
    expect(tags(lines('Call re P2026-141 roof'))).toEqual(['P2026-141']);
    expect(tags(lines('Follow up 2327-018 RFI'))).toEqual(['2327-018']);
    expect(tags(lines('p2026-141'))).toEqual(['P2026-141']);
    expect(tags(lines('P2026–141'))).toEqual(['P2026-141']);
    expect(tags(lines('P 2026-141'))).toEqual(['P2026-141']);
    expect(tags(lines('see [[P2026-141]]'))).toEqual(['P2026-141']);
  });

  it('rejects dates, phone numbers, longer digit runs and letters for digits', () => {
    expect(tags(lines('2026-10-21'))).toEqual([]);
    expect(tags(lines('call 555-1234'))).toEqual([]);
    expect(tags(lines('12345-678'))).toEqual([]);
    expect(tags(lines('2327-0189'))).toEqual([]);
    expect(tags(lines('P2O26-141'))).toEqual([]);
    expect(tags(lines('AP2026-141'))).toEqual([]);
    expect(tags(lines('x2327-018'))).toEqual([]);
  });

  it('one suggestion per number, first line shown, with where it matched', () => {
    const out = suggestProjectNumbers(lines('nothing', '  re P2026-141 beam', 'again p2026–141', '2327-018'));
    expect(out.map((s) => [s.tag, s.lineId])).toEqual([['P2026-141', 'l1'], ['2327-018', 'l3']]);
    expect(out[0].line).toBe('re P2026-141 beam');
    expect(out[0].line.slice(out[0].start, out[0].end)).toBe('P2026-141');
  });

  it('two numbers on one line are both offered', () => {
    expect(tags(lines('P2026-141 and 2327-018'))).toEqual(['P2026-141', '2327-018']);
  });

  it('excludes tags already on the page and dismissed ones', () => {
    const ls = lines('P2026-141, 2327-018, 2412-007');
    expect(tags(ls, { exclude: ['P2026-141', '2412-007'] })).toEqual(['2327-018']);
  });

  it('reads a scan record\'s transcription text (no line ids)', () => {
    const out = suggestProjectNumbers('line one\n  indented 2327-018');
    expect(out).toEqual([{ tag: '2327-018', lineId: null, line: 'indented 2327-018', start: 9, end: 17 }]);
  });

  it('a page with no transcript has no suggestions', () => {
    expect(suggestProjectNumbers([])).toEqual([]);
    expect(suggestProjectNumbers(null)).toEqual([]);
    expect(suggestProjectNumbers('')).toEqual([]);
    expect(suggestProjectNumbers([{ id: 'a' }, null])).toEqual([]);
  });

  it('findProjectNumbers reports positions', () => {
    expect(findProjectNumbers('x P2026-141')).toEqual([{ tag: 'P2026-141', start: 2, end: 11 }]);
    expect(findProjectNumbers(null)).toEqual([]);
  });

  it('splits a line around the number, trimming long lines', () => {
    const [s] = suggestProjectNumbers(lines('Call re P2026-141 now'));
    expect(splitSuggestionLine(s)).toEqual({ before: 'Call re ', match: 'P2026-141', after: ' now' });
    const [l] = suggestProjectNumbers(lines(`${'a'.repeat(100)} 2327-018 ${'b'.repeat(100)}`));
    const parts = splitSuggestionLine(l, 40);
    expect(parts.match).toBe('2327-018');
    expect(parts.before.startsWith('…')).toBe(true);
    expect(parts.after.endsWith('…')).toBe(true);
  });
});

describe('derived data', () => {
  const records = [rec('388', '1'), rec('388', '2'), rec('388v2', '151b'), rec('3017', '42'), rec('3017', '43')];
  const map = { '388/1': ['beam'], '388v2/151b': ['beam', 'P2026-141'], '3017/42': ['P2026-141'], '999/1': ['beam'] };
  const dates = new Map([['388/1', { lastMs: 100 }], ['388v2/151b', { lastMs: 300 }], ['3017/42', { lastMs: 200 }]]);

  it('indexes tag → keys', () => {
    const index = buildTagIndex(map);
    expect(index.get('beam')).toEqual(['388/1', '388v2/151b', '999/1']);
    expect(index.get('P2026-141')).toEqual(['388v2/151b', '3017/42']);
    expect(buildTagIndex({}).size).toBe(0);
  });

  it('records under a tag skip pages no longer on disk, in reading order', () => {
    const out = recordsForKeys(['3017/42', '999/1', '388v2/151b', '388/1'], byKey(records));
    expect(out.map((r) => `${r.book}/${r.pageId}`)).toEqual(['388/1', '388v2/151b', '3017/42']);
  });

  it('untagged pages are the scan minus tagged keys', () => {
    expect(untaggedRecords(records, map).map((r) => `${r.book}/${r.pageId}`)).toEqual(['388/2', '3017/43']);
    expect(untaggedRecords(records, {})).toHaveLength(5);
    const card = untaggedCard(records, map, dates);
    expect(card.pageCount).toBe(2);
    expect(card.notebookCount).toBe(2);
  });

  it('tag cards count pages and notebooks, fan newest first', () => {
    const cards = tagCards(buildTagIndex(map), byKey(records), dates);
    const beam = cards.find((c) => c.tag === 'beam');
    expect(beam).toMatchObject({ pageCount: 2, notebookCount: 2, project: false, lastMs: 300 });
    expect(beam.fan.map((r) => r.pageId)).toEqual(['151b', '1']);
    expect(cards.find((c) => c.tag === 'P2026-141')).toMatchObject({ project: true, pageCount: 2 });
  });

  it('a tag only on missing pages has no card', () => {
    expect(tagCards(buildTagIndex({ '999/1': ['ghost'] }), byKey(records))).toEqual([]);
  });

  it('sorts cards by pages, name or recency', () => {
    const cards = [
      { tag: 'b', pageCount: 2, lastMs: 10 },
      { tag: 'a', pageCount: 2, lastMs: null },
      { tag: 'P2026-141', pageCount: 5, lastMs: 5 }
    ];
    expect(sortTagCards(cards, 'pages').map((c) => c.tag)).toEqual(['P2026-141', 'a', 'b']);
    expect(sortTagCards(cards, 'name').map((c) => c.tag)).toEqual(['P2026-141', 'a', 'b']);
    expect(sortTagCards(cards, 'recent').map((c) => c.tag)).toEqual(['b', 'P2026-141', 'a']);
    expect(sortTagCards(null, 'name')).toEqual([]);
  });

  it('tag stats come from the sidecar alone', () => {
    expect(tagStats(map)).toEqual([
      { tag: 'beam', pages: 3, notebooks: 3 },
      { tag: 'P2026-141', pages: 2, notebooks: 2 }
    ]);
  });

  it('parses stored display choices', () => {
    expect(parseTagSort('name')).toBe('name');
    expect(parseTagSort('bogus')).toBe('pages');
    expect(parseGroupBy('tag')).toBe('tag');
    expect(parseGroupBy(null)).toBe('book');
  });
});

describe('filters', () => {
  const items = [
    { id: 1, tags: ['beam', 'calc'] },
    { id: 2, tags: ['beam', 'footing'] },
    { id: 3, tags: ['footing'] },
    { id: 4, tags: [] }
  ];
  const ids = (list) => list.map((i) => i.id);

  it('any = at least one chosen tag, all = every chosen tag', () => {
    expect(ids(filterByTags(items, ['calc', 'footing'], 'any'))).toEqual([1, 2, 3]);
    expect(ids(filterByTags(items, ['beam', 'footing'], 'all'))).toEqual([2]);
    expect(ids(filterByTags(items, [], 'all'))).toEqual([1, 2, 3, 4]);
    expect(filterByTags(null, ['x'])).toEqual([]);
  });

  it('offers tags in the grid with counts, minus chosen', () => {
    expect(filterChoices(items, ['beam'], 'any')).toEqual([
      { tag: 'calc', count: 1 }, { tag: 'footing', count: 2 }
    ]);
    expect(filterChoices(items, [], 'any')).toEqual([
      { tag: 'beam', count: 2 }, { tag: 'calc', count: 1 }, { tag: 'footing', count: 2 }
    ]);
  });

  it('in all mode only tags that still match, so the grid cannot be emptied', () => {
    expect(filterChoices(items, ['calc'], 'all')).toEqual([{ tag: 'beam', count: 1 }]);
    for (const { tag } of filterChoices(items, ['beam'], 'all')) {
      expect(filterByTags(items, ['beam', tag], 'all').length).toBeGreaterThan(0);
    }
  });
});

describe('tag field: Enter adds what was typed (G1), Backspace once per press (G3)', () => {
  const stats = [{ tag: 'beam-check', pages: 14 }, { tag: 'beam', pages: 6 }, { tag: 'beams', pages: 2 }];

  it('lists the exact tag first even when a longer one is used more', () => {
    expect(tagOptions('beam', stats).options.map((o) => o.tag)).toEqual(['beam', 'beam-check', 'beams']);
    expect(tagOptions('Beam', stats).options[0].tag).toBe('beam');
  });

  it('Enter without ↑ ↓ adds exactly the typed tag, never a longer match', () => {
    const items = tagOptions('beam', stats).options;
    expect(tagEnterChoice(items, 0, false, 'beam')).toBe('beam');
    const only = [{ tag: 'beams', pages: 2 }];
    expect(tagEnterChoice(only, 0, false, 'beam')).toBe('beam');
    expect(tagEnterChoice([], 0, false, 'p2026-141')).toBe('P2026-141');
  });

  it('Enter after ↑ ↓ adds the highlighted row', () => {
    const items = tagOptions('beam', stats).options;
    expect(tagEnterChoice(items, 1, true, 'beam')).toBe('beam-check');
  });

  it('Enter on text that is no tag adds nothing', () => {
    expect(tagEnterChoice([], 0, false, '  ')).toBeNull();
    expect(tagEnterChoice([], 0, false, '??')).toBeNull();
  });

  it('input that normalizes to nothing lists no tags', () => {
    expect(tagOptions('??', stats)).toEqual({ options: [], create: null });
  });

  it('Backspace removes a tag only on a fresh press in an empty field', () => {
    expect(backspaceRemovesTag({ key: 'Backspace', repeat: false }, '')).toBe(true);
    expect(backspaceRemovesTag({ key: 'Backspace', repeat: true }, '')).toBe(false);
    expect(backspaceRemovesTag({ key: 'Backspace', repeat: false }, 'b')).toBe(false);
    expect(backspaceRemovesTag({ key: 'Delete', repeat: false }, '')).toBe(false);
  });
});

describe('tagOptions (type-ahead)', () => {
  const stats = [{ tag: 'beam', pages: 14 }, { tag: 'P2026-141', pages: 8 }, { tag: 'footing', pages: 9 }];

  it('lists existing tags most-used first, minus those on the page', () => {
    expect(tagOptions('', stats, ['footing']).options.map((o) => o.tag)).toEqual(['beam', 'P2026-141']);
    expect(tagOptions('', stats).create).toBeNull();
  });

  it('filters by the typed text and offers to create a new tag', () => {
    expect(tagOptions('be', stats)).toEqual({ options: [{ tag: 'beam', pages: 14 }], create: 'be' });
    expect(tagOptions('Beam', stats).create).toBeNull();
    expect(tagOptions('p2026-141', stats)).toEqual({ options: [{ tag: 'P2026-141', pages: 8 }], create: null });
    expect(tagOptions('!!', stats).create).toBeNull();
  });
});

describe('planTagCarry (volume moves)', () => {
  const move = { fromBook: '390', fromPage: 12, toBook: '390v2', toPage: 12 };

  it('moves an emptied page’s tags and dismissals to a target that has none', () => {
    const out = planTagCarry({ pages: { '390/12': ['beam'] }, dismissed: { '390/12': ['2327-018'] } }, [move]);
    expect(out).toEqual({
      pages: { '390v2/12': ['beam'] },
      dismissed: { '390v2/12': ['2327-018'] },
      carried: ['390/12']
    });
  });

  it('never overwrites the target’s own tags', () => {
    const maps = { pages: { '390/12': ['beam'], '390v2/12': ['roof'] }, dismissed: {} };
    const out = planTagCarry(maps, [move]);
    expect(out.pages).toEqual(maps.pages);
    expect(out.carried).toEqual([]);
  });

  it('ignores untagged sources, bad keys and repeated moves', () => {
    expect(planTagCarry({ pages: {}, dismissed: {} }, [move]).carried).toEqual([]);
    expect(planTagCarry({ pages: { '390/12': ['a'] } }, [{ ...move, toBook: '390v1' }]).carried).toEqual([]);
    const twice = planTagCarry({ pages: { '390/12': ['a'] }, dismissed: {} }, [move, move]);
    expect(twice.pages).toEqual({ '390v2/12': ['a'] });
    expect(planTagCarry({ pages: {} }, null).carried).toEqual([]);
  });
});

describe('tag manager column sort (v3.2.0)', () => {
  const rows = [
    { tag: 'beam', pages: 3, notebooks: 1 },
    { tag: 'P2026-141', pages: 3, notebooks: 2 },
    { tag: 'slab', pages: 7, notebooks: 1 },
    { tag: '2327-018', pages: 1, notebooks: 3 }
  ];
  const tags = (list) => list.map((r) => r.tag);

  it('defaults to most pages first; a bad stored value falls back', async () => {
    const { parseTagStatSort } = await import('$lib/tags.js');
    expect(parseTagStatSort(null)).toEqual({ by: 'pages', dir: 'desc' });
    expect(parseTagStatSort({ by: 'colour', dir: 'up' })).toEqual({ by: 'pages', dir: 'desc' });
    expect(parseTagStatSort({ by: 'tag' })).toEqual({ by: 'tag', dir: 'asc' });
    expect(parseTagStatSort({ by: 'notebooks', dir: 'asc' })).toEqual({ by: 'notebooks', dir: 'asc' });
  });

  it('a header click flips the same column, starts another in its natural direction', async () => {
    const { nextTagStatSort } = await import('$lib/tags.js');
    expect(nextTagStatSort({ by: 'pages', dir: 'desc' }, 'pages')).toEqual({ by: 'pages', dir: 'asc' });
    expect(nextTagStatSort({ by: 'pages', dir: 'asc' }, 'pages')).toEqual({ by: 'pages', dir: 'desc' });
    expect(nextTagStatSort({ by: 'pages', dir: 'asc' }, 'tag')).toEqual({ by: 'tag', dir: 'asc' });
    expect(nextTagStatSort({ by: 'tag', dir: 'asc' }, 'notebooks')).toEqual({ by: 'notebooks', dir: 'desc' });
    expect(nextTagStatSort({ by: 'tag', dir: 'desc' }, 'actions')).toEqual({ by: 'tag', dir: 'desc' });
  });

  it('sorts by name (project numbers first), and by counts with ties by name', async () => {
    const { sortTagStats } = await import('$lib/tags.js');
    expect(tags(sortTagStats(rows, { by: 'tag', dir: 'asc' }))).toEqual(['2327-018', 'P2026-141', 'beam', 'slab']);
    expect(tags(sortTagStats(rows, { by: 'tag', dir: 'desc' }))).toEqual(['slab', 'beam', 'P2026-141', '2327-018']);
    expect(tags(sortTagStats(rows, { by: 'pages', dir: 'desc' }))).toEqual(['slab', 'P2026-141', 'beam', '2327-018']);
    expect(tags(sortTagStats(rows, { by: 'pages', dir: 'asc' }))).toEqual(['2327-018', 'P2026-141', 'beam', 'slab']);
    expect(tags(sortTagStats(rows, { by: 'notebooks', dir: 'desc' }))).toEqual(['2327-018', 'P2026-141', 'beam', 'slab']);
  });

  it('never reorders its input; empty is empty', async () => {
    const { sortTagStats } = await import('$lib/tags.js');
    const copy = [...rows];
    sortTagStats(rows, { by: 'tag', dir: 'asc' });
    expect(rows).toEqual(copy);
    expect(sortTagStats(null, { by: 'pages', dir: 'desc' })).toEqual([]);
  });
});

describe('tag home display (v3.11.0)', () => {
  it('parseTagView: pills only when stored, cards otherwise', () => {
    expect(parseTagView('pills')).toBe('pills');
    expect(parseTagView('cards')).toBe('cards');
    expect(parseTagView(null)).toBe('cards');
    expect(parseTagView('grid')).toBe('cards');
  });

  it('parseCollapsedGroups keeps known groups once, in group order', () => {
    expect(parseCollapsedGroups(['topic', 'project', 'topic', 'x'])).toEqual(['project', 'topic']);
    expect(parseCollapsedGroups(['person'])).toEqual(['person']);
    expect(parseCollapsedGroups([])).toEqual([]);
    expect(parseCollapsedGroups('projects')).toEqual([]);
    expect(parseCollapsedGroups(null)).toEqual([]);
  });
});

describe('sortTagPageTiles (v3.11.0)', () => {
  const tile = (book, pageId, lastMs) => ({ record: rec(book, pageId), pageId: String(pageId), lastMs });
  const ids = (list) => list.map((t) => `${t.record.book}/${t.pageId}`);

  it('parseTagPageSort defaults to notebook', () => {
    expect(parseTagPageSort('recent')).toBe('recent');
    expect(parseTagPageSort('notebook')).toBe('notebook');
    expect(parseTagPageSort(undefined)).toBe('notebook');
    expect(parseTagPageSort('page-asc')).toBe('notebook');
  });

  it('notebook: book key (volumes after their book), then page and suffix', () => {
    const tiles = [tile('388v2', 1, 5), tile('3880', 2, 1), tile('388', 151, 3), tile('388', 12, 9), tile('388', '151b', 2)];
    expect(ids(sortTagPageTiles(tiles, 'notebook'))).toEqual(['388/12', '388/151', '388/151b', '388v2/1', '3880/2']);
  });

  it('recent: latest stroke first across notebooks; ties and untimed pages in notebook order, untimed last', () => {
    const tiles = [tile('390', 4, null), tile('388', 2, 100), tile('390', 1, 300), tile('388', 9, 300), tile('388', 1, undefined)];
    expect(ids(sortTagPageTiles(tiles, 'recent'))).toEqual(['388/9', '390/1', '388/2', '388/1', '390/4']);
  });

  it('returns a new array and copes with empty input', () => {
    const tiles = [tile('388', 2, 1), tile('388', 1, 2)];
    const copy = [...tiles];
    sortTagPageTiles(tiles, 'recent');
    expect(tiles).toEqual(copy);
    expect(sortTagPageTiles(null, 'notebook')).toEqual([]);
  });
});

describe('rankFilterChoices (v3.14.0)', () => {
  const items = [
    { tags: ['2237-011', 'beam'], lastMs: 300 },
    { tags: ['5444-006'], lastMs: 500 },
    { tags: ['beam'], lastMs: 100 },
    { tags: ['zeta'], lastMs: null },
    { tags: ['alpha'] }
  ];
  const choices = [
    { tag: '2237-011', count: 1 }, { tag: '5444-006', count: 1 }, { tag: 'alpha', count: 1 },
    { tag: 'beam', count: 2 }, { tag: 'zeta', count: 1 }
  ];

  it('newest written first, by the newest page carrying the tag; a tie goes to the bigger count', () => {
    expect(rankFilterChoices(choices, items).map((c) => c.tag).slice(0, 3)).toEqual(['5444-006', 'beam', '2237-011']);
  });

  it('undated tags last, by count then name', () => {
    expect(rankFilterChoices(choices, items).map((c) => c.tag).slice(3)).toEqual(['alpha', 'zeta']);
  });

  it('leaves the input alone and handles empty input', () => {
    const copy = [...choices];
    rankFilterChoices(choices, items);
    expect(choices).toEqual(copy);
    expect(rankFilterChoices([], items)).toEqual([]);
    expect(rankFilterChoices(null, null)).toEqual([]);
  });
});

/* ============================================================
 *  Tag types and details (v3.22.0, spec Phase C)
 * ============================================================ */

describe('normalizeTagInfo (v3.22.0)', () => {
  it('keeps a person\'s fields, capitals and all', () => {
    expect(normalizeTagInfo('tom', {
      type: 'person', label: '  Tom ', aliases: ['Thomas', ' Tom B. ', 'Thomas', '', 7], company: 'Burnell', note: ' PM ', junk: 1
    })).toEqual({ type: 'person', label: 'Tom', aliases: ['Thomas', 'Tom B.'], company: 'Burnell', note: 'PM' });
  });

  it('aliases keep case: "Rich" and "rich" are two aliases; the label itself is dropped', () => {
    expect(normalizeTagInfo('rich', { type: 'person', label: 'Rich', aliases: ['Rich', 'rich', 'RICH'] }))
      .toEqual({ type: 'person', label: 'Rich', aliases: ['rich', 'RICH'] });
  });

  it('a topic never stores a type, and drops a person\'s company', () => {
    expect(normalizeTagInfo('framing', { type: 'topic', aliases: ['framed'], company: 'x' })).toEqual({ aliases: ['framed'] });
    expect(normalizeTagInfo('framing', { type: 'project', label: 'Framing' })).toEqual({ label: 'Framing' });
  });

  it('a project number never stores a type or label; a proposal may name its job', () => {
    expect(normalizeTagInfo('5444-006', { type: 'person', label: 'X', name: 'Stair', client: 'Acme', active: true, job: '2327-018' }))
      .toEqual({ name: 'Stair', client: 'Acme', active: true });
    expect(normalizeTagInfo('P2026-141', { job: '2327–018', active: false })).toEqual({ active: false, job: '2327-018' });
    expect(normalizeTagInfo('P2026-141', { job: 'P2026-001' })).toBeNull();
    expect(normalizeTagInfo('P2026-141', { active: 'yes' })).toBeNull();
  });

  it('a label equal to the tag, empty records and bad keys give null', () => {
    expect(normalizeTagInfo('tom', { label: 'tom' })).toBeNull();
    expect(normalizeTagInfo('tom', {})).toBeNull();
    expect(normalizeTagInfo('Tom', { type: 'person' })).toBeNull();   // keys are normalized tags
    expect(normalizeTagInfo('tom', null)).toBeNull();
    expect(normalizeTagInfo('tom', ['person'])).toBeNull();
    expect(normalizeTagInfo('tom', { type: 'person' })).toEqual({ type: 'person' });
  });

  it('long text, many aliases and long notes are capped', () => {
    const rec = normalizeTagInfo('tom', {
      label: 'x'.repeat(200), aliases: Array.from({ length: 40 }, (_, i) => `a${i}`), note: 'n'.repeat(900)
    });
    expect(rec.label.length).toBe(MAX_INFO_TEXT);
    expect(rec.aliases).toHaveLength(MAX_ALIASES);
    expect(rec.note.length).toBe(MAX_INFO_NOTE);
  });

  it('normalizeTagsFile reads the info section, dropping bad keys and empty records', () => {
    const out = normalizeTagsFile({
      pages: {}, dismissed: {},
      info: { tom: { type: 'person', label: 'Tom' }, 'Not A Key': { label: 'x' }, empty: {}, '5444-006': { name: 'Stair' } }
    });
    expect(out.info).toEqual({ tom: { type: 'person', label: 'Tom' }, '5444-006': { name: 'Stair' } });
    expect(normalizeTagsFile({ info: [] }).info).toEqual({});
  });
});

describe('tag types and labels (v3.22.0)', () => {
  const info = { tom: { type: 'person', label: 'Tom', aliases: ['Thomas'] }, framing: { label: 'Framing', aliases: ['framed'] } };

  it('type: project by the pattern, person by info, topic by default', () => {
    expect(tagTypeOf('5444-006', info)).toBe('project');
    expect(tagTypeOf('P2026-141', { 'P2026-141': { type: 'person' } })).toBe('project');
    expect(tagTypeOf('tom', info)).toBe('person');
    expect(tagTypeOf('framing', info)).toBe('topic');
    expect(tagTypeOf('sketch', {})).toBe('topic');
    expect(tagTypeOf('sketch')).toBe('topic');
    expect(TAG_TYPES).toEqual(['project', 'person', 'topic']);
  });

  it('job and proposal are told apart by the pattern', () => {
    expect(projectKind('2327-018')).toBe('job');
    expect(projectKind('P2026-141')).toBe('proposal');
    expect(projectKind('tom')).toBeNull();
    expect(projectKind(null)).toBeNull();
  });

  it('label: the project number, else the stored label, else the tag', () => {
    expect(tagLabel('5444-006', info)).toBe('5444-006');
    expect(tagLabel('tom', info)).toBe('Tom');
    expect(tagLabel('sketch', info)).toBe('sketch');
    expect(tagLabel('tom', null)).toBe('tom');
  });

  it('names and matching: key, label or alias, case-insensitive', () => {
    expect(tagNames('tom', info)).toEqual(['tom', 'Tom', 'Thomas']);
    expect(tagAnswersTo('tom', info, 'TOM')).toBe(true);
    expect(tagAnswersTo('tom', info, 'thomas')).toBe(true);
    expect(tagAnswersTo('tom', info, 'Tomas')).toBe(false);
    expect(tagAnswersTo('5444-006', info, '5444–006')).toBe(true);
    expect(tagAnswersTo('tom', info, '  ')).toBe(false);
    expect(tagAnswersTo('constructor', {}, 'constructor')).toBe(true);
    expect(tagLabel('constructor', {})).toBe('constructor');   // no prototype leaks
  });

  it('withTagType: a keyword becomes a Person or a Topic; a project never changes', () => {
    const a = withTagType({}, 'tom', 'person', 'Tom');
    expect(a).toEqual({ tom: { type: 'person', label: 'Tom' } });
    // An existing label wins over the typed one.
    expect(withTagType(info, 'tom', 'person', 'TOMMY').tom.label).toBe('Tom');
    const b = withTagType({ tom: { type: 'person', label: 'Tom', company: 'Burnell' } }, 'tom', 'topic');
    expect(b).toEqual({ tom: { label: 'Tom' } });
    expect(withTagType({ tom: { type: 'person' } }, 'tom', 'topic')).toEqual({});
    const same = { x: 1 };
    expect(withTagType(same, '5444-006', 'person')).toBe(same);
    expect(withTagType(same, 'tom', 'project')).toBe(same);
  });

  it('withTagInfo sets a normalized record; null or empty removes it', () => {
    expect(withTagInfo({}, 'tom', { type: 'person', label: 'Tom' })).toEqual({ tom: { type: 'person', label: 'Tom' } });
    expect(withTagInfo(info, 'tom', null).tom).toBeUndefined();
    expect(withTagInfo(info, 'tom', { label: '' }).tom).toBeUndefined();
    expect(info.tom).toEqual({ type: 'person', label: 'Tom', aliases: ['Thomas'] });   // input untouched
  });
});

describe('rename / merge / delete carry info (v3.22.0)', () => {
  const info = {
    tom: { type: 'person', label: 'Tom', aliases: ['Thomas'], company: 'Burnell' },
    thomas: { type: 'person', label: 'Thomas B.', aliases: ['TB'] },
    framing: { aliases: ['framed'] }
  };

  it('a rename moves the record to the new key', () => {
    const next = renameTagInfo(info, 'tom', 'tom-b');
    expect(next['tom-b']).toEqual(info.tom);
    expect(next.tom).toBeUndefined();
    expect(info.tom).toBeDefined();   // input untouched
  });

  it('a merge keeps the target\'s info and adds the source\'s aliases', () => {
    const next = renameTagInfo(info, 'tom', 'thomas', true);
    // Thomas's own label stays; Tom's display name joins the aliases, his company does not come along.
    expect(next.thomas).toEqual({ type: 'person', label: 'Thomas B.', aliases: ['TB', 'Tom', 'Thomas'] });
    expect(next.tom).toBeUndefined();
  });

  it('a merge into a tag with no info gives it the source\'s aliases only', () => {
    const next = renameTagInfo(info, 'framing', 'carpentry', true);
    expect(next.carpentry).toEqual({ aliases: ['framed'] });
    expect(renameTagInfo({ tom: { type: 'person', label: 'Tom' } }, 'tom', 'x', true)).toEqual({ x: { aliases: ['Tom'] } });
  });

  it('renaming a keyword to a project number drops what a project can\'t hold', () => {
    expect(renameTagInfo(info, 'tom', '5444-006')['5444-006']).toEqual({ aliases: ['Thomas'] });
  });

  it('a tag with no info renames to nothing; no-ops return the same map', () => {
    expect(renameTagInfo(info, 'beam', 'girder')).toBe(info);
    expect(renameTagInfo(info, 'tom', 'tom')).toBe(info);
    expect(renameTagInfo(info, '??', 'x')).toBe(info);
  });

  it('delete drops the record', () => {
    expect(deleteTagInfo(info, 'tom').tom).toBeUndefined();
    expect(deleteTagInfo(info, 'beam')).toBe(info);
  });

  it('diffTagInfo lists set and removed records; rollbackInfoPatch puts back only what the write set', () => {
    const next = { ...deleteTagInfo(info, 'framing'), tom: { type: 'person', label: 'Tommy' } };
    const patch = diffTagInfo(info, next);
    expect(patch).toEqual({ tom: { type: 'person', label: 'Tommy' }, framing: null });
    expect(rollbackInfoPatch(next, patch, info)).toEqual(info);
    // A later edit to tom wins over the rollback.
    const later = { ...next, tom: { type: 'person', label: 'T.' } };
    const rolled = rollbackInfoPatch(later, patch, info);
    expect(rolled.tom).toEqual({ type: 'person', label: 'T.' });
    expect(rolled.framing).toEqual(info.framing);
    expect(diffTagInfo(info, info)).toEqual({});
  });
});

describe('tag groups, rows and the type-ahead (v3.22.0)', () => {
  const info = { tom: { type: 'person', label: 'Tom', aliases: ['Thomas'] } };

  it('an old "keywords" collapse entry reads as Topics, "projects" as Projects', () => {
    expect(parseCollapsedGroups(['keywords'])).toEqual(['topic']);
    expect(parseCollapsedGroups(['projects', 'keywords', 'topic'])).toEqual(['project', 'topic']);
    expect(TAG_GROUP_LABELS).toEqual({ project: 'Projects', person: 'People', topic: 'Topics' });
  });

  it('groupByTagType: Projects, People, Topics, empty groups left out', () => {
    const items = [{ tag: 'sketch' }, { tag: 'tom' }, { tag: '5444-006' }, { tag: 'dream' }];
    expect(groupByTagType(items, info).map((g) => [g.id, g.label, g.items.map((i) => i.tag)])).toEqual([
      ['project', 'Projects', ['5444-006']], ['person', 'People', ['tom']], ['topic', 'Topics', ['sketch', 'dream']]
    ]);
    expect(groupByTagType([{ tag: 'a' }], {}).map((g) => g.id)).toEqual(['topic']);
    expect(groupByTagType(null, info)).toEqual([]);
  });

  it('createRows: a keyword offers Topic (Enter) and Person with the typed capitals', () => {
    expect(createRows('tom', ' Tom ')).toEqual([
      { tag: 'tom', create: 'topic' }, { tag: 'tom', create: 'person', label: 'Tom' }
    ]);
    expect(createRows('P2026-141', 'p2026-141')).toEqual([{ tag: 'P2026-141', create: 'project' }]);
    expect(createRows(null, 'x')).toEqual([]);
  });

  it('tagOptions finds a tag by its label or alias', () => {
    const stats = [{ tag: 'tom', pages: 3 }, { tag: 'beam', pages: 9 }];
    expect(tagOptions('thom', stats, [], 6, info).options.map((o) => o.tag)).toEqual(['tom']);
    expect(tagOptions('thom', stats, [], 6).options).toEqual([]);
    expect(tagOptions('Thomas', stats, [], 6, info).create).toBe('thomas');
  });

  it('sortTagStats by type: projects, people, topics, then name', () => {
    const rows = [{ tag: 'b', type: 'topic' }, { tag: 'tom', type: 'person' }, { tag: '5444-006', type: 'project' }, { tag: 'a', type: 'topic' }];
    expect(sortTagStats(rows, { by: 'type', dir: 'asc' }).map((r) => r.tag)).toEqual(['5444-006', 'tom', 'a', 'b']);
    expect(sortTagStats(rows, { by: 'type', dir: 'desc' }).map((r) => r.tag)).toEqual(['a', 'b', 'tom', '5444-006']);
  });
});

describe('coordinator QA fixes (v3.22.0)', () => {
  it('a merge keeps the source\'s display name: thomas ("Thomas") into tom', () => {
    const info = { tom: { type: 'person', label: 'Tom' }, thomas: { type: 'person', label: 'Thomas', aliases: ['Tommy'] } };
    const next = renameTagInfo(info, 'thomas', 'tom', true);
    expect(next).toEqual({ tom: { type: 'person', label: 'Tom', aliases: ['Thomas', 'Tommy'] } });
    expect(tagAnswersTo('tom', next, 'Thomas')).toBe(true);
  });

  it('a person\'s key joins too when no target name reads the same', () => {
    const info = { tom: { type: 'person', label: 'Tom' }, tb: { type: 'person', company: 'Burnell' } };
    expect(renameTagInfo(info, 'tb', 'tom', true).tom.aliases).toEqual(['tb']);
    // "Thomas" already among the names: the key `thomas` is not added again.
    const info2 = { tom: { type: 'person', label: 'Tom' }, thomas: { type: 'person', label: 'Thomas' } };
    expect(renameTagInfo(info2, 'thomas', 'tom', true).tom.aliases).toEqual(['Thomas']);
    // A topic's key is not a name: not added.
    expect(renameTagInfo({ tom: { type: 'person' }, framing: { aliases: ['framed'] } }, 'framing', 'tom', true).tom.aliases)
      .toEqual(['framed']);
  });

  it('a target with info but on no page is merged into, not overwritten', () => {
    const info = { tom: { type: 'person', label: 'Tom', company: 'Burnell' }, tommy: { label: 'Tommy' } };
    expect(renameTagInfo(info, 'tommy', 'tom')).toEqual({ tom: { type: 'person', label: 'Tom', company: 'Burnell', aliases: ['Tommy'] } });
  });

  it('renameIsMerge: a target on a page, or with info of its own', () => {
    const pages = { '388/1': ['beam'] };
    const info = { tom: { type: 'person' } };
    expect(renameIsMerge(pages, info, 'beam')).toBe(true);
    expect(renameIsMerge(pages, info, 'Tom')).toBe(true);
    expect(renameIsMerge(pages, info, 'slab')).toBe(false);
    expect(renameIsMerge(pages, info, 'constructor')).toBe(false);
    expect(renameIsMerge(pages, info, '??')).toBe(false);
  });

  it('withInfoOnlyTags lists a tag on no page with 0 pages', () => {
    const stats = [{ tag: 'beam', pages: 3, notebooks: 1 }];
    expect(withInfoOnlyTags(stats, { beam: { aliases: ['girder'] }, tom: { type: 'person' } }))
      .toEqual([...stats, { tag: 'tom', pages: 0, notebooks: 0 }]);
    expect(withInfoOnlyTags(stats, {})).toBe(stats);
    expect(withInfoOnlyTags(null, null)).toEqual([]);
  });
});
