<!--
  SketchMarkLayer.svelte — the Library reader's Mark sketch (v3.24.0,
  docs/TRANSCRIPT-STRUCTURE-SPEC.md E.3, the approved mockup), over one page's
  ink in Ink + text.

  "Mark sketch" puts the page in box mode (stores/sketch-lines.js sketchMark;
  PageInk draws the box). A box picks the strokes wholly inside it: those in no
  text line are taken; those in a text line (or another sketch) are offered per
  line with a warning ("14 strokes are in line #16 …"): Leave them in #16
  (default) or Take them. Then Make sketch… opens the dialog. A sketch row's Add
  strokes… / Remove strokes… use the same box: added strokes join that sketch,
  removed ones are unlinked (never deleted). The page shown is the one on disk.

  Stroke by stroke (v3.29.0, lib/viewer/sketch-pick.js): the box stays up after
  the first pick, and the page shows the pick (`marks`): taken strokes in
  orange, offered ones left in their line in blue, the rest greyed. Ctrl-drag
  adds a box, Shift-drag takes one away, a plain drag starts again, and a click
  on a stroke takes it or drops it. The middle button pans.
-->
<script>
  import { sketchMark, startSketchMark, stopSketchMark, openMakeSketch, runSketch } from '$stores/sketch-lines.js';
  import { emptyPick, boxIds, applyBox, toggleStroke, setLineTaken, pickGroups, groupWarning, pickedIds, pickMarks, strokeAt } from '$lib/viewer/sketch-pick.js';
  import { plural } from '$lib/plural.js';

  export let book;
  export let pageId;
  export let doc = null;

  let sel = emptyPick();
  /** A box or click has been made since the mark began (the panel shows). */
  let touched = false;
  let busy = false;
  /** The panel sits at the page's foot, or its head when it covers the ink being picked. */
  let panelTop = false;

  $: mark = $sketchMark && $sketchMark.book === String(book) && $sketchMark.pageId === String(pageId) ? $sketchMark : null;
  let markWas = null;
  $: if (mark !== markWas) { markWas = mark; sel = emptyPick(); touched = false; }
  $: opts = mark ? { mode: mark.mode, lineId: mark.lineId } : {};

  /** PageInk's `boxMode`: up for the whole mark, so more boxes and clicks refine the pick. */
  export let boxMode = null;
  $: boxMode = mark ? { hint: touched ? '' : hintOf(mark) } : null;
  /** PageInk's `marks`: the pick in colour over the greyed page. */
  export let marks = null;
  $: marks = mark && doc ? shownMarks(pickMarks(doc, sel, opts)) : null;
  /** Nothing to show yet = no marks, so the page isn't greyed before a pick. */
  const shownMarks = (m) => (m.taken.length || m.offered.length || m.base.length ? m : null);

  const REFINE = 'Strokes in a line are left there (blue) unless taken. Drag: start again · Ctrl-drag: add · Shift-drag: take away · Click a stroke: take it or drop it · Middle-drag: pan · Esc: stop';

  function hintOf(m) {
    if (m.mode === 'add') return `Drag a box around the strokes to add to “${m.label}”`;
    if (m.mode === 'remove') return `Drag a box around the strokes to take out of “${m.label}”`;
    return 'Drag a box around the sketch';
  }

  /** PageInk's onBox. */
  export function pick(box, how = 'replace', yFrac = null) {
    if (!mark || !doc) return;
    // The panel goes to the half of the pane away from the box, so it never covers the drawing.
    if (yFrac != null && how === 'replace') panelTop = yFrac > 0.5;
    sel = applyBox(sel, doc, boxIds(doc, box, opts), how, opts);
    touched = true;
  }

  /** PageInk's onBoxClick: the stroke under the pointer in or out (Shift only drops). */
  export function click(pt, tol, how = 'replace') {
    if (!mark || !doc) return;
    const id = strokeAt(doc, pt, tol, opts);
    if (!id) return;
    if (how === 'subtract' && !sel.chosen.has(id)) return;
    sel = toggleStroke(sel, id);
    touched = true;
  }

  $: groups = mark && doc ? pickGroups(doc, sel, opts) : [];
  $: ids = mark && doc ? pickedIds(doc, sel) : [];
  $: free = ids.length - groups.reduce((n, g) => n + g.taken, 0);

  function setLine(lineId, take) {
    sel = setLineTaken(sel, doc, lineId, take);
  }

  async function apply() {
    if (!ids.length || busy) return;
    const m = mark;
    if (m.mode === 'create') {
      stopSketchMark();
      openMakeSketch(book, pageId, ids, { decided: true });
      return;
    }
    busy = true;
    const r = await runSketch(book, pageId, { op: m.mode === 'add' ? 'add-strokes' : 'remove-strokes', lineId: m.lineId, strokeIds: ids });
    busy = false;
    if (!r.error) stopSketchMark();
  }

  function clear() {
    sel = emptyPick();
    touched = false;
  }

  function toggleMark() {
    if (mark) stopSketchMark();
    else startSketchMark(book, pageId, 'create');
  }
</script>

{#if doc && (doc.strokes || []).length}
  <button type="button" class="sml-btn" class:on={mark && mark.mode === 'create'} on:click={toggleMark}
    title={mark ? 'Stop marking (Esc)' : 'Mark sketch: drag a box around a drawing to make it a sketch line in the transcript'}>
    {mark && mark.mode === 'create' ? 'Stop marking' : 'Mark sketch'}
  </button>
{/if}

{#if mark && touched}
  <div class="sml-panel" class:top={panelTop} role="dialog" aria-label="Strokes picked">
    <button type="button" class="sml-move" on:click={() => (panelTop = !panelTop)}
      title={panelTop ? 'Move this panel to the foot of the page' : 'Move this panel to the head of the page'}>{panelTop ? '▼' : '▲'}</button>
    {#if mark.mode === 'remove'}
      <p><span class="sw taken"></span><b>{ids.length} {plural(ids.length, 'stroke')}</b> of “{mark.label}” to take out of the sketch: unlinked, never deleted.</p>
    {:else}
      <p><span class="sw taken"></span><b>{ids.length} {plural(ids.length, 'stroke')}</b> {mark.mode === 'add' ? `to add to “${mark.label}”` : 'go into the sketch'}{#if free > 0 && free < ids.length}{' '}({free} in no line){/if}.
        {#if sel.offered.size}<span class="sml-left"><span class="sw offered"></span>{sel.offered.size} left in {plural(sel.offered.size, 'its line', 'their lines')}</span>{/if}</p>
      {#if groups.length}<p class="sml-sub">In transcript lines: leave them there, or take them into {mark.mode === 'add' ? 'this' : 'the'} sketch</p>{/if}
      {#each groups as g (g.lineId)}
        <div class="sml-warn" title={groupWarning(g)}>
          <span class="sml-gl"><b>#{g.n}</b>{g.sketch ? ' sketch' : ''} “{g.text.length > 28 ? `${g.text.slice(0, 27)}…` : g.text}”: {g.ids.length} {plural(g.ids.length, 'stroke')}{#if g.taken && g.taken < g.ids.length}, {g.taken} taken{/if}</span>
          <span class="sml-choice">
            <button type="button" class:sel={g.taken === 0} on:click={() => setLine(g.lineId, false)} title="Leave them in #{g.n}">Leave</button>
            <button type="button" class:sel={g.taken === g.ids.length} on:click={() => setLine(g.lineId, true)} title="Take them out of #{g.n} into the sketch">Take</button>
          </span>
        </div>
      {/each}
    {/if}
    <p class="sml-tips">{REFINE}</p>
    <div class="sml-actions">
      <button type="button" on:click={stopSketchMark}>Cancel</button>
      <button type="button" on:click={clear} title="Clear the pick and draw again">Clear</button>
      <button type="button" class="primary" disabled={!ids.length || busy} on:click={apply}>
        {mark.mode === 'create' ? `Make sketch… (${ids.length})` : mark.mode === 'add' ? `Add ${ids.length}` : `Take out ${ids.length}`}
      </button>
    </div>
  </div>
{/if}

<style>
  .sml-btn {
    position: absolute; left: 8px; top: 8px; z-index: 21;
    padding: 4px 10px; border: 1px solid #ddd; border-radius: 6px; background: rgba(255, 255, 255, 0.95);
    color: #555; font-size: 12px; cursor: pointer;
  }
  .sml-btn:hover { border-color: #f5b942; color: #222; }
  .sml-btn.on { background: #f5b942; border-color: #f5b942; color: #1c1f2b; font-weight: 600; }
  .sml-panel {
    position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 22; max-height: 42%; overflow-y: auto;
    padding: 10px 30px 10px 12px; border: 1px solid #e3d3a8; border-radius: 8px; background: #fffdf6;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); font-size: 13px; color: #333; line-height: 1.45;
  }
  .sml-panel.top { bottom: auto; top: 40px; }
  .sml-move { position: absolute; top: 6px; right: 6px; padding: 0 5px; border: 1px solid #ddd; border-radius: 4px; background: #fff; font-size: 10px; line-height: 18px; color: #666; cursor: pointer; }
  .sml-panel p { margin: 0 0 6px; }
  .sml-sub { margin: 0 0 2px !important; font-size: 12px; color: #555; }
  .sml-tips { margin: 6px 0 0 !important; font-size: 11px; color: #777; }
  .sml-left { margin-left: 8px; color: #555; white-space: nowrap; }
  .sw { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 2px; vertical-align: -1px; }
  .sw.taken { background: #e8590c; }
  .sw.offered { background: #3b82f6; }
  .sml-gl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sml-warn { display: flex; align-items: center; gap: 6px 10px; margin: 4px 0; padding: 3px 8px; border-radius: 6px; background: rgba(245, 185, 66, 0.14); border: 1px solid rgba(245, 185, 66, 0.45); }
  .sml-choice { display: inline-flex; gap: 4px; }
  .sml-choice button, .sml-actions button { padding: 4px 10px; border: 1px solid #ddd; border-radius: 5px; background: #fff; font-size: 12px; cursor: pointer; }
  .sml-choice button.sel { border-color: #b7791f; background: #fdf0d2; font-weight: 600; }
  .sml-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .sml-actions .primary { background: #e5546c; border-color: #e5546c; color: #fff; font-weight: 600; }
  .sml-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
