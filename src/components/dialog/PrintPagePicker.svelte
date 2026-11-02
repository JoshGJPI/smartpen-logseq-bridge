<!--
  PrintPagePicker.svelte — the Print dialog's left panel (v3.8.0): every
  notebook as an accordion heading, its pages as chips. Click a page to add it to
  the end of the print list, click it again to take it out; "Add all" adds a
  notebook's pages in page order. Built from the scan records (no page reads), so
  it opens instantly; a dot marks a transcribed page.
-->
<script>
  import { savedPages, bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { compareBookKeys } from '$lib/volumes.js';
  import { refKey } from '$lib/print/print-list.js';

  /** The dialog's pages, [{ book, pageId }]. */
  export let pages = [];
  /** (refs) => void */
  export let onAdd = () => {};
  /** (refs) => void */
  export let onRemove = () => {};
  export let disabled = false;

  let open = new Set();
  let openedFor = false;

  $: books = groupBooks($savedPages || [], $bookAliases);
  $: picked = new Set(pages.map(refKey));
  // Open the notebooks the job already draws from, once.
  $: if (!openedFor && books.length) {
    openedFor = true;
    open = new Set(pages.map((p) => p.book));
  }

  function groupBooks(records, aliases) {
    const map = new Map();
    for (const r of records) {
      const pageId = String(r.pageId != null ? r.pageId : r.page);
      const book = String(r.book);
      if (!map.has(book)) map.set(book, []);
      map.get(book).push({ book, pageId, transcribed: !!r.transcribed });
    }
    return [...map.entries()]
      .sort((a, b) => compareBookKeys(a[0], b[0]))
      .map(([book, list]) => ({
        book,
        name: formatBookName(book, aliases, 'alias-only') || `B${book}`,
        pages: list.sort((a, b) => a.pageId.localeCompare(b.pageId, undefined, { numeric: true }))
      }));
  }

  function toggleBook(book) {
    const next = new Set(open);
    if (next.has(book)) next.delete(book);
    else next.add(book);
    open = next;
  }

  function togglePage(p) {
    if (picked.has(refKey(p))) onRemove([p]);
    else onAdd([p]);
  }
</script>

<div class="pp" aria-label="Notebooks">
  <div class="pp-head">Notebooks <small>click a page to add it</small></div>
  <div class="pp-scroll">
    {#each books as b (b.book)}
      {@const n = b.pages.filter((p) => picked.has(refKey(p))).length}
      <section class="pp-book">
        <div class="pp-row">
          <button type="button" class="pp-toggle" aria-expanded={open.has(b.book)} on:click={() => toggleBook(b.book)}>
            <span class="caret" class:on={open.has(b.book)} aria-hidden="true">▸</span>
            <span class="pp-name" title={b.name}>{b.name}</span>
            <span class="pp-count">{n ? `${n}/` : ''}{b.pages.length}</span>
          </button>
          <button type="button" class="pp-all" disabled={disabled || n === b.pages.length}
            title="Add every page of {b.name} not already in the list" on:click={() => onAdd(b.pages)}>Add all</button>
        </div>
        {#if open.has(b.book)}
          <div class="pp-pages">
            {#each b.pages as p (p.pageId)}
              <button type="button" class="chip" class:on={picked.has(refKey(p))} aria-pressed={picked.has(refKey(p))} {disabled}
                title={picked.has(refKey(p)) ? 'In the list: click to take it out' : 'Add to the end of the list'}
                on:click={() => togglePage(p)}>
                P{p.pageId}{#if p.transcribed}<i aria-label="transcribed"></i>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <p class="pp-none">No saved pages.</p>
    {/each}
  </div>
</div>

<style>
  .pp { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .pp-head { padding: 6px 10px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.8rem; font-weight: 600; }
  .pp-head small { margin-left: 6px; font-weight: 400; color: var(--text-secondary); }
  .pp-scroll { flex: 1; min-height: 0; overflow-y: auto; }
  .pp-book { border-top: 1px solid var(--border); }
  .pp-row { display: flex; align-items: center; gap: 6px; padding-right: 8px; }
  .pp-toggle {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 7px 10px;
    border: none; background: none; color: var(--text-primary); font-size: 0.84rem; font-weight: 600; cursor: pointer; text-align: left;
  }
  .pp-toggle:hover { background: var(--bg-secondary); }
  .caret { color: var(--text-secondary); font-size: 0.7rem; transition: transform 0.12s; }
  .caret.on { transform: rotate(90deg); }
  .pp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-count { color: var(--text-secondary); font-weight: 400; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  .pp-all {
    padding: 2px 7px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-primary);
    color: var(--text-primary); font-size: 0.72rem; cursor: pointer; white-space: nowrap;
  }
  .pp-all:disabled { opacity: 0.4; cursor: default; }
  .pp-pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(54px, 1fr)); gap: 4px; padding: 2px 10px 10px 24px; }
  .chip {
    position: relative; padding: 4px 0; border: 1px solid var(--border); border-radius: 5px;
    background: var(--bg-primary); color: var(--text-secondary); font-size: 0.75rem; cursor: pointer;
  }
  .chip:hover:not(:disabled) { color: var(--text-primary); border-color: var(--selected-border); }
  .chip.on { background: var(--selected-bg); border-color: var(--selected-line); color: var(--text-primary); }
  .chip i { position: absolute; top: 3px; right: 3px; width: 4px; height: 4px; border-radius: 50%; background: var(--selected-line); }
  .pp-none { margin: 10px; color: var(--text-secondary); font-size: 0.8rem; }
</style>
