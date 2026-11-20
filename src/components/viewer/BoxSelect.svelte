<!--
  BoxSelect.svelte — drag a box over a page's ink in the Library reader
  (v3.24.0, Mark sketch / Add strokes… / Remove strokes…). Covers PageInk's
  canvas while the reader is in box mode, so a drag draws a box instead of
  panning (the wheel still zooms). On release the box is handed back in Ncode
  (`onBox`), through PageInk's `toNcode`, which follows zoom, pan and the page's
  display rotation (all four corners are mapped, so a turned page gives the
  right box). Escape leaves box mode (`onCancel`).
-->
<script>
  /** (clientX, clientY) => { x, y } in Ncode */
  export let toNcode;
  /** ({ minX, maxX, minY, maxY }) => void */
  export let onBox = () => {};
  export let onCancel = () => {};
  /** Shown in the corner while no box is drawn. */
  export let hint = 'Drag a box around the ink';

  let el;
  let start = null;
  let end = null;
  const MIN_PX = 6;

  function rel(e) {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
  }

  function down(e) {
    if (e.button !== 0) return;
    start = rel(e);
    end = start;
  }
  function move(e) {
    if (start) end = rel(e);
  }
  function up(e) {
    if (!start) return;
    end = rel(e);
    const a = start, b = end;
    start = null;
    if (Math.abs(a.x - b.x) < MIN_PX || Math.abs(a.y - b.y) < MIN_PX) { end = null; return; }
    const pts = [toNcode(a.cx, a.cy), toNcode(b.cx, a.cy), toNcode(a.cx, b.cy), toNcode(b.cx, b.cy)].filter(Boolean);
    end = null;
    if (pts.length < 4) return;
    onBox({
      minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y))
    });
  }

  function onKey(e) {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  }

  $: rect = start && end ? {
    left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y)
  } : null;
</script>

<svelte:window on:keydown|capture={onKey} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="bs" bind:this={el}
  on:mousedown|stopPropagation|preventDefault={down}
  on:mousemove|stopPropagation={move}
  on:mouseup|stopPropagation={up}
  on:mouseleave={() => { start = null; end = null; }}>
  {#if rect}
    <div class="bs-rect" style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px;"></div>
  {:else}
    <div class="bs-hint">{hint} · Esc to stop</div>
  {/if}
</div>

<style>
  .bs { position: absolute; inset: 0; z-index: 15; cursor: crosshair; }
  .bs-rect { position: absolute; border: 2px solid #f5b942; background: rgba(245, 185, 66, 0.12); border-radius: 2px; pointer-events: none; }
  .bs-hint {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
    padding: 4px 10px; border-radius: 6px; background: rgba(28, 31, 43, 0.85); color: #fff; font-size: 12px; pointer-events: none;
  }
</style>
