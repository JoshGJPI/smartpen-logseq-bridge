<!--
  TagSketches.svelte — a tag page's Sketches strip (v3.24.0,
  docs/TRANSCRIPT-STRUCTURE-SPEC.md E.5, the approved mockup): the sketches
  carrying the tag (lib/sketch-search.js sketchesOfTag: a project's or person's
  sketches by block scope, a topic's on its pages), newest first, each a crop
  thumbnail (PageThumb with the line id, only when on screen), its label and
  page. From scan records only: no page is read until a thumbnail is on screen.
  A click opens the reader at the sketch line.
-->
<script>
  import { searchDates, openPageInLibrary, focusReaderLineId, bookAliases } from '$stores';
  import { pageTags, tagInfo, tagBlocks } from '$stores/tags.js';
  import { scopeLines } from '$stores/tag-scope.js';
  import { sketchesOfTag } from '$lib/sketch-search.js';
  import { shortDay } from '$lib/library-home.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';
  import PageThumb from '../viewer/PageThumb.svelte';

  export let tag;
  /** The scan records carrying the tag. */
  export let records = [];

  $: list = sketchesOfTag(records, tag, {
    pageTags: $pageTags, info: $tagInfo, blocks: $tagBlocks, scopeLines: $scopeLines, dates: $searchDates
  });
  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

  function open(e) {
    const r = e.record;
    if (openPageInLibrary(r.book, idOf(r)) === 'cancelled') return;
    focusReaderLineId(r.book, idOf(r), e.id);
  }
  function when(e) {
    const d = $searchDates.get(e.key);
    return d && d.last ? shortDay(d.last) : '';
  }
</script>

{#if list.length}
  <section class="ts">
    <h3>Sketches <span>{list.length} {plural(list.length, 'sketch', 'sketches')}</span></h3>
    <div class="ts-strip">
      {#each list as e (e.key + '#' + e.id)}
        <button type="button" class="ts-card" on:click={() => open(e)} title="Open {formatBookName(e.record.book, $bookAliases, 'alias-only')} p.{idOf(e.record)} at this sketch">
          <PageThumb book={e.record.book} pageId={idOf(e.record)} lineId={e.id} height="96px" />
          <span class="ts-label">{e.label}</span>
          <span class="ts-sub">{formatBookName(e.record.book, $bookAliases, 'alias-only')} p.{idOf(e.record)}{#if when(e)} · {when(e)}{/if}</span>
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .ts { margin: 18px 0 4px; }
  .ts h3 { margin: 0 0 8px; font-size: 14px; color: #333; }
  .ts h3 span { font-weight: 400; color: #999; font-size: 12px; margin-left: 6px; }
  .ts-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .ts-card {
    flex: 0 0 132px; display: flex; flex-direction: column; gap: 3px; padding: 6px;
    border: 1px solid #e6e6e6; border-radius: 8px; background: #fff; text-align: left; cursor: pointer;
  }
  .ts-card:hover { border-color: #f5b942; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); }
  .ts-label { font-size: 13px; font-weight: 600; color: #222; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts-sub { font-size: 11px; color: #888; }
</style>
