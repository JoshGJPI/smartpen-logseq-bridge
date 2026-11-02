<!--
  PrintPageList.svelte — the Print dialog's pages, in print order (v3.8.0).
  Drag a row (or use ↑ ↓) to reorder, × to drop a page, Sort by notebook to put
  them back in notebook-then-page order. Pages may come from any notebook. The
  dialog decides where an edit goes (setDialogPages: its own copy, or the print
  list when it is editing that).
-->
<script>
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { moveRef, sortByBook, refKey } from '$lib/print/print-list.js';

  /** [{ book, pageId }] */
  export let pages = [];
  /** (pages) => void */
  export let onChange = () => {};
  export let disabled = false;

  let dragFrom = null;
  let dropAt = null;

  const name = (r) => `${formatBookName(r.book, $bookAliases, 'alias-only') || `B${r.book}`} — P${r.pageId}`;
  $: books = new Set(pages.map((p) => p.book)).size;

  function move(from, to) {
    const next = moveRef(pages, from, to);
    if (next !== pages) onChange(next);
  }

  function onDragStart(e, i) {
    dragFrom = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  }

  function onDragOver(e, i) {
    if (dragFrom == null) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    dropAt = e.clientY > rect.top + rect.height / 2 ? i + 1 : i;
  }

  function onDrop(e) {
    e.preventDefault();
    if (dragFrom != null && dropAt != null) move(dragFrom, dropAt > dragFrom ? dropAt - 1 : dropAt);
    dragFrom = dropAt = null;
  }
</script>

<div class="ppl">
  <div class="ppl-head">
    <span>{pages.length} {pages.length === 1 ? 'page' : 'pages'}{books > 1 ? ` from ${books} notebooks` : ''} · drag to reorder</span>
    <button type="button" disabled={disabled || pages.length < 2} on:click={() => onChange(sortByBook(pages))}>Sort by notebook</button>
    <slot />
  </div>
  <ol class="ppl-rows" on:dragleave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) dropAt = null; }}>
    {#each pages as p, i (refKey(p))}
      <li
        draggable={!disabled}
        class:dragging={dragFrom === i}
        class:drop-before={dropAt === i && dragFrom !== i && dragFrom !== i - 1}
        class:drop-after={dropAt === i + 1 && i === pages.length - 1 && dragFrom !== i}
        on:dragstart={(e) => onDragStart(e, i)}
        on:dragover={(e) => onDragOver(e, i)}
        on:drop={onDrop}
        on:dragend={() => (dragFrom = dropAt = null)}
      >
        <span class="grip" aria-hidden="true">⋮⋮</span>
        <span class="n">{i + 1}</span>
        <span class="t" title={name(p)}>{name(p)}</span>
        <button type="button" disabled={disabled || i === 0} aria-label="Move {name(p)} up" on:click={() => move(i, i - 1)}>↑</button>
        <button type="button" disabled={disabled || i === pages.length - 1} aria-label="Move {name(p)} down" on:click={() => move(i, i + 1)}>↓</button>
        <button type="button" disabled={disabled} aria-label="Remove {name(p)}" title="Leave this page out" on:click={() => onChange(pages.filter((_, j) => j !== i))}>✕</button>
      </li>
    {/each}
  </ol>
</div>

<style>
  .ppl { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .ppl-head {
    display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    background: var(--bg-secondary); color: var(--text-secondary); font-size: 0.78rem;
  }
  .ppl-head span { flex: 1; min-width: 0; }
  .ppl-head :global(button), .ppl-rows button {
    padding: 2px 8px; border: 1px solid var(--border); border-radius: 5px;
    background: var(--bg-primary); color: var(--text-primary); font-size: 0.75rem; cursor: pointer;
  }
  .ppl-head :global(button:disabled), .ppl-rows button:disabled { opacity: 0.4; cursor: default; }
  .ppl-rows { list-style: none; margin: 0; padding: 0; max-height: 190px; overflow-y: auto; }
  .ppl-rows li {
    display: flex; align-items: center; gap: 6px; padding: 4px 10px;
    border-top: 1px solid var(--border); font-size: 0.82rem; color: var(--text-primary); cursor: grab;
  }
  .ppl-rows li.dragging { opacity: 0.4; }
  .ppl-rows li.drop-before { box-shadow: inset 0 2px 0 var(--selected-line); }
  .ppl-rows li.drop-after { box-shadow: inset 0 -2px 0 var(--selected-line); }
  .grip { color: var(--text-secondary); letter-spacing: -2px; font-size: 0.7rem; }
  .n { width: 22px; text-align: right; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ppl-rows button { padding: 0 6px; line-height: 18px; }
</style>
