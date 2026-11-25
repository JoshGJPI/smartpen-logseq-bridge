/**
 * Tests for lib/relink.js (v3.21.0, spec B.2–B.6): what is sent, how lines are
 * classified, word fixes, the review's decisions → the save's spec, the
 * guards (the same set as Claude's edits) and the cache check.
 */
import { describe, it, expect } from 'vitest';
import {
  relinkSendStrokes, textLines, classifyRelink, wordFixes, applyWordFixes, defaultDecisions, buildRelinkSpec,
  relinkNeedsNoReview, relinkRefusal, cachedRunValid, linkedCount, NO_LINKS, runForCache, relinkCandidates, groupCandidates,
  afterRelinkSave, plausibleMisreading, STALE_NOTE, MATCH_AT, CONFIRM_AT, LEFTOVER_ADD, LEFTOVER_TEXTLESS, LEFTOVER_LEAVE, LEFTOVER_JOIN, rowLinked,
  reviewRows, leftoverTarget, setLeftoverChoice, reviewCounts, reviewSummary, LEFTOVER_SKETCH
} from '../relink.js';
import { editRefusal } from '../mcp-edits.js';
import { makeOldPage, makeRun, makeMovedPage, makeMergedPage, mm, rowY } from './fixtures/relink-page.js';

const yb = (i) => ({ minY: mm(rowY(i)), maxY: mm(rowY(i) + 2) });

describe('relinkSendStrokes', () => {
  it('sends every stroke with ink', () => {
    const doc = makeOldPage();
    expect(relinkSendStrokes(doc)).toHaveLength(doc.strokes.length);
  });

  it('never sends textless strokes or strokes linked to a line with a kind', () => {
    const doc = makeOldPage();
    doc.strokes[0].textless = true;
    doc.strokes[0].lineId = null;
    doc.transcript.lines.push({ id: 'sk', kind: 'sketch', text: 'Sketch', indentLevel: 0, parentId: null, checked: null, yBounds: null });
    doc.strokes[1].lineId = 'sk';
    doc.strokes[2].lineId = 'sk';
    doc.strokes.push({ id: 's1', startTime: 1, endTime: 2, lineId: null, points: [] });
    const sent = relinkSendStrokes(doc).map((s) => s.id);
    expect(sent).not.toContain(doc.strokes[0].id);
    expect(sent).not.toContain(doc.strokes[1].id);
    expect(sent).not.toContain(doc.strokes[2].id);
    expect(sent).not.toContain('s1');
    expect(sent).toHaveLength(doc.strokes.length - 4);
  });

  it('handles a missing doc', () => {
    expect(relinkSendStrokes(null)).toEqual([]);
  });
});

describe('textLines', () => {
  it('leaves out any line with a kind (spec E.7), not just sketch', () => {
    const lines = [{ id: 'a', text: 'x' }, { id: 'b', kind: 'sketch', text: 'S' }, { id: 'c', kind: 'table', text: 'T' }];
    expect(textLines(lines).map((l) => l.id)).toEqual(['a']);
    expect(textLines(null)).toEqual([]);
  });
});

describe('classifyRelink', () => {
  it('matches every line of an unchanged reading, task boxes stripped', () => {
    const doc = makeOldPage();
    const { counts, rows } = classifyRelink(doc.transcript.lines, makeRun(doc).lines);
    expect(counts).toMatchObject({ matched: 28, confirm: 0, noink: 0, leftover: 0, tasks: 5 });
    expect(rows[3]).toMatchObject({ type: 'matched', n: 4, task: 'DONE', reading: '☑ check deflection at landing' });
    expect(rows[13].task).toBe('CANCELLED');
    expect(rows[14].task).toBe('WAITING');
  });

  it('sorts pairs by similarity: matched ≥ 0.85, confirm from 0.60, below that no ink + ink left over', () => {
    const lines = [
      { id: 'a', text: 'order the steel beams' },
      { id: 'b', text: 'schedule site meeting' },
      { id: 'c', text: 'zzzz qqqq' }
    ];
    const ms = [
      { text: 'order the steel beams', yBounds: yb(0) },
      { text: 'schedule site meetup soon', yBounds: yb(1) },
      { text: 'zzzk qwer', yBounds: yb(2) }
    ];
    const { rows, counts } = classifyRelink(lines, ms);
    expect(rows[0].type).toBe('matched');
    expect(rows[0].sim).toBeGreaterThanOrEqual(MATCH_AT);
    expect(rows[1].type).toBe('confirm');
    expect(rows[1].sim).toBeGreaterThanOrEqual(CONFIRM_AT);
    expect(rows[1].sim).toBeLessThan(MATCH_AT);
    expect(counts.noink + counts.leftover).toBeGreaterThan(0);
    expect(rows.find((r) => r.lineId === 'c').type).toBe('noink');
  });

  it('a stored line MyScript did not read is no ink; a reading with no stored line is ink left over', () => {
    const doc = makeOldPage();
    const run = makeRun(doc, { drop: [10], extra: [{ text: 'margin note about piles', y: rowY(27) + 6 }] });
    const { rows, counts } = classifyRelink(doc.transcript.lines, run.lines);
    expect(counts).toMatchObject({ matched: 27, noink: 1, leftover: 1 });
    expect(rows.find((r) => r.lineId === 'L10').type).toBe('noink');
    expect(rows[rows.length - 1]).toMatchObject({ type: 'leftover', reading: 'margin note about piles', lineId: null });
  });

  it('a meeting stored at the end but written mid-page (3017/180) comes back as confirm rows marked moved', () => {
    const doc = makeMovedPage();
    const { rows, counts } = classifyRelink(doc.transcript.lines, makeRun(doc).lines);
    expect(counts).toMatchObject({ matched: 25, confirm: 3, moved: 3, noink: 0, leftover: 0 });
    const moved = rows.filter((r) => r.moved);
    expect(moved.map((r) => [r.lineId, r.type, r.n])).toEqual([['L10', 'confirm', 26], ['L11', 'confirm', 27], ['L12', 'confirm', 28]]);
    expect(moved[0].sim).toBe(1);
    // Rows stay in stored order: the moved lines are last, as stored.
    expect(rows.slice(-3)).toEqual(moved);
    expect(defaultDecisions({ rows, counts }).link.L10).toBe(true);
    expect(relinkNeedsNoReview({ rows, counts })).toBe(false);
  });

  it('a moved pair below CONFIRM_AT stays no ink plus leftover; a reading without bounds never pairs as moved', () => {
    const doc = makeMovedPage();
    const run = makeRun(doc, { overrides: { 11: 'qqqq zzzz xxxx' } });
    const { rows } = classifyRelink(doc.transcript.lines, run.lines);
    expect(rows.find((r) => r.lineId === 'L11').type).toBe('noink');
    expect(rows.some((r) => r.type === 'leftover' && r.reading === 'qqqq zzzz xxxx')).toBe(true);
    const flat = makeRun(doc);
    const at = flat.lines.findIndex((l) => l.text === 'drainage behind wall');
    flat.lines[at] = { ...flat.lines[at], yBounds: { minY: 0, maxY: 0 } };
    expect(classifyRelink(doc.transcript.lines, flat.lines).rows.find((r) => r.lineId === 'L12').type).toBe('noink');
  });

  it('lines merged by hand (2 and 3 rows) match their joined readings, with no ink left over', () => {
    const doc = makeMergedPage();
    const { rows, counts } = classifyRelink(doc.transcript.lines, makeRun(doc).lines);
    expect(counts).toMatchObject({ matched: 25, confirm: 0, joined: 2, noink: 0, leftover: 0 });
    const l5 = rows.find((r) => r.lineId === 'L05');
    expect(l5).toMatchObject({ type: 'matched', msAll: [5, 6], reading: 'boring plate at top confirm anchor spacing', breaks: [4] });
    expect(l5.fixes.map((f) => f.to)).toEqual(['boring']);
    expect(rows.find((r) => r.lineId === 'L17')).toMatchObject({ type: 'matched', msAll: [17, 18, 19], breaks: [3, 6] });
    expect(relinkNeedsNoReview({ rows, counts })).toBe(true);
    const spec = buildRelinkSpec(makeRun(doc), { rows, counts });
    expect(spec.links.find((l) => l.lineId === 'L17').ms).toEqual([17, 18, 19]);
  });

  it("#8: a merged line that pairs at ~70% with MyScript's first line is matched at 100% on the joined reading", () => {
    const merged = "We'll need to provide a coating for the concrete to accommodate being submerged full time";
    const lines = [{ id: 'a', text: 'Pump station walls' }, { id: 'b', text: merged }, { id: 'c', text: 'next item' }];
    const ms = [{ text: 'Pump station walls', yBounds: yb(0) }, { text: "We'll need to provide a coating for the concrete to accommodate", yBounds: yb(1) },
      { text: 'being submerged full time', yBounds: yb(2) }, { text: 'next item', yBounds: yb(3) }];
    const { rows, counts } = classifyRelink(lines, ms);
    expect(rows.find((r) => r.lineId === 'b')).toMatchObject({ type: 'matched', sim: 1, msAll: [1, 2] });
    expect(counts.leftover).toBe(0);
  });

  it('two stored lines each matching one reading are never joined', () => {
    const { rows } = classifyRelink(makeOldPage().transcript.lines, makeRun(makeOldPage()).lines);
    expect(rows.every((r) => r.msAll.length === 1)).toBe(true);
  });

  it('a leftover row names the linked line above it for "Add to #N"', () => {
    const doc = makeOldPage();
    const run = makeRun(doc, { extra: [{ text: 'scribble', y: rowY(27) + 6 }] });
    const model = classifyRelink(doc.transcript.lines, run.lines);
    const left = model.rows.find((r) => r.type === 'leftover');
    expect(left).toMatchObject({ joinTo: 'L27', joinToN: 28 });
    const d = defaultDecisions(model);
    expect(rowLinked(model, d, 'L27')).toBe(true);
    d.leftover[left.ms] = LEFTOVER_JOIN;
    const spec = buildRelinkSpec(run, model, d);
    expect(spec.links.find((l) => l.lineId === 'L27').ms).toEqual([27, left.ms]);
    expect(spec.add).toEqual([]);
    expect(spec.texts).toEqual({});
    // After a no-ink line with no shared word, that line is suggested (v3.28.0: it can take the ink).
    const run2 = makeRun(doc, { drop: [27], extra: [{ text: 'qqqq zzzz', y: rowY(27) + 6 }] });
    const left2 = classifyRelink(doc.transcript.lines, run2.lines).rows.find((r) => r.type === 'leftover');
    expect(left2.joinTo).toBe('L27');
  });

  it('"Add to #N" on a confirm row set to Don\'t link gives the line only the added ink', () => {
    const lines = [{ id: 'a', text: 'schedule site meeting' }];
    const ms = [{ text: 'schedule site meetup soon', yBounds: yb(0) }, { text: 'xx yy', yBounds: yb(1) }];
    const model = classifyRelink(lines, ms);
    const left = model.rows.find((r) => r.type === 'leftover');
    expect(left.joinTo).toBe('a');
    const d = setLeftoverChoice(model, { ...defaultDecisions(model), link: { a: false } }, left.ms, LEFTOVER_JOIN);
    expect(rowLinked(model, d, 'a')).toBe(true);
    expect(buildRelinkSpec({ lines: ms }, model, d).links).toEqual([{ lineId: 'a', ms: [left.ms] }]);
  });

  // 2026-11-25, Josh's B553/P1: readings of no-ink lines came back as leftovers with nothing to
  // add them to, and a lone word belonged to the line BELOW the suggested one.
  describe('"Add to" any line (v3.28.0)', () => {
    const lines = [
      { id: 'a', text: 'Want multiple solution repair options' },
      { id: 'b', text: 'Press replaced in 2016 - noticed shifting' },
      { id: 'c', text: 'Tm scope: LP has down days every 2 weeks (6hrs-12hrs down)' },
      { id: 'd', text: '(6) Cores through 24" slab and testing' },
      { id: 'e', text: 'GPR' }
    ];
    const ms = [
      { text: 'Want multiple solution repair options', yBounds: yb(0) },
      { text: 'replaced', yBounds: yb(1) },
      { text: 'Press replacd in 2016 - noticed shifting', yBounds: yb(2) },
      { text: 'Tm scope: thought disi, differing weeks (cohrs-hrs down)', yBounds: yb(3) },
      { text: '(6) Cores', yBounds: yb(4) },
      { text: 'GPR', yBounds: yb(5) }
    ];
    const model = classifyRelink(lines, ms);
    const leftAt = (j) => model.rows.find((r) => r.type === 'leftover' && r.ms === j);

    it('suggests the nearby line sharing the most words, below or with no ink', () => {
      expect(model.rows.map((r) => r.type)).toEqual(['matched', 'leftover', 'matched', 'noink', 'noink', 'leftover', 'leftover', 'matched']);
      expect(leftAt(1)).toMatchObject({ joinTo: 'b', joinToN: 2 });
      expect(leftAt(3)).toMatchObject({ joinTo: 'c', joinToN: 3 });
      expect(leftAt(4)).toMatchObject({ joinTo: 'd', joinToN: 4 });
    });

    it("a no-ink line that takes leftover ink is linked, its text kept, MyScript's words offered", () => {
      const d = setLeftoverChoice(model, defaultDecisions(model), 3, LEFTOVER_JOIN);
      const row = reviewRows(model, d).find((r) => r.lineId === 'c');
      expect(row).toMatchObject({ type: 'noink', added: [3], msAll: [3], reading: ms[3].text });
      expect(row.fixes.length).toBeGreaterThan(0);
      expect(reviewRows(model, d).find((r) => r.ms === 3 && r.type === 'leftover').addedTo).toBe(3);
      expect(linkedCount(model, d)).toBe(linkedCount(model) + 1);
      const spec = buildRelinkSpec({ lines: ms }, model, d);
      expect(spec.links.find((l) => l.lineId === 'c')).toEqual({ lineId: 'c', ms: [3] });
      expect(spec.texts).toEqual({});
      // A fix taken is written; the rest of the text stays.
      const d2 = { ...d, fixes: { c: [0] } };
      expect(buildRelinkSpec({ lines: ms }, model, d2).texts.c).toBe(applyWordFixes(lines[2].text, [row.fixes[0]]));
    });

    it('any line can be picked; a linked line takes the ink beside its own, in reading order', () => {
      const d = setLeftoverChoice(model, defaultDecisions(model), 1, LEFTOVER_JOIN, 'a');
      expect(leftoverTarget(model, d, leftAt(1))).toBe('a');
      const row = reviewRows(model, d).find((r) => r.lineId === 'a');
      expect(row).toMatchObject({ msAll: [0, 1], added: [1], reading: `${ms[0].text} replaced`, breaks: [5] });
      expect(buildRelinkSpec({ lines: ms }, model, d).links.find((l) => l.lineId === 'a').ms).toEqual([0, 1]);
      // Picked to the line below instead: it moves, and two leftovers can go to one line.
      let d2 = setLeftoverChoice(model, d, 1, LEFTOVER_JOIN, 'b');
      d2 = setLeftoverChoice(model, d2, 4, LEFTOVER_JOIN, 'b');
      const spec = buildRelinkSpec({ lines: ms }, model, d2);
      expect(spec.links.find((l) => l.lineId === 'a').ms).toEqual([0]);
      expect(spec.links.find((l) => l.lineId === 'b').ms).toEqual([1, 2, 4]);
      // Back to Leave unlinked forgets the pick.
      const d3 = setLeftoverChoice(model, d2, 1, LEFTOVER_LEAVE);
      expect(d3.joinTo[1]).toBeUndefined();
      expect(buildRelinkSpec({ lines: ms }, model, d3).links.find((l) => l.lineId === 'b').ms).toEqual([2, 4]);
    });

    it('a taken fix survives a change that still offers it, and is dropped when it is gone', () => {
      const base = defaultDecisions(model);
      const bRow = model.rows.find((r) => r.lineId === 'b');
      const k = bRow.fixes.findIndex((f) => f.to === 'replacd');
      expect(k).toBeGreaterThanOrEqual(0);
      const d = setLeftoverChoice(model, { ...base, fixes: { b: [k] } }, 4, LEFTOVER_JOIN, 'b');
      const after = reviewRows(model, d).find((r) => r.lineId === 'b');
      expect(after.fixes[d.fixes.b[0]].to).toBe('replacd');
      // A no-ink line's fixes go with its added ink.
      let e = setLeftoverChoice(model, base, 3, LEFTOVER_JOIN);
      e = { ...e, fixes: { c: [0] } };
      e = setLeftoverChoice(model, e, 3, LEFTOVER_LEAVE);
      expect(e.fixes.c).toBeUndefined();
    });

    it('reviewCounts and reviewSummary follow the choices', () => {
      const base = defaultDecisions(model);
      expect(reviewCounts(model, base)).toMatchObject({ matched: 3, noink: 2, given: 0, leftover: 3, unlinked: 3, addedTo: 0, linked: 3 });
      expect(reviewSummary(reviewCounts(model, base))).toBe('');
      let d = setLeftoverChoice(model, base, 3, LEFTOVER_JOIN);
      d = setLeftoverChoice(model, d, 4, LEFTOVER_JOIN);
      d = setLeftoverChoice(model, d, 1, LEFTOVER_SKETCH);
      d = { ...d, fixes: { c: [0] } };
      const k = reviewCounts(model, d);
      expect(k).toMatchObject({ noink: 0, given: 2, leftover: 3, unlinked: 0, addedTo: 2, sketch: 1, fixes: 1, linked: 5 });
      expect(k.linked).toBe(linkedCount(model, d));
      expect(reviewSummary(k)).toBe('1 word fix, 2 leftovers added to lines, 1 sketch (from 1 row)');
      // Don't link: counted apart, and the line has no ink.
      const conf = classifyRelink([{ id: 'a', text: 'schedule site meeting' }], [{ text: 'schedule site meetup soon', yBounds: yb(0) }]);
      const k2 = reviewCounts(conf, { ...defaultDecisions(conf), link: { a: false } });
      expect(k2).toMatchObject({ confirm: 1, dontLink: 1, noink: 1, linked: 0 });
      expect(reviewSummary(k2)).toBe('1 not linked');
      expect(reviewSummary({ ...k2, dontLink: 0, newLines: 2, textless: 1 })).toBe('2 new lines, 1 left out as Not text');
    });

    it('a pick naming a line not on the page reads as Leave unlinked', () => {
      const d = { ...defaultDecisions(model), leftover: { 1: LEFTOVER_JOIN }, joinTo: { 1: 'gone' } };
      expect(leftoverTarget(model, d, leftAt(1))).toBe(null);
      expect(reviewRows(model, d)).toBe(model.rows);
    });
  });

  it('a reading without usable yBounds cannot link', () => {
    const { rows } = classifyRelink([{ id: 'a', text: 'hello there' }], [{ text: 'hello there', yBounds: { minY: 0, maxY: 0 } }]);
    expect(rows.map((r) => r.type)).toEqual(['noink', 'leftover']);
  });

  it('ignores kind lines and counts them apart', () => {
    const lines = [{ id: 'a', text: 'first line' }, { id: 'sk', kind: 'sketch', text: 'Sketch' }];
    const { rows, counts } = classifyRelink(lines, [{ text: 'first line', yBounds: yb(0) }]);
    expect(rows).toHaveLength(1);
    expect(counts.kindLines).toBe(1);
  });

  it('handles empty input', () => {
    expect(classifyRelink([], []).rows).toEqual([]);
    expect(classifyRelink(null, null).counts.matched).toBe(0);
  });
});

describe('wordFixes / applyWordFixes', () => {
  it('offers a substituted word and keeps its punctuation when taken', () => {
    const fixes = wordFixes('boing, plate at top', 'boring plate at top');
    expect(fixes).toEqual([{ at: 0, msAt: 0, from: 'boing', to: 'boring', start: 0, end: 5 }]);
    expect(applyWordFixes('boing, plate at top', fixes)).toBe('boring, plate at top');
  });

  it('offers nothing for case, punctuation or spacing alone', () => {
    expect(wordFixes('Call Tom.', 'call tom')).toEqual([]);
    expect(wordFixes('same text', 'same text')).toEqual([]);
  });

  it('ignores a task box in the reading and words only one side has', () => {
    expect(wordFixes('order steel', '☑ order steel')).toEqual([]);
    expect(wordFixes('order steel', 'order the steel')).toEqual([]);
  });

  it('offers a fix only for a plausible misreading (P123: a glued run-on is not a fix for "We’ll")', () => {
    const glued = 'mprvetmosqtoinfestatoncimpactofchhrmeonenvironment.ve’ll';
    expect(plausibleMisreading('We’ll', glued)).toBe(false);
    expect(wordFixes('We’ll need to provide a coating', `${glued} need to provide a coating`)).toEqual([]);
    expect(plausibleMisreading('boing', 'boring')).toBe(true);
    expect(wordFixes('boing plate', 'boring plate').map((f) => f.to)).toEqual(['boring']);
    expect(plausibleMisreading('teh', 'the')).toBe(true);
    expect(plausibleMisreading('beam', 'concrete')).toBe(false);   // 2x length but mostly different
    expect(plausibleMisreading('at', 'attachment')).toBe(false);    // lengths over 2x apart
    expect(plausibleMisreading('', 'x')).toBe(false);
  });

  it('applies several fixes from the right so offsets stay valid', () => {
    const text = 'teh beem is ok';
    const fixes = wordFixes(text, 'the beam is ok');
    expect(fixes.map((f) => f.to)).toEqual(['the', 'beam']);
    expect(applyWordFixes(text, fixes)).toBe('the beam is ok');
    expect(applyWordFixes(text, [fixes[1]])).toBe('teh beam is ok');
    expect(applyWordFixes(text, [])).toBe(text);
  });
});

describe('decisions → the save spec', () => {
  const doc = makeOldPage();
  const run = makeRun(doc, { overrides: { 7: 'coordinate w/ architekt' }, extra: [{ text: '☐ call Rich', y: rowY(27) + 6 }, { text: 'xxxx', y: rowY(27) + 12 }] });
  const model = classifyRelink(doc.transcript.lines, run.lines);

  it('defaults: confirm rows link, ink left over stays unlinked, no fix taken', () => {
    const d = defaultDecisions(model);
    for (const r of model.rows.filter((x) => x.type === 'confirm')) expect(d.link[r.lineId]).toBe(true);
    for (const r of model.rows.filter((x) => x.type === 'leftover')) expect(d.leftover[r.ms]).toBe(LEFTOVER_LEAVE);
    expect(d.fixes).toEqual({});
    const spec = buildRelinkSpec(run, model);
    expect(spec.texts).toEqual({});
    expect(spec.add).toEqual([]);
    expect(spec.textless).toEqual([]);
    expect(spec.links.length).toBe(model.counts.matched + model.counts.confirm);
    expect(spec.revision).toBe(doc.metadata.lastUpdated);
    expect(spec.sent).toEqual(run.sent);
  });

  it("Don't link drops the pair and its word fixes; Use takes a fix; leftover choices land", () => {
    const d = defaultDecisions(model);
    const confirm = model.rows.find((r) => r.type === 'confirm');
    expect(confirm).toBeTruthy();
    d.link[confirm.lineId] = false;
    d.fixes[confirm.lineId] = [0];
    d.fixes.L05 = [0];
    const [left1, left2] = model.rows.filter((r) => r.type === 'leftover');
    d.leftover[left1.ms] = LEFTOVER_ADD;
    d.leftover[left2.ms] = LEFTOVER_TEXTLESS;
    const spec = buildRelinkSpec(run, model, d);
    expect(spec.links.some((l) => l.lineId === confirm.lineId)).toBe(false);
    expect(spec.texts).toEqual({ L05: 'boring plate at top' });
    expect(spec.add).toEqual([{ ms: [left1.ms], text: left1.reading.trim() }]);
    expect(spec.textless).toEqual([left2.ms]);
  });

  it('linkedCount counts matched rows and confirm rows still on Link (Save needs at least one)', () => {
    const d = defaultDecisions(model);
    const all = linkedCount(model, d);
    expect(all).toBe(model.counts.matched + model.counts.confirm);
    for (const r of model.rows) if (r.type === 'confirm') d.link[r.lineId] = false;
    expect(linkedCount(model, d)).toBe(model.counts.matched);
    const allNoInk = classifyRelink([{ id: 'a', text: 'alpha beta' }], [{ text: 'zzzz qqqq', yBounds: yb(0) }]);
    expect(linkedCount(allNoInk)).toBe(0);
    expect(NO_LINKS).toMatch(/nothing to save/);
  });

  it('needs no review only when every line matched and nothing is left over', () => {
    expect(relinkNeedsNoReview(model)).toBe(false);
    expect(relinkNeedsNoReview(classifyRelink(doc.transcript.lines, makeRun(doc).lines))).toBe(true);
    expect(relinkNeedsNoReview(classifyRelink([], []))).toBe(false);
    expect(relinkNeedsNoReview(null)).toBe(false);
  });
});

describe('relinkRefusal (B.6)', () => {
  const clear = { label: 'B3017/P123', draft: false, editorOpen: false, reset: false, pendingTranscription: false };

  it('lets an untrustworthy page with text and ink through', () => {
    expect(relinkRefusal(clear, makeOldPage())).toBeNull();
  });

  it('refuses on exactly the flags Claude\'s edits refuse on', () => {
    const editBase = { ...clear, appRoot: 'C:/d', requestRoot: 'C:/d', folderReady: true };
    for (const flag of ['draft', 'editorOpen', 'reset', 'pendingTranscription']) {
      const s = { ...clear, [flag]: true };
      expect(relinkRefusal(s, makeOldPage()), flag).toBeTruthy();
      expect(editRefusal({ ...editBase, [flag]: true }), flag).toBeTruthy();
    }
    expect(editRefusal(editBase)).toBeNull();
  });

  it('refuses a letter-suffixed page whose page number is on the canvas (Relink only, not an edit guard)', () => {
    expect(relinkRefusal({ ...clear, label: 'B3017/P151b', suffixOnCanvas: true }, makeOldPage())).toMatch(/letter-suffixed.*unload it/);
  });

  it('refuses a missing page, one with no text lines, a trustworthy one and one with no ink to send', () => {
    expect(relinkRefusal(clear, null)).toMatch(/not found/);
    const empty = makeOldPage();
    empty.transcript.lines = [{ id: 'sk', kind: 'sketch', text: 'Sketch' }];
    expect(relinkRefusal(clear, empty)).toMatch(/no transcript lines/);
    const trusted = makeOldPage();
    trusted.transcript.lastTranscribed = '2026-11-01T00:00:00.000Z';
    trusted.transcript.lines.forEach((l, i) => { l.yBounds = yb(i); });
    trusted.strokes.forEach((s, k) => { s.lineId = trusted.transcript.lines[Math.floor(k / 3)].id; });
    expect(relinkRefusal(clear, trusted)).toMatch(/already linked/);
    // Relink again (confirmed in the dialog) lets a linked page through; the other guards still apply.
    expect(relinkRefusal(clear, trusted, { again: true })).toBeNull();
    expect(relinkRefusal({ ...clear, draft: true }, trusted, { again: true })).toMatch(/unsaved transcript edits/);
    expect(relinkCandidates([{ book: '3017', pageId: '1', doc: trusted }])).toEqual([]);
    const inkless = makeOldPage();
    inkless.strokes.forEach((s) => { s.textless = true; s.lineId = null; });
    expect(relinkRefusal(clear, inkless)).toMatch(/no ink/);
  });
});

describe('afterRelinkSave: the dialog never stays on Saving…', () => {
  it('a saved relink closes the dialog (phase done)', () => {
    expect(afterRelinkSave({ ok: true })).toEqual({ phase: 'done', close: true, error: '', staleNote: '' });
  });

  it('a stale page asks to send again; a refusal or a thrown save goes back to the review with the reason', () => {
    expect(afterRelinkSave({ ok: false, stale: true })).toMatchObject({ phase: 'ask', close: false, staleNote: STALE_NOTE });
    expect(afterRelinkSave({ ok: false, error: 'nope' })).toMatchObject({ phase: 'review', close: false, error: 'nope' });
    expect(afterRelinkSave(null)).toMatchObject({ phase: 'review', error: 'Save failed' });
    for (const r of [{ ok: true }, { ok: false, stale: true }, { ok: false }, undefined]) expect(afterRelinkSave(r).phase).not.toBe('saving');
  });
});

describe('the cache check', () => {
  const run = runForCache({ revision: 'r1', rotation: 90, originNcodeY: 10, sent: ['s1'], lines: [{ text: 'a', yBounds: { minY: 1, maxY: 2 }, parent: 0, children: [] }] });

  it('keeps only what Relink needs', () => {
    expect(run).toMatchObject({ revision: 'r1', rotation: 90, originNcodeY: 10, sent: ['s1'] });
    expect(run.lines[0]).toEqual({ text: 'a', yBounds: { minY: 1, maxY: 2 }, indentLevel: 0 });
    expect(typeof run.time).toBe('string');
  });

  it('is valid only for the same revision', () => {
    expect(cachedRunValid(run, 'r1')).toBe(true);
    expect(cachedRunValid(run, 'r2')).toBe(false);
    expect(cachedRunValid(run, '')).toBe(false);
    expect(cachedRunValid(null, 'r1')).toBe(false);
    expect(cachedRunValid({ ...run, originNcodeY: Infinity }, 'r1')).toBe(false);
    expect(cachedRunValid({ revision: 'r1' }, 'r1')).toBe(false);
  });
});

describe('relinkCandidates / groupCandidates', () => {
  it('lists unreliable pages with line and task counts, newest ink first', () => {
    const a = makeOldPage();
    const b = makeOldPage();
    b.strokes.forEach((s) => { s.startTime += 1e9; });
    const trusted = makeOldPage();
    trusted.transcript.lines = [];
    const rows = relinkCandidates([
      { book: '3017', pageId: '123', doc: a }, { book: '387', pageId: '5', doc: b },
      { book: '3017', pageId: '9', doc: trusted }, { book: '3017', pageId: '10', doc: null }
    ]);
    expect(rows.map((r) => r.pageId)).toEqual(['5', '123']);
    expect(rows[1]).toMatchObject({ lines: 28, tasks: 5, revision: a.metadata.lastUpdated });
    expect(groupCandidates(rows)).toEqual([
      { book: '3017', pages: 1, lines: 28, tasks: 5 }, { book: '387', pages: 1, lines: 28, tasks: 5 }
    ]);
    expect(relinkCandidates(null)).toEqual([]);
  });
});
