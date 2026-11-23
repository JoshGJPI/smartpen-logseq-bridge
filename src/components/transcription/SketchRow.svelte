<!--
  SketchRow.svelte — a sketch line in the reader's transcript (v3.24.0, the
  approved mockup's "Show"): a thumbnail cropped to its ink (PageThumb with the
  line id, thumbs.js, only when on screen), a SKETCH badge, the label, its stroke
  count and the block it is in. Hovering it outlines its ink on the page
  (`onHover`; a sketch's links are exact, so on any page).

  The ⋯ menu (interactive pages only): Rename…, Add strokes…, Remove strokes…
  (the reader's box, stores/sketch-lines.js startSketchMark), Print this sketch,
  and Remove sketch (RemoveSketchPrompt: the line goes, its strokes are never
  deleted, and its ink is Not text by default or, by choice, sent again). Every write goes through lib/viewer/sketch-lines.js saveSketchLine.
-->
<script>
  import { tick } from 'svelte';
  import { runSketch, startSketchMark, printSketch } from '$stores/sketch-lines.js';
  import { plural } from '$lib/plural.js';
  import PageThumb from '../viewer/PageThumb.svelte';
  import OverflowMenu from '../viewer/OverflowMenu.svelte';
  import RemoveSketchPrompt from './RemoveSketchPrompt.svelte';

  export let line;
  /** The stored line number (#n). */
  export let n = 0;
  export let book = null;
  export let pageId = null;
  /** Strokes linked to it, or null when not known. */
  export let count = null;
  /** "in the 6226-001 block", "under #16 …", or ''. */
  export let context = '';
  /** Writes allowed here (the reader, not a preview). */
  export let interactive = false;
  /** Why writes are off now (an unsaved draft), or ''. */
  export let lock = '';
  export let hot = false;
  export let focus = false;
  /** (line|null) => void */
  export let onHover = null;
  /** The page's ink is shown beside the text (Ink + text), so a box can be drawn on it. */
  export let boxable = false;

  const NEEDS_INK = 'Switch the reader to Ink + text to draw the box on the page';

  let renaming = false;
  let removing = false;
  let draft = '';
  let field;

  $: items = [
    { label: 'Rename…', onSelect: startRename, disabled: !!lock, title: lock || 'Change the sketch’s label' },
    { label: 'Add strokes…', onSelect: () => startSketchMark(book, pageId, 'add', line), disabled: !!lock || !boxable,
      title: lock || (boxable ? 'Drag a box on the page: the strokes wholly inside join this sketch' : NEEDS_INK) },
    { label: 'Remove strokes…', onSelect: () => startSketchMark(book, pageId, 'remove', line), disabled: !!lock || !boxable,
      title: lock || (boxable ? 'Drag a box on the page: this sketch’s strokes inside it are unlinked (never deleted)' : NEEDS_INK) },
    { label: 'Print this sketch', onSelect: () => printSketch(book, pageId, line.id), title: 'Print its ink on its page’s paper' },
    { label: 'Remove sketch…', onSelect: remove, disabled: !!lock, title: lock || 'The line goes; its strokes stay on the page (never deleted), left out as Not text unless you choose otherwise' }
  ];

  async function startRename() {
    draft = line.text || '';
    renaming = true;
    await tick();
    field && field.select();
  }

  async function commitRename() {
    if (!renaming) return;
    renaming = false;
    if ((draft || '').trim() === (line.text || '').trim()) return;
    await runSketch(book, pageId, { op: 'rename', lineId: line.id, label: draft });
  }

  function onKey(e) {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renaming = false; }
  }

  function remove() {
    removing = true;
  }

  async function confirmRemove(ink) {
    removing = false;
    await runSketch(book, pageId, { op: 'remove', lineId: line.id, ink });
  }
</script>

{#if removing}
  <RemoveSketchPrompt label={line.text} {count} onConfirm={confirmRemove} onCancel={() => (removing = false)} />
{/if}
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="sk-row" class:hot class:focus style="padding-left: {(line.indentLevel || 0) * 1.5}rem"
  on:mouseenter={() => onHover && onHover(line)} on:mouseleave={() => onHover && onHover(null)}>
  {#if book != null}
    <div class="sk-thumb"><PageThumb {book} {pageId} lineId={line.id} height="72px" /></div>
  {/if}
  <div class="sk-main">
    <div class="sk-title">
      <span class="sk-badge">SKETCH</span>
      {#if renaming}
        <input class="sk-input" bind:this={field} bind:value={draft} on:keydown={onKey} on:blur={commitRename}
          placeholder="Sketch" aria-label="Sketch label" />
      {:else}
        <span class="sk-label">{line.text}</span>
      {/if}
    </div>
    <div class="sk-sub">
      {#if count != null}{count} {plural(count, 'stroke')}{/if}{#if context}{count != null ? ' · ' : ''}{context}{/if}
      {#if n}<span class="sk-n">#{n}</span>{/if}
    </div>
  </div>
  {#if interactive}
    <span class="sk-menu"><OverflowMenu {items} label="Sketch line actions" quiet /></span>
  {/if}
</div>

<style>
  .sk-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 3px 0;
    padding-top: 4px;
    padding-bottom: 4px;
    border-radius: 6px;
    background: rgba(245, 185, 66, 0.07);
    box-shadow: inset 0 1px 0 rgba(245, 185, 66, 0.25), inset 0 -1px 0 rgba(245, 185, 66, 0.25);
  }
  .sk-row.hot { background: rgba(245, 185, 66, 0.18); }
  .sk-row.focus { box-shadow: inset 3px 0 0 #e0b400; background: #fff6d6; }
  .sk-thumb { flex: 0 0 88px; border: 1px solid #eee; border-radius: 5px; overflow: hidden; background: #fff; }
  .sk-thumb :global(.thumb) { padding: 3px; }
  .sk-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .sk-title { display: flex; align-items: center; gap: 8px; }
  .sk-badge { flex-shrink: 0; padding: 0 6px; border-radius: 4px; background: #f5b942; color: #1c1f2b; font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; }
  .sk-label { font-weight: 600; overflow-wrap: anywhere; }
  .sk-input { flex: 1; min-width: 0; padding: 2px 6px; border: 1px solid #4a7cf7; border-radius: 4px; font: inherit; }
  .sk-sub { font-size: 12px; color: #888; }
  .sk-n { margin-left: 6px; color: #aaa; }
  .sk-menu { flex-shrink: 0; opacity: 0; }
  .sk-row:hover .sk-menu, .sk-menu:focus-within { opacity: 1; }
</style>
