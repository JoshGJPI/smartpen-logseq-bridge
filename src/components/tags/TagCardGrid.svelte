<!--
  TagCardGrid.svelte — the Library home in Tag grouping (v3.1.0 page tags;
  mockup 4): project-number tags under Projects, keywords under Keywords, each
  in the chosen sort, then the dashed Untagged card. A card opens that tag's
  pages across notebooks (TagPages) through openLibraryView. Everything comes
  from derived stores (sidecar + scan); nothing here reads a page.

  v3.11.0: each group header folds its group shut (collapsedTagGroups), and the
  display is Cards (TagCard, thumbnail fans; the default) or Pills (TagPill,
  name and counts only), both remembered per viewer. Pills never load a
  thumbnail.
-->
<script>
  import {
    tagCardList, untaggedSummary, libraryTagSort, libraryTagView, collapsedTagGroups, toggleTagGroup, openLibraryView
  } from '$stores';
  import { sortTagCards } from '$lib/tags.js';
  import TagCard from './TagCard.svelte';
  import TagPill from './TagPill.svelte';

  $: sorted = sortTagCards($tagCardList, $libraryTagSort);
  $: groups = [
    { id: 'projects', label: 'Projects', cards: sorted.filter((c) => c.project) },
    { id: 'keywords', label: 'Keywords', cards: sorted.filter((c) => !c.project) }
  ].filter((g) => g.cards.length);
  $: pills = $libraryTagView === 'pills';
  $: Item = pills ? TagPill : TagCard;
</script>

{#if !sorted.length}
  <div class="tcg-msg">
    <p>No tags yet.</p>
    <p class="sub">Tag a page beside it in the reader, or Select pages in a notebook's grid and add a tag to all of them.</p>
  </div>
{/if}

{#each groups as g (g.id)}
  {@const open = !$collapsedTagGroups.includes(g.id)}
  <section class="tcg-sec">
    <h3>
      <button type="button" class="tcg-h" aria-expanded={open} on:click={() => toggleTagGroup(g.id)}
        title={open ? `Collapse ${g.label}` : `Expand ${g.label}`}>
        <span class="caret" class:shut={!open} aria-hidden="true">▾</span>
        {g.label}
        <span class="n">{g.cards.length}</span>
      </button>
    </h3>
    {#if open}
      <div class="tcg" class:pills>
        {#each g.cards as card (card.tag)}
          <svelte:component this={Item} {card} onOpen={() => openLibraryView({ kind: 'tag', tag: card.tag })} />
        {/each}
      </div>
    {/if}
  </section>
{/each}

{#if $untaggedSummary.pageCount}
  <section class="tcg-sec">
    {#if sorted.length}<h3 class="sr">Untagged</h3>{/if}
    <div class="tcg" class:pills>
      <svelte:component this={Item} card={$untaggedSummary} untagged onOpen={() => openLibraryView({ kind: 'untagged' })} />
    </div>
  </section>
{/if}

<style>
  .tcg-sec + .tcg-sec { margin-top: 18px; }
  .tcg { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
  .tcg.pills { display: flex; flex-wrap: wrap; gap: 8px; }
  h3 { margin: 0 0 8px; }
  .tcg-h {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 2px;
    border: none;
    border-radius: 5px;
    background: transparent;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #999;
    cursor: pointer;
  }
  .tcg-h:hover, .tcg-h:focus-visible { color: #555; background: #f2f2f4; outline: none; }
  .caret { display: inline-block; width: 10px; font-size: 10px; transition: transform 0.12s; }
  .caret.shut { transform: rotate(-90deg); }
  .n { font-weight: 500; letter-spacing: 0; color: #bbb; }
  h3.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .tcg-msg { color: #999; font-size: 14px; padding: 20px 0 24px; text-align: center; }
  .tcg-msg p { margin: 0; }
  .tcg-msg .sub { font-size: 12px; color: #aaa; margin-top: 6px; }
</style>
