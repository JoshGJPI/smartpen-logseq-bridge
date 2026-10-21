<!--
  TagCard.svelte — one tag on the Library home in Tag grouping (v3.1.0 page
  tags; mockup 4), laid out like NotebookCard: a fan of its most recently
  written pages, the tag, page and notebook counts. `untagged` draws the
  dashed Untagged card. Numbers come from tagCards() / untaggedCard() (sidecar
  + scan); only the fan's thumbnails read pages, on screen (PageThumb).
-->
<script>
  import PageThumb from '../viewer/PageThumb.svelte';
  import TagChip from './TagChip.svelte';
  import { plural } from '$lib/plural.js';

  /** From tagCards() or untaggedCard(). */
  export let card;
  export let untagged = false;
  export let onOpen = () => {};

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

  $: fan = (card.fan || []).slice(0, 3).reverse();
  $: label = untagged ? 'Untagged pages' : card.tag;
  $: meta = `${card.pageCount} ${plural(card.pageCount, 'page')} · ${untagged ? 'across ' : ''}${card.notebookCount} ${plural(card.notebookCount, 'notebook')}`;
</script>

<button type="button" class="tc" class:untagged on:click={onOpen} title="Open {label}: {meta}">
  <div class="tc-fan" class:n2={fan.length === 2} class:n1={fan.length === 1}>
    {#each fan as r, i (`${r.book}/${idOf(r)}`)}
      <div class="tc-sheet s{fan.length - 1 - i}">
        <PageThumb book={r.book} pageId={idOf(r)} height="100%" />
      </div>
    {/each}
  </div>
  <div class="tc-body">
    <div class="tc-title">
      {#if untagged}<span class="tc-un">Untagged</span>{:else}<TagChip tag={card.tag} />{/if}
    </div>
    <div class="tc-meta">{meta}</div>
    {#if untagged}<div class="tc-sub">Pages with no tag yet</div>{/if}
  </div>
</button>

<style>
  .tc {
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
  .tc:hover, .tc:focus-visible {
    border-color: #4a7cf7;
    box-shadow: 0 2px 10px rgba(74, 124, 247, 0.15);
    transform: translateY(-1px);
    outline: none;
  }
  .tc.untagged { border-style: dashed; background: transparent; }
  .tc-fan { position: relative; height: 128px; background: #f3f3f1; border-bottom: 1px solid #ececec; }
  .untagged .tc-fan { background: transparent; }
  .tc-sheet {
    position: absolute;
    top: 12px;
    bottom: 10px;
    left: 50%;
    width: 40%;
    border: 1px solid #ddd;
    border-radius: 3px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    overflow: hidden;
  }
  .tc-sheet.s0 { transform: translateX(-50%); z-index: 3; }
  .tc-sheet.s1 { transform: translateX(-94%) rotate(-5deg); z-index: 2; }
  .tc-sheet.s2 { transform: translateX(-6%) rotate(5deg); z-index: 1; }
  .tc-fan.n2 .tc-sheet.s1 { transform: translateX(-80%) rotate(-4deg); }
  .tc-body { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px 12px; min-width: 0; }
  .tc-title { display: flex; min-width: 0; }
  .tc-title :global(.tg) { font-size: 13.5px; padding: 2px 10px; }
  .tc-un { font-size: 15px; font-weight: 600; color: #888; }
  .tc-meta { font-size: 13px; color: #555; }
  .tc-sub { font-size: 12px; color: #aaa; }
</style>
