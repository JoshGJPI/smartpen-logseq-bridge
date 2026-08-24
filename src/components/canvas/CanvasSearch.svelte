<!--
  CanvasSearch.svelte — find a page among the ones currently on the canvas.

  Deliberately NOT the same thing as Transcripts → Search in the left panel.
  That one searches every saved page on disk to decide what to *load*; this one
  searches only what is already loaded, to decide where to *look*. With a dozen
  pages spread across the canvas, "which one mentions the footing schedule?" is
  a navigation question, and the answer is a pan, not an import.

  Matches on the notebook name, the page number, and the transcript text.
  Transcripts come from memory either way — fresh MyScript results, or the
  `transcriptionText` the metadata-only scan already carries for saved pages —
  so typing here never touches disk.
-->
<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { pages, pageTranscriptionsArray, savedPages, bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { BOOK_KEY_FRAGMENT } from '$lib/volumes.js';

  const dispatch = createEventDispatcher();

  /** S#/O#/B<bookKey>/P# — the book portion may carry a volume suffix. */
  const PAGE_KEY_RE = new RegExp(`^S(\\d+)\\/O(\\d+)\\/B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)$`);

  const SNIPPET_PAD = 55;
  const MAX_RESULTS = 12;

  /** Bound out so text view can highlight the same term on the page. */
  export let term = '';

  let query = '';
  $: term = query.trim();

  let isOpen = false;
  let activeIndex = 0;
  let inputEl;
  let wrapper;

  // One entry per page on the canvas, with whatever transcript text we hold for
  // it. Built from `$pages` rather than the page filter, so a page hidden by the
  // filter is still findable — the result then reveals it.
  $: index = buildIndex($pages, $pageTranscriptionsArray, $savedPages, $bookAliases);

  function buildIndex($pages, transcriptions, saved, aliases) {
    const entries = [];

    for (const [pageKey, pageStrokes] of $pages) {
      const match = pageKey.match(PAGE_KEY_RE);
      if (!match) continue;

      const book = match[3];
      const page = parseInt(match[4], 10);

      // Fresh MyScript results win over what is on disk: they are what the user
      // just produced and has not saved yet.
      const fresh = transcriptions?.find(
        t => String(t.pageInfo?.book) === book && t.pageInfo?.page === page
      );
      const stored = fresh
        ? null
        : saved?.find(p => String(p.book) === book && p.page === page && p.transcriptionText);

      const label = `${formatBookName(book, aliases, 'alias-only')} / P${page}`;
      entries.push({
        pageKey,
        book,
        page,
        label,
        strokeCount: Array.isArray(pageStrokes) ? pageStrokes.length : 0,
        text: fresh?.text || stored?.transcriptionText || ''
      });
    }

    return entries.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  $: results = search(index, query);

  function search(entries, raw) {
    const q = raw.trim().toLowerCase();
    if (!q) return [];

    const out = [];
    for (const entry of entries) {
      const labelHit = entry.label.toLowerCase().includes(q);
      const textLower = entry.text.toLowerCase();
      const textAt = textLower.indexOf(q);

      if (!labelHit && textAt === -1) continue;

      out.push({
        ...entry,
        labelHit,
        hits: textAt === -1 ? 0 : countHits(textLower, q),
        snippet: textAt === -1 ? null : makeSnippet(entry.text, textAt, q.length)
      });
    }

    // A name match is what you meant when you typed a notebook name; text
    // matches rank below, most hits first.
    out.sort((a, b) => (b.labelHit - a.labelHit) || (b.hits - a.hits));
    return out.slice(0, MAX_RESULTS);
  }

  function countHits(haystack, needle) {
    let n = 0;
    let i = haystack.indexOf(needle);
    while (i !== -1) {
      n++;
      i = haystack.indexOf(needle, i + needle.length);
    }
    return n;
  }

  /** Split around the match so the highlight needs no HTML escaping. */
  function makeSnippet(text, at, len) {
    const start = Math.max(0, at - SNIPPET_PAD);
    const end = Math.min(text.length, at + len + SNIPPET_PAD);
    return {
      before: (start > 0 ? '…' : '') + text.slice(start, at).replace(/\s+/g, ' '),
      match: text.slice(at, at + len),
      after: text.slice(at + len, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '')
    };
  }

  $: if (query.trim()) {
    isOpen = true;
    activeIndex = 0;
  }

  function choose(result) {
    dispatch('goto', result);
    isOpen = false;
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (query) {
        query = '';
        isOpen = false;
      } else {
        inputEl?.blur();
      }
      return;
    }
    if (!results.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % results.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + results.length) % results.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  function handleWindowClick(event) {
    if (isOpen && wrapper && !wrapper.contains(event.target)) isOpen = false;
  }

  /** Called by the parent so the toolbar / Ctrl+F can jump here. */
  export function focus() {
    inputEl?.focus();
    inputEl?.select();
  }

  onDestroy(() => { isOpen = false; });
</script>

<svelte:window on:click={handleWindowClick} />

<div class="canvas-search" bind:this={wrapper}>
  <span class="cs-icon" aria-hidden="true">🔍</span>
  <input
    bind:this={inputEl}
    bind:value={query}
    type="text"
    placeholder="Find page on canvas…"
    aria-label="Find a page on the canvas by name or transcript"
    disabled={index.length === 0}
    title={index.length === 0
      ? 'No pages on the canvas yet'
      : `Search the ${index.length} page${index.length !== 1 ? 's' : ''} on the canvas`}
    on:keydown={handleKeydown}
    on:focus={() => { if (query.trim()) isOpen = true; }}
  />
  {#if query}
    <button class="cs-clear" on:click={() => { query = ''; isOpen = false; focus(); }} title="Clear">✕</button>
  {/if}

  {#if isOpen && query.trim()}
    <div class="cs-results" role="listbox">
      {#if results.length === 0}
        <div class="cs-empty">
          Nothing on the canvas matches “{query}”.
          <span class="cs-empty-hint">Searching {index.length} loaded page{index.length !== 1 ? 's' : ''} — use Transcripts → Search for pages not yet loaded.</span>
        </div>
      {:else}
        {#each results as result, i (result.pageKey)}
          <button
            class="cs-result"
            class:active={i === activeIndex}
            role="option"
            aria-selected={i === activeIndex}
            on:mouseenter={() => (activeIndex = i)}
            on:click={() => choose(result)}
          >
            <span class="cs-result-head">
              <span class="cs-label">{result.label}</span>
              <span class="cs-meta">
                {#if result.hits > 0}{result.hits} hit{result.hits !== 1 ? 's' : ''} · {/if}{result.strokeCount} strokes
              </span>
            </span>
            {#if result.snippet}
              <span class="cs-snippet"
                >{result.snippet.before}<mark>{result.snippet.match}</mark>{result.snippet.after}</span
              >
            {:else if !result.text}
              <span class="cs-snippet cs-none">No transcript for this page</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .canvas-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 5px;
    min-width: 170px;
    max-width: 240px;
    flex: 0 1 auto;
  }

  .canvas-search:focus-within {
    border-color: var(--accent);
  }

  .cs-icon {
    font-size: 0.7rem;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .canvas-search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 0.75rem;
    padding: 2px 0;
  }

  .canvas-search input::placeholder {
    color: var(--text-secondary);
  }

  .canvas-search input:disabled {
    cursor: not-allowed;
  }

  .cs-clear {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0 2px;
    flex-shrink: 0;
  }

  .cs-clear:hover {
    color: var(--text-primary);
  }

  .cs-results {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    width: 340px;
    max-height: 320px;
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    z-index: 300;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cs-result {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 7px 9px;
    background: transparent;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
  }

  .cs-result.active {
    background: var(--bg-tertiary);
  }

  .cs-result-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }

  .cs-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cs-meta {
    font-size: 0.65rem;
    color: var(--text-secondary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cs-snippet {
    font-size: 0.7rem;
    line-height: 1.45;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cs-snippet mark {
    background: rgba(251, 191, 36, 0.25);
    color: var(--warning);
    border-radius: 2px;
    padding: 0 1px;
  }

  .cs-none {
    font-style: italic;
    opacity: 0.7;
  }

  .cs-empty {
    padding: 12px 10px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .cs-empty-hint {
    display: block;
    margin-top: 5px;
    font-size: 0.68rem;
    opacity: 0.8;
  }
</style>
