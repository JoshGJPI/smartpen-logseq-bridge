<!--
  SketchMarkLayer.svelte — the Library reader's Mark sketch (v3.24.0,
  docs/TRANSCRIPT-STRUCTURE-SPEC.md E.3, the approved mockup), over one page's
  ink in Ink + text.

  "Mark sketch" puts the page in box mode (stores/sketch-lines.js sketchMark;
  PageInk draws the box). A box picks the strokes wholly inside it
  (lib/viewer/sketch-lines.js boxPick): those in no text line are taken; those
  in a text line (or another sketch) are offered per line with a warning
  ("14 strokes are in line #16 …"): Leave them in #16 (default) or Take them.
  Then Make sketch… opens the dialog. A sketch row's Add strokes… / Remove
  strokes… use the same box: added strokes join that sketch, removed ones are
  unlinked (never deleted). The page shown is the one on disk (the reader's doc).
-->
<script>
  import { sketchMark, startSketchMark, stopSketchMark, openMakeSketch, runSketch } from '$stores/sketch-lines.js';
  import { boxPick, inLineWarning } from '$lib/viewer/sketch-lines.js';
  import { plural } from '$lib/plural.js';

  export let book;
  export let pageId;
  export let doc = null;

  /** The last box's pick, and which offered lines the user takes. */
  let picked = null;
  let takeLines = new Set();
  let busy = false;

  $: mark = $sketchMark && $sketchMark.book === String(book) && $sketchMark.pageId === String(pageId) ? $sketchMark : null;
  $: if (!mark) picked = null;
  /** PageInk's `boxMode`: the hint while a box is to be drawn, null when not. */
  export let boxMode = null;
  $: boxMode = mark && !picked ? { hint: hintOf(mark) } : null;

  function hintOf(m) {
    if (m.mode === 'add') return `Drag a box around the strokes to add to “${m.label}”`;
    if (m.mode === 'remove') return `Drag a box around the strokes to take out of “${m.label}”`;
    return 'Drag a box around the sketch';
  }

  /** PageInk's onBox. */
  export function pick(box) {
    if (!mark || !doc) return;
    picked = boxPick(doc, box, { lineId: mark.lineId, remove: mark.mode === 'remove' });
    takeLines = new Set();
  }

  function toggleLine(id, on) {
    const next = new Set(takeLines);
    on ? next.add(id) : next.delete(id);
    takeLines = next;
  }

  $: ids = picked ? [...picked.take, ...picked.inLines.filter((g) => takeLines.has(g.lineId)).flatMap((g) => g.ids)] : [];

  async function apply() {
    if (!ids.length || busy) return;
    const m = mark;
    if (m.mode === 'create') {
      stopSketchMark();
      openMakeSketch(book, pageId, ids);
      return;
    }
    busy = true;
    const r = await runSketch(book, pageId, { op: m.mode === 'add' ? 'add-strokes' : 'remove-strokes', lineId: m.lineId, strokeIds: ids });
    busy = false;
    if (!r.error) stopSketchMark();
  }

  function again() {
    picked = null;
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

{#if mark && picked}
  <div class="sml-panel" role="dialog" aria-label="Strokes in the box">
    {#if mark.mode === 'remove'}
      <p><b>{picked.take.length} {plural(picked.take.length, 'stroke')}</b> of “{mark.label}” in the box: taken out of the sketch, unlinked (never deleted).</p>
    {:else}
      <p><b>{picked.take.length} {plural(picked.take.length, 'stroke')}</b> wholly inside and in no text line {picked.take.length === 1 ? 'is' : 'are'} taken{#if mark.mode === 'add'} into “{mark.label}”{/if}.</p>
      {#each picked.inLines as g (g.lineId)}
        <div class="sml-warn">
          <span>{inLineWarning(g)}. Leave them in that {g.sketch ? 'sketch' : 'line'}, or take them into {mark.mode === 'add' ? 'this' : 'the'} sketch?</span>
          <span class="sml-choice">
            <button type="button" class:sel={!takeLines.has(g.lineId)} on:click={() => toggleLine(g.lineId, false)}>Leave in #{g.n}</button>
            <button type="button" class:sel={takeLines.has(g.lineId)} on:click={() => toggleLine(g.lineId, true)}>Take them</button>
          </span>
        </div>
      {/each}
    {/if}
    <div class="sml-actions">
      <button type="button" on:click={stopSketchMark}>Cancel</button>
      <button type="button" on:click={again}>Draw again</button>
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
    position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 22; max-height: 60%; overflow-y: auto;
    padding: 10px 12px; border: 1px solid #e3d3a8; border-radius: 8px; background: #fffdf6;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); font-size: 13px; color: #333; line-height: 1.45;
  }
  .sml-panel p { margin: 0 0 6px; }
  .sml-warn { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 6px 0; padding: 6px 8px; border-radius: 6px; background: rgba(245, 185, 66, 0.14); border: 1px solid rgba(245, 185, 66, 0.45); }
  .sml-choice { display: inline-flex; gap: 4px; }
  .sml-choice button, .sml-actions button { padding: 4px 10px; border: 1px solid #ddd; border-radius: 5px; background: #fff; font-size: 12px; cursor: pointer; }
  .sml-choice button.sel { border-color: #b7791f; background: #fdf0d2; font-weight: 600; }
  .sml-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .sml-actions .primary { background: #e5546c; border-color: #e5546c; color: #fff; font-weight: 600; }
  .sml-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
