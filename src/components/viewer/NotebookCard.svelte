<!--
  NotebookCard.svelte — one notebook on the Library home (reading-first
  package E): a fan of its three most recently written pages, its name and
  volume, page count, when it was written and how much is transcribed.

  Every number is from `notebookCards()` (lib/library-home.js): scan records
  and the capture-date index, no page reads. Only the fan's thumbnails read
  pages, lazily (PageThumb).
-->
<script>
  import PageThumb from './PageThumb.svelte';
  import { writtenRange, relativeDay } from '$lib/library-home.js';
  import { plural } from '$lib/plural.js';

  /** A card from notebookCards(). */
  export let card;
  /** (book) => void */
  export let onOpen = () => {};

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

  $: range = writtenRange(card.first, card.last);
  $: lastLabel = card.last ? relativeDay(card.last) : '';
  $: meta = `${card.pageCount} ${plural(card.pageCount, 'page')}` + (lastLabel ? ` · last written ${lastLabel}` : '');
  $: fan = card.fan.slice(0, 3).reverse(); // oldest at the back, newest on top
</script>

<button
  type="button"
  class="nc"
  on:click={() => onOpen(card.book)}
  title="Open {card.name}: {card.pageCount} {plural(card.pageCount, 'page')}, {card.strokes.toLocaleString()} {plural(card.strokes, 'stroke')}"
>
  <div class="nc-fan" class:n2={fan.length === 2} class:n1={fan.length === 1}>
    {#each fan as r, i (`${r.book}/${idOf(r)}`)}
      <div class="nc-sheet s{fan.length - 1 - i}">
        <PageThumb book={r.book} pageId={idOf(r)} height="100%" />
      </div>
    {/each}
  </div>

  <div class="nc-body">
    <div class="nc-title">
      <span class="nc-name">{card.name}</span>
      {#if card.volume > 1}<span class="nc-vol" title="Volume {card.volume} of this notebook">Vol {card.volume}</span>{/if}
    </div>
    <div class="nc-meta">
      {meta}
    </div>
    <div class="nc-range">{range || 'No dated ink'}</div>
    <div class="nc-tx" title="{card.transcribed} of {card.pageCount} {plural(card.pageCount, 'page')} transcribed">
      <div class="nc-bar"><div class="nc-fill" style="width: {card.transcribedPct}%"></div></div>
      <span>{card.transcribedPct}% transcribed</span>
    </div>
  </div>
</button>

<style>
  .nc {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    background: #fff;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  }
  .nc:hover,
  .nc:focus-visible {
    border-color: #4a7cf7;
    box-shadow: 0 2px 10px rgba(74, 124, 247, 0.15);
    transform: translateY(-1px);
    outline: none;
  }

  /* Three sheets, fanned: the newest on top and in front. */
  .nc-fan {
    position: relative;
    height: 168px;
    background: #f3f3f1;
    border-bottom: 1px solid #ececec;
  }
  .nc-sheet {
    position: absolute;
    top: 16px;
    bottom: 12px;
    left: 50%;
    width: 46%;
    border: 1px solid #ddd;
    border-radius: 3px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    overflow: hidden;
  }
  .nc-sheet.s0 { transform: translateX(-50%); z-index: 3; }
  .nc-sheet.s1 { transform: translateX(-94%) rotate(-5deg); z-index: 2; }
  .nc-sheet.s2 { transform: translateX(-6%) rotate(5deg); z-index: 1; }
  .nc-fan.n2 .nc-sheet.s1 { transform: translateX(-80%) rotate(-4deg); }

  .nc-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .nc-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .nc-name {
    font-size: 15px;
    font-weight: 600;
    color: #222;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nc-vol {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 9px;
    background: #eef3ff;
    color: #3a5fc8;
    font-size: 12px;
    font-weight: 600;
  }
  .nc-meta { font-size: 13px; color: #555; }
  .nc-range { font-size: 12px; color: #888; }
  .nc-tx { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12px; color: #777; }
  .nc-bar { flex: 1; height: 5px; border-radius: 3px; background: #eee; overflow: hidden; }
  .nc-fill { height: 100%; background: #6ea8fe; }
</style>
