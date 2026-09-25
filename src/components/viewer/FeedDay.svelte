<!--
  FeedDay.svelte — one day of the Timeline feed.

  The heading (date, strokes, pages) comes from the capture-date index and is
  always shown. The cards need the strokes, so they load only while the parent
  says this day is `active` (near the viewport), and a whole DAY loads at once:
  a day's sittings interleave across its pages, so its cards can't be laid out
  until every page is read — loading page by page would reshuffle cards in
  front of the reader.

  When the day scrolls far away it lets its pages go and holds its measured
  height as a placeholder, so the scroll position doesn't jump.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import FeedCard from './FeedCard.svelte';
  import { daySessions, indexPageStrokes, estimateDayHeight, formatDuration } from '$lib/timeline-feed.js';
  import { dayStart } from '$lib/timeline.js';
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';

  /** A 'day' entry from feedSkeleton(). */
  export let item;
  export let active = false;
  /** createFeedPageLoader() instance shared by the whole feed. */
  export let loader;
  export let order = 'newest';
  export let pxPerUnit = 10;
  export let busy = false;
  /** (el, day) => unregister — the parent observes this day's element. */
  export let register = () => () => {};
  export let onOpenPage = () => {};
  export let onLoadSession = async () => {};
  export let onLoadDay = () => {};

  let el;
  let status = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
  let sessions = [];   // ascending
  let pagesByKey = new Map();
  let held = [];       // entries acquired from the loader
  let loadedCount = 0;
  let loadedFor = '';
  let measured = 0;
  let error = null;
  let token = 0;
  let unregister = () => {};

  // What this day's ink looked like when it was read; a change (a page saved
  // since) means the cards are stale.
  $: signature = `${item.strokes}:${item.entries.length}`;
  $: if (status === 'ready' && loadedFor !== signature) unload();

  $: if (active && status === 'idle') load();
  $: if (!active && (status === 'ready' || status === 'error')) unload();

  $: ordered = order === 'oldest' ? sessions : [...sessions].reverse();
  $: placeholder = measured || estimateDayHeight(item.entries, pxPerUnit);

  function releaseAll() {
    for (const e of held) loader.release(e.book, e.pageId);
    held = [];
  }

  async function load() {
    const my = ++token;
    const entries = item.entries;
    status = 'loading';
    error = null;
    loadedCount = 0;
    held = entries;
    try {
      const pages = await Promise.all(entries.map(async (e) => {
        const doc = await loader.acquire(e.book, e.pageId);
        if (my === token) loadedCount += 1;
        return { book: e.book, pageId: e.pageId, doc };
      }));
      if (my !== token) return; // unloaded or destroyed meanwhile
      const present = pages.filter((p) => p.doc);
      const map = new Map();
      for (const p of present) {
        map.set(`${p.book}/${p.pageId}`, { book: p.book, pageId: p.pageId, ...indexPageStrokes(p.doc) });
      }
      pagesByKey = map;
      sessions = daySessions(present, item.day);
      loadedFor = `${item.strokes}:${entries.length}`;
      status = 'ready';
    } catch (err) {
      if (my !== token) return;
      console.warn('[timeline] could not read pages for', item.day, err);
      error = err.message || String(err);
      status = 'error';
    }
  }

  function unload() {
    if (el && status === 'ready') measured = el.offsetHeight;
    token += 1;
    releaseAll();
    sessions = [];
    pagesByKey = new Map();
    status = 'idle';
  }

  function retry() {
    unload();
    if (active) load();
  }

  onMount(() => {
    unregister = register(el, item.day);
  });

  onDestroy(() => {
    token += 1;
    unregister();
    releaseAll();
  });

  const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmt = (n) => (n || 0).toLocaleString();

  $: heading = dayStart(item.day)?.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long'
  }) || item.day;

  $: span = status === 'ready' && sessions.length
    ? ` · ${clock(sessions[0].startTime)} – ${clock(sessions[sessions.length - 1].endTime)}`
    : '';

  // Reading down the feed moves back in time when newest is on top. Sittings
  // are more than the session gap apart by definition, so this is never tiny.
  function gapLabel(a, b) {
    const later = a.startTime > b.startTime ? a : b;
    const earlier = later === a ? b : a;
    return `${formatDuration(later.startTime - earlier.endTime)} ${order === 'oldest' ? 'later' : 'earlier'}`;
  }
</script>

<section class="fd" bind:this={el} data-day={item.day}
  style:min-height={status === 'ready' ? null : `${placeholder}px`}>
  <div class="fd-head">
    <div class="fd-title">
      <h2>{heading}</h2>
      <span>{fmt(item.strokes)} strokes · {item.pages} page{item.pages === 1 ? '' : 's'}{span}</span>
    </div>
    <button type="button" class="fd-action" on:click={() => onLoadDay(item.day)} disabled={busy}>
      Load day into Editor
    </button>
  </div>

  {#if status === 'ready'}
    {#each ordered as s, i (s.id)}
      {#if i > 0}
        <div class="fd-gap"><div class="fd-rail"><i class="line"></i></div><span>{gapLabel(ordered[i - 1], s)}</span></div>
      {/if}
      <div class="fd-row">
        <div class="fd-rail">
          <i class="line"></i><i class="dot"></i>
          <span class="fd-time">{clock(s.startTime)}</span>
        </div>
        <FeedCard
          session={s}
          pages={pagesByKey}
          onOpen={onOpenPage}
          onLoad={onLoadSession}
        />
      </div>
    {:else}
      <p class="fd-note">No ink for this day on disk any more — the capture-date index may be out of date.</p>
    {/each}
  {:else if status === 'loading'}
    <div class="fd-status">
      <span>Reading {item.entries.length} page{item.entries.length === 1 ? '' : 's'}…</span>
      <span class="fd-bar"><i style:width={`${(loadedCount / Math.max(1, item.entries.length)) * 100}%`}></i></span>
      <span>{loadedCount} of {item.entries.length}</span>
    </div>
  {:else if status === 'error'}
    <p class="fd-note">Couldn't read this day's pages: {error}
      <button type="button" class="fd-link" on:click={retry}>Retry</button></p>
  {:else}
    <div class="fd-placeholder">
      <div class="fd-chips">
        {#each item.entries as e (e.book + '/' + e.pageId)}
          <span class="fd-chip">{formatBookName(e.book, $bookAliases, 'alias-only')} · P{e.pageId} <em>{fmt(e.strokes)}</em></span>
        {/each}
      </div>
      <span>Loads as you scroll closer</span>
    </div>
  {/if}
</section>

<style>
  .fd { padding-bottom: 26px; }

  .fd-head {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 0 10px;
    margin-bottom: 12px;
    background: #f5f5f5;
    border-bottom: 1px solid #e2e2e7;
  }

  .fd-title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; min-width: 0; }
  .fd-title h2 { margin: 0; font-size: 17px; font-weight: 650; color: #1f1f28; }
  .fd-title span { font-size: 12.5px; color: #62626e; font-variant-numeric: tabular-nums; }

  .fd-action,
  .fd-link {
    background: none;
    border: none;
    color: #2f5fd8;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    padding: 4px 2px;
  }
  .fd-action:disabled { opacity: 0.5; cursor: progress; }
  .fd-action:hover:not(:disabled),
  .fd-link:hover { text-decoration: underline; }

  .fd-row { display: flex; align-items: stretch; }
  .fd-gap { display: flex; height: 32px; }
  .fd-gap span {
    display: flex;
    align-items: center;
    padding-left: 12px;
    font-size: 12px;
    font-style: italic;
    color: #6b6b76;
  }

  /* The timeline rail: a line down the left with a dot and the start time at
     each card. */
  .fd-rail { position: relative; width: 84px; flex-shrink: 0; }
  .fd-rail .line {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 15px;
    width: 2px;
    background: #dcdce2;
  }
  .fd-rail .dot {
    position: absolute;
    top: 19px;
    right: 10px;
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #1a1a2e;
  }
  .fd-time {
    position: absolute;
    top: 14px;
    right: 30px;
    font-size: 12px;
    font-weight: 600;
    color: #2b2b33;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .fd-status {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: 84px;
    font-size: 12px;
    color: #62626e;
    font-variant-numeric: tabular-nums;
  }
  .fd-bar { width: 140px; height: 4px; border-radius: 2px; background: #e4e4ea; overflow: hidden; }
  .fd-bar i { display: block; height: 100%; background: #2f5fd8; transition: width 0.2s; }

  .fd-placeholder {
    margin-left: 84px;
    min-height: 120px;
    box-sizing: border-box;
    border: 1.5px dashed #d2d2da;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px;
    font-size: 12px;
    color: #6b6b76;
  }
  .fd-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .fd-chip {
    display: inline-flex;
    gap: 6px;
    background: #fff;
    border: 1px solid #dedee5;
    border-radius: 12px;
    padding: 3px 10px;
    color: #45454f;
  }
  .fd-chip em { font-style: normal; color: #75757f; font-variant-numeric: tabular-nums; }

  .fd-note { margin: 0 0 0 84px; font-size: 12.5px; color: #62626e; }
</style>
