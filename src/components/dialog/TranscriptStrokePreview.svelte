<!--
  TranscriptStrokePreview.svelte — read-only stroke render for the transcription
  editor modal.

  Purpose: confirm a transcribed line against the handwriting that produced it
  without closing the modal. The focused line's strokes are drawn in ink; the
  rest of the page is dimmed, and a band marks the line's Y range so a line with
  no stroke association is still locatable on the page.

  Stroke source, in order:
    1. the canvas (`strokes` store) — the page being transcribed is normally
       loaded there, and this is the copy the user is editing;
    2. the PageDoc on disk (via the Book View LRU) — for a saved page opened
       from the Pages tab that isn't on the canvas.
  Both are normalised to the storage shape `{ id, points, sketch, lineId }` so
  the existing `page-svg` helpers render them unchanged.
-->
<script>
  import { onMount, tick } from 'svelte';
  import {
    NCODE_SCALE,
    DEFAULT_STROKE_WIDTH,
    computeStrokeBounds,
    strokeToPathD,
    strokeToWidthRuns
  } from '$lib/viewer/page-svg.js';
  import { sketchProfile } from '$stores';
  import { getStrokesSnapshot } from '$stores/strokes.js';
  import { getCachedPage } from '$lib/viewer/page-cache.js';
  import { yBoundsToNcode } from '$lib/myscript-api.js';

  /** Book key (string, may carry a volume suffix — e.g. "388v2"). */
  export let book;
  /** Unique-within-book page id, letter suffix included. */
  export let pageId;
  /** The line currently being edited, or null. Drives the highlight. */
  export let highlightLine = null;
  /** Bump to force a re-resolve (modal reopened). */
  export let reloadKey = 0;

  /** Y-overlap slack (Ncode units) when a line has no stroke ids to match on. */
  const Y_TOLERANCE = 1;

  let previewStrokes = [];
  let loading = false;
  let error = '';
  let source = '';           // 'canvas' | 'disk' | ''
  let zoom = 1;
  let containerEl;
  let lastResolveKey = '';

  $: resolveKey = `${book}/${pageId}/${reloadKey}`;
  $: if (resolveKey !== lastResolveKey) {
    lastResolveKey = resolveKey;
    resolveStrokes(book, pageId, resolveKey);
  }

  $: bounds = computeStrokeBounds(previewStrokes);
  $: baseWidth = bounds ? (bounds.maxX - bounds.minX) * NCODE_SCALE : 0;
  $: baseHeight = bounds ? (bounds.maxY - bounds.minY) * NCODE_SCALE : 0;

  // A transcript line's yBounds are MyScript millimetres, not Ncode — the two
  // only look comparable. Everything below works in Ncode, so convert once here
  // and let both the highlight and the band read from it.
  $: lineNcodeY = bounds ? yBoundsToNcode(highlightLine?.yBounds, bounds.minY) : null;

  // Which strokes belong to the focused line. Prefer the explicit stroke→line
  // link; fall back to Y-overlap for freshly recognised lines that have no id
  // yet (the common case when confirming a new transcription).
  $: highlightIds = computeHighlightIds(previewStrokes, highlightLine, lineNcodeY);
  $: band = bandFor(lineNcodeY, bounds, baseHeight);

  // Recentre whenever the focused line moves.
  $: if (band) scrollBandIntoView(band);

  /** Canvas dotArray → storage-format point tuples. */
  function dotsToPoints(dotArray) {
    const out = [];
    for (const d of dotArray || []) {
      if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) continue;
      out.push([d.x, d.y, d.timestamp ?? null, d.f]);
    }
    return out;
  }

  function fromCanvasStroke(stroke, i) {
    return {
      id: stroke.id || (stroke.startTime ? `s${stroke.startTime}` : `i${i}`),
      points: dotsToPoints(stroke.dotArray),
      sketch: !!stroke.sketch,
      lineId: stroke.blockUuid || stroke.lineId || null
    };
  }

  async function resolveStrokes(bookKey, id, key) {
    previewStrokes = [];
    error = '';
    source = '';
    if (bookKey == null || id == null) return;

    // 1. Canvas. Matched on the integer page number, which is what canvas
    //    strokes carry in pageInfo (the letter suffix is a file-level identity).
    const pageNum = parseInt(String(id), 10);
    const canvas = getStrokesSnapshot().filter(
      (s) => s.pageInfo?.book === bookKey && s.pageInfo?.page === pageNum && !s.deleted
    );
    if (canvas.length > 0) {
      previewStrokes = canvas.map(fromCanvasStroke).filter((s) => s.points.length > 1);
      source = 'canvas';
      await tick();
      fitToWidth();
      return;
    }

    // 2. Disk.
    loading = true;
    try {
      const doc = await getCachedPage(bookKey, id);
      if (lastResolveKey !== key) return; // a newer resolve superseded this one
      previewStrokes = (doc && doc.strokes) || [];
      source = previewStrokes.length > 0 ? 'disk' : '';
    } catch (err) {
      if (lastResolveKey === key) error = err?.message || String(err);
    } finally {
      if (lastResolveKey === key) {
        loading = false;
        await tick();
        fitToWidth();
      }
    }
  }

  function computeHighlightIds(list, line, ncodeY) {
    if (!line || list.length === 0) return null;

    if (line.blockUuid) {
      const byId = list.filter((s) => s.lineId && s.lineId === line.blockUuid);
      if (byId.length > 0) return new Set(byId.map((s) => s.id));
    }

    if (!ncodeY) return null;
    const lo = ncodeY.minY - Y_TOLERANCE;
    const hi = ncodeY.maxY + Y_TOLERANCE;
    const hits = list.filter((s) => s.points.some((p) => p[1] >= lo && p[1] <= hi));
    return hits.length > 0 ? new Set(hits.map((s) => s.id)) : null;
  }

  /**
   * Band geometry in unzoomed paper pixels, clamped to the page. The conversion
   * assumes the line was recognised from the whole page; a partial
   * re-transcription has a lower origin, which shifts the band down. Clamping
   * keeps a bad estimate at the page edge rather than floating outside it.
   */
  function bandFor(ncodeY, b, pageHeight) {
    if (!ncodeY || !b || !pageHeight) return null;
    const rawTop = (ncodeY.minY - b.minY) * NCODE_SCALE;
    const rawBottom = (ncodeY.maxY - b.minY) * NCODE_SCALE;
    const top = Math.min(Math.max(rawTop, 0), pageHeight);
    const bottom = Math.min(Math.max(rawBottom, 0), pageHeight);
    const height = Math.max(bottom - top, 3);
    if (top >= pageHeight) return { top: pageHeight - height, height };
    return { top, height };
  }

  onMount(() => {
    // The initial resolve may run before the pane has a measurable width.
    fitToWidth();
  });

  function fitToWidth() {
    if (!containerEl || !baseWidth) return;
    const avail = containerEl.clientWidth - 24;
    if (avail <= 0) return;
    zoom = Math.min(avail / baseWidth, 3);
  }

  function scrollBandIntoView(b) {
    if (!containerEl) return;
    const top = b.top * zoom;
    const height = b.height * zoom;
    const target = top + height / 2 - containerEl.clientHeight / 2;
    containerEl.scrollTo({ top: Math.max(target, 0), behavior: 'smooth' });
  }

  function zoomBy(factor) {
    zoom = Math.min(Math.max(zoom * factor, 0.1), 6);
  }
</script>

<svelte:window on:resize={fitToWidth} />

<div class="preview">
  <div class="preview-toolbar">
    <span class="preview-title">
      Strokes
      {#if source === 'canvas'}<span class="src">canvas</span>
      {:else if source === 'disk'}<span class="src">saved</span>{/if}
    </span>
    <div class="zoom-group">
      <button class="zoom-btn" on:click={() => zoomBy(1 / 1.25)} title="Zoom out">&minus;</button>
      <span class="zoom-label">{Math.round(zoom * 100)}%</span>
      <button class="zoom-btn" on:click={() => zoomBy(1.25)} title="Zoom in">+</button>
      <button class="zoom-btn wide" on:click={fitToWidth} title="Fit page width">Fit</button>
    </div>
  </div>

  <div class="preview-scroll" bind:this={containerEl}>
    {#if loading}
      <div class="preview-empty">Loading strokes&hellip;</div>
    {:else if error}
      <div class="preview-empty error">Could not load strokes: {error}</div>
    {:else if !bounds}
      <div class="preview-empty">
        No strokes available for this page.
        <span class="hint">Import the page onto the canvas to preview it here.</span>
      </div>
    {:else}
      <div
        class="paper"
        style="width: {(baseWidth * zoom).toFixed(2)}px; height: {(baseHeight * zoom).toFixed(2)}px;"
      >
        {#if band}
          <div
            class="band"
            style="top: {(band.top * zoom).toFixed(2)}px; height: {(band.height * zoom).toFixed(2)}px;"
          ></div>
        {/if}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 {baseWidth.toFixed(2)} {baseHeight.toFixed(2)}"
          width={(baseWidth * zoom).toFixed(2)}
          height={(baseHeight * zoom).toFixed(2)}
        >
          {#each previewStrokes as stroke (stroke.id)}
            {@const ink = highlightIds !== null && !highlightIds.has(stroke.id) ? '#c3c8d4' : '#1a1a2e'}
            {#if stroke.sketch}
              {#each strokeToWidthRuns(stroke, bounds, $sketchProfile) as run, i (i)}
                <path d={run.d} stroke={ink} stroke-width={run.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
              {/each}
            {:else}
              <path d={strokeToPathD(stroke, bounds)} stroke={ink} stroke-width={DEFAULT_STROKE_WIDTH} fill="none" stroke-linecap="round" stroke-linejoin="round" />
            {/if}
          {/each}
        </svg>
      </div>
    {/if}
  </div>
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .preview-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .preview-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .src {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 8px;
    background: rgba(107, 114, 128, 0.18);
    color: #9ca3af;
    text-transform: none;
  }

  .zoom-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .zoom-btn {
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .zoom-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .zoom-btn.wide { min-width: 34px; }

  .zoom-label {
    font-size: 0.7rem;
    color: var(--text-tertiary);
    min-width: 38px;
    text-align: center;
  }

  .preview-scroll {
    flex: 1;
    overflow: auto;
    padding: 12px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .paper {
    position: relative;
    /* Nothing may paint outside the page — a band from a mis-estimated origin
       floating in the pane reads as a rendering bug. */
    overflow: hidden;
    background: #ffffff;
    border-radius: 4px;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
    flex-shrink: 0;
  }

  .band {
    position: absolute;
    left: 0;
    right: 0;
    background: rgba(245, 158, 11, 0.16);
    border-top: 1px solid rgba(245, 158, 11, 0.45);
    border-bottom: 1px solid rgba(245, 158, 11, 0.45);
    pointer-events: none;
  }

  .paper :global(svg) {
    display: block;
    position: relative;
  }

  .preview-empty {
    margin: auto;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-tertiary);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 24px 16px;
  }

  .preview-empty.error { color: #f87171; }

  .preview-empty .hint {
    font-size: 0.72rem;
    opacity: 0.8;
  }
</style>
