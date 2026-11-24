/**
 * The Timeline's tag filter (v3.25.0):
 *   lib/timeline-tags.js  filterIndexByTags, indexTags
 *   stores/timeline.js    timelineTagFilter, timelineTags, timelineIndexFiltered, timelineFiltering
 *
 * What matters: ticked tags keep pages with ANY of them; the column offers only
 * tags on pages of the notebooks the book / type filters leave in (no dead
 * filters), but a ticked tag stays listed so it can be unticked; counts are
 * pages with ink in the range.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const docs = new Map();
// The real check needs MyScript-era yBounds; these made-up pages count as relinked.
vi.mock('$lib/viewer/ink-text.js', () => ({ isTrustworthyTranscript: () => true }));
vi.mock('$lib/storage/local-store.js', () => ({
  getTimelineIndex: vi.fn(async () => ({ pages: {} })),
  getPage: vi.fn(async (book, pageId) => docs.get(`${book}/${pageId}`) || null)
}));

import { get } from 'svelte/store';
import {
  filterIndexByTags, indexTags, scopedStrokes, dayHistogram, scopeIndex, narrowDayPages, SCOPE_PAD
} from '$lib/timeline-tags.js';
import {
  timelineIndex, timelineRange, timelineExcludedBooks, timelineTagFilter, timelineTags,
  timelineIndexFiltered, timelineFiltering, setTagIncluded, includeOnlyTag, clearTagFilter, includeAllBooks,
  timelineScoping, clearScopeCache
} from '../../stores/timeline.js';
import { pageTags, tagInfo, tagBlocks } from '../../stores/tags.js';

/** The filtered index once block scope has settled. */
async function settled() {
  let value;
  const unsub = timelineIndexFiltered.subscribe((v) => { value = v; });   // the feed holds one, as here
  for (let i = 0; i < 50 && get(timelineScoping) > 0; i++) await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  unsub();
  return value;
}

const entry = (book, page, days) => ({ book, page, pageId: String(page), days });
const index = {
  pages: {
    'B388/P1': entry('388', 1, { '2026-11-20': 10 }),
    'B388/P2': entry('388', 2, { '2026-11-21': 5 }),
    'B390/P7': entry('390', 7, { '2026-11-20': 3 }),
    'B388v2/P1': entry('388v2', 1, { '2026-11-22': 4 })
  }
};
const tags = {
  '388/1': ['2327-018', 'tom'],
  '388/2': ['tom'],
  '390/7': ['budget'],
  '388v2/1': ['2327-018']
};

describe('filterIndexByTags', () => {
  it('returns the same index with no tag chosen', () => {
    expect(filterIndexByTags(index, new Set(), tags)).toBe(index);
    expect(filterIndexByTags(index, null, tags)).toBe(index);
    expect(filterIndexByTags(null, new Set(['tom']), tags)).toBe(null);
  });

  it('keeps pages with any chosen tag', () => {
    expect(Object.keys(filterIndexByTags(index, new Set(['tom']), tags).pages)).toEqual(['B388/P1', 'B388/P2']);
    expect(Object.keys(filterIndexByTags(index, new Set(['budget', '2327-018']), tags).pages).sort())
      .toEqual(['B388/P1', 'B388v2/P1', 'B390/P7']);
  });

  it('keeps nothing when no page has the tag, or there are no tags', () => {
    expect(filterIndexByTags(index, new Set(['nope']), tags).pages).toEqual({});
    expect(filterIndexByTags(index, new Set(['tom']), {}).pages).toEqual({});
    expect(filterIndexByTags(index, new Set(['tom']), null).pages).toEqual({});
  });
});

describe('indexTags', () => {
  it('lists every tag with pages and pages in range, projects first', () => {
    expect(indexTags(index, tags, '2026-11-20', '2026-11-20')).toEqual([
      { tag: '2327-018', pages: 2, inRange: 1 },
      { tag: 'budget', pages: 1, inRange: 1 },
      { tag: 'tom', pages: 2, inRange: 1 }
    ]);
  });

  it('counts nothing in range without a range', () => {
    expect(indexTags(index, tags).every((r) => r.inRange === 0)).toBe(true);
  });

  it('keeps chosen tags at 0 when no page here has them', () => {
    const only388 = filterIndexByTagsBook(index, '388');
    expect(indexTags(only388, tags, null, null, new Set(['budget'])).map((r) => r.tag))
      .toEqual(['2327-018', 'budget', 'tom']);
    expect(indexTags(only388, tags).map((r) => r.tag)).toEqual(['2327-018', 'tom']);
  });

  it('is empty for no index or no tags', () => {
    expect(indexTags(null, tags)).toEqual([]);
    expect(indexTags(index, {})).toEqual([]);
  });
});

function filterIndexByTagsBook(idx, book) {
  return { pages: Object.fromEntries(Object.entries(idx.pages).filter(([, p]) => p.book === book)) };
}

describe('tag filter stores', () => {
  beforeEach(() => {
    docs.clear();
    clearScopeCache();
    includeAllBooks();
    clearTagFilter();
    pageTags.set(tags);
    timelineIndex.set(index);
    timelineRange.set({ from: '2026-11-20', to: '2026-11-22' });
  });

  it('offers only tags in the notebooks left in', () => {
    expect(get(timelineTags).map((r) => r.tag)).toEqual(['2327-018', 'budget', 'tom']);
    timelineExcludedBooks.set(new Set(['390']));
    expect(get(timelineTags).map((r) => r.tag)).toEqual(['2327-018', 'tom']);
  });

  it('applies on top of the book filter and counts as filtering', async () => {
    expect(get(timelineFiltering)).toBe(false);
    setTagIncluded('2327-018', true);
    expect(get(timelineFiltering)).toBe(true);
    // No page docs here: unreadable pages keep their page-level days.
    expect(Object.keys((await settled()).pages).sort()).toEqual(['B388/P1', 'B388v2/P1']);
    timelineExcludedBooks.set(new Set(['388v2']));
    expect(Object.keys((await settled()).pages)).toEqual(['B388/P1']);
  });

  it('Only and Any', () => {
    setTagIncluded('tom', true);
    setTagIncluded('budget', true);
    includeOnlyTag('budget');
    expect([...get(timelineTagFilter)]).toEqual(['budget']);
    setTagIncluded('budget', false);
    expect(get(timelineTagFilter).size).toBe(0);
    setTagIncluded('tom', true);
    clearTagFilter();
    expect(get(timelineIndexFiltered)).toBe(index);
  });

  it('a ticked tag stays listed after its notebook is left out', () => {
    setTagIncluded('budget', true);
    timelineExcludedBooks.set(new Set(['390']));
    expect(get(timelineTags).find((r) => r.tag === 'budget')).toEqual({ tag: 'budget', pages: 0, inRange: 0 });
  });
});

/* ---------------- Block scope (v3.26.0) ---------------- */

const T = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
const ln = (id, text, indentLevel = 0) => ({ id, text, indentLevel, checked: null });
const st = (id, lineId, x, y, t) => ({ id, lineId, startTime: t, endTime: t + 100, points: [[x, y, t], [x + 4, y + 1, t + 50]] });

// Two blocks: the project's (lines a, a1) and a later note (b, b1).
const doc = {
  transcript: { lastTranscribed: '2026-11-01T00:00:00Z', lines: [
    ln('a', '9:00 2327-018 framing'), ln('a1', 'joists at 16', 1), ln('b', 'Dreams last night'), ln('b1', 'flying', 1)
  ] },
  strokes: [
    st('s1', 'a', 5, 5, T(2026, 11, 20)),
    st('s2', 'a1', 8, 10, T(2026, 11, 20)),
    st('s3', 'b', 5, 30, T(2026, 11, 21)),
    st('s4', 'b1', 8, 35, T(2026, 11, 21)),
    st('u1', null, 6, 12, T(2026, 11, 22)),    // unlinked, inside the project block's box
    st('u2', null, 6, 60, T(2026, 11, 22))     // unlinked, far below everything
  ]
};
const ids = (set) => [...set].map((s) => s.id).sort();

describe('scopedStrokes', () => {
  it('keeps ink linked to the tag’s block, plus unlinked ink inside its box', () => {
    const r = scopedStrokes(doc, ['2327-018']);
    expect(r.why).toBe('scoped');
    expect(ids(r.strokes)).toEqual(['s1', 's2', 'u1']);
  });

  it('a topic has a block by name (Dreams → dream)', () => {
    expect(ids(scopedStrokes(doc, ['dream']).strokes)).toEqual(['s3', 's4']);
  });

  it('unions several tags', () => {
    expect(ids(scopedStrokes(doc, ['2327-018', 'dream']).strokes)).toEqual(['s1', 's2', 's3', 's4', 'u1']);
  });

  it('is not narrowed for a tag named nowhere, no transcript, untrusted links or no tag', () => {
    expect(scopedStrokes(doc, ['isaiah'], { info: { isaiah: { type: 'person' } } })).toEqual({ strokes: null, why: 'whole-page' });
    expect(scopedStrokes({ strokes: doc.strokes }, ['dream'])).toEqual({ strokes: null, why: 'untranscribed' });
    expect(scopedStrokes(doc, ['dream'], { trusted: false })).toEqual({ strokes: null, why: 'untrusted' });
    expect(scopedStrokes(doc, [])).toEqual({ strokes: null, why: 'no-tag' });
  });

  it('a hand correction moves the block', () => {
    const r = scopedStrokes(doc, ['2327-018'], { corrections: { '2327-018': { remove: ['a'], add: ['b'] } } });
    expect(ids(r.strokes)).toEqual(['s3', 's4']);
  });

  it('the pad is a few Ncode units', () => {
    expect(SCOPE_PAD).toBeGreaterThan(0);
    expect(SCOPE_PAD).toBeLessThan(10);
  });
});

describe('dayHistogram and scopeIndex', () => {
  it('counts strokes by local day', () => {
    expect(dayHistogram(doc.strokes)).toEqual({ '2026-11-20': 2, '2026-11-21': 2, '2026-11-22': 2 });
    expect(dayHistogram([{ startTime: 0 }, { startTime: 'x' }])).toEqual({});
  });

  it('replaces days, drops empty pages, leaves unknown pages out', () => {
    const idx = { pages: {
      A: { book: '1', pageId: '1', days: { d1: 9 }, strokes: 9, firstStroke: 1 },
      B: { book: '1', pageId: '2', days: { d2: 3 } },
      C: { book: '1', pageId: '3', days: { d3: 1 } }
    } };
    const out = scopeIndex(idx, (key) => ({ A: { days: { d1: 2 } }, B: { days: {} } })[key]);
    expect(out.missing).toEqual(['C']);
    expect(out.index.pages).toEqual({ A: { book: '1', pageId: '1', days: { d1: 2 }, strokes: 2, firstStroke: null, lastStroke: null } });
    expect(scopeIndex(null, () => ({})).index).toBe(null);
  });
});

describe('narrowDayPages', () => {
  it('keeps only scoped strokes for the sittings and says why per page', () => {
    const pages = [{ book: '388', pageId: '1', doc }];
    const out = narrowDayPages(pages, new Set(['dream']), { pageTags: { '388/1': ['dream', 'poem'] } });
    expect(out.pages[0].doc.strokes.map((s) => s.id)).toEqual(['s3', 's4']);
    expect(out.why.get('388/1')).toBe('scoped');
    expect(doc.strokes).toHaveLength(6);   // the page itself untouched
    expect(narrowDayPages(pages, new Set()).pages).toBe(pages);
  });
});

describe('scoped timeline index (store)', () => {
  beforeEach(() => {
    docs.clear();
    clearScopeCache();
    includeAllBooks();
    clearTagFilter();
    tagInfo.set({});
    tagBlocks.set({});
    docs.set('388/1', doc);
    pageTags.set({ '388/1': ['2327-018', 'dream'], '388/2': ['dream'] });
    timelineIndex.set({ pages: {
      'B388/P1': { book: '388', page: 1, pageId: '1', mtimeMs: 1, size: 1, days: { '2026-11-20': 2, '2026-11-21': 2, '2026-11-22': 2 } },
      'B388/P2': { book: '388', page: 2, pageId: '2', mtimeMs: 1, size: 1, days: { '2026-11-25': 7 } }
    } });
  });

  it('counts only the tagged block’s days, never the rest of the page', async () => {
    setTagIncluded('2327-018', true);
    const idx = await settled();
    expect(idx.pages['B388/P1'].days).toEqual({ '2026-11-20': 2, '2026-11-22': 1 });
    expect(idx.pages['B388/P2']).toBeUndefined();   // not tagged 2327-018
  });

  it('a page that cannot be read keeps its page-level days', async () => {
    setTagIncluded('dream', true);
    const idx = await settled();
    expect(idx.pages['B388/P1'].days).toEqual({ '2026-11-21': 2 });
    expect(idx.pages['B388/P2'].days).toEqual({ '2026-11-25': 7 });
  });

  it('a block correction re-reads the page', async () => {
    setTagIncluded('2327-018', true);
    await settled();
    tagBlocks.set({ '388/1': { '2327-018': { remove: ['a'], add: ['b'] } } });
    expect((await settled()).pages['B388/P1'].days).toEqual({ '2026-11-21': 2 });
  });
});
