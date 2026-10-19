<!--
  ActivityStrip.svelte — every day with ink as one horizontal strip across the
  top of the Timeline feed, with the range as a window on it
  (reading-first package C).

  Drag the window to slide the range (its length kept), drag either edge to
  resize it, or drag across the strip to pick a new range; ←/→ on the focused
  window slide it a day, Shift+←/→ moves its end. While dragging only the
  window moves; the range is set once, on release, so the feed is not rebuilt
  for every pixel of a drag.

  Every calendar day is counted (gaps are information, as in the heat grid),
  bucketed so a column is never narrower than a few pixels. Reads
  `timelineDays`, the book-filtered totals, like every other date view.
-->
<script>
  import { timelineDays, timelineRange, feedDayInView, setTimelineRange } from '$stores';
  import {
    stripLayout, dayAtFraction, windowFraction, moveWindow, resizeWindow, dayOffset
  } from '$lib/timeline-range.js';
  import { dayStart } from '$lib/timeline.js';
  import { plural } from '$lib/plural.js';

  const COL_PX = 4;
  const LABEL_GAP_PX = 44;

  let width = 0;
  let trackEl;
  let drag = null;     // { mode, startDay, from, to }
  let preview = null;  // the window while dragging

  $: layout = stripLayout($timelineDays, Math.max(1, Math.floor(width / COL_PX)));
  $: shown = preview || $timelineRange;
  $: win = windowFraction(shown.from, shown.to, layout);
  $: spyOff = layout && $feedDayInView ? dayOffset($feedDayInView, layout.first) : null;
  $: spy = spyOff != null && spyOff >= 0 && spyOff < layout.totalDays ? (spyOff + 0.5) / layout.totalDays : null;
  $: labels = monthLabels(layout, width);

  function monthLabels(l, px) {
    if (!l || !px) return [];
    const out = [];
    let lastMonth = null;
    let lastX = -Infinity;
    for (const c of l.columns) {
      const d = dayStart(c.from);
      if (!d) continue;
      const key = d.getFullYear() * 12 + d.getMonth();
      if (key === lastMonth) continue;
      lastMonth = key;
      const x = (dayOffset(c.from, l.first) / l.totalDays) * px;
      if (x - lastX < LABEL_GAP_PX) continue;
      lastX = x;
      const text = d.getMonth() === 0 || out.length === 0
        ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : d.toLocaleDateString(undefined, { month: 'short' });
      out.push({ x, text });
    }
    return out;
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

  function dayAt(e) {
    const r = trackEl.getBoundingClientRect();
    return dayAtFraction((e.clientX - r.left) / Math.max(1, r.width), layout);
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
    if (!drag) return;
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
    const next = e.shiftKey
      ? resizeWindow('end', from, to, dayAtFraction((dayOffset(to, layout.first) + step + 0.5) / layout.totalDays, layout))
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
      on:pointerup={up}
      on:pointercancel={up}
    >
      <svg viewBox="0 0 {layout.totalDays} 1" preserveAspectRatio="none" aria-hidden="true">
        {#each layout.columns as c, i}
          {#if c.strokes > 0}
            <rect
              x={i * layout.bucket}
              width={Math.max(0.6, (dayOffset(c.to, c.from) + 1) * 0.82)}
              y={1 - Math.max(0.12, Math.sqrt(c.strokes / layout.max) * 0.92)}
              height={Math.max(0.12, Math.sqrt(c.strokes / layout.max) * 0.92)}
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
    height: 34px;
    border-bottom: 1px solid #dcdce2;
    cursor: crosshair;
    touch-action: none;
  }

  .as-track svg { display: block; width: 100%; height: 100%; }
  .as-track rect { fill: #c3c9d8; }
  .as-track rect.on { fill: #2f5fd8; }

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
    height: 16px;
    font-size: 11px;
    color: #6b6b76;
  }

  .as-labels span {
    position: absolute;
    top: 1px;
    white-space: nowrap;
  }
</style>
