<!--
  DatesTab.svelte — load the canvas by capture date rather than by notebook.

  Date does not line up with pages: across the reference corpus 154 of 289 pages
  hold ink from more than one day, so this filters at STROKE level. What is left
  of each touched page comes along as context ink (halftoned, untouchable) so the
  day's writing can be read where it actually sits on the page.

  The same range drives Book View's Timeline feed. While the feed is showing,
  the day list jumps it to a day and marks the one at its top, and the load
  button hands the range to the Editor.
-->
<script>
  import { onMount } from 'svelte';
  import ActivityGrid from './ActivityGrid.svelte';
  import BookFilterMenu from './BookFilterMenu.svelte';
  import {
    timelineIndex, timelineIndexFiltered, timelineLoading, timelineError, timelineRange,
    timelineDays, timelineSummary, timelineRangeDays, timelineRangeExtent,
    canvasPageOrder, loadTimeline, setTimelineRange, setCanvasPageOrder
  } from '$stores/timeline.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { bookAliases } from '$stores';
  import { contextInkCount, clearContextInk } from '$stores/context-ink.js';
  import {
    feedVisible, feedDayInView, feedOrder, requestFeedJump, setViewerMode, setBookViewMode
  } from '$stores/viewer.js';
  import { importDateRangeFromFolder, LARGE_LOAD_STROKES } from '$lib/storage/load-range.js';
  import { dayStart, addDays } from '$lib/timeline.js';
  import { formatBookName } from '$utils/formatting.js';

  let loading = false;
  let progress = null;
  let confirmingLarge = false;

  $: range = $timelineRange;
  $: summary = $timelineSummary;
  $: heavy = summary.strokes > LARGE_LOAD_STROKES;
  $: inView = $feedVisible ? $feedDayInView : null;
  // Mirror the feed's order while it is showing, so the list beside it reads
  // the same way down.
  $: dayList = $feedVisible && $feedOrder === 'newest'
    ? [...$timelineRangeDays].reverse()
    : $timelineRangeDays;
  $: canLoad = $dataFolderReady && summary.strokes > 0 && !loading;

  // A new range is a new decision — don't carry a previous "load anyway" over.
  $: if (range) confirmingLarge = false;

  // Refresh on every visit, not just the first. The tab is unmounted when you
  // leave it, so this fires each time you come back — and a refresh is one stat
  // per page file (~35ms over a 300-page corpus), so a page saved a moment ago
  // is already in the grid rather than missing until a restart.
  onMount(() => {
    if ($dataFolderReady) loadTimeline({ silent: true });
  });

  // Covers the folder being chosen after this tab was already open.
  $: if ($dataFolderReady && !$timelineIndex && !$timelineLoading) {
    loadTimeline({ silent: true });
  }

  function onGridSelect(event) {
    setTimelineRange(event.detail.from, event.detail.to);
  }

  function onFromInput(event) {
    if (event.target.value) setTimelineRange(event.target.value, range.to || event.target.value);
  }

  function onToInput(event) {
    if (event.target.value) setTimelineRange(range.from || event.target.value, event.target.value);
  }

  /** Jump to the last day with ink, and optionally back n days from it. */
  function preset(kind) {
    const extent = $timelineRangeExtent;
    if (!extent) return;
    const anchor = (range.to && range.to <= extent.last) ? range.to : extent.last;
    if (kind === 'day') setTimelineRange(anchor, anchor);
    if (kind === 'week') setTimelineRange(addDays(anchor, -6), anchor);
    if (kind === 'month') setTimelineRange(addDays(anchor, -29), anchor);
    if (kind === 'latest') setTimelineRange(extent.last, extent.last);
  }

  function shift(n) {
    if (!range.from || !range.to) return;
    setTimelineRange(addDays(range.from, n), addDays(range.to, n));
  }

  async function handleLoad() {
    if (!canLoad) return;
    if (heavy && !confirmingLarge) {
      confirmingLarge = true;
      return;
    }
    loading = true;
    progress = null;
    try {
      const result = await importDateRangeFromFolder({
        from: range.from,
        to: range.to,
        index: $timelineIndexFiltered,
        onProgress: (message, current, total) => {
          progress = { message, current, total };
        }
      });
      // Only switch the canvas to date order once something is actually on it —
      // reordering an empty canvas just changes a setting the user can't see.
      if (result.success && result.imported > 0) setCanvasPageOrder('date');
      // From the feed, "Load into Editor" means go there too.
      if (result.success && $feedVisible) setViewerMode('editor');
    } finally {
      loading = false;
      progress = null;
      confirmingLarge = false;
    }
  }

  function showTimeline() {
    setBookViewMode('timeline');
    setViewerMode('book');
  }

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
    <ActivityGrid days={$timelineDays} from={range.from} to={range.to} {inView} on:select={onGridSelect} />

    <div class="range">
      <div class="field">
        <label for="date-from">From</label>
        <input id="date-from" type="date" value={range.from || ''} on:change={onFromInput} />
      </div>
      <div class="field">
        <label for="date-to">To</label>
        <input id="date-to" type="date" value={range.to || ''} on:change={onToInput} />
      </div>
      <div class="stepper">
        <button type="button" title="Earlier" aria-label="Shift range earlier" on:click={() => shift(-1)}>‹</button>
        <button type="button" title="Later" aria-label="Shift range later" on:click={() => shift(1)}>›</button>
      </div>
    </div>

    <div class="presets">
      <button type="button" on:click={() => preset('latest')}>Latest day</button>
      <button type="button" on:click={() => preset('day')}>1 day</button>
      <button type="button" on:click={() => preset('week')}>7 days</button>
      <button type="button" on:click={() => preset('month')}>30 days</button>
    </div>

    <div class="tally">
      <span><b>{summary.days}</b> days</span>
      <span><b>{summary.pages}</b> pages</span>
      <span><b>{fmt(summary.strokes)}</b> strokes</span>
      <span class="tally-filter"><BookFilterMenu theme="dark" align="right" /></span>
    </div>

    {#if summary.partialPages > 0}
      <p class="context-note">
        <b>{summary.partialPages}</b> of these pages also hold ink outside the range.
        Its {fmt(summary.contextStrokes)} strokes load as halftoned context —
        visible, but not selectable, savable or transcribable.
      </p>
    {/if}

    {#if $feedVisible}
      <p class="feed-note">
        Book View is showing this range as a timeline. Pick a day below to jump to it.
      </p>
    {/if}

    <div class="actions">
      <button class="btn btn-primary" on:click={handleLoad} disabled={!canLoad}>
        {#if loading}
          Loading…
        {:else if confirmingLarge}
          Load {fmt(summary.strokes)} strokes anyway
        {:else if summary.strokes === 0}
          Nothing in range
        {:else if $feedVisible}
          Load into Editor
        {:else}
          Load onto canvas
        {/if}
      </button>
      {#if !$feedVisible}
        <button class="btn btn-secondary" on:click={showTimeline} disabled={!$dataFolderReady}>
          View as timeline
        </button>
      {/if}
      <label class="order">
        <input
          type="checkbox"
          checked={$canvasPageOrder === 'date'}
          on:change={(e) => setCanvasPageOrder(e.target.checked ? 'date' : 'book')}
        />
        Order canvas by date
      </label>
    </div>

    {#if confirmingLarge}
      <p class="warn">
        That is a lot of ink for one canvas — expect slow panning and zooming.
        A shorter range, or clearing the canvas first, will feel better.
      </p>
    {/if}

    {#if progress}
      <p class="progress">{progress.message} ({progress.current}/{progress.total})</p>
    {/if}

    {#if $contextInkCount > 0}
      <p class="context-loaded">
        {fmt($contextInkCount)} strokes shown as context.
        <button type="button" class="link" on:click={clearContextInk}>Hide</button>
      </p>
    {/if}

    <p class="hint">
      Loading adds to the canvas; it never replaces what is already there. Use
      Clear to start from empty.
    </p>

    <div class="daylist" class:feed={$feedVisible}>
      {#each dayList as day (day.day)}
        <div class="day" class:in-view={inView === day.day}>
          {#if $feedVisible}
            <button type="button" class="day-head jump" on:click={() => requestFeedJump(day.day)}
              title="Scroll the timeline to this day">
              <b>{longDate(day.day)}{#if inView === day.day}<span class="in-view-pill">In view</span>{/if}</b>
              <span>{fmt(day.strokes)} strokes · {day.pages} pg</span>
            </button>
          {:else}
            <div class="day-head">
              <b>{longDate(day.day)}</b>
              <span>{fmt(day.strokes)} strokes · {day.pages} pg</span>
            </div>
          {/if}
          <div class="chips">
            {#each day.entries as entry (entry.book + '/' + entry.pageId)}
              <span class="chip" class:partial={entry.spansOtherDays} title={entry.spansOtherDays
                ? `${chipLabel(entry)} — ${fmt(entry.strokes)} of ${fmt(entry.totalStrokes)} strokes were written this day`
                : `${chipLabel(entry)} — ${fmt(entry.strokes)} strokes`}>
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
  }

  .notice {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .notice.error {
    color: var(--error);
  }

  .range {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  .field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .field label {
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .field input {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 5px;
    padding: 6px 7px;
    font-size: 0.8rem;
    width: 100%;
  }

  .stepper {
    display: flex;
    gap: 3px;
  }

  .stepper button {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 5px;
    width: 26px;
    height: 30px;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1;
  }

  .stepper button:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .presets button {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 5px;
    padding: 4px 9px;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .presets button:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .tally {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .tally-filter {
    margin-left: auto;
  }

  .tally b {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .context-note {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: #f3d9a0;
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.28);
    border-radius: 6px;
    padding: 8px 10px;
  }

  .context-note b {
    color: var(--warning);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }

  .actions :global(.btn-primary) {
    flex: 1;
    min-width: 150px;
  }

  .order {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .warn {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--warning);
  }

  .progress {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .context-loaded {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
  }

  .hint {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--text-secondary);
    opacity: 0.85;
  }

  .feed-note {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: #cdd7f2;
    background: rgba(74, 124, 247, 0.1);
    border: 1px solid rgba(74, 124, 247, 0.38);
    border-radius: 6px;
    padding: 8px 10px;
  }

  .daylist {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }

  .day {
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
  }

  /* While the feed is showing, rows get a little inset so the in-view tint
     has room, and each heading is a button that scrolls the feed there. */
  .daylist.feed .day {
    padding: 9px 8px;
  }

  .day.in-view {
    background: rgba(255, 255, 255, 0.07);
    border-radius: 6px;
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
    font-size: 0.62rem;
    font-weight: 600;
    color: var(--bg-secondary);
    background: var(--text-primary);
    border-radius: 8px;
    padding: 0 7px;
    vertical-align: 1px;
  }

  .day-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .day-head b {
    font-size: 0.8rem;
  }

  .day-head span {
    font-size: 0.7rem;
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
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .chip em {
    font-style: normal;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  /* A page that also holds ink on other days — the ones that arrive with
     context ink. Marked so the chip list explains the amber note above it. */
  .chip.partial {
    border-color: rgba(251, 191, 36, 0.45);
  }
</style>
