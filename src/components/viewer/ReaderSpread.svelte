<!--
  ReaderSpread.svelte — the Library reader's pages: one page, or a two-page
  spread, with the page tags strip beside them (ReaderTagsLayout). Split out of
  BookViewer (v3.2.0), which still decides what each slot shows (`slotA` /
  `slotB`: `{ record, mode }`), whether pages can turn, and guards every route.

  In Tag order the two pages of a spread can come from different notebooks;
  each page's header names its own.
-->
<script>
  import { bookAliases, applyTranscriptToRecord } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { pageIdOf as idOf } from '$lib/viewer/page-reader.js';
  import { loadPageIntoEditor } from '$lib/viewer/load-into-editor.js';
  import PageSpreadView from './PageSpreadView.svelte';
  import ReaderTagsLayout from '../tags/ReaderTagsLayout.svelte';

  /** `{ record, mode }` for the left (or only) page. */
  export let slotA;
  /** `{ record, mode }` for the right page, or null. */
  export let slotB = null;
  /** Show the right slot (a spread, or the pinned editing layout). */
  export let showSlotB = true;
  /** Both slots focus one page while its transcript is edited. */
  export let pinEdit = false;
  export let editingRecord = null;
  export let twoPageMode = true;
  export let canTurn = true;
  export let hasPrev = false;
  export let hasNext = false;
  /** What the empty right slot says at the end: "End of book" / "End of tag". */
  export let endLabel = 'End of book';
  /** ('prev'|'next') => void */
  export let onTurn = () => {};
  /** ('left'|'right', boolean) => void */
  export let onEditingChange = () => {};
  /** out: each page's zoom factor, null when it shows no ink */
  export let zoomA = null;
  export let zoomB = null;

  let pageA = null;
  let pageB = null;

  const aliasFor = (book) => formatBookName(book, $bookAliases, 'alias-only');

  /** Shared zoom: 'in' | 'out' | 'fit', applied to every page showing ink. */
  export function zoomAll(op) {
    for (const p of [pageA, pageB]) {
      if (!p) continue;
      if (op === 'fit') p.fit();
      else p.zoomBy(op === 'in' ? 1.2 : 1 / 1.2);
    }
  }
</script>

<ReaderTagsLayout records={pinEdit ? [editingRecord] : [slotA.record, showSlotB && slotB ? slotB.record : null]}>
<div class="bv-body" class:spread={showSlotB}>
  {#key `${slotA.record.book}:${idOf(slotA.record)}`}
    <div class="bv-page">
      <PageSpreadView
        bind:this={pageA}
        bind:zoom={zoomA}
        record={slotA.record}
        bookAlias={aliasFor(slotA.record.book)}
        contentMode={slotA.mode}
        layout={showSlotB ? 'stack' : 'side'}
        hasPrev={canTurn && hasPrev}
        hasNext={canTurn && !twoPageMode && hasNext}
        onPrev={canTurn ? () => onTurn('prev') : null}
        onNext={canTurn && !twoPageMode ? () => onTurn('next') : null}
        onTranscriptSaved={applyTranscriptToRecord}
        onLoadIntoEditor={() => loadPageIntoEditor(slotA.record)}
        onEditingChange={(e) => onEditingChange('left', e)}
      />
    </div>
  {/key}

  {#if showSlotB}
    <div class="bv-spine"></div>
    {#if slotB}
      {#key `${slotB.record.book}:${idOf(slotB.record)}`}
        <div class="bv-page">
          <PageSpreadView
            bind:this={pageB}
            bind:zoom={zoomB}
            record={slotB.record}
            bookAlias={aliasFor(slotB.record.book)}
            contentMode={slotB.mode}
            layout="stack"
            hasPrev={false}
            hasNext={canTurn && hasNext}
            onPrev={null}
            onNext={canTurn ? () => onTurn('next') : null}
            onTranscriptSaved={applyTranscriptToRecord}
            onLoadIntoEditor={() => loadPageIntoEditor(slotB.record)}
            onEditingChange={(e) => onEditingChange('right', e)}
          />
        </div>
      {/key}
    {:else}
      <div class="bv-page bv-endofbook">{endLabel}</div>
    {/if}
  {/if}
</div>
</ReaderTagsLayout>

<style>
  .bv-body { flex: 1; display: flex; min-height: 0; }
  .bv-page { flex: 1; display: flex; min-width: 0; overflow: hidden; }
  .bv-spine {
    width: 3px;
    flex-shrink: 0;
    background: linear-gradient(to bottom, #d8d8d8, #b8b8b8, #d8d8d8);
    box-shadow: -1px 0 3px rgba(0, 0, 0, 0.08), 1px 0 3px rgba(0, 0, 0, 0.08);
  }
  .bv-endofbook {
    align-items: center;
    justify-content: center;
    color: #bbb;
    font-size: 14px;
    background: #f0f0f0;
  }
</style>
