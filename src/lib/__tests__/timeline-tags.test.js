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

vi.mock('$lib/storage/local-store.js', () => ({ getTimelineIndex: vi.fn(async () => ({ pages: {} })) }));

import { get } from 'svelte/store';
import { filterIndexByTags, indexTags } from '$lib/timeline-tags.js';
import {
  timelineIndex, timelineRange, timelineExcludedBooks, timelineTagFilter, timelineTags,
  timelineIndexFiltered, timelineFiltering, setTagIncluded, includeOnlyTag, clearTagFilter, includeAllBooks
} from '../../stores/timeline.js';
import { pageTags } from '../../stores/tags.js';

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

  it('applies on top of the book filter and counts as filtering', () => {
    expect(get(timelineFiltering)).toBe(false);
    setTagIncluded('2327-018', true);
    expect(get(timelineFiltering)).toBe(true);
    expect(Object.keys(get(timelineIndexFiltered).pages).sort()).toEqual(['B388/P1', 'B388v2/P1']);
    timelineExcludedBooks.set(new Set(['388v2']));
    expect(Object.keys(get(timelineIndexFiltered).pages)).toEqual(['B388/P1']);
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
