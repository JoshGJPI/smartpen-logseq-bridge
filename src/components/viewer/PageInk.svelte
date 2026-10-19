<!--
  PageInk.svelte — one page's ink in the Library reader: paper, strokes, local
  zoom/pan, hover-to-reveal times, and the page-corner orientation control.

  Extracted from PageSpreadView (reading-first package D). Zoom is still per
  page (each page fits its own ink or paper), but the shared spread toolbar
  drives both pages through the exported zoomBy() / fit(), and `zoom` is bound
  out so it can show their percentages.

  Highlights: the ink under the pointer (SittingHover, Times) wins; otherwise
  `highlight` from the parent (a ribbon day chip or an Ink + text line) is drawn.
  Either way it is the same cheap path: the page's paths grey by one class and
  SittingInk redraws only the highlighted strokes on top.

  Rotation is display-only and ONE transform per page: the content group's
  `transform`, inside which paper, ink and SittingInk all sit.
-->
<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { NCODE_SCALE, DEFAULT_STROKE_WIDTH, computeStrokeBounds, strokeToPathD, strokeToWidthRuns } from '$lib/viewer/page-svg.js';
  import { sketchProfile, backgroundsEnabled, resolvePageBackground } from '$stores';
  import { frameToBounds } from '$lib/neo-backgrounds.js';
  import { pageOrientations } from '$stores/orientation.js';
  import { rotationFor, rotateFrame, svgRotationTransform } from '$lib/page-orientation.js';
  import SittingHover from './SittingHover.svelte';
  import SittingInk from './SittingInk.svelte';
  import OrientationControl from './OrientationControl.svelte';

  export let book;
  export let pageId;
  /** The PageDoc's strokes. */
  export let strokes = [];
  /** { groups, groupOf } from pageDayGroups(), built once by the parent. */
  export let dayModel = null;
  /** Strokes to draw in ink over a greyed page ({ strokes }), or null. */
  export let highlight = null;
  /** (day) => void: the hovered ink was clicked. */
  export let onOpenDay = () => {};
  /** Out: current zoom factor. */
  export let zoom = 1;

  let containerEl;
  let svgEl;
  let contentEl;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panArmed = false;
  let panStart = { x: 0, y: 0, px: 0, py: 0 };
  // A press only becomes a pan once it moves PAN_SLOP px, so a plain click on
  // ink keeps its hover highlight and reaches SittingHover as a click.
  const PAN_SLOP = 4;
  let hotSitting = null;
  // Until the reader zooms or pans by hand, the page keeps fitting its pane as
  // the pane changes size (window resize, panel toggle, header wrapping).
  let userMoved = false;
  let resizeObs = null;

  // The printed page behind the strokes ({ frame, url }), when the book has one
  // and backgrounds are switched on. Resolution never throws: no paper is null.
  let bg = null;
  let bgKey = null;
  $: updateBackground(book, pageId, $backgroundsEnabled);

  async function updateBackground(b, p, enabled) {
    if (!enabled) {
      bgKey = null;
      if (bg) { bg = null; refit(); }
      return;
    }
    const key = `${b}:${p}`;
    if (key === bgKey) return;
    bgKey = key;
    bg = null;                                   // never show another page's paper
    const next = await resolvePageBackground(b, p);
    if (bgKey !== key) return;                   // a newer page won the race
    bg = next;
    refit();
  }

  $: bounds = computeStrokeBounds(strokes);
  // With paper, the page is the printed sheet; without, it is the ink's own box.
  $: viewBounds = bg ? frameToBounds(bg.frame) : bounds;
  $: svgWidth = viewBounds ? (viewBounds.maxX - viewBounds.minX) * NCODE_SCALE : 0;
  $: svgHeight = viewBounds ? (viewBounds.maxY - viewBounds.minY) * NCODE_SCALE : 0;

  // The svg takes the turned frame's size, so a landscape page lays out landscape.
  $: rotation = rotationFor($pageOrientations, book, pageId);
  $: pageFrame = { x0: 0, y0: 0, x1: svgWidth, y1: svgHeight };
  $: shownFrame = rotateFrame(pageFrame, rotation);
  $: shownWidth = shownFrame.x1 - shownFrame.x0;
  $: shownHeight = shownFrame.y1 - shownFrame.y0;
  $: contentTransform = svgRotationTransform(rotation, pageFrame) || null;
  $: rotation, refit();
  $: strokes, refit();

  $: shown = hotSitting || highlight;

  async function refit() {
    await tick();
    requestAnimationFrame(fit);
  }

  export function fit() {
    if (!viewBounds || !containerEl) return;
    const cw = containerEl.clientWidth;
    const ch = containerEl.clientHeight;
    const sw = shownWidth + 20;
    const sh = shownHeight + 20;
    if (sw <= 0 || sh <= 0 || cw <= 0 || ch <= 0) return;
    zoom = Math.min(cw / sw, ch / sh) * 0.92;
    panX = (cw - sw * zoom) / 2;
    panY = (ch - sh * zoom) / 2;
    userMoved = false;
  }

  /** Zoom by `factor` about the middle of this page's pane. */
  export function zoomBy(factor) {
    if (!containerEl) return;
    const nz = Math.max(0.1, Math.min(20, zoom * factor));
    const mx = containerEl.clientWidth / 2;
    const my = containerEl.clientHeight / 2;
    panX = mx - (mx - panX) * (nz / zoom);
    panY = my - (my - panY) * (nz / zoom);
    zoom = nz;
    userMoved = true;
  }

  onMount(() => {
    refit();
    if (typeof ResizeObserver === 'undefined') return;
    resizeObs = new ResizeObserver(() => { if (!userMoved) requestAnimationFrame(fit); });
    resizeObs.observe(containerEl);
  });
  onDestroy(() => resizeObs && resizeObs.disconnect());

  function handleWheel(e) {
    e.preventDefault();
    const rect = containerEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const nz = Math.max(0.1, Math.min(20, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    panX = mx - (mx - panX) * (nz / zoom);
    panY = my - (my - panY) * (nz / zoom);
    zoom = nz;
    userMoved = true;
  }

  function handleMouseDown(e) {
    if (e.button !== 0) return;
    panArmed = true;
    panStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
  }
  function handleMouseMove(e) {
    if (!panArmed) return;
    if (!isPanning && Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) <= PAN_SLOP) return;
    isPanning = true;
    userMoved = true;
    panX = panStart.px + (e.clientX - panStart.x);
    panY = panStart.py + (e.clientY - panStart.y);
  }
  function endPan() { panArmed = false; isPanning = false; }
</script>

<div class="pi" bind:this={containerEl}>
  {#if viewBounds}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="pi-canvas"
      class:panning={isPanning}
      on:wheel={handleWheel}
      on:mousedown={handleMouseDown}
      on:mousemove={handleMouseMove}
      on:mouseup={endPan}
      on:mouseleave={endPan}
      role="application"
      aria-label="Page strokes — scroll to zoom, drag to pan"
    >
      <div class="pi-transform" style="transform: translate({panX}px, {panY}px) scale({zoom});">
        <svg bind:this={svgEl} class:paper={!!bg} class:dimmed={!!shown} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {shownWidth.toFixed(2)} {shownHeight.toFixed(2)}" width={shownWidth.toFixed(2)} height={shownHeight.toFixed(2)}>
          <g bind:this={contentEl} transform={contentTransform}>
            {#if bg}
              <!-- The sheet is drawn 1:1 into the frame (Ncode units × NCODE_SCALE),
                   the same space the strokes are projected into below. -->
              <image href={bg.url} x="0" y="0" width={svgWidth.toFixed(2)} height={svgHeight.toFixed(2)} preserveAspectRatio="none" />
            {/if}
            {#each strokes as stroke (stroke.id)}
              {#if stroke.sketch}
                <!-- One <path> per constant-width run: SVG applies a single
                     stroke-width per path, so a pressure-varying line is split. -->
                {#each strokeToWidthRuns(stroke, viewBounds, $sketchProfile) as run, i (i)}
                  <path d={run.d} stroke="#1a1a2e" stroke-width={run.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
                {/each}
              {:else}
                <path d={strokeToPathD(stroke, viewBounds)} stroke="#1a1a2e" stroke-width={DEFAULT_STROKE_WIDTH} fill="none" stroke-linecap="round" stroke-linejoin="round" />
              {/if}
            {/each}
            <SittingInk sitting={shown} {viewBounds} />
          </g>
        </svg>
      </div>
      <SittingHover {svgEl} frameEl={contentEl} {strokes} {dayModel} {viewBounds} view="{zoom},{panX},{panY}" paused={isPanning} bind:hot={hotSitting} on:open={(e) => onOpenDay(e.detail.day)} />
    </div>
    <div class="pi-corner">
      <OrientationControl {book} {pageId} compact />
    </div>
  {:else}
    <div class="pi-empty">No strokes on this page</div>
  {/if}
</div>

<style>
  .pi {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    min-width: 0;
    min-height: 0;
    background: #f9f9f9;
  }
  .pi-canvas {
    flex: 1;
    position: relative;
    overflow: hidden;
    cursor: grab;
  }
  .pi-canvas.panning { cursor: grabbing; }
  .pi-transform { transform-origin: 0 0; position: absolute; top: 0; left: 0; }
  .pi-transform :global(svg) { display: block; }
  /* The printed sheet stands off the pane like a page on a desk. */
  .pi-transform :global(svg.paper) { background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22); }
  /* Something is highlighted: the page's own ink goes context grey (FeedPart's
     CONTEXT) and SittingInk redraws the highlighted strokes in ink on top. */
  svg.dimmed path { stroke: #c3c7d4; }
  .pi-canvas:not(.panning) svg.dimmed { cursor: pointer; }

  /* Rotation is per page, so it sits on the page: quiet until the page is hovered. */
  .pi-corner {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 20;
    padding: 2px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.9);
    opacity: 0.55;
    transition: opacity 0.15s;
  }
  .pi:hover .pi-corner,
  .pi-corner:focus-within { opacity: 1; }

  .pi-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bbb;
    font-size: 14px;
  }
</style>
