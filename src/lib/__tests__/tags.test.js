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
  tagCards, untaggedCard, sortTagCards, tagStats, filterByTags, filterChoices, tagOptions,
  parseTagSort, parseGroupBy, MAX_TAG_LENGTH
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
      dismissed: { '3017/42': ['2327-018'] }
    });
  });

  it('missing, corrupt or wrongly shaped input is empty', () => {
    const empty = { pages: {}, dismissed: {} };
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
