<!--
  FeedPart.svelte — one page's share of a sitting, inside a FeedCard.

  Collapsed it is a STRIP: the page's full width, cropped to the band the
  sitting's ink covers. Every part shares one frame width (PAGE_MIN_WIDTH), so
  handwriting reads the same size card to card and a part is only as tall as
  what was written. Ink in separate places on the page (a tick at the top and
  another at the bottom) becomes separate strips with the blank page between
  them cut out, marked by a dashed cut. Clicking the strip (or "Whole page")
  expands it to the full page, with the sitting's bands faintly tinted so they
  can be found again.

  The sitting's strokes draw in ink and everything else on the page in the
  canvas's context-ink grey — the same convention as a date load in the Editor.
  The header's right end is a slot, so a one-page card can put its Load button
  there instead of drawing a second header above.
-->
<script>
  import { NCODE_SCALE, DEFAULT_STROKE_WIDTH, strokeToPathD, strokeToWidthRuns } from '$lib/viewer/page-svg.js';
  import { sessionBands } from '$lib/timeline-feed.js';
  import { dayKey, dayStart } from '$lib/timeline.js';
  import { sketchProfile } from '$stores';

  /** A part from daySessions(): { book, pageId, count, strokes, firstStart, lastStart }. */
  export let part;
  /** { width, height, items } from indexPageStrokes(), for this part's page. */
  export let page;
  export let title = '';
  export let meta = '';
  /** Drawn under another part — gets a top rule rather than sitting flush. */
  export let divided = false;
  export let onOpen = () => {};

  const ORIGIN = { minX: 0, minY: 0 };
  const S = NCODE_SCALE;
  const INK = '#1a1a2e';
  // canvas-renderer's contextInkColor: grey by colour, not by thinning, so it
  // reads as background rather than as faint handwriting.
  const CONTEXT = '#c3c7d4';

  let expanded = false;

  $: bands = sessionBands(page.items.filter((it) => part.strokes.has(it.stroke)), page.height);
  // What gets drawn: one view per strip, or the whole page.
  $: views = (expanded ? [{ y0: 0, y1: page.height }] : bands).map((v) => {
    const visible = page.items.filter((it) => it.maxY >= v.y0 && it.minY <= v.y1);
    return {
      ...v,
      ours: visible.filter((it) => part.strokes.has(it.stroke)),
      theirs: visible.filter((it) => !part.strokes.has(it.stroke))
    };
  });
  $: greyNote = describeGrey(views.flatMap((v) => v.theirs), part.firstStart);

  // Name when the grey ink was written, when that is one answer — "written
  // 12 Sep" explains a strip at a glance; "other times" is the honest fallback.
  function describeGrey(list, at) {
    if (list.length === 0) return '';
    const own = dayKey(at);
    const days = new Set();
    for (const it of list) {
      const st = Number(it.stroke.startTime);
      if (Number.isFinite(st)) days.add(dayKey(st));
      if (days.size > 1) return 'Grey: written at other times';
    }
    const only = [...days][0];
    if (!only) return 'Grey: other ink on this page';
    if (only === own) return 'Grey: other sittings that day';
    const d = dayStart(only);
    return `Grey: written ${d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : only}`;
  }

  function toggle() {
    expanded = !expanded;
  }
</script>

<div class="fp" class:divided>
  <div class="fp-head">
    <svg class="fp-loc" viewBox="0 0 {page.width} {page.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Where this sits on the page">
      <rect x="0" y="0" width={page.width} height={page.height} rx="2" fill="#fff" stroke="#c9c9d2" stroke-width="1.6" vector-effect="non-scaling-stroke" />
      {#each bands as b}
        <rect x="1" y={b.y0} width={page.width - 2} height={b.y1 - b.y0} fill="rgba(47, 95, 216, 0.2)" stroke="#2f5fd8" stroke-width="1" vector-effect="non-scaling-stroke" />
      {/each}
    </svg>
    <div class="fp-id">
      <div class="fp-title">{title}</div>
      <div class="fp-meta">{meta}</div>
    </div>
    <button type="button" class="fp-btn" on:click={toggle} aria-expanded={expanded}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if expanded}
          <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
        {:else}
          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
        {/if}
      </svg>
      {expanded ? 'Strip' : 'Whole page'}
    </button>
    <button type="button" class="fp-btn" on:click={() => onOpen(part)} title="Open this page in Books">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
      </svg>
      Open page
    </button>
    <slot name="actions" />
  </div>

  <button type="button" class="fp-body" on:click={toggle} aria-expanded={expanded}
    aria-label={expanded ? 'Show only this sitting' : 'Show the whole page'}>
    {#each views as v, i}
      {#if i > 0}
        <span class="fp-cut" aria-hidden="true"></span>
      {/if}
      <svg viewBox="0 {v.y0 * S} {page.width * S} {(v.y1 - v.y0) * S}" preserveAspectRatio="xMidYMin meet">
        {#if expanded}
          {#each bands as b}
            <rect x="0" y={b.y0 * S} width={page.width * S} height={(b.y1 - b.y0) * S} fill="rgba(47, 95, 216, 0.06)" />
          {/each}
        {/if}
        {#each v.theirs as it}
          <path d={strokeToPathD(it.stroke, ORIGIN)} stroke={CONTEXT} stroke-width={DEFAULT_STROKE_WIDTH} fill="none" stroke-linecap="round" stroke-linejoin="round" />
        {/each}
        {#each v.ours as it}
          {#if it.stroke.sketch}
            {#each strokeToWidthRuns(it.stroke, ORIGIN, $sketchProfile) as run}
              <path d={run.d} stroke={INK} stroke-width={run.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
            {/each}
          {:else}
            <path d={strokeToPathD(it.stroke, ORIGIN)} stroke={INK} stroke-width={DEFAULT_STROKE_WIDTH} fill="none" stroke-linecap="round" stroke-linejoin="round" />
          {/if}
        {/each}
      </svg>
    {/each}
    {#if greyNote}
      <span class="fp-legend"><i></i>{greyNote}</span>
    {/if}
  </button>
</div>

<style>
  .fp.divided { border-top: 1px solid #e6e6ea; }

  .fp-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #efeff2;
  }

  .fp-loc {
    width: 26px;
    height: 37px;
    flex-shrink: 0;
  }

  .fp-id {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .fp-title,
  .fp-meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fp-title {
    font-size: 13.5px;
    font-weight: 600;
    color: #2b2b33;
  }

  .fp-meta {
    font-size: 12px;
    color: #62626e;
    font-variant-numeric: tabular-nums;
  }

  .fp-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    height: 30px;
    padding: 0 9px;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    background: #fff;
    color: #45454f;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .fp-btn:hover {
    background: #f2f2f4;
    border-color: #c8c8d0;
  }

  .fp-body {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: #fdfdfb;
    cursor: zoom-in;
  }

  .fp-body[aria-expanded='true'] {
    cursor: zoom-out;
  }

  .fp-body:focus-visible {
    outline: 2px solid #2f5fd8;
    outline-offset: -2px;
  }

  .fp-body svg {
    display: block;
    width: 100%;
    height: auto;
  }

  /* Where blank page between two strips was cut out. */
  .fp-cut {
    display: block;
    height: 0;
    margin: 6px 12px;
    border-top: 1.5px dashed #d2d2da;
  }

  .fp-legend {
    position: absolute;
    top: 8px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid #e4e4ea;
    border-radius: 10px;
    padding: 2px 8px;
    font-size: 11px;
    color: #62626e;
    pointer-events: none;
  }

  .fp-legend i {
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: #c3c7d4;
  }
</style>
