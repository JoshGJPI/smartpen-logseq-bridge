<!--
  SittingHover.svelte — Book View's hover-to-reveal capture time.

  Sits over one page's SVG (inside PageInk's .pi-canvas). Hovering ink
  finds the day it was written (lib/viewer/page-sittings.js) and reports it
  through `bind:hot`; the page then draws that day's ink black and the rest grey
  (SittingInk + a class on the SVG), and this layer shows the date and time just
  outside the top-right corner of its ink. Clicking ink fires `open` with the
  day, which the page turns into "show this day in the Timeline". A press
  that moves more than CLICK_SLOP px is a pan, not a click.

  Built for dense pages: the groups (passed in as `dayModel`, shared with the
  page's written-on ribbon) and a segment grid are computed once per page load, pointer moves are coalesced to one hit-test per animation frame,
  and `hot` changes only when the pointer crosses into another group, so the
  page's own paths never re-render. Pointer → Ncode goes through the screen
  matrix of the page's content (`frameEl`, the rotated group), so it holds under
  zoom, pan and page rotation.
-->
<script>
  import { onDestroy, createEventDispatcher } from 'svelte';
  import { NCODE_SCALE } from '$lib/viewer/page-svg.js';
  import { buildHitIndex, hitTest, hoverTolerance, formatSittingLabel } from '$lib/viewer/page-sittings.js';
  import { sittingHoverEnabled } from '$stores';

  /** The page's <svg>: pointer events are taken here, blank paper included. */
  export let svgEl = null;
  /**
   * The element whose user units are Ncode × NCODE_SCALE from viewBounds' corner:
   * the page's rotated content group. Defaults to `svgEl` (an unturned page).
   */
  export let frameEl = null;
  /** The PageDoc's strokes. */
  export let strokes = [];
  /** { groups, groupOf } from pageDayGroups(strokes), built once by the page. */
  export let dayModel = null;
  /** { minX, minY, ... } the SVG is drawn from. */
  export let viewBounds = null;
  /** Anything that changes when the page moves on screen (zoom, pan), so the label follows. */
  export let view = '';
  /** True while the page is being dragged: no highlight then. */
  export let paused = false;
  /** Out: the hovered day `{ index, day, startTime, endTime, strokes, bounds }`, or null. */
  export let hot = null;

  /** Screen px a press may move and still count as a click. */
  const CLICK_SLOP = 4;
  const dispatch = createEventDispatcher();

  let layerEl;
  let labelEl;
  let label = '';
  let labelPos = null;   // { left, top } in px within the layer
  let model = null;
  let frame = 0;
  let pending = null;    // last pointer position not yet tested
  let attached = null;
  let downAt = null;     // where the last primary press started, for click-vs-pan

  $: model = $sittingHoverEnabled && dayModel ? buildModel(strokes, dayModel) : null;
  $: if (!model || paused) setHot(null);
  $: attach(svgEl);
  $: label = hot ? formatSittingLabel(hot.startTime, hot.endTime) : '';
  $: schedulePlace(hot, view, label);

  function buildModel(list, { groups, groupOf }) {
    return { groups, groupOf, index: buildHitIndex(list, groupOf) };
  }

  function attach(el) {
    if (attached === el) return;
    if (attached) {
      attached.removeEventListener('pointermove', onMove);
      attached.removeEventListener('pointerleave', onLeave);
      attached.removeEventListener('pointerdown', onDown);
      attached.removeEventListener('click', onClick);
    }
    attached = el;
    if (el) {
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerleave', onLeave);
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('click', onClick);
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

  function onDown(e) {
    downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }

  function onClick(e) {
    const d = downAt;
    downAt = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
    const g = groupAt(e.clientX, e.clientY);
    if (g) dispatch('open', { day: g.day, startTime: g.startTime });
  }

  function runHitTest() {
    frame = 0;
    const p = pending;
    pending = null;
    if (!p || paused) return;
    setHot(groupAt(p.x, p.y));
  }

  /** The day group of the ink at a client point, or null for blank paper. */
  function groupAt(clientX, clientY) {
    if (!model || !svgEl || !viewBounds) return null;
    const m = (frameEl || svgEl).getScreenCTM();
    if (!m) return null;
    const u = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    const x = u.x / NCODE_SCALE + viewBounds.minX;
    const y = u.y / NCODE_SCALE + viewBounds.minY;
    const tol = hoverTolerance(NCODE_SCALE * Math.hypot(m.a, m.b));
    const si = hitTest(model.index, x, y, tol);
    return si >= 0 ? model.groups[model.groupOf[si]] : null;
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
    const m = (frameEl || svgEl).getScreenCTM();
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
    >{label}<span class="sh-go">Timeline ›</span></div>
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

  /* Says the ink is clickable without competing with the date. */
  .sh-go {
    margin-left: 8px;
    color: #8a8fa3;
    font-weight: 400;
  }
</style>
