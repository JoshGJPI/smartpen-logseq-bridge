/**
 * Tests for lib/relink-plan.js through save-page.js planTranscript(…, { relink })
 * (v3.21.0, spec B.3): only yBounds, stroke links, taken word fixes and added
 * lines change; ids, text, order, indent, parentId, checked and marker never do;
 * only sent strokes are relinked; leftover ink keeps its own strokes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/storage/local-store.js', () => ({ getPage: vi.fn(), savePage: vi.fn(), deletePage: vi.fn() }));
vi.mock('$stores/pending-changes.js', () => ({ noteOnDiskStrokeIds: vi.fn() }));

import { planTranscript } from '../storage/save-page.js';
import { planRelink } from '../relink-plan.js';
import { classifyRelink, buildRelinkSpec, defaultDecisions, LEFTOVER_ADD, LEFTOVER_TEXTLESS } from '../relink.js';
import { makeOldPage, makeRun, makeMovedPage, rowY, ORIGIN } from './fixtures/relink-page.js';

const keyFields = (l) => ({ id: l.id, text: l.text, indentLevel: l.indentLevel, parentId: l.parentId, checked: l.checked, marker: l.marker });

function plan(doc, run, decide = () => {}) {
  const model = classifyRelink(doc.transcript.lines, run.lines);
  const d = defaultDecisions(model);
  decide(d, model);
  const spec = buildRelinkSpec(run, model, d);
  return { spec, model, out: planTranscript(doc.transcript.lines, null, doc.strokes, ORIGIN, { relink: spec }) };
}

describe('planTranscript(…, { relink })', () => {
  it('keeps every line field but yBounds and links each stroke to its own line', () => {
    const doc = makeOldPage();
    const { out } = plan(doc, makeRun(doc));
    expect(out.relink).toBe(true);
    expect(out.lines.map(keyFields)).toEqual(doc.transcript.lines.map(keyFields));
    expect(out.changed).toBe(false);
    expect(out.linesAdded).toBe(0);
    expect(out.linked).toBe(28);
    out.lines.forEach((l, i) => expect(l.yBounds).not.toEqual(doc.transcript.lines[i].yBounds));
    doc.strokes.forEach((s, k) => expect(out.lineIdAssignments.get(s.id)).toBe(doc.transcript.lines[Math.floor(k / 3)].id));
    expect(out.textlessIds.size).toBe(0);
    expect(out.deletedInkIds.size).toBe(0);
  });

  it('ignores pageTranscription when relinking and is the plain plan without relink', () => {
    const doc = makeOldPage();
    const none = planTranscript(doc.transcript.lines, null, doc.strokes, ORIGIN);
    expect(none.changed).toBe(false);
    expect(none.lineIdAssignments.size).toBe(0);
  });

  it('a no-ink line keeps its fields but loses its pre-fix yBounds; strokes in no pair end unlinked', () => {
    const doc = makeOldPage();
    const { out } = plan(doc, makeRun(doc, { drop: [10] }));
    const l10 = out.lines.find((l) => l.id === 'L10');
    expect(l10).toEqual({ ...doc.transcript.lines[10], yBounds: null });
    expect(keyFields(l10)).toEqual(keyFields(doc.transcript.lines[10]));
    for (const s of doc.strokes.slice(30, 33)) expect(out.lineIdAssignments.get(s.id)).toBeNull();
  });

  it("Don't link leaves the line's ink unlinked", () => {
    const doc = makeOldPage();
    const run = makeRun(doc, { overrides: { 7: 'coordinate w/ architekt' } });
    const { out, model } = plan(doc, run, (d) => { d.link.L07 = false; });
    expect(model.rows.find((r) => r.lineId === 'L07').type).toBe('confirm');
    for (const s of doc.strokes.slice(21, 24)) expect(out.lineIdAssignments.get(s.id)).toBeNull();
    expect(out.lines[7]).toEqual({ ...doc.transcript.lines[7], yBounds: null });
  });

  it('a taken word fix changes only that line\'s text, never its task state', () => {
    const doc = makeOldPage();
    doc.transcript.lines[5].checked = false;
    doc.transcript.lines[5].marker = 'WAITING';
    const { out } = plan(doc, makeRun(doc), (d) => { d.fixes.L05 = [0]; });
    expect(out.lines[5]).toMatchObject({ id: 'L05', text: 'boring plate at top', checked: false, marker: 'WAITING', indentLevel: 2 });
    expect(out.changed).toBe(true);
    out.lines.forEach((l, i) => { if (i !== 5) expect(keyFields(l)).toEqual(keyFields(doc.transcript.lines[i])); });
  });

  it('only sent strokes are relinked; textless and kind-line strokes are never touched', () => {
    const doc = makeOldPage();
    doc.strokes[0].textless = true;
    doc.strokes[0].lineId = null;
    doc.transcript.lines.push({ id: 'sk', kind: 'sketch', text: 'Sketch', indentLevel: 0, parentId: null, checked: null, yBounds: null });
    doc.strokes[1].lineId = 'sk';
    const run = makeRun(doc);
    run.sent = run.sent.filter((id) => id !== doc.strokes[1].id);
    // Even a spec that lists a kind line's stroke as sent cannot move it.
    const { out } = plan(doc, { ...run, sent: [...run.sent, doc.strokes[1].id] });
    expect(out.lineIdAssignments.has(doc.strokes[0].id)).toBe(false);
    expect(out.lineIdAssignments.has(doc.strokes[1].id)).toBe(false);
    expect(out.lines.find((l) => l.id === 'sk')).toEqual(doc.transcript.lines.find((l) => l.id === 'sk'));
  });

  it('reports the written links for the canvas copy, and links nothing when every line is unlinked', () => {
    const doc = makeOldPage();
    const { out } = plan(doc, makeRun(doc));
    expect(out.links[doc.strokes[0].id]).toBe('L00');
    const none = planRelink(doc.transcript.lines, { myscriptLines: [], links: [], sent: doc.strokes.map((s) => s.id) }, doc.strokes, ORIGIN);
    expect(none.linked).toBe(0);
    expect(none.lines.every((l) => l.yBounds === null)).toBe(true);
  });

  it('a kind line keeps its yBounds / bounds untouched', () => {
    const lines = [{ id: 'sk', kind: 'sketch', text: 'Sketch', yBounds: { minY: 1, maxY: 2 } }];
    expect(planRelink(lines, { myscriptLines: [], links: [], sent: [] }, [], ORIGIN).lines[0]).toBe(lines[0]);
  });

  it('linking moved lines (3017/180) changes only their yBounds and ink, never order, indent, parentId or text', () => {
    const doc = makeMovedPage();
    const { out, model } = plan(doc, makeRun(doc));
    expect(model.counts.moved).toBe(3);
    expect(out.lines.map(keyFields)).toEqual(doc.transcript.lines.map(keyFields));
    expect(out.lines.slice(-3).map((l) => l.id)).toEqual(['L10', 'L11', 'L12']);
    expect(out.linked).toBe(28);
    // Their ink, written mid-page (rows 10-12), is theirs.
    const rowsOf = (o, id) => doc.strokes.filter((s) => o.lineIdAssignments.get(s.id) === id).map((s) => s.points[0][1]);
    expect(rowsOf(out, 'L10')).toEqual([rowY(10), rowY(10), rowY(10)]);
    expect(rowsOf(out, 'L12')).toEqual([rowY(12), rowY(12), rowY(12)]);
    expect(out.lines.at(-1).yBounds).not.toBeNull();
    // Don't link on a moved row: its ink stays unlinked, its yBounds go.
    const off = plan(doc, makeRun(doc), (d) => { d.link.L11 = false; }).out;
    expect(rowsOf(off, 'L11')).toEqual([]);
    expect(doc.strokes.slice(33, 36).map((s) => off.lineIdAssignments.get(s.id))).toEqual([null, null, null]);
    expect(off.lines.find((l) => l.id === 'L11').yBounds).toBeNull();
  });

  it('a link to a kind line is refused', () => {
    const doc = makeOldPage();
    doc.transcript.lines.push({ id: 'sk', kind: 'sketch', text: 'Sketch', indentLevel: 0, parentId: null, checked: null, yBounds: null });
    const out = planRelink(doc.transcript.lines, { myscriptLines: [{ text: 'x', yBounds: { minY: 1, maxY: 2 } }], links: [{ lineId: 'sk', ms: 0 }], sent: [] }, doc.strokes, ORIGIN);
    expect(out.linked).toBe(0);
  });

  it('ink left over keeps its strokes: unlinked by default, Not text when chosen', () => {
    const doc = makeOldPage();
    const y = rowY(27) + 6;
    doc.strokes.push({ id: 's9', startTime: 9, endTime: 10, lineId: 'L27', points: [[20, y], [30, y + 2]] });
    const run = makeRun(doc, { extra: [{ text: 'scribble', y }] });
    const left = plan(doc, run).out;
    expect(left.lineIdAssignments.get('s9')).toBeNull();
    const tl = plan(doc, run, (d, m) => { d.leftover[m.rows.find((r) => r.type === 'leftover').ms] = LEFTOVER_TEXTLESS; }).out;
    expect([...tl.textlessIds]).toEqual(['s9']);
    expect(tl.lineIdAssignments.get('s9')).toBeNull();
    expect(tl.lines).toHaveLength(28);
  });

  it('Add as new line: a new id, MyScript\'s text (a box read as on transcription), placed by y, linked', () => {
    const doc = makeOldPage();
    // Between line 9 (indent 0, has children) and line 10.
    const y = rowY(9) + 2.5;
    doc.strokes.push({ id: 's9', startTime: 9, endTime: 10, lineId: null, points: [[60, y + 0.2], [70, y + 0.4]] });
    const run = makeRun(doc, { extra: [{ text: '☐ ask about piles', y: y + 0.2 }] });
    const { out } = plan(doc, run, (d, m) => { d.leftover[m.rows.find((r) => r.type === 'leftover').ms] = LEFTOVER_ADD; });
    expect(out.linesAdded).toBe(1);
    const at = out.lines.findIndex((l) => l.text === 'ask about piles');
    expect(at).toBe(10);
    const added = out.lines[at];
    expect(added).toMatchObject({ checked: false, indentLevel: 1, parentId: 'L09' });
    expect(doc.transcript.lines.some((l) => l.id === added.id)).toBe(false);
    expect(out.lineIdAssignments.get('s9')).toBe(added.id);
    // Every stored line is still there, in order, unchanged.
    expect(out.lines.filter((l) => l.id !== added.id).map(keyFields)).toEqual(doc.transcript.lines.map(keyFields));
  });

  it('a new line below the last linked line follows it as a sibling; with no links at all it goes at the end', () => {
    const doc = makeOldPage();
    const y = rowY(27) + 6;
    const run = makeRun(doc, { extra: [{ text: 'last thought', y }] });
    const { out } = plan(doc, run, (d, m) => { d.leftover[m.rows.find((r) => r.type === 'leftover').ms] = LEFTOVER_ADD; });
    expect(out.lines[28]).toMatchObject({ text: 'last thought', indentLevel: 1, parentId: 'L24' });
    const lone = planRelink([{ id: 'a', text: 'a', indentLevel: 0, parentId: null, checked: null }],
      { myscriptLines: [{ text: 'new', yBounds: { minY: 2, maxY: 3 } }], links: [], add: [0], sent: [] }, [], ORIGIN, { newId: () => 'n1' });
    expect(lone.lines.map((l) => l.id)).toEqual(['a', 'n1']);
  });

  it('a new line above the first linked line goes before it', () => {
    const lines = [{ id: 'a', text: 'first', indentLevel: 1, parentId: 'p', checked: null }];
    const out = planRelink(lines, {
      myscriptLines: [{ text: 'above', yBounds: { minY: 1.7, maxY: 2.5 } }, { text: 'first', yBounds: { minY: 5, maxY: 6 } }],
      links: [{ lineId: 'a', ms: 1 }], add: [0], sent: []
    }, [], ORIGIN, { newId: () => 'n0' });
    expect(out.lines.map((l) => l.id)).toEqual(['n0', 'a']);
    expect(out.lines[0]).toMatchObject({ indentLevel: 1, parentId: 'p' });
  });
});
