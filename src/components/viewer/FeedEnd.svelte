<!--
  FeedEnd.svelte — the foot of the Timeline feed: "No ink in …" for an empty
  range, then either the way on (more days load as you scroll, or Show
  earlier / later days) or the "that's everything" line, and Back to top.
  TimelineFeed owns the footer element (it measures it for endless scroll).
-->
<script>
  import { dayStart } from '$lib/timeline.js';

  /** The range has no ink at all. */
  export let empty = false;
  /** Days with ink lie beyond the range (extendFeedRange found some). */
  export let hasMore = false;
  /** 'newest' | 'oldest' */
  export let order = 'newest';
  /** A book or type filter is on. */
  export let filtering = false;
  /** The range, written out ("1–12 November 2026"). */
  export let rangeLabel = '';
  /** The far end of the ink the feed can reach, a day key, or null when there is none. */
  export let farDay = null;
  export let onMore = () => {};
  export let onTop = () => {};

  const longDay = (day) => dayStart(day)?.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }) || day;
</script>

{#if empty}
  <div class="fe-title">No ink in {rangeLabel}{filtering ? ' for this filter' : ''}</div>
{/if}
{#if hasMore}
  <div class="fe-sub">{order === 'oldest' ? 'Later' : 'Earlier'} days load as you scroll</div>
  <div class="fe-actions">
    <button type="button" class="fe-btn load" on:click={onMore}>
      {order === 'oldest' ? 'Show later days' : 'Show earlier days'}
    </button>
    {#if !empty}
      <button type="button" class="fe-btn" on:click={onTop}>Back to top</button>
    {/if}
  </div>
{:else}
  <div class="fe-title">
    {#if !farDay}
      Nothing written{filtering ? ' matching this filter' : ''} yet
    {:else if order === 'oldest'}
      You're up to date — the last ink{filtering ? ' matching this filter' : ''} is from {longDay(farDay)}
    {:else}
      That's everything — the first ink{filtering ? ' matching this filter' : ''} is from {longDay(farDay)}
    {/if}
  </div>
  {#if !empty}
    <div class="fe-actions">
      <button type="button" class="fe-btn" on:click={onTop}>Back to top</button>
    </div>
  {/if}
{/if}

<style>
  .fe-title { font-size: 14px; font-weight: 650; color: #2b2b33; }
  .fe-sub { font-size: 12px; color: #62626e; font-variant-numeric: tabular-nums; }
  .fe-actions { display: flex; gap: 8px; }

  .fe-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 11px;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    background: #fff;
    color: #45454f;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .fe-btn:hover { background: #f2f2f4; border-color: #c8c8d0; }
  .fe-btn.load { color: #2f5fd8; border-color: #c7d6fb; font-weight: 600; }
  .fe-btn.load:hover { background: #eef3ff; border-color: #4a7cf7; }
</style>
