<!--
  PageSpreadView.svelte — renders ONE page within the Book View.

  Shows either the rendered strokes (SVG, with local zoom/pan/fit) or the
  transcript (TranscriptPane), based on `contentMode`. The primary page
  (showGlobalControls) also hosts the viewer-wide toggles: Strokes⇄Transcript,
  Single⇄Spread, and Home. Prev/Next arrows turn pages.
-->
<script>
  import { onMount, tick } from 'svelte';
  import { NCODE_SCALE, computeStrokeBounds, strokeToPathD } from '$lib/viewer/page-svg.js';
  import { getCachedPage } from '$lib/viewer/page-cache.js';
  import TranscriptPane from './TranscriptPane.svelte';

  /** store record: lightweight { book, page, pageId, strokeCount, ... } — NO strokes */
  export let record;
  export let bookAlias = '';
  export let contentMode = 'strokes'; // 'strokes' | 'transcript'

  export let hasPrev = false;
  export let hasNext = false;
  export let onPrev = null;
  export let onNext = null;
  export let onTranscriptSaved = () => {};
  export let onLoadIntoEditor = () => {};

  let containerEl;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  // The PageDoc (with strokes + transcript) is loaded lazily — records no longer
  // carry strokes (perf #3). A small LRU keeps recently-viewed docs so turning a
  // spread doesn't re-read disk each time.
  let doc = null;
  let loadingDoc = false;
  let loadedKey = null;

  $: if (record) loadDoc(record);

  function idOf(rec) {
    return rec.pageId != null ? String(rec.pageId) : String(rec.page);
  }

  async function loadDoc(rec) {
    const key = `${rec.book}:${idOf(rec)}`;
    if (key === loadedKey) return; // already loaded/loading this exact page
    loadedKey = key;
    doc = null;
    loadingDoc = true;
    try {
      const d = await getCachedPage(rec.book, idOf(rec));
      if (loadedKey !== key) return; // a newer record won the race
      doc = d;
      await tick();
      requestAnimationFrame(fitContent); // fit once strokes are in the DOM
    } catch (e) {
      if (loadedKey === key) console.warn('Book View: failed to load page', key, e);
    } finally {
      if (loadedKey === key) loadingDoc = false;
    }
  }

  // Reflect a transcript save back into the locally-held doc so display mode
  // shows the edits immediately (the parent also updates the store + cache).
  function handleSaved(b, p, savedLines) {
    if (doc) doc = { ...doc, transcript: { ...(doc.transcript || {}), lines: savedLines } };
    onTranscriptSaved(b, p, savedLines);
  }

  $: strokes = (doc && doc.strokes) || [];
  $: lines = (doc && doc.transcript && doc.transcript.lines) || [];
  $: bounds = computeStrokeBounds(strokes);
  $: svgWidth = bounds ? (bounds.maxX - bounds.minX) * NCODE_SCALE : 0;
  $: svgHeight = bounds ? (bounds.maxY - bounds.minY) * NCODE_SCALE : 0;
  // pageId is the unique-within-book file identifier (incl. suffix); used as the
  // read/write key for the transcript and as the display/label.
  $: pageId = record ? (record.pageId != null ? String(record.pageId) : String(record.page)) : '';
  $: pageKey = record ? `${record.book}:${pageId}` : '';
  $: title = `${bookAlias || `B${record?.book}`} — P${pageId}`;

  function fitContent() {
    if (!bounds || !containerEl) return;
    const cw = containerEl.clientWidth;
    const ch = containerEl.clientHeight;
    const sw = (bounds.maxX - bounds.minX) * NCODE_SCALE + 20;
    const sh = (bounds.maxY - bounds.minY) * NCODE_SCALE + 20;
    if (sw <= 0 || sh <= 0) return;
    zoom = Math.min(cw / sw, ch / sh) * 0.92;
    panX = (cw - sw * zoom) / 2;
    panY = (ch - sh * zoom) / 2;
  }

  onMount(async () => {
    await tick();
    requestAnimationFrame(fitContent);
  });

  function zoomIn() { zoom = Math.min(20, zoom * 1.2); }
  function zoomOut() { zoom = Math.max(0.1, zoom / 1.2); }

  function handleWheel(e) {
    if (contentMode !== 'strokes') return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = containerEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const nz = Math.max(0.1, Math.min(20, zoom * delta));
    panX = mx - (mx - panX) * (nz / zoom);
    panY = my - (my - panY) * (nz / zoom);
    zoom = nz;
  }

  function handleMouseDown(e) {
    if (contentMode !== 'strokes' || e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
  }
  function handleMouseMove(e) {
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
  }
  function endPan() { isPanning = false; }
</script>

<div class="page-view">
  <div class="pv-toolbar">
    <div class="pv-left">
      <span class="pv-title">{title}</span>
      <span class="pv-stats">{record.strokeCount} strokes</span>
    </div>

    <div class="pv-center">
      {#if contentMode === 'strokes'}
        <button class="pv-btn" on:click={zoomOut} title="Zoom out">&#x2212;</button>
        <span class="pv-zoom">{Math.round(zoom * 100)}%</span>
        <button class="pv-btn" on:click={zoomIn} title="Zoom in">&#x2B;</button>
        <button class="pv-btn" on:click={fitContent} title="Fit page">Fit</button>
        <span class="pv-divider"></span>
      {/if}
      <button class="pv-btn load" on:click={() => onLoadIntoEditor()} title="Load this page into the Editor for editing">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
        Load into Editor
      </button>
    </div>
  </div>

  <div class="pv-area" bind:this={containerEl}>
    {#if hasPrev && onPrev}
      <button class="pv-nav prev" on:click={onPrev} title="Previous page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
    {/if}
    {#if hasNext && onNext}
      <button class="pv-nav next" on:click={onNext} title="Next page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    {/if}

    {#if contentMode === 'transcript'}
      <TranscriptPane {lines} book={record.book} page={pageId} {pageKey} onSaved={handleSaved} />
    {:else if loadingDoc}
      <div class="pv-empty">Loading…</div>
    {:else if bounds}
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div
        class="pv-canvas"
        class:panning={isPanning}
        on:wheel={handleWheel}
        on:mousedown={handleMouseDown}
        on:mousemove={handleMouseMove}
        on:mouseup={endPan}
        on:mouseleave={endPan}
        role="application"
        aria-label="Page strokes — scroll to zoom, drag to pan"
      >
        <div class="pv-transform" style="transform: translate({panX}px, {panY}px) scale({zoom});">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svgWidth.toFixed(2)} {svgHeight.toFixed(2)}" width={svgWidth.toFixed(2)} height={svgHeight.toFixed(2)}>
            {#each strokes as stroke (stroke.id)}
              <path d={strokeToPathD(stroke, bounds)} stroke="#1a1a2e" stroke-width="0.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            {/each}
          </svg>
        </div>
      </div>
    {:else}
      <div class="pv-empty">No strokes on this page</div>
    {/if}
  </div>
</div>

<style>
  .page-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .pv-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    gap: 10px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .pv-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pv-title { font-weight: 600; font-size: 14px; color: #333; white-space: nowrap; }
  .pv-stats { font-size: 12px; color: #aaa; white-space: nowrap; }
  .pv-center { display: flex; align-items: center; gap: 4px; }
  .pv-zoom { font-size: 12px; color: #666; min-width: 42px; text-align: center; }

  .pv-btn {
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s;
  }
  .pv-btn:hover { background: #f2f2f2; border-color: #ccc; }
  .pv-btn.load { color: #4a7cf7; border-color: #c7d6fb; }
  .pv-btn.load:hover { background: #eef3ff; border-color: #4a7cf7; }
  .pv-divider { width: 1px; height: 20px; background: #e0e0e0; margin: 0 4px; }

  .pv-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    min-height: 0;
    background: #f9f9f9;
  }

  .pv-canvas {
    flex: 1;
    position: relative;
    overflow: hidden;
    cursor: grab;
  }
  .pv-canvas.panning { cursor: grabbing; }
  .pv-transform { transform-origin: 0 0; position: absolute; top: 0; left: 0; }
  .pv-transform :global(svg) { display: block; }

  .pv-nav {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 44px;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: rgba(0, 0, 0, 0.18);
    transition: all 0.2s;
  }
  .pv-nav:hover { background: rgba(0, 0, 0, 0.04); color: rgba(0, 0, 0, 0.55); }
  .pv-nav.prev { left: 0; }
  .pv-nav.next { right: 0; }

  .pv-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bbb;
    font-size: 14px;
  }
</style>
