/**
 * Tests for lib/tag-suggestions.js (the Library-wide suggestion pass) and
 * stores/tag-suggestions.js (pending = found − tags − dismissals).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({ getTags: vi.fn(), patchTags: vi.fn(async () => ({})) }));

import {
  foundInText, pendingFrom, countPending, groupSuggestions, createSuggestionScanner
} from '$lib/tag-suggestions.js';
import {
  pendingSuggestions, suggestionCount, suggestionsFound, suggestionScan,
  ensureSuggestionScan, cancelSuggestionScan, clearSuggestions
} from '$stores/tag-suggestions.js';
import { pageTags, dismissedTags, addTagToPages, dismissSuggestion } from '$stores/tags.js';
import { savedPages, isScanning } from '$stores/saved-pages.js';

const rec = (book, pageId, text) => ({ book, pageId: String(pageId), page: parseInt(pageId, 10), transcriptionText: text });

describe('foundInText', () => {
  it('finds each number once with its line', () => {
    expect(foundInText('a\n10:00 P2026-062 meeting\nP 2026-062 again\n2327-018')).toEqual([
      { tag: 'P2026-062', line: '10:00 P2026-062 meeting', start: 6, end: 15 },
      { tag: '2327-018', line: '2327-018', start: 0, end: 8 }
    ]);
    expect(foundInText(null)).toEqual([]);
    expect(foundInText('')).toEqual([]);
  });

  it('keeps a long line short, around the match', () => {
    const [f] = foundInText(`${'x '.repeat(200)}2327-018${' y'.repeat(200)}`);
    expect(f.line.length).toBeLessThanOrEqual(140);
    expect(f.line.slice(f.start, f.end)).toBe('2327-018');
  });
});

describe('pending and groups', () => {
  const found = new Map([
    ['3017/115', [{ tag: '2327-018', line: '2327-018 bids', start: 0, end: 8 }, { tag: 'P2026-113', line: 'x', start: 0, end: 1 }]],
    ['3017/71', [{ tag: '2327-018', line: '8:30 2327-018 kickoff', start: 5, end: 13 }]],
    ['390v2/151b', [{ tag: 'P2026-113', line: 'y', start: 0, end: 1 }]]
  ]);

  it('subtracts tags and dismissals per page', () => {
    const p = pendingFrom(found, { '3017/115': ['2327-018'] }, { '390v2/151b': ['P2026-113'] });
    expect([...p]).toEqual([['3017/115', ['P2026-113']], ['3017/71', ['2327-018']]]);
    expect(countPending(p)).toBe(2);
    expect(countPending(new Map())).toBe(0);
    expect(pendingFrom(null).size).toBe(0);
  });

  it('groups by number, most pages first, pages in reading order, first source line', () => {
    const records = new Map([
      ['3017/115', rec('3017', '115')], ['3017/71', rec('3017', '71')], ['390v2/151b', rec('390v2', '151b')]
    ]);
    const groups = groupSuggestions(pendingFrom(found), found, records);
    expect(groups.map((g) => [g.tag, g.keys])).toEqual([
      ['2327-018', ['3017/71', '3017/115']],
      ['P2026-113', ['390v2/151b', '3017/115']] // book 390 sorts before 3017
    ]);
    expect(groups[0].source.line).toBe('8:30 2327-018 kickoff');
  });

  it('skips pages no longer in the scan', () => {
    expect(groupSuggestions(pendingFrom(found), found, new Map())).toEqual([]);
  });
});

describe('createSuggestionScanner', () => {
  it('matches only transcribed pages, in chunks with progress, and caches by text', async () => {
    const pause = vi.fn(async () => {});
    const s = createSuggestionScanner({ chunk: 2, pause });
    const records = [rec('1', '1', 'P2026-141'), rec('1', '2', null), rec('1', '3', 'none'), rec('1', '4', '2327-018')];
    const progress = [];
    const found = await s.run(records, { onProgress: (d, t) => progress.push([d, t]) });
    expect([...found.keys()]).toEqual(['1/1', '1/4']);
    expect(progress[0]).toEqual([0, 3]);
    expect(progress.at(-1)).toEqual([3, 3]);
    expect(pause).toHaveBeenCalled();
    expect(s.size()).toBe(3);

    // A re-transcribed page is matched again; a vanished page leaves the cache.
    const again = await s.run([rec('1', '1', 'now 2412-007'), rec('1', '4', '2327-018')]);
    expect(again.get('1/1').map((f) => f.tag)).toEqual(['2412-007']);
    expect(s.size()).toBe(2);
  });

  it('a cancelled run resolves null', async () => {
    let release;
    const s = createSuggestionScanner({ chunk: 1, pause: () => new Promise((r) => { release = r; }) });
    const p = s.run([rec('1', '1', 'P2026-141'), rec('1', '2', 'x')]);
    s.cancel();
    release();
    expect(await p).toBe(null);
  });
});

describe('suggestions store', () => {
  beforeEach(() => {
    clearSuggestions();
    pageTags.set({});
    dismissedTags.set({});
    isScanning.set(false);
  });

  it('runs once per scan and derives pending from tags and dismissals', async () => {
    savedPages.set([rec('3017', '115', '2327-018 bids\n16:00 P2026-113 LP'), rec('3017', '71', '8:30 2327-018 kickoff')]);
    await ensureSuggestionScan();
    expect(get(suggestionCount)).toBe(3);
    expect(get(suggestionScan).running).toBe(false);

    await addTagToPages(['3017/115'], '2327-018');
    expect(get(pendingSuggestions).get('3017/115')).toEqual(['P2026-113']);
    await dismissSuggestion(['3017/115'], 'P2026-113');
    expect(get(pendingSuggestions).has('3017/115')).toBe(false);
    expect(get(suggestionCount)).toBe(1);

    // Same scan: no new pass.
    const found = get(suggestionsFound);
    await ensureSuggestionScan();
    expect(get(suggestionsFound)).toBe(found);
  });

  it('waits while a scan is running, and clears on a data-folder change', async () => {
    savedPages.set([rec('1', '1', 'P2026-141')]);
    isScanning.set(true);
    await ensureSuggestionScan();
    expect(get(suggestionsFound).size).toBe(0);
    isScanning.set(false);
    await ensureSuggestionScan();
    expect(get(suggestionsFound).size).toBe(1);
    clearSuggestions();
    expect(get(suggestionCount)).toBe(0);
  });

  it('cancel stops the progress line', () => {
    savedPages.set([rec('1', '1', 'P2026-141')]);
    ensureSuggestionScan();
    cancelSuggestionScan();
    expect(get(suggestionScan).running).toBe(false);
  });
});
