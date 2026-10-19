<!--
  SearchField.svelte — the header's global search (reading-first package E):
  a field, Ctrl K to focus it from anywhere, and the results under it
  (SearchResults), grouped Pages / Notebooks / Days.

  Words search transcripts (the same matching as Transcripts → Search, over an
  index built once per scan: stores/library.js); dates ("Oct 14", "2026-10-14",
  "yesterday") give Day results and the pages written that day; notebook names
  or keys give Notebook results (lib/search-query.js, lib/global-search.js).
  Debounced; nothing reads a page except the result thumbnails on screen.

  Enter opens the result: a page in the reader (openPageInLibrary, so the
  discard prompt is asked; its line is lit only on trusted pages, see
  PageSpreadView), a notebook's page grid, a day in the Timeline. Shift+Enter
  loads a page into the Editor (load-into-editor.js). Escape closes.

  Ctrl K (isSearchShortcut) never fires while typing in another field or while
  a transcript is edited. Ctrl+F (canvas find) and Ctrl+Shift+F (Transcripts →
  Search) stay with the Editor's canvas.
-->
<script>
  import { onDestroy, tick } from 'svelte';
  import {
    globalSearchIndex, searchRecords, searchDates, notebookNames, transcriptEditing,
    ensureTimelineLoaded, openPageInLibrary, openNotebookInLibrary, focusReaderLine,
    navigateTo, setTimelineRange, setActiveTab, openTranscriptSearch
  } from '$stores';
  import { timelineIndexFiltered } from '$stores/timeline.js';
  import { parseSearchQuery } from '$lib/search-query.js';
  import { runSearch, flattenResults, isSearchShortcut } from '$lib/global-search.js';
  import { loadPageIntoEditor } from '$lib/viewer/load-into-editor.js';
  import SearchResults from './SearchResults.svelte';

  const DEBOUNCE_MS = 120;

  let input;
  let text = '';
  let focused = false;
  let query = parseSearchQuery('');
  let results = runSearch(null, {});
  let active = 0;
  let timer;

  $: open = focused;
  $: flat = flattenResults(results);

  // Re-run only when the text settles; the index itself is rebuilt per scan.
  $: schedule(text);
  function schedule(t) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = parseSearchQuery(t);
      active = 0;
    }, DEBOUNCE_MS);
  }
  $: results = runSearch(query, {
    index: $globalSearchIndex,
    notebooks: $notebookNames,
    timeline: $timelineIndexFiltered,
    dates: $searchDates,
    records: $searchRecords
  });

  onDestroy(() => clearTimeout(timer));

  function onWindowKey(e) {
    if (!isSearchShortcut(e, { editing: $transcriptEditing })) return;
    e.preventDefault();
    input.focus();
    input.select();
  }

  function close() {
    input && input.blur();
  }

  async function activate(entry, shift = false) {
    if (!entry) return;
    const { group, item } = entry;
    if (group === 'pages') {
      const r = item.record;
      const pageId = r.pageId != null ? String(r.pageId) : String(r.page);
      if (shift) {
        if ((await loadPageIntoEditor(r)) !== 'cancelled') close();
        return;
      }
      if (openPageInLibrary(r.book, pageId) === 'cancelled') return;
      if (query.tokens.length) focusReaderLine(r.book, pageId, query.tokens);
    } else if (group === 'notebooks') {
      if (openNotebookInLibrary(item.book) === 'cancelled') return;
    } else if (group === 'days') {
      // The same route as a written-on chip: passive, so a collapsed panel stays so.
      if (navigateTo('timeline') === 'cancelled') return;
      setTimelineRange(item.day, item.day);
      setActiveTab('dates');
    }
    close();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter before the debounce settles searches what is typed now.
      if (parseSearchQuery(text).raw !== query.raw) {
        clearTimeout(timer);
        query = parseSearchQuery(text);
        active = 0;
        tick().then(() => activate(flat[0], e.shiftKey));
        return;
      }
      activate(flat[active], e.shiftKey);
    }
  }

  async function browseAll() {
    close();
    await openTranscriptSearch();
  }
</script>

<svelte:window on:keydown={onWindowKey} />

<div class="sf" class:open>
  <svg class="sf-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
  <input
    bind:this={input}
    bind:value={text}
    type="text"
    placeholder="Search notes, dates, notebooks…"
    aria-label="Search notes, dates and notebooks"
    title="Search (Ctrl K)"
    on:focus={() => { focused = true; ensureTimelineLoaded(); }}
    on:blur={() => (focused = false)}
    on:keydown={onKey}
  />
  <kbd class="sf-kbd" aria-hidden="true">Ctrl K</kbd>

  {#if open}
    <SearchResults
      {results}
      {query}
      typed={text.trim() !== ''}
      settled={parseSearchQuery(text).raw === query.raw}
      {active}
      onHover={(i) => (active = i)}
      onPick={(i, shift) => activate(flat[i], shift)}
      onBrowseAll={browseAll}
    />
  {/if}
</div>

<style>
  .sf {
    position: relative;
    display: flex;
    align-items: center;
    width: 300px;
    min-width: 170px;
    flex-shrink: 1;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-secondary);
    transition: border-color 0.15s, width 0.15s;
  }
  .sf:hover { border-color: var(--text-secondary); }
  .sf.open { border-color: var(--selected-line, #4a7cf7); }
  .sf-icon { flex-shrink: 0; margin: 0 7px 0 11px; }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.8125rem;
    outline: none;
  }
  input::placeholder { color: var(--text-secondary); }
  .sf-kbd {
    flex-shrink: 0;
    margin: 0 7px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.7rem;
    opacity: 0.7;
  }
  .sf.open .sf-kbd { display: none; }
  @media (max-width: 1300px) {
    .sf { width: 230px; }
  }
</style>
