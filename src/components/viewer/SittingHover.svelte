<!--
  SittingHover.svelte — Book View's hover-to-reveal capture time.

  Sits over one page's SVG (inside PageSpreadView's .pv-canvas). Hovering ink
  finds the sitting it was written in (lib/viewer/page-sittings.js) and reports
  it through `bind:hot`; the page then draws that sitting in ink and the rest
  grey (SittingInk + a class on the SVG), and this layer shows the sitting's
  date and time just outside the top-right corner of its ink.

  Built for dense pages: the sittings and a segment grid are computed once per
  page load, pointer moves are coalesced to one hit-test per animation frame,
  and `hot` changes only when the pointer crosses into another sitting, so the
  page's own paths never re-render. Pointer → Ncode goes through the SVG's
  screen matrix, so it holds under zoom, pan and any transform on the page.
-->
<script>
  import { onDestroy } from 'svelte';
  import { NCODE_SCALE } from '$lib/viewer/page-svg.js';
  import { pageSittings, buildHitIndex, hitTest, hoverTolerance, formatSittingLabel } from '$lib/viewer/page-sittings.js';
  import { sittingHoverEnabled } from '$stores';

  /** The page's <svg>, whose user units are Ncode × NCODE_SCALE from viewBounds' corner. */
  export let svgEl = null;
  /** The PageDoc's strokes. */
  export let strokes = [];
  /** { minX, minY, ... } the SVG is drawn from. */
  export let viewBounds = null;
  /** Anything that changes when the page moves on screen (zoom, pan), so the label follows. */
  export let view = '';
  /** True while the page is being dragged: no highlight then. */
  export let paused = false;
  /** Out: the hovered sitting `{ index, startTime, endTime, strokes, bounds }`, or null. */
  export let hot = null;

  let layerEl;
  let labelEl;
  let label = '';
  let labelPos = null;   // { left, top } in px within the layer
  let model = null;
  let frame = 0;
  let pending = null;    // last pointer position not yet tested
  let attached = null;

  $: model = $sittingHoverEnabled ? buildModel(strokes) : null;
  $: if (!model || paused) setHot(null);
  $: attach(svgEl);
  $: label = hot ? formatSittingLabel(hot.startTime, hot.endTime) : '';
  $: schedulePlace(hot, view, label);

  function buildModel(list) {
    const { groups, groupOf } = pageSittings(list);
    return { groups, groupOf, index: buildHitIndex(list, groupOf) };
  }

  function attach(el) {
    if (attached === el) return;
    if (attached) {
      attached.removeEventListener('pointermove', onMove);
      attached.removeEventListener('pointerleave', onLeave);
    }
    attached = el;
    if (el) {
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerleave', onLeave);
    }
  }

  function onMove(e) {
    pending = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(runHitTest);
  }

  function onLeave() {
    pending = null;
    setHot(null);
  }

  function runHitTest() {
    frame = 0;
    const p = pending;
    pending = null;
    if (!p || !model || paused || !svgEl || !viewBounds) return;
    const m = svgEl.getScreenCTM();
    if (!m) return;
    const u = new DOMPoint(p.x, p.y).matrixTransform(m.inverse());
    const x = u.x / NCODE_SCALE + viewBounds.minX;
    const y = u.y / NCODE_SCALE + viewBounds.minY;
    const tol = hoverTolerance(NCODE_SCALE * Math.hypot(m.a, m.b));
    const si = hitTest(model.index, x, y, tol);
    setHot(si >= 0 ? model.groups[model.groupOf[si]] : null);
  }

  function setHot(g) {
    if ((g || null) !== hot) hot = g || null;
  }

  // Placed after the DOM settles (the transform for a new zoom/pan has to be
  // applied before the SVG's screen matrix reflects it).
  function schedulePlace() {
    if (!hot) { labelPos = null; return; }
    requestAnimationFrame(place);
  }

  function place() {
    const g = hot;
    if (!g || !g.bounds || !svgEl || !layerEl || !viewBounds) { labelPos = null; return; }
    const m = svgEl.getScreenCTM();
    if (!m) return;
    const b = g.bounds;
    let right = -Infinity, top = Infinity;
    for (const [nx, ny] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
      const s = new DOMPoint((nx - viewBounds.minX) * NCODE_SCALE, (ny - viewBounds.minY) * NCODE_SCALE).matrixTransform(m);
      if (s.x > right) right = s.x;
      if (s.y < top) top = s.y;
    }
    const host = layerEl.getBoundingClientRect();
    const w = labelEl ? labelEl.offsetWidth : 0;
    const h = labelEl ? labelEl.offsetHeight : 0;
    const GAP = 4, EDGE = 6;
    let left = right - host.left + GAP;
    let y = top - host.top - h - GAP;
    // Keep it in the pane: slide in from the right edge, drop below the top.
    left = Math.max(EDGE, Math.min(left, host.width - w - EDGE));
    y = Math.max(EDGE, Math.min(y, host.height - h - EDGE));
    labelPos = { left, top: y };
  }

  onDestroy(() => {
    attach(null);
    if (frame) cancelAnimationFrame(frame);
  });
</script>

<div class="sh-layer" bind:this={layerEl} aria-live="polite">
  {#if hot && label}
    <div
      class="sh-label"
      bind:this={labelEl}
      style={labelPos ? `left:${labelPos.left}px;top:${labelPos.top}px` : 'visibility:hidden'}
    >{label}</div>
  {/if}
</div>

<style>
  .sh-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 5;
  }

  /* Opaque enough to read over ink and printed paper alike. */
  .sh-label {
    position: absolute;
    white-space: nowrap;
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid #d6d8e0;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16);
    font-size: 12px;
    font-weight: 500;
    color: #1a1a2e;
    font-variant-numeric: tabular-nums;
  }
</style>
