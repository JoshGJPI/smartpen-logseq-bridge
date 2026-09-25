<!--
  TimelineFeed.svelte — Book View's Timeline mode: the Dates tab's range as one
  scrolling column of ink, a card per sitting, newest first by default.

  Browsing here is read-only and cheap, so it follows the Dates range live —
  there is no "load" step to see a range. Putting ink on the canvas is the
  deliberate act, at three sizes: a card, a day, or the whole range.

  Lazy loading: the outline (days, pages, counts) comes from the capture-date
  index with no page reads. Each FeedDay registers its element here; one
  IntersectionObserver marks days within 1.5 screens as active (they read their
  pages), and a wider one (4 screens) lets them go again, so a month-long range
  never holds more than a few days of pages. Pages are shared through one
  ref-counted loader, since most pages hold ink from more than one day.

  Endless scroll: scrolling toward the end of the range grows the RANGE by the
  next few days with ink (earlier when newest is on top), rather than keeping a
  private extension. The Dates tab's grid and tallies then keep describing
  exactly what the feed shows, and "Load range into Editor" loads what you
  scrolled through. It runs only on a user scroll or wheel — opening the feed
  never widens a range you picked.

  Everything here reads the book-filtered index, so an excluded notebook is
  gone from the outline, the cards, the sittings and the loads alike.
-->
<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import FeedDay from './FeedDay.svelte';
  import BookFilterMenu from '../dates/BookFilterMenu.svelte';
  import { feedSkeleton, nextFeedRange, extendFeedRange, PAGE_MIN_WIDTH } from '$lib/timeline-feed.js';
  import { dayStart } from '$lib/timeline.js';
  import { createFeedPageLoader } from '$lib/viewer/feed-pages.js';
  import {
    importDateRangeFromFolder, importSessionFromFolder, LARGE_LOAD_STROKES
  } from '$lib/storage/load-range.js';
  import {
    timelineIndex, timelineIndexFiltered, timelineExcludedBooks, timelineLoading, timelineError,
    timelineRange, timelineDays, timelineSummary, loadTimeline, setTimelineRange,
    setCanvasPageOrder, feedOrder, feedDayInView, feedJumpRequest, setViewerMode,
    setBookViewMode, setViewerSelection, recordRecentView, setActiveTab
  } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';

  const RAIL = 84;
  // Days with ink added each time the feed runs out.
  const EXTEND_DAYS = 3;

  const loader = createFeedPageLoader();
  let scrollEl;
  let endEl;
  let colWidth = 760;
  let busy = false;

  $: range = $timelineRange;
  $: order = $feedOrder;
  $: skeleton = feedSkeleton($timelineIndexFiltered, $timelineDays, range.from, range.to, order);
  $: pxPerUnit = Math.max(4, (colWidth - RAIL) / PAGE_MIN_WIDTH);
  $: more = extendFeedRange($timelineDays, range.from, range.to, order, EXTEND_DAYS);
  $: filtering = $timelineExcludedBooks.size > 0;

  // ---- labels ---------------------------------------------------------------
  function spanLabel(from, to, opts) {
    const a = dayStart(from), b = dayStart(to);
    if (!a || !b) return '';
    try {
      return new Intl.DateTimeFormat(undefined, opts).formatRange(a, b);
    } catch {
      return `${a.toLocaleDateString(undefined, opts)} – ${b.toLocaleDateString(undefined, opts)}`;
    }
  }
  const longDay = (day) => dayStart(day)?.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }) || day;
  const fmt = (n) => (n || 0).toLocaleString();
  $: rangeLabel = spanLabel(range.from, range.to, { day: 'numeric', month: 'long', year: 'numeric' });
  $: summary = $timelineSummary;
  $: summaryLine = `${summary.days} day${summary.days === 1 ? '' : 's'} with ink · `
    + `${summary.pages} page${summary.pages === 1 ? '' : 's'} · ${fmt(summary.strokes)} strokes`;
  // The far end of the ink the feed can reach, for the "that's everything" line.
  $: farDay = order === 'oldest'
    ? $timelineDays[$timelineDays.length - 1]?.day
    : $timelineDays[0]?.day;

  // ---- lazy loading -----------------------------------------------------------
  const elements = new Map(); // element → day key
  let near = new Set();
  let loadObserver = null;
  let keepObserver = null;

  function register(el, day) {
    if (!el) return () => {};
    elements.set(el, day);
    loadObserver?.observe(el);
    keepObserver?.observe(el);
    return () => {
      elements.delete(el);
      loadObserver?.unobserve(el);
      keepObserver?.unobserve(el);
      if (near.has(day)) {
        near.delete(day);
        near = new Set(near);
      }
    };
  }

  function watch(margin, onEntry) {
    return new IntersectionObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const day = elements.get(entry.target);
        if (day && onEntry(entry, day)) changed = true;
      }
      if (changed) near = new Set(near);
    }, { root: scrollEl, rootMargin: `${margin} 0px` });
  }

  // ---- endless scroll ---------------------------------------------------------
  function endIsNear() {
    if (!endEl || !scrollEl) return false;
    const view = scrollEl.getBoundingClientRect();
    return endEl.getBoundingClientRect().top - view.bottom < view.height * 1.5;
  }

  let extending = false;
  // Grow the range while the end is still within reach. One step can fall
  // short — three quiet days may be shorter than a screen — so it loops, with a
  // cap, re-measuring once the new days have mounted and pushed the end down.
  async function extendWhileNear(force = false) {
    if (extending) return;
    extending = true;
    try {
      for (let i = 0; i < 12 && more && (force || endIsNear()); i++) {
        force = false;
        setTimelineRange(more.from, more.to);
        await tick();
      }
    } finally {
      extending = false;
    }
  }

  function onWheel(event) {
    // Covers a feed shorter than its viewport, which has nothing to scroll and
    // so fires no scroll events at all.
    if (event.deltaY > 0 && endIsNear()) extendWhileNear();
  }

  // ---- scroll-spy: which day heads the viewport ------------------------------
  let spyQueued = false;
  function onScroll() {
    if (spyQueued) return;
    spyQueued = true;
    requestAnimationFrame(() => {
      spyQueued = false;
      updateSpy();
      if (endIsNear()) extendWhileNear();
    });
  }

  function updateSpy() {
    if (!scrollEl) return;
    const top = scrollEl.getBoundingClientRect().top + 8;
    let best = null;
    for (const [el, day] of elements) {
      const r = el.getBoundingClientRect();
      if (r.bottom > top && (!best || r.top < best.top)) best = { top: r.top, day };
    }
    feedDayInView.set(best ? best.day : null);
  }

  function jumpTo(day) {
    if (!scrollEl) return;
    for (const [el, d] of elements) {
      if (d !== day) continue;
      scrollEl.scrollTop += el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      return;
    }
  }

  // Start from the top only when the feed genuinely changes: a new near end
  // (the day it opens on), a new order, or a new book filter. Growing the FAR
  // end — endless scroll, or dragging the grid further back — keeps your place.
  let lastKey = '';
  $: nearEnd = order === 'oldest' ? range.from : range.to;
  $: filterKey = [...$timelineExcludedBooks].sort().join(',');
  $: feedKey = `${nearEnd}|${order}|${filterKey}`;
  $: if (feedKey !== lastKey) {
    lastKey = feedKey;
    if (scrollEl) scrollEl.scrollTop = 0;
    tick().then(updateSpy);
  }

  let lastJump = 0;
  const unsubJump = feedJumpRequest.subscribe((r) => {
    if (r.n === lastJump) return;
    lastJump = r.n;
    if (r.day) jumpTo(r.day);
  });

  onMount(() => {
    lastJump = $feedJumpRequest.n;
    // Refresh on every visit — one stat per page file — so a page saved a moment
    // ago is already in the feed.
    if ($dataFolderReady) loadTimeline({ silent: true });

    loadObserver = watch('150%', (entry, day) => {
      if (!entry.isIntersecting || near.has(day)) return false;
      near.add(day);
      return true;
    });
    keepObserver = watch('400%', (entry, day) => {
      if (entry.isIntersecting || !near.has(day)) return false;
      near.delete(day);
      return true;
    });
    // Days mount (and register) before this runs.
    for (const el of elements.keys()) {
      loadObserver.observe(el);
      keepObserver.observe(el);
    }
    updateSpy();
  });

  onDestroy(() => {
    unsubJump();
    loadObserver?.disconnect();
    keepObserver?.disconnect();
    loader.clear();
    feedDayInView.set(null);
  });

  // ---- actions --------------------------------------------------------------
  function afterLoad(result) {
    if (result && result.success && (result.imported > 0 || result.duplicatesSkipped > 0)) {
      setCanvasPageOrder('date');
      setViewerMode('editor');
    }
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    try {
      afterLoad(await task());
    } finally {
      busy = false;
    }
  }

  const loadSession = (s) => run(() => importSessionFromFolder({
    pages: s.parts.map((p) => ({ book: p.book, pageId: p.pageId })),
    startMs: s.startTime,
    // One past the last stroke's START: the window filters on startTime.
    endMs: s.lastStart + 1
  }));

  const loadDay = (day) => run(() => importDateRangeFromFolder({
    from: day, to: day, index: $timelineIndexFiltered
  }));

  function loadRange() {
    if (summary.strokes > LARGE_LOAD_STROKES && !window.confirm(
      `Load ${fmt(summary.strokes)} strokes into the Editor? That is a lot of ink for one canvas — `
      + 'expect slow panning and zooming.'
    )) return;
    run(() => importDateRangeFromFolder({ from: range.from, to: range.to, index: $timelineIndexFiltered }));
  }

  function openPage(p) {
    setViewerSelection(p.book, p.pageId);
    recordRecentView(p.book, p.pageId);
    setBookViewMode('books');
  }

  function shiftRange(direction) {
    const n = nextFeedRange(range.from, range.to, direction > 0 ? 'oldest' : 'newest');
    if (n) setTimelineRange(n.from, n.to);
  }
</script>

<div class="tf">
  <div class="tf-head">
    <div class="tf-range">
      <button type="button" class="tf-nav" on:click={() => shiftRange(-1)} aria-label="Earlier range" title="Earlier range">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div class="tf-label">
        <div class="tf-title">{rangeLabel || 'No range selected'}</div>
        <div class="tf-sub">{range.from ? summaryLine : 'Pick a range in the Dates tab'}</div>
      </div>
      <button type="button" class="tf-nav" on:click={() => shiftRange(1)} aria-label="Later range" title="Later range">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
      <button type="button" class="tf-btn" on:click={() => setActiveTab('dates')}>Change range</button>
      <BookFilterMenu theme="light" />
    </div>
    <button type="button" class="tf-btn load" on:click={loadRange} disabled={busy || summary.strokes === 0}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
      {busy ? 'Loading…' : 'Load range into Editor'}
    </button>
  </div>

  <div class="tf-scroll" bind:this={scrollEl} on:scroll={onScroll} on:wheel|passive={onWheel}>
    <div class="tf-col" bind:clientWidth={colWidth}>
      {#if !$dataFolderReady}
        <p class="tf-msg">Choose a data folder in Settings to browse by date.</p>
      {:else if $timelineError}
        <p class="tf-msg">{$timelineError}
          <button type="button" class="tf-link" on:click={() => loadTimeline({ force: true })}>Retry</button></p>
      {:else if $timelineLoading && !$timelineIndex}
        <p class="tf-msg">Reading capture dates…</p>
      {:else}
        {#each skeleton as entry (entry.kind === 'day' ? entry.day : `gap:${entry.from}`)}
          {#if entry.kind === 'day'}
            <FeedDay
              item={entry}
              active={near.has(entry.day)}
              {loader}
              {order}
              {pxPerUnit}
              {busy}
              {register}
              onOpenPage={openPage}
              onLoadSession={loadSession}
              onLoadDay={loadDay}
            />
          {:else}
            <div class="tf-empty">
              <i></i>
              <span>{entry.count === 1
                ? `${dayStart(entry.from)?.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} — nothing written`
                : `${spanLabel(entry.from, entry.to, { day: 'numeric', month: 'short' })} — nothing written`}</span>
              <i></i>
            </div>
          {/if}
        {/each}

        {#if range.from}
          <footer class="tf-end" bind:this={endEl}>
            {#if !skeleton.length}
              <div class="tf-end-title">No ink in {rangeLabel}{filtering ? ' for the selected books' : ''}</div>
            {/if}
            {#if more}
              <div class="tf-sub">{order === 'oldest' ? 'Later' : 'Earlier'} days load as you scroll</div>
              <div class="tf-end-actions">
                <button type="button" class="tf-btn load" on:click={() => extendWhileNear(true)}>
                  {order === 'oldest' ? 'Show later days' : 'Show earlier days'}
                </button>
                {#if skeleton.length}
                  <button type="button" class="tf-btn" on:click={() => { scrollEl.scrollTop = 0; }}>Back to top</button>
                {/if}
              </div>
            {:else}
              <div class="tf-end-title">
                {#if !farDay}
                  Nothing written{filtering ? ' in the selected books' : ''} yet
                {:else if order === 'oldest'}
                  You're up to date — the last ink{filtering ? ' in these books' : ''} is from {longDay(farDay)}
                {:else}
                  That's everything — the first ink{filtering ? ' in these books' : ''} is from {longDay(farDay)}
                {/if}
              </div>
              {#if skeleton.length}
                <div class="tf-end-actions">
                  <button type="button" class="tf-btn" on:click={() => { scrollEl.scrollTop = 0; }}>Back to top</button>
                </div>
              {/if}
            {/if}
          </footer>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .tf {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    overflow: hidden;
  }

  .tf-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 20px;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    /* Above the feed's sticky day headings, so the book menu can drop over them. */
    position: relative;
    z-index: 5;
  }

  .tf-range { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .tf-label { min-width: 0; }
  .tf-title { font-size: 16px; font-weight: 650; color: #1f1f28; }
  .tf-sub { font-size: 12px; color: #62626e; font-variant-numeric: tabular-nums; }

  .tf-nav,
  .tf-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
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
  .tf-nav { width: 30px; padding: 0; }
  .tf-btn { padding: 0 11px; }
  .tf-nav:hover,
  .tf-btn:hover:not(:disabled) { background: #f2f2f4; border-color: #c8c8d0; }
  .tf-btn.load { color: #2f5fd8; border-color: #c7d6fb; font-weight: 600; }
  .tf-btn.load:hover:not(:disabled) { background: #eef3ff; border-color: #4a7cf7; }
  .tf-btn:disabled { opacity: 0.55; cursor: default; }

  .tf-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* Explicit, because the feed depends on it: when a day above the viewport
       loads or unloads and changes height, the browser keeps what you are
       reading in place instead of letting it slide. */
    overflow-anchor: auto;
  }

  .tf-col {
    max-width: 780px;
    margin: 0 auto;
    padding: 0 20px 12px;
    box-sizing: border-box;
  }

  .tf-msg { margin: 40px 0; text-align: center; font-size: 14px; color: #6b6b76; }

  .tf-link {
    background: none;
    border: none;
    color: #2f5fd8;
    font-weight: 600;
    cursor: pointer;
    padding: 0 4px;
  }

  .tf-empty {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 4px 0 30px;
    font-size: 12.5px;
    color: #6b6b76;
  }
  .tf-empty i { flex: 1; height: 1px; background: #dedee4; }

  .tf-end {
    margin: 14px 0 28px 84px;
    padding: 22px 0;
    border-top: 1px solid #e2e2e7;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    /* Growing the range inserts days ABOVE this; never let the browser pick
       the footer as the scroll anchor, or it would chase it downward. */
    overflow-anchor: none;
  }
  .tf-end-title { font-size: 14px; font-weight: 650; color: #2b2b33; }
  .tf-end-actions { display: flex; gap: 8px; }
</style>
