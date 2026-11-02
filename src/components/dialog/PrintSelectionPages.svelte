<!--
  PrintSelectionPages.svelte — Print selection…'s pages (v3.8.0), read-only:
  one row per pen page with how many selected strokes print on it, in notebook
  then page order. The order and pages come from the selection, so there is
  nothing to pick, drag or remove here.
-->
<script>
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';

  /** [{ book, pageId, strokes }] from `selectionPrint` */
  export let pages = [];
  /** selected strokes that are on no page (floating pasted copies) */
  export let skipped = 0;

  const name = (r) => `${formatBookName(r.book, $bookAliases, 'alias-only') || `B${r.book}`} — P${r.pageId}`;
</script>

<div class="psp">
  <div class="psp-head">
    {pages.length} {plural(pages.length, 'page')} · each prints on its full page, the selection where it was written
  </div>
  <ol class="psp-rows">
    {#each pages as p, i (`${p.book}/${p.pageId}`)}
      <li>
        <span class="n">{i + 1}</span>
        <span class="t">{name(p)}</span>
        <span class="c">{p.strokes.length} {plural(p.strokes.length, 'stroke')}</span>
      </li>
    {/each}
  </ol>
  {#if skipped}
    <p class="psp-note">{skipped} selected {plural(skipped, 'stroke')} {skipped === 1 ? 'is' : 'are'} not on a page and won't print.</p>
  {/if}
</div>

<style>
  .psp { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .psp-head { padding: 6px 10px; background: var(--bg-secondary); color: var(--text-secondary); font-size: 0.78rem; }
  .psp-rows { list-style: none; margin: 0; padding: 0; max-height: 190px; overflow-y: auto; }
  .psp-rows li {
    display: flex; align-items: center; gap: 6px; padding: 4px 10px;
    border-top: 1px solid var(--border); font-size: 0.82rem; color: var(--text-primary);
  }
  .n { width: 22px; text-align: right; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .c { color: var(--text-secondary); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
  .psp-note { margin: 0; padding: 6px 10px; border-top: 1px solid var(--border); color: var(--warning); font-size: 0.78rem; }
</style>
