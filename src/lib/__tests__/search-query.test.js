/**
 * lib/search-query.js (reading-first package E): dates and notebook names in a
 * global-search query.
 *
 * What matters: the date forms Josh types resolve to local day keys (month
 * first, no year = most recent past occurrence), invalid dates stay words, and
 * ordinary words (a month alone, a job number) are not taken for dates.
 */
import { describe, it, expect } from 'vitest';
import { parseSearchQuery, matchNotebooks, matchTags, extractFacets, facetTakesTag, facetPages } from '$lib/search-query.js';

const now = new Date(2026, 9, 19, 15); // Mon Oct 19 2026, local
const p = (s) => parseSearchQuery(s, { now });

describe('parseSearchQuery: dates', () => {
  it('month-name forms', () => {
    expect(p('Oct 14').days).toEqual(['2026-10-14']);
    expect(p('october 14th').days).toEqual(['2026-10-14']);
    expect(p('Oct. 14, 2025').days).toEqual(['2025-10-14']);
    expect(p('14 Oct').days).toEqual(['2026-10-14']);
    expect(p('3rd June 2025').days).toEqual(['2025-06-03']);
  });

  it('ISO and numeric (month first) forms', () => {
    expect(p('2026-10-14').days).toEqual(['2026-10-14']);
    expect(p('2026-1-5').days).toEqual(['2026-01-05']);
    expect(p('10/14').days).toEqual(['2026-10-14']);
    expect(p('10/14/26').days).toEqual(['2026-10-14']);
    expect(p('10/14/2025').days).toEqual(['2025-10-14']);
  });

  it('a date with no year is its latest occurrence not after today', () => {
    expect(p('Oct 19').days).toEqual(['2026-10-19']);
    expect(p('Oct 20').days).toEqual(['2025-10-20']);
    expect(p('Dec 3').days).toEqual(['2025-12-03']);
    expect(p('Feb 29').days).toEqual(['2024-02-29']);
  });

  it('today and yesterday', () => {
    expect(p('today').days).toEqual(['2026-10-19']);
    expect(p('Yesterday').days).toEqual(['2026-10-18']);
    const jan1 = parseSearchQuery('yesterday', { now: new Date(2026, 0, 1, 9) });
    expect(jan1.days).toEqual(['2025-12-31']);
  });

  it('invalid dates stay text', () => {
    expect(p('Feb 30').days).toEqual([]);
    expect(p('13/45').days).toEqual([]);
    expect(p('2026-13-01').days).toEqual([]);
  });

  it('not dates: a month alone, a number, job and proposal numbers', () => {
    expect(p('may').days).toEqual([]);
    expect(p('14').days).toEqual([]);
    expect(p('2327-018').days).toEqual([]);
    expect(p('P2026-141').days).toEqual([]);
    expect(p('1/2/3/4').days).toEqual([]);
  });

  it('date plus words: the words are what is left', () => {
    const q = p('beam calc Oct 14');
    expect(q.days).toEqual(['2026-10-14']);
    expect(q.text).toBe('beam calc');
    expect(q.tokens).toEqual(['beam', 'calc']);
  });

  it('several dates, deduped, in query order', () => {
    expect(p('Oct 14 10/14 yesterday').days).toEqual(['2026-10-14', '2026-10-18']);
  });

  it('empty and non-string input', () => {
    expect(p('')).toEqual({ raw: '', text: '', tokens: [], days: [], facets: [] });
    expect(parseSearchQuery(null, { now })).toEqual({ raw: '', text: '', tokens: [], days: [], facets: [] });
  });

  it('tokens use the transcript tokenizer (hyphens kept, 1-char words dropped)', () => {
    expect(p('5444-006 a Rich').tokens).toEqual(['5444-006', 'rich']);
  });
});

describe('matchNotebooks', () => {
  const nbs = [
    { book: '387', name: 'JPI Ruled' },
    { book: '388', name: 'JPI Dotted' },
    { book: '390', name: 'Study Notes 1' },
    { book: '390v2', name: 'Study Notes 3' },
    { book: '3017', name: 'B3017' }
  ];

  it('by name: every word, case-insensitive, prefix before contains', () => {
    expect(matchNotebooks('study notes', nbs).map((n) => n.book)).toEqual(['390', '390v2']);
    expect(matchNotebooks('notes 3', nbs).map((n) => n.book)).toEqual(['390v2']);
    expect(matchNotebooks('jpi', nbs).map((n) => n.book)).toEqual(['388', '387']);
  });

  it('exact name is flagged', () => {
    expect(matchNotebooks('JPI Dotted', nbs)[0]).toEqual({ book: '388', name: 'JPI Dotted', exact: true });
  });

  it('by book key: "390", "B390", "390v2"; never by digit prefix', () => {
    expect(matchNotebooks('390', nbs).map((n) => n.book)).toEqual(['390']);
    expect(matchNotebooks('B390', nbs).map((n) => n.book)).toEqual(['390']);
    expect(matchNotebooks('390v2', nbs).map((n) => n.book)).toEqual(['390v2']);
    expect(matchNotebooks('39', nbs)).toEqual([]);
  });

  it('too short, nothing or no list', () => {
    expect(matchNotebooks('j', nbs)).toEqual([]);
    expect(matchNotebooks('', nbs)).toEqual([]);
    expect(matchNotebooks('jpi', null)).toEqual([]);
    expect(matchNotebooks('zzz', nbs)).toEqual([]);
  });
});

describe('tag facets (v3.22.0)', () => {
  const info = {
    tom: { type: 'person', label: 'Tom', aliases: ['Thomas'] },
    rich: { type: 'person', label: 'Rich' },
    framing: { aliases: ['framed'] },
    '5444-006': { name: 'Stair' }
  };
  const pageTags = {
    '388/170': ['5444-006', 'rich'],
    '388/101': ['P2026-141', 'framing', 'tom'],
    '390/5': ['2327-018', 'tom'],
    '390/6': ['sketch']
  };
  const keys = (facets) => [...facetPages(facets, pageTags, info).keys].sort();

  it('extractFacets takes every facet out of the text, in order', () => {
    const r = extractFacets('beam person:tom is:job  TYPE:Person stair');
    expect(r.text.replace(/\s+/g, ' ')).toBe('beam stair');
    expect(r).toMatchObject({
      facets: [{ key: 'person', value: 'tom' }, { key: 'is', value: 'job' }, { key: 'type', value: 'person' }]
    });
    expect(extractFacets('person:"Tom Burnell" x').facets).toEqual([{ key: 'person', value: 'Tom Burnell' }]);
    expect(extractFacets('project:5444-006').facets).toEqual([{ key: 'project', value: '5444-006' }]);
  });

  it('an unknown type or is value, an empty value, or a facet inside a word stays text', () => {
    for (const s of ['type:company', 'is:active', 'person:', 'person:""', 'xperson:tom', 'company:acme']) {
      const r = extractFacets(s);
      expect(r.facets, s).toEqual([]);
      expect(r.text, s).toBe(s);
    }
  });

  it('parseSearchQuery: facets never become words or dates', () => {
    const r = p('person:tom 10/14 beam');
    expect(r.facets).toEqual([{ key: 'person', value: 'tom' }]);
    expect(r.tokens).toEqual(['beam']);
    expect(r.days).toEqual(['2026-10-14']);
    expect(p('project:2026-10-14').days).toEqual([]);
  });

  it('person: / topic: / project: match key, label or alias, within their type only', () => {
    const takes = (key, value, tag) => facetTakesTag({ key, value }, tag, info);
    expect(takes('person', 'tom', 'tom')).toBe(true);
    expect(takes('person', 'Thomas', 'tom')).toBe(true);
    expect(takes('person', 'TOM', 'tom')).toBe(true);
    expect(takes('topic', 'tom', 'tom')).toBe(false);
    expect(takes('topic', 'framed', 'framing')).toBe(true);
    expect(takes('person', 'framing', 'framing')).toBe(false);
    expect(takes('project', '5444–006', '5444-006')).toBe(true);
    expect(takes('project', 'p2026-141', 'P2026-141')).toBe(true);
    expect(takes('topic', 'sketch', 'sketch')).toBe(true);   // no info: a topic
  });

  it('type: and is: take a whole type or the job / proposal pattern', () => {
    expect(keys([{ key: 'type', value: 'person' }])).toEqual(['388/101', '388/170', '390/5']);
    expect(keys([{ key: 'type', value: 'project' }])).toEqual(['388/101', '388/170', '390/5']);
    expect(keys([{ key: 'type', value: 'topic' }])).toEqual(['388/101', '390/6']);
    expect(keys([{ key: 'is', value: 'job' }])).toEqual(['388/170', '390/5']);
    expect(keys([{ key: 'is', value: 'proposal' }])).toEqual(['388/101']);
  });

  it('several facets: a page must satisfy each; the tags named are listed', () => {
    const r = facetPages([{ key: 'person', value: 'tom' }, { key: 'is', value: 'job' }], pageTags, info);
    expect([...r.keys]).toEqual(['390/5']);
    expect(r.tags).toEqual(['2327-018', '5444-006', 'tom']);
    expect(keys([{ key: 'person', value: 'nobody' }])).toEqual([]);
    expect(facetPages([], pageTags, info)).toEqual({ tags: [], keys: null });
  });

  it('matchTags: text equal to a label or alias finds the tag; one bare word does too', () => {
    const stats = [{ tag: 'tom', pages: 2 }, { tag: 'framing', pages: 1 }, { tag: 'tomato', pages: 5 }];
    expect(matchTags('Thomas', stats, info)).toEqual([{ tag: 'tom', pages: 2, exact: true }]);
    expect(matchTags('framed', stats, info).map((t) => t.tag)).toEqual(['framing']);
    expect(matchTags('Thomas beam', stats, info).map((t) => t.tag)).toEqual(['tom']);
    expect(matchTags('tom', stats, info).map((t) => [t.tag, t.exact])).toEqual([['tom', true], ['tomato', false]]);
    expect(matchTags('Thomas', stats)).toEqual([]);   // no info: by key only, as before
  });
});
