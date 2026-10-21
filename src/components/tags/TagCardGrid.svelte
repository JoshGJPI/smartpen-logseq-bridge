<!--
  TagCardGrid.svelte — the Library home in Tag grouping (v3.1.0 page tags;
  mockup 4): project-number tags under Projects, keywords under Keywords, each
  in the chosen sort, then the dashed Untagged card. A card opens that tag's
  pages across notebooks (TagPages) through openLibraryView. Everything comes
  from derived stores (sidecar + scan); nothing here reads a page.
-->
<script>
  import { tagCardList, untaggedSummary, libraryTagSort, openLibraryView } from '$stores';
  import { sortTagCards } from '$lib/tags.js';
  import TagCard from './TagCard.svelte';

  $: sorted = sortTagCards($tagCardList, $libraryTagSort);
  $: projects = sorted.filter((c) => c.project);
  $: keywords = sorted.filter((c) => !c.project);
</script>

{#if !sorted.length}
  <div class="tcg-msg">
    <p>No tags yet.</p>
    <p class="sub">Tag a page beside it in the reader, or Select pages in a notebook's grid and add a tag to all of them.</p>
  </div>
{/if}

<div class="tcg">
  {#if projects.length}
    <h3>Projects</h3>
    {#each projects as card (card.tag)}
      <TagCard {card} onOpen={() => openLibraryView({ kind: 'tag', tag: card.tag })} />
    {/each}
  {/if}
  {#if keywords.length}
    <h3>Keywords</h3>
    {#each keywords as card (card.tag)}
      <TagCard {card} onOpen={() => openLibraryView({ kind: 'tag', tag: card.tag })} />
    {/each}
  {/if}
  {#if $untaggedSummary.pageCount}
    {#if sorted.length}<h3 class="sr">Untagged</h3>{/if}
    <TagCard card={$untaggedSummary} untagged onOpen={() => openLibraryView({ kind: 'untagged' })} />
  {/if}
</div>

<style>
  .tcg { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
  h3 {
    grid-column: 1 / -1;
    margin: 4px 0 -6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #999;
  }
  h3.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .tcg-msg { color: #999; font-size: 14px; padding: 20px 0 24px; text-align: center; }
  .tcg-msg p { margin: 0; }
  .tcg-msg .sub { font-size: 12px; color: #aaa; margin-top: 6px; }
</style>
