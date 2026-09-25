<!--
  FeedCard.svelte — one sitting in the Timeline feed.

  A sitting is every stroke chained by pauses of 20 minutes or less, across
  however many pages it touched (see daySessions). The card shows one FeedPart
  per page, in the order they were first written on, so a meeting that turned
  two pages reads as one card with two strips rather than two cards.

  A one-page sitting — most of them — gets no extra header: the part's own
  header carries the sitting's time, and the Load button sits in its slot.
  A multi-page sitting gets a header of its own for the time and the Load
  button, and each part heads itself with its page and share of the strokes.
-->
<script>
  import FeedPart from './FeedPart.svelte';
  import { formatDuration } from '$lib/timeline-feed.js';
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';

  /** A session from daySessions(). */
  export let session;
  /** Map "book/pageId" → indexPageStrokes() result, for the day's pages. */
  export let pages;
  export let onOpen = () => {};
  export let onLoad = async () => {};

  let loading = false;

  const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const strokesLabel = (n) => `${n.toLocaleString()} stroke${n === 1 ? '' : 's'}`;
  const bookName = (book, aliases) => formatBookName(book, aliases, 'alias-only');

  // A part whose page couldn't be read is left out rather than drawn empty.
  $: shown = session.parts.filter((p) => pages.get(`${p.book}/${p.pageId}`));

  $: start = clock(session.startTime);
  $: end = clock(session.endTime);
  $: timeMeta = `${start === end ? start : `${start} – ${end}`} · `
    + `${formatDuration(session.endTime - session.startTime)} · ${strokesLabel(session.count)}`;

  // "JPI Dotted · P149, P167" — pages grouped under their notebook, in the
  // order the sitting reached each notebook.
  $: multiTitle = groupedTitle(shown, $bookAliases);

  function groupedTitle(parts, aliases) {
    const groups = [];
    for (const p of parts) {
      const last = groups[groups.length - 1];
      if (last && last.book === p.book) last.ids.push(p.pageId);
      else groups.push({ book: p.book, ids: [p.pageId] });
    }
    return groups.map((g) => `${bookName(g.book, aliases)} · P${g.ids.join(', P')}`).join(' + ');
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      await onLoad(session);
    } finally {
      loading = false;
    }
  }
</script>

<article class="fc">
  {#if shown.length > 1}
    <header class="fc-head">
      <div class="fc-id">
        <div class="fc-title">{multiTitle}</div>
        <div class="fc-meta">{timeMeta} · {shown.length} pages</div>
      </div>
      <button type="button" class="fc-load" on:click={load} disabled={loading}
        title="Load this sitting into the Editor — the rest of each page comes along as grey context">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        {loading ? 'Loading…' : 'Load into Editor'}
      </button>
    </header>
    {#each shown as part, i (`${part.book}/${part.pageId}`)}
      <FeedPart
        {part}
        page={pages.get(`${part.book}/${part.pageId}`)}
        title={`${bookName(part.book, $bookAliases)} · P${part.pageId}`}
        meta={`${clock(part.firstStart)} · ${strokesLabel(part.count)}`}
        divided={i > 0}
        {onOpen}
      />
    {/each}
  {:else if shown.length === 1}
    <FeedPart
      part={shown[0]}
      page={pages.get(`${shown[0].book}/${shown[0].pageId}`)}
      title={`${bookName(shown[0].book, $bookAliases)} · P${shown[0].pageId}`}
      meta={timeMeta}
      {onOpen}
    >
      <button slot="actions" type="button" class="fc-load" on:click={load} disabled={loading}
        title="Load this sitting into the Editor — the rest of the page comes along as grey context">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
        {loading ? 'Loading…' : 'Load into Editor'}
      </button>
    </FeedPart>
  {/if}
</article>

<style>
  .fc {
    flex: 1;
    min-width: 0;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(20, 20, 40, 0.05);
  }

  .fc-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: #fafafb;
    border-bottom: 1px solid #e6e6ea;
  }

  .fc-id {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .fc-title,
  .fc-meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fc-title {
    font-size: 13.5px;
    font-weight: 650;
    color: #1f1f28;
  }

  .fc-meta {
    font-size: 12px;
    color: #62626e;
    font-variant-numeric: tabular-nums;
  }

  /* Styled here for both copies: Svelte scopes slotted markup to the
     component that wrote it, so the one in FeedPart's header is ours too. */
  .fc-load {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    height: 30px;
    padding: 0 9px;
    border: 1px solid #c7d6fb;
    border-radius: 6px;
    background: #fff;
    color: #2f5fd8;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .fc-load:hover:not(:disabled) {
    background: #eef3ff;
    border-color: #4a7cf7;
  }

  .fc-load:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
