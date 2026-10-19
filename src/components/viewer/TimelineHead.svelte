<!--
  TimelineHead.svelte — the Timeline feed's header (reading-first package C).

  One row: ‹ Range ▾ › · summary · book filter · Load range. Under it, the
  activity strip with the range as a draggable window. The summary (days,
  pages, strokes) is said here once; the Dates panel beside the feed no
  longer repeats it. "Load range into Editor" is a quiet secondary button: the
  deliberate crossing into editing, not the page's main action.
-->
<script>
  import RangeMenu from './RangeMenu.svelte';
  import ActivityStrip from './ActivityStrip.svelte';
  import BookFilterMenu from '../dates/BookFilterMenu.svelte';
  import { timelineRange, timelineSummary } from '$stores';
  import { dayStart } from '$lib/timeline.js';
  import { plural } from '$lib/plural.js';

  export let busy = false;
  export let onLoadRange = () => {};
  /** -1 = the same-length range before, +1 = after. */
  export let onShift = (direction) => {};

  $: range = $timelineRange;
  $: summary = $timelineSummary;
  $: label = spanLabel(range.from, range.to);
  $: summaryLine = range.from
    ? `${summary.days} ${plural(summary.days, 'day')} with ink · ${summary.pages} ${plural(summary.pages, 'page')} · `
      + `${(summary.strokes || 0).toLocaleString()} ${plural(summary.strokes, 'stroke')}`
    : 'Pick a range';

  function spanLabel(from, to) {
    const a = dayStart(from), b = dayStart(to);
    if (!a || !b) return '';
    const opts = { day: 'numeric', month: 'long', year: 'numeric' };
    try {
      return new Intl.DateTimeFormat(undefined, opts).formatRange(a, b);
    } catch {
      return `${a.toLocaleDateString(undefined, opts)} – ${b.toLocaleDateString(undefined, opts)}`;
    }
  }
</script>

<div class="th">
  <div class="th-row">
    <div class="th-range">
      <button type="button" class="th-nav" on:click={() => onShift(-1)} aria-label="Earlier range" title="Earlier range">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <RangeMenu {label} />
      <button type="button" class="th-nav" on:click={() => onShift(1)} aria-label="Later range" title="Later range">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
      <span class="th-sub">{summaryLine}</span>
    </div>
    <div class="th-actions">
      <BookFilterMenu theme="light" />
      <button type="button" class="th-btn" on:click={onLoadRange} disabled={busy || summary.strokes === 0}
        title="Put this range's ink on the Editor canvas">
        {busy ? 'Loading…' : 'Load range into Editor'}
      </button>
    </div>
  </div>
  <ActivityStrip />
</div>

<style>
  .th {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 20px 4px;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    /* Above the feed's sticky day headings, so the menus drop over them. */
    position: relative;
    z-index: 5;
  }

  .th-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .th-range { display: flex; align-items: center; gap: 4px 6px; min-width: 0; flex-wrap: wrap; }
  .th-actions { display: flex; align-items: center; gap: 8px; }

  .th-sub {
    margin-left: 6px;
    font-size: 12px;
    color: #62626e;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .th-nav,
  .th-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 30px;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    background: #fff;
    color: #45454f;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .th-nav { width: 30px; padding: 0; flex-shrink: 0; }
  .th-btn { padding: 0 11px; }
  .th-nav:hover,
  .th-btn:hover:not(:disabled) { background: #f2f2f4; border-color: #c8c8d0; }
  .th-btn:disabled { opacity: 0.55; cursor: default; }
</style>
