<!--
  TagPill.svelte — one tag on the Library home in Tag grouping when the
  display is Pills (v3.11.0): the tag, then its page and notebook counts, no
  thumbnails, so many tags fit on a screen. `untagged` draws the dashed
  Untagged pill. Same card data as TagCard (tagCards() / untaggedCard()); it
  reads no page.
-->
<script>
  import TagChip from './TagChip.svelte';
  import { plural } from '$lib/plural.js';

  /** From tagCards() or untaggedCard(). */
  export let card;
  export let untagged = false;
  export let onOpen = () => {};

  $: label = untagged ? 'Untagged pages' : card.tag;
  $: pages = `${card.pageCount} ${plural(card.pageCount, 'page')}`;
  $: books = `${card.notebookCount} ${plural(card.notebookCount, 'notebook')}`;
</script>

<button type="button" class="tpl" class:untagged on:click={onOpen} title="Open {label}: {pages} · {books}">
  {#if untagged}<span class="tpl-un">Untagged</span>{:else}<TagChip tag={card.tag} />{/if}
  <span class="tpl-meta">{pages} · {books}</span>
</button>

<style>
  .tpl {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    padding: 5px 12px 5px 6px;
    border: 1px solid #e0e0e0;
    border-radius: 99px;
    background: #fff;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .tpl:hover, .tpl:focus-visible {
    border-color: #4a7cf7;
    box-shadow: 0 1px 6px rgba(74, 124, 247, 0.15);
    outline: none;
  }
  .tpl.untagged { border-style: dashed; background: transparent; padding-left: 12px; }
  .tpl :global(.tg) { font-size: 13px; padding: 2px 9px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tpl-un { font-size: 13px; font-weight: 600; color: #888; }
  .tpl-meta { font-size: 12px; color: #666; white-space: nowrap; }
</style>
