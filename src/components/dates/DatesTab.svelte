<!--
  DatesTab.svelte — the Timeline's own panel ("Days"): the days in the range,
  each jumping the feed to it, with the one at the feed's top marked.

  v3.14.0: the From / To fields, ‹ › and presets left this panel. They were a
  second copy of the feed head's range menu (RangeMenu), which is now the one
  place to set the range; the panel's title line says which range it lists.

  The heat grid's job (the picture of the range), the summary, book filter and
  Load live once, in the feed's head (TimelineHead / TimelineFeed: Load session,
  day or range, then the Editor opens), so this panel keeps the range fields
  and the day list (package C).

  Until v3.10.0 this was also an Editor tab that loaded the canvas by date (with
  a heat grid, tally and "Order canvas by date"). The Timeline does that load,
  and the canvas order is on the bar below the canvas (CanvasControls), so the
  Editor's tabs are Strokes, Transcripts and Pages and a load from the Timeline
  lands on Strokes.
-->
<script>
  import { onMount } from 'svelte';
  import {
    timelineIndex, timelineLoading, timelineError, timelineRange,
    timelineRangeDays, loadTimeline
  } from '$stores/timeline.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { bookAliases } from '$stores';
  import { feedDayInView, feedOrder, requestFeedJump } from '$stores/viewer.js';
  import { dayStart } from '$lib/timeline.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';

  $: range = $timelineRange;
  $: inView = $feedDayInView;
  // Mirror the feed's order, so the list beside it reads the same way down.
  $: dayList = $feedOrder === 'newest' ? [...$timelineRangeDays].reverse() : $timelineRangeDays;

  // Refresh on every visit, not just the first. The tab is unmounted when you
  // leave it, so this fires each time you come back — and a refresh is one stat
  // per page file (~35ms over a 300-page corpus), so a page saved a moment ago
  // is already in the list rather than missing until a restart.
  onMount(() => {
    if ($dataFolderReady) loadTimeline({ silent: true });
  });

  // Covers the folder being chosen after this tab was already open.
  $: if ($dataFolderReady && !$timelineIndex && !$timelineLoading) {
    loadTimeline({ silent: true });
  }

  $: days = $timelineRangeDays.length;
  $: rangeNote = !range.from ? '' : range.from === range.to
    ? longDate(range.from)
    : `${longDate(range.from)} – ${longDate(range.to)}`;

  function longDate(day) {
    return dayStart(day)?.toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short'
    }) || day;
  }

  // 'alias-only' rather than the default 'full' — "Study Notes 2 (B388)" turns
  // a chip into a paragraph, and the book id is already in the tooltip.
  function chipLabel(entry) {
    return `${formatBookName(entry.book, $bookAliases, 'alias-only')} · P${entry.pageId}`;
  }

  const fmt = n => (n || 0).toLocaleString();
</script>

<div class="dates-tab">
  {#if !$dataFolderReady}
    <p class="notice">Choose a data folder in Settings to browse by date.</p>
  {:else if $timelineError}
    <p class="notice error">{$timelineError}</p>
    <button class="btn btn-secondary" on:click={() => loadTimeline({ force: true })}>Retry</button>
  {:else if $timelineLoading && !$timelineIndex}
    <p class="notice">Reading capture dates…</p>
  {:else}
    <p class="range-note" title="Set the range from the date at the top of the Timeline">
      {days} {plural(days, 'day')} with ink · {rangeNote}
    </p>

    <div class="daylist">
      {#each dayList as day (day.day)}
        <div class="day" class:in-view={inView === day.day}>
          <button type="button" class="day-head jump" on:click={() => requestFeedJump(day.day)}
            title="Scroll the timeline to this day">
            <b>{longDate(day.day)}{#if inView === day.day}<span class="in-view-pill">In view</span>{/if}</b>
            <span>{fmt(day.strokes)} {plural(day.strokes, 'stroke')} · {day.pages} pg</span>
          </button>
          <div class="chips">
            {#each day.entries as entry (entry.book + '/' + entry.pageId)}
              <span class="chip" class:partial={entry.spansOtherDays} title={entry.spansOtherDays
                ? `${chipLabel(entry)} — ${fmt(entry.strokes)} of ${fmt(entry.totalStrokes)} strokes were written this day`
                : `${chipLabel(entry)} — ${fmt(entry.strokes)} ${plural(entry.strokes, 'stroke')}`}>
                {chipLabel(entry)} <em>{fmt(entry.strokes)}</em>
              </span>
            {/each}
          </div>
        </div>
      {:else}
        <p class="notice">No ink captured in this range.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dates-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
  }

  .dates-tab::-webkit-scrollbar {
    width: 8px;
  }

  .dates-tab::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .dates-tab::-webkit-scrollbar-thumb {
    background: #3a3a60;
    border-radius: 4px;
  }

  .dates-tab::-webkit-scrollbar-thumb:hover {
    background: var(--selected-border);
  }

  .notice {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .notice.error {
    color: var(--error);
  }

  .range-note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .daylist {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }

  /* A little inset so the in-view tint has room; each heading is a button
     that scrolls the feed there. */
  .day {
    padding: 9px 8px;
    border-bottom: 1px solid var(--border);
  }

  .day.in-view {
    background: rgba(255, 255, 255, 0.07);
    border-radius: 6px;
  }

  .day-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .day-head.jump {
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .day-head.jump:hover b {
    text-decoration: underline;
  }

  .day-head.jump:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }

  .in-view-pill {
    margin-left: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--bg-secondary);
    background: var(--text-primary);
    border-radius: 8px;
    padding: 0 7px;
    vertical-align: 1px;
  }

  .day-head b {
    font-size: 0.8rem;
  }

  .day-head span {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 11px;
    padding: 2px 8px;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .chip em {
    font-style: normal;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  /* A page that also holds ink on other days — the ones that arrive with
     context ink. */
  .chip.partial {
    border-color: rgba(251, 191, 36, 0.45);
  }
</style>
