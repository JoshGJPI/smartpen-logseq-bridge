<!--
  ActivityStrip.svelte — the days with ink as one horizontal strip across the
  top of the Timeline feed, with the range as a window on it
  (reading-first package C; zoom and scroll Nov 2026).

  The strip is a view over the ink, not always all of it: the wheel zooms in
  or out around the month under the pointer (shaded while hovered), and the
  thin scroll bar under it pans. Columns follow the calendar (days, Monday
  weeks, months) and get coarser as it zooms out; every calendar day is counted
  (gaps are information, as in the heat grid). The view opens fitted to the
  range, then follows it only when the range leaves it (‹ ›, Today, Range ▾, the
  feed growing it); it is kept for the session, like your place in the Library.

  Drag the window to slide the range (its length kept), drag either edge to
  resize it, or drag across the strip to pick a new range; dragging near
  either end scrolls the view. ←/→ on the focused window slide it a day,
  Shift+←/→ moves its end. While dragging only the window moves; the range is
  set once, on release, so the feed is not rebuilt for every pixel of a drag.
  Reads `timelineDays`, the book-filtered totals, like every other date view.
-->
<script context="module">
  // The zoom and scroll, for the session (the strip remounts with the feed).
  let savedView = null;
</script>

<script>
  import StripScroll from './StripScroll.svelte';
  import { timelineDays, timelineRange, feedDayInView, setTimelineRange } from '$stores';
  import {
    stripExtent, stripLayout, stripLabels, fitView, keepInView, rebaseView, zoomView, panView,
    monthOf, dayAtFraction, windowFraction, moveWindow, resizeWindow, dayOffset
  } from '$lib/timeline-range.js';
  import { dayStart, addDays } from '$lib/timeline.js';
  import { plural } from '$lib/plural.js';

  const EDGE_PX = 14;          // dragging this close to an end scrolls the view
  const ZOOM_PER_PX = 0.0015;  // wheel delta → zoom factor (exp)

  let width = 0;
  let trackEl;
  let view = null;     // { first, start, span }, see lib/timeline-range.js
  let drag = null;     // { mode, startDay, from, to }
  let preview = null;  // the window while dragging
  let hover = null;    // the month under the pointer, { from, to }

  $: extent = stripExtent($timelineDays);
  $: followRange(extent, $timelineRange);
  $: layout = view && width ? stripLayout($timelineDays, view, width) : null;
  $: shown = preview || $timelineRange;
  $: win = windowFraction(shown.from, shown.to, layout);
  $: spyAt = layout && $feedDayInView ? dayOffset($feedDayInView, layout.first) : null;
  $: spy = spyAt != null && layout && spyAt + 0.5 >= layout.start && spyAt + 0.5 <= layout.start + layout.span
    ? (spyAt + 0.5 - layout.start) / layout.span : null;
  $: labels = stripLabels(layout, width);
  $: hoverBox = !drag && hover && layout ? monthBox(hover, layout) : null;

  function setView(v) {
    view = v;
    savedView = v;
  }

  /** Keep the range in sight when it changes elsewhere; open fitted to it. */
  function followRange(ext, range) {
    if (!ext) { view = null; return; }
    const base = rebaseView(view || savedView, ext);
    setView(base ? keepInView(base, range.from, range.to, ext) : fitView(range.from, range.to, ext));
  }

  function monthBox(m, l) {
    const a = dayOffset(m.from, l.first);
    const b = dayOffset(m.to, l.first) + 1;
    return { x: a - l.start, w: b - a };
  }

  function colTitle(c) {
    const a = dayStart(c.from)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) || c.from;
    const b = c.to !== c.from
      ? ` – ${dayStart(c.to)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) || c.to}`
      : '';
    return c.strokes
      ? `${a}${b} — ${c.strokes.toLocaleString()} ${plural(c.strokes, 'stroke')}`
      : `${a}${b} — nothing written`;
  }

  const inRange = (c, r) => !!(r.from && r.to && c.to >= r.from && c.from <= r.to);
  const barH = (c, l) => Math.max(0.12, Math.sqrt(c.strokes / l.max) * 0.92);

  function fractionAt(e) {
    const r = trackEl.getBoundingClientRect();
    return (e.clientX - r.left) / Math.max(1, r.width);
  }

  const dayAt = (e) => dayAtFraction(fractionAt(e), layout);

  function wheel(e) {
    if (!layout) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (Math.abs(dx) > Math.abs(dy)) {
      setView(panView(layout, (dx / Math.max(1, width)) * layout.span, extent));
      return;
    }
    // Zoom around the hovered month's middle while the month is all in view,
    // so it stays put; zoomed in closer than a month, around the pointer.
    const f = Math.min(1, Math.max(0, fractionAt(e)));
    let anchor = layout.start + f * layout.span;
    const m = monthOf(dayAtFraction(f, layout));
    const box = m && monthBox(m, layout);
    if (box && box.x >= 0 && box.x + box.w <= layout.span) anchor = layout.start + box.x + box.w / 2;
    setView(zoomView(layout, anchor, (anchor - layout.start) / layout.span, Math.exp(dy * ZOOM_PER_PX), extent));
  }

  function down(e, mode) {
    if (!layout || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const day = dayAt(e);
    const cur = $timelineRange;
    if (mode !== 'select' && !(cur.from && cur.to)) mode = 'select';
    drag = { mode, startDay: day, from: cur.from, to: cur.to };
    preview = mode === 'select' ? { from: day, to: day } : { from: cur.from, to: cur.to };
    trackEl.setPointerCapture?.(e.pointerId);
  }

  function move(e) {
    if (!layout) return;
    if (!drag) {
      const m = monthOf(dayAt(e));
      if (m && m.from !== hover?.from) hover = m;
      return;
    }
    const r = trackEl.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < EDGE_PX) setView(panView(layout, -layout.span * 0.02, extent));
    else if (x > r.width - EDGE_PX) setView(panView(layout, layout.span * 0.02, extent));
    const day = dayAt(e);
    if (drag.mode === 'select') {
      preview = day < drag.startDay ? { from: day, to: drag.startDay } : { from: drag.startDay, to: day };
    } else if (drag.mode === 'move') {
      preview = moveWindow(drag.from, drag.to, dayOffset(day, drag.startDay), layout.first, layout.last);
    } else {
      preview = resizeWindow(drag.mode, drag.from, drag.to, day);
    }
  }

  function up() {
    if (!drag) return;
    const p = preview;
    drag = null;
    preview = null;
    if (p && p.from && p.to) setTimelineRange(p.from, p.to);
  }

  function key(e) {
    if (!layout || !(e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const { from, to } = $timelineRange;
    if (!from || !to) return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    const end = addDays(to, step);
    const next = e.shiftKey
      ? resizeWindow('end', from, to, end < layout.first ? layout.first : end > layout.last ? layout.last : end)
      : moveWindow(from, to, step, layout.first, layout.last);
    setTimelineRange(next.from, next.to);
  }
</script>

<div class="as" bind:clientWidth={width}>
  {#if layout}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="as-track" bind:this={trackEl}
      on:pointerdown={(e) => down(e, 'select')}
      on:pointermove={move}
      on:pointerleave={() => { hover = null; }}
      on:pointerup={up}
      on:pointercancel={up}
      on:wheel|nonpassive={wheel}
    >
      <svg viewBox="0 0 {layout.span} 1" preserveAspectRatio="none" aria-hidden="true">
        {#if hoverBox}
          <rect class="as-month" x={hoverBox.x} width={hoverBox.w} y="0" height="1" />
        {/if}
        {#each layout.columns as c (c.from)}
          {#if c.strokes > 0}
            <rect
              x={c.off - layout.start}
              width={c.len * (layout.unit === 'day' ? 0.7 : 0.82)}
              y={1 - barH(c, layout)}
              height={barH(c, layout)}
              class:on={inRange(c, shown)}
            ><title>{colTitle(c)}</title></rect>
          {/if}
        {/each}
      </svg>

      {#if spy != null}
        <i class="as-spy" style:left={`${spy * 100}%`} title="Day at the top of the feed"></i>
      {/if}

      {#if win}
        <div
          class="as-win"
          class:dragging={!!drag}
          style:left={`${win.left * 100}%`}
          style:width={`${win.width * 100}%`}
          role="slider"
          tabindex="0"
          aria-label="Range: drag to move, drag an edge to resize"
          aria-valuetext={`${shown.from} to ${shown.to}`}
          aria-valuenow={dayOffset(shown.from, layout.first)}
          on:pointerdown={(e) => down(e, 'move')}
          on:keydown={key}
        >
          <span class="as-handle start" on:pointerdown={(e) => down(e, 'start')}></span>
          <span class="as-handle end" on:pointerdown={(e) => down(e, 'end')}></span>
        </div>
      {/if}
    </div>
    <StripScroll start={layout.start} span={layout.span} totalDays={layout.totalDays} {width}
      onPan={(days) => setView(panView(layout, days, extent))} />
    <div class="as-labels" aria-hidden="true">
      {#each labels as l}
        <span style:left={`${l.x}px`}>{l.text}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .as { width: 100%; min-width: 0; user-select: none; }

  .as-track {
    position: relative;
    height: 30px;
    border-bottom: 1px solid #dcdce2;
    cursor: crosshair;
    touch-action: none;
  }

  .as-track svg { display: block; width: 100%; height: 100%; }
  .as-track rect { fill: #c3c9d8; }
  .as-track rect.on { fill: #2f5fd8; }
  .as-track rect.as-month { fill: rgba(47, 95, 216, 0.07); }

  .as-spy {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: #e94560;
    pointer-events: none;
  }

  .as-win {
    position: absolute;
    top: -3px;
    bottom: -3px;
    min-width: 8px;
    margin-left: -1px;
    box-sizing: border-box;
    background: rgba(47, 95, 216, 0.1);
    border: 1.5px solid #2f5fd8;
    border-radius: 4px;
    cursor: grab;
  }

  .as-win.dragging { cursor: grabbing; background: rgba(47, 95, 216, 0.16); }
  .as-win:focus-visible { outline: 2px solid #4a7cf7; outline-offset: 2px; }

  .as-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
  }

  .as-handle.start { left: -5px; }
  .as-handle.end { right: -5px; }

  .as-labels {
    position: relative;
    height: 15px;
    font-size: 11px;
    color: #6b6b76;
    overflow: hidden;
  }

  .as-labels span {
    position: absolute;
    top: 0;
    white-space: nowrap;
  }
</style>
