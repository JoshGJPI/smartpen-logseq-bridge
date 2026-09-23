<!--
  ActivityGrid.svelte — capture activity as a weekday grid, drag to select.

  Columns are weeks and rows are weekdays, so a year of capture fits in a panel
  without scrolling to a distant month, and the weekday pattern of a notebook is
  visible at a glance. Days with no capture are drawn, not skipped: a gap is
  information, and squeezing it out would make two months look adjacent.

  Selection is a pointer drag across cells rather than a brush handle — at this
  cell size a handle would be finer than the thing it selects.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { dayKey, dayStart, addDays } from '$lib/timeline.js';

  /** @type {Array<{day: string, strokes: number, pages: number}>} */
  export let days = [];
  export let from = null;
  export let to = null;

  const dispatch = createEventDispatcher();

  let dragging = false;
  let anchor = null;

  // Five buckets, thresholds chosen against the reference corpus (median day
  // ~1,500 strokes, busiest ~6,400) so a typical day sits mid-ramp rather than
  // saturating the top colour.
  const STEPS = [400, 1200, 2600];

  $: totals = new Map(days.map(d => [d.day, d]));

  $: grid = buildGrid(days);

  function buildGrid(list) {
    if (!list.length) return { weeks: [], months: [] };
    const first = dayStart(list[0].day);
    const last = dayStart(list[list.length - 1].day);
    if (!first || !last) return { weeks: [], months: [] };

    // Back up to the Monday on or before the first capture day, so every column
    // is a full week and rows line up with weekdays.
    const start = new Date(first);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

    const weeks = [];
    const months = [];
    let cursor = dayKey(start);
    let lastMonth = -1;
    let guard = 0;

    while (cursor && guard++ < 1200) {
      const column = [];
      const columnStart = dayStart(cursor);
      for (let r = 0; r < 7; r++) {
        const d = addDays(cursor, r);
        const date = dayStart(d);
        column.push({
          day: d,
          outside: !date || date < first || date > last
        });
      }
      weeks.push(column);

      const month = columnStart ? columnStart.getMonth() : lastMonth;
      months.push((columnStart && month !== lastMonth)
        ? columnStart.toLocaleDateString(undefined, { month: 'short' })
        : '');
      lastMonth = month;

      const next = addDays(cursor, 7);
      const nextDate = dayStart(next);
      if (!nextDate || nextDate > last) break;
      cursor = next;
    }

    return { weeks, months };
  }

  function level(day) {
    const entry = totals.get(day);
    if (!entry || entry.strokes <= 0) return 0;
    if (entry.strokes < STEPS[0]) return 1;
    if (entry.strokes < STEPS[1]) return 2;
    if (entry.strokes < STEPS[2]) return 3;
    return 4;
  }

  function selected(day) {
    return !!(from && to && day >= from && day <= to);
  }

  function title(day) {
    const entry = totals.get(day);
    const label = dayStart(day)?.toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    }) || day;
    if (!entry) return `${label} — nothing captured`;
    return `${label} — ${entry.strokes.toLocaleString()} strokes on ${entry.pages} page(s)`;
  }

  function startDrag(event, day) {
    dragging = true;
    anchor = day;
    dispatch('select', { from: day, to: day });
    event.preventDefault();
  }

  function overCell(day) {
    if (!dragging || !anchor) return;
    dispatch('select', { from: anchor, to: day });
  }

  function endDrag() {
    dragging = false;
  }

  function onKey(event, day) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      // Shift extends from the current start, matching the drag.
      dispatch('select', event.shiftKey && from ? { from, to: day } : { from: day, to: day });
    }
  }
</script>

<svelte:window on:pointerup={endDrag} on:pointercancel={endDrag} />

<div class="activity">
  {#if grid.weeks.length === 0}
    <p class="empty">No captured ink yet.</p>
  {:else}
    <div class="scroll">
      <div class="inner">
        <div class="months">
          {#each grid.months as label}
            <span>{label}</span>
          {/each}
        </div>
        <div class="grid">
          {#each grid.weeks as week}
            <div class="week">
              {#each week as cell}
                {#if cell.outside}
                  <span class="cell outside"></span>
                {:else}
                  <button
                    type="button"
                    class="cell level-{level(cell.day)}"
                    class:selected={selected(cell.day)}
                    title={title(cell.day)}
                    aria-label={title(cell.day)}
                    aria-pressed={selected(cell.day)}
                    on:pointerdown={(e) => startDrag(e, cell.day)}
                    on:pointerenter={() => overCell(cell.day)}
                    on:keydown={(e) => onKey(e, cell.day)}
                  ></button>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>
    <div class="legend">
      <span>Drag across days to select a range</span>
      <span class="ramp">
        <i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i>
      </span>
    </div>
  {/if}
</div>

<style>
  .activity {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .inner {
    display: inline-block;
    min-width: 100%;
  }

  .months {
    display: flex;
    height: 14px;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .months span {
    flex: 0 0 13px;
    white-space: nowrap;
  }

  .grid {
    display: flex;
    gap: 2px;
    touch-action: none;
  }

  .week {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cell {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 2px;
    padding: 0;
    cursor: pointer;
  }

  .cell.outside {
    background: transparent;
    cursor: default;
  }

  /* Ramp from the panel's own sunk surface up to the accent, so an empty day
     reads as "part of the panel" rather than as a dark mark of its own.
     Shared by the cells and the legend swatches so the two can't drift. */
  .level-0 { background: #232344; }
  .level-1 { background: #4a2436; }
  .level-2 { background: #8d2e42; }
  .level-3 { background: #c53c54; }
  .level-4 { background: var(--accent); }

  .cell.selected {
    box-shadow: inset 0 0 0 2px #ffffff;
  }

  .cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .legend {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .ramp {
    display: inline-flex;
    gap: 2px;
  }

  .ramp i {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: block;
  }

  .empty {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
</style>
