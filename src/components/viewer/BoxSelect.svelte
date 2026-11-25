<!--
  BoxSelect.svelte — drag a box over a page's ink in the Library reader
  (v3.24.0, Mark sketch / Add strokes… / Remove strokes…). Covers PageInk's
  canvas while the reader is in box mode, so a drag draws a box instead of
  panning (the wheel still zooms). On release the box is handed back in Ncode
  (`onBox`), through PageInk's `toNcode`, which follows zoom, pan and the page's
  display rotation (all four corners are mapped, so a turned page gives the
  right box). Escape leaves box mode (`onCancel`).

  v3.29.0: the box says how it applies (`'replace'`, Ctrl `'add'`, Shift
  `'subtract'`), a click without a drag is handed back as a point with a hit
  tolerance (`onClick`), and the middle button passes through so PageInk pans.
-->
<script>
  /** (clientX, clientY) => { x, y } in Ncode */
  export let toNcode;
  /** ({ minX, maxX, minY, maxY }, how, yFrac) => void; yFrac = the box's middle down the pane, 0–1 */
  export let onBox = () => {};
  export let onCancel = () => {};
  /** ({ x, y } in Ncode, tolerance in Ncode, how) => void: a click without a drag. */
  export let onClick = null;
  /** Shown in the corner while no box is drawn. */
  export let hint = 'Drag a box around the ink';

  let el;
  let start = null;
  let end = null;
  let how = 'replace';
  const MIN_PX = 6;
  /** A click hits ink within this many screen pixels. */
  const HIT_PX = 6;

  const howOf = (e) => ((e.ctrlKey || e.metaKey) ? 'add' : e.shiftKey ? 'subtract' : 'replace');

  function rel(e) {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
  }

  function down(e) {
    if (e.button !== 0) return;          // the middle button pans (PageInk)
    e.preventDefault();
    e.stopPropagation();
    how = howOf(e);
    start = rel(e);
    end = start;
  }
  function move(e) {
    if (!start) return;
    e.stopPropagation();
    end = rel(e);
  }
  function up(e) {
    if (!start) return;
    end = rel(e);
    const a = start, b = end;
    start = null;
    e.stopPropagation();
    if (Math.abs(a.x - b.x) < MIN_PX && Math.abs(a.y - b.y) < MIN_PX) {
      end = null;
      const p = toNcode(b.cx, b.cy);
      const q = toNcode(b.cx + HIT_PX, b.cy);
      if (onClick && p && q) onClick(p, Math.hypot(q.x - p.x, q.y - p.y), howOf(e));
      return;
    }
    if (Math.abs(a.x - b.x) < MIN_PX || Math.abs(a.y - b.y) < MIN_PX) { end = null; return; }
    const pts = [toNcode(a.cx, a.cy), toNcode(b.cx, a.cy), toNcode(a.cx, b.cy), toNcode(b.cx, b.cy)].filter(Boolean);
    end = null;
    if (pts.length < 4) return;
    onBox({
      minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y))
    }, how, ((a.y + b.y) / 2) / (el.clientHeight || 1));
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
  on:mousedown={down}
  on:mousemove={move}
  on:mouseup={up}
  on:mouseleave={() => { start = null; end = null; }}>
  {#if rect}
    <div class="bs-rect" class:add={how === 'add'} class:sub={how === 'subtract'} style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px;"></div>
  {:else if hint}
    <div class="bs-hint">{hint} · Esc to stop</div>
  {/if}
</div>

<style>
  .bs { position: absolute; inset: 0; z-index: 15; cursor: crosshair; }
  .bs-rect { position: absolute; border: 2px solid #f5b942; background: rgba(245, 185, 66, 0.12); border-radius: 2px; pointer-events: none; }
  .bs-rect.add { border-style: dashed; }
  .bs-rect.sub { border: 2px dashed #8a93a6; background: rgba(138, 147, 166, 0.12); }
  .bs-hint {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); max-width: calc(100% - 24px); text-align: center;
    padding: 4px 10px; border-radius: 6px; background: rgba(28, 31, 43, 0.85); color: #fff; font-size: 12px; pointer-events: none;
  }
</style>
