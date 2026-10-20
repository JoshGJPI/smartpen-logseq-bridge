<!--
  SearchResults.svelte — the global search's results under the header field
  (reading-first package E): groups in `results.order` (Pages / Notebooks /
  Days), one keyboard-active row, hints when empty. Pure display: SearchField
  owns the query, the keys and what a pick does.

  Page rows: lazy thumbnail (PageThumb), notebook and page, when written, and
  the best-matching line with the query words marked (escaped HTML from
  snippetHtml). Rows take the mouse on mousedown so the field keeps focus.
-->
<script>
  import { bookAliases, searchDates } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { snippetHtml } from '$lib/global-search.js';
  import { writtenRange, shortDay, pageKeyOf } from '$lib/library-home.js';
  import { plural } from '$lib/plural.js';
  import PageThumb from '../viewer/PageThumb.svelte';

  export let results;
  export let query;
  /** Something is typed (else the hint shows). */
  export let typed = false;
  /** The results are for what is typed now (else "Searching…"). */
  export let settled = true;
  export let active = 0;
  export let onHover = () => {};
  /** (index, shift) => void */
  export let onPick = () => {};
  export let onBrowseAll = () => {};

  const TITLES = { pages: 'Pages', notebooks: 'Notebooks', days: 'Days' };
  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));
  const nameOf = (book) => formatBookName(book, $bookAliases, 'alias-only');

  // Flat index of each row, in the same order as flattenResults().
  $: groups = (results.order || [])
    .filter((g) => results[g] && results[g].length)
    .reduce((acc, g) => {
      const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].items.length : 0;
      acc.push({ id: g, items: results[g], start });
      return acc;
    }, []);

  function written(r) {
    const d = $searchDates.get(pageKeyOf(r.book, idOf(r)));
    return d ? writtenRange(d.first, d.last) : '';
  }

  function pick(e, i) {
    e.preventDefault();
    onPick(i, e.shiftKey);
  }
</script>

<div class="sr" role="listbox" tabindex="-1" aria-label="Search results" on:mousedown|preventDefault>
  {#if !typed}
    <p class="sr-hint">
      Search transcribed text, a date (<b>Oct 14</b>, <b>2026-10-14</b>, <b>yesterday</b>) or a notebook name.
      <br />↑ ↓ to choose · <b>Enter</b> opens · <b>Shift+Enter</b> loads a page into the Editor · <b>Esc</b> closes
    </p>
  {:else if !groups.length}
    <p class="sr-hint">
      {#if !settled}Searching…{:else if query.days.length && !query.tokens.length}No ink on {query.days.map((d) => shortDay(d)).join(', ')}.{:else}No matches for “{query.raw.trim()}”.{/if}
    </p>
  {:else}
    {#each groups as g (g.id)}
      <div class="sr-group">{TITLES[g.id]} <span>{g.items.length}</span></div>
      {#each g.items as item, j (g.id + (item.key || item.book || item.day))}
        {@const i = g.start + j}
        <button
          type="button"
          role="option"
          aria-selected={i === active}
          class="sr-row {g.id}"
          class:active={i === active}
          on:mousemove={() => i !== active && onHover(i)}
          on:click={(e) => pick(e, i)}
        >
          {#if g.id === 'pages'}
            <div class="sr-thumb"><PageThumb book={item.record.book} pageId={idOf(item.record)} height="54px" /></div>
            <div class="sr-main">
              <div class="sr-title">
                {nameOf(item.record.book)} · P{idOf(item.record)}
                {#if written(item.record)}<span class="sr-when">{written(item.record)}</span>{/if}
              </div>
              {#if item.snippet}<div class="sr-snip">{@html snippetHtml(item.snippet, query)}</div>{/if}
            </div>
          {:else if g.id === 'notebooks'}
            <div class="sr-main">
              <div class="sr-title">{item.name}</div>
              <div class="sr-snip">Open the notebook's pages</div>
            </div>
          {:else}
            <div class="sr-main">
              <div class="sr-title">{writtenRange(item.day, item.day)}</div>
              <div class="sr-snip">{item.pages} {plural(item.pages, 'page')} · {item.strokes.toLocaleString()} {plural(item.strokes, 'stroke')} · open in the Timeline</div>
            </div>
          {/if}
        </button>
      {/each}
    {/each}
  {/if}
  <button type="button" class="sr-foot" on:click={onBrowseAll}>Browse every transcript in Transcripts → Search</button>
</div>

<style>
  .sr {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 1000;
    width: min(600px, calc(100vw - 32px));
    max-height: min(70vh, 560px);
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-secondary);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .sr-hint { margin: 8px 10px; font-size: 0.8rem; line-height: 1.6; color: var(--text-secondary); }
  .sr-hint b { color: var(--text-primary); font-weight: 600; }
  .sr-group {
    margin: 8px 8px 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-secondary);
  }
  .sr-group span { font-weight: 400; opacity: 0.8; }
  .sr-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }
  .sr-row.active { background: var(--selected-bg, rgba(255, 255, 255, 0.08)); box-shadow: inset 2px 0 0 var(--selected-line, #4a7cf7); }
  .sr-thumb { flex: 0 0 44px; border-radius: 3px; overflow: hidden; }
  .sr-thumb :global(.thumb) { padding: 2px; }
  .sr-main { flex: 1; min-width: 0; }
  .sr-title { display: flex; align-items: baseline; gap: 8px; font-size: 0.85rem; font-weight: 600; }
  .sr-when { font-size: 0.75rem; font-weight: 400; color: var(--text-secondary); white-space: nowrap; }
  .sr-snip {
    margin-top: 2px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sr-snip :global(mark) { background: rgba(253, 224, 71, 0.3); color: var(--text-primary); border-radius: 2px; }
  .sr-foot {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 7px 8px;
    border: none;
    border-top: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-align: left;
    cursor: pointer;
  }
  .sr-foot:hover { color: var(--text-primary); }
</style>
