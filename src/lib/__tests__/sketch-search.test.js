/**
 * lib/sketch-search.js and the global search's Sketches group (v3.24.0,
 * docs/TRANSCRIPT-STRUCTURE-SPEC.md E.5): a sketch's tags by block scope, and
 * has:sketch with project, person, label words and facets. Scan records only.
 */
import { describe, it, expect } from 'vitest';
import { sketchTagsOf, sketchEntries, matchSketches, sketchesOfTag } from '../sketch-search.js';
import { parseSearchQuery, extractFacets } from '../search-query.js';
import { buildSearchIndex, recordsByKey, runSearch } from '../global-search.js';
import { buildTranscriptionText } from '../tag-scope.js';
import { buildSketchSummary } from '../line-kinds.js';

const sk = (id, text, lvl = 1) => ({ id, kind: 'sketch', text, indentLevel: lvl });
/** A scan record built the way main builds it. */
function rec(book, pageId, lines) {
  return { book, page: Number(pageId), pageId, transcriptionText: buildTranscriptionText(lines), sketches: buildSketchSummary(lines), tasks: [] };
}

// 3017/124: the floor plan inside the 6226-001 block; 5444-006 is on the page but named nowhere.
const p124 = rec('3017', '124', [
  { text: '9:30 6226-001 Initial Site Visit', indentLevel: 0 }, { text: 'ceiling height', indentLevel: 1 }, sk('fp', 'Floor plan', 2),
  { text: 'Isaiah to check the stair', indentLevel: 0 }, sk('st', 'Stair section', 1)
]);
// 3017/131: two weld details and a pit tie-off under 5656-004.
const p131 = rec('3017', '131', [
  { text: 'Historical steel vs Modern steel', indentLevel: 0 }, sk('w1', 'Lamellar tearing'), sk('w2', 'Weld setup'),
  { text: '5656-004 pit', indentLevel: 0 }, sk('pt', 'Pit tie-off section')
]);
const p200 = rec('3017', '200', [{ text: 'no sketches here 6226-001', indentLevel: 0 }]);
const records = [p124, p131, p200];
const pageTags = { '3017/124': ['6226-001', '5444-006', 'isaiah', 'framing'], '3017/131': ['5444-006', '5656-004'], '3017/200': ['6226-001'] };
const info = { isaiah: { type: 'person' } };
const ctx = { pageTags, info };

describe('a sketch\'s tags', () => {
  it('projects and people by block scope; a tag named nowhere covers the page; topics always', () => {
    const t = sketchTagsOf(p124, ctx);
    expect(t.get('fp')).toEqual(['5444-006', '6226-001', 'framing']);
    expect(t.get('st')).toEqual(['5444-006', 'framing', 'isaiah']);
    const w = sketchTagsOf(p131, ctx);
    expect(w.get('w1')).toEqual(['5444-006']);
    expect(w.get('pt')).toEqual(['5444-006', '5656-004']);
  });

  it('a hand-corrected root (blocks) counts, read from lines with ids', () => {
    const lines = [{ id: 'a', text: '9:30 6226-001 Initial Site Visit', indentLevel: 0 }, { id: 'b', text: 'ceiling height', indentLevel: 1 },
      { id: 'fp', text: '[sketch] Floor plan', indentLevel: 2 }, { id: 'c', text: 'Isaiah to check the stair', indentLevel: 0 },
      { id: 'st', text: '[sketch] Stair section', indentLevel: 1 }];
    const t = sketchTagsOf(p124, { ...ctx, blocks: { '3017/124': { isaiah: { remove: ['c'] } } }, scopeLines: new Map([['3017/124', lines]]) });
    expect(t.get('st')).not.toContain('6226-001');
    expect(t.get('fp')).toContain('isaiah');   // Isaiah's only root removed: named nowhere, so the whole page
  });

  it('pages without sketches give none', () => {
    expect(sketchEntries(records, ctx).map((e) => e.id)).toEqual(['fp', 'st', 'w1', 'w2', 'pt']);
  });
});

describe('matchSketches', () => {
  const entries = sketchEntries(records, ctx);
  const ids = (q) => matchSketches(entries, parseSearchQuery(q), { info }).map((e) => e.id).sort();

  it('has:sketch alone: every sketch', () => {
    expect(ids('has:sketch')).toEqual(['fp', 'pt', 'st', 'w1', 'w2']);
  });
  it('has:sketch 6226-001: the floor plan only (its block)', () => {
    expect(ids('has:sketch 6226-001')).toEqual(['fp']);
  });
  it('has:sketch person:isaiah: sketches inside Isaiah\'s blocks', () => {
    expect(ids('has:sketch person:isaiah')).toEqual(['st']);
    expect(ids('has:sketch person:nobody')).toEqual([]);
  });
  it('has:sketch <label word>', () => {
    expect(ids('has:sketch weld')).toEqual(['w2']);
    expect(ids('has:sketch section')).toEqual(['pt', 'st']);
  });
  it('words without has:sketch find labels only, never by tag', () => {
    expect(ids('weld setup')).toEqual(['w2']);
    expect(ids('6226-001')).toEqual([]);
    expect(ids('')).toEqual([]);
  });
  it('a project facet is met by a sketch\'s own tags', () => {
    expect(ids('has:sketch project:5656-004')).toEqual(['pt']);
  });
  it('sketchesOfTag lists a tag page\'s strip', () => {
    expect(sketchesOfTag(records, '6226-001', ctx).map((e) => e.id)).toEqual(['fp']);
    expect(sketchesOfTag(records, '5444-006', ctx).map((e) => e.id).sort()).toEqual(['fp', 'pt', 'st', 'w1', 'w2']);
  });
});

describe('global search: has:sketch', () => {
  const run = (q) => runSearch(parseSearchQuery(q), {
    index: buildSearchIndex(records), notebooks: [], records: recordsByKey(records), tags: [], pageTags, info
  });

  it('parses has:sketch out of the query', () => {
    expect(extractFacets('has:sketch 6226-001')).toMatchObject({ has: ['sketch'], facets: [] });
    expect(parseSearchQuery('HAS:SKETCHES weld')).toMatchObject({ has: ['sketch'], tokens: ['weld'] });
    expect(parseSearchQuery('has:sketchy').has).toEqual([]);
  });

  it('puts a Sketches group first and keeps only pages with a sketch', () => {
    const r = run('has:sketch 6226-001');
    expect(r.order[0]).toBe('sketches');
    expect(r.sketches.map((s) => s.id)).toEqual(['fp']);
    expect(r.pages.map((p) => p.key)).toEqual(['3017/124']);
  });

  it('has:sketch alone lists the pages with sketches', () => {
    const r = run('has:sketch');
    expect(r.pages.map((p) => p.key).sort()).toEqual(['3017/124', '3017/131']);
    expect(r.sketches).toHaveLength(5);
  });

  it('a label word alone brings its sketch up first; no sketch, no group', () => {
    expect(run('lamellar').order[0]).toBe('sketches');
    const r = run('heater');
    expect(r.sketches).toEqual([]);
    expect(r.order).not.toContain('sketches');
  });

  it('[sketch] label is in the page text, so word search finds the page too', () => {
    expect(run('lamellar').pages.map((p) => p.key)).toEqual(['3017/131']);
  });
});
