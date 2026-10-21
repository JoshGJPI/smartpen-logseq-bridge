<!--
  PageTile.svelte — one page in a Library page grid (v3.1.0 page tags;
  mockups 3 and 5): the thumbnail, P12 (with its notebook when the grid spans
  notebooks), first written day, ✓ when transcribed, and the page's tags
  (first two, then +N). Tags come from the tags store, never from reading the
  page; the thumbnail keeps PageThumb's on-screen-only loading.

  Hover shows "+ tag" (the chip editor in a small popover); an amber dot marks
  a page with an unreviewed project-number suggestion. In select mode a click
  ticks the page (shift-click ticks a range; PageGrid decides).
-->
<script>
  import { tick } from 'svelte';
  import { pageTags, setPageTagList } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { shortDay, writtenRange } from '$lib/library-home.js';
  import PageThumb from '../viewer/PageThumb.svelte';
  import TagChip from './TagChip.svelte';
  import TagInput from './TagInput.svelte';

  /** `{ record, key, pageId, first, last, days, transcribed }` */
  export let tile;
  /** Notebook name to show before P12, or '' (a single notebook's grid). */
  export let notebook = '';
  export let selecting = false;
  export let selected = false;
  /** An unreviewed suggestion on this page. */
  export let pending = false;
  /** (event) => void: open, or tick in select mode */
  export let onClick = () => {};

  let popOpen = false;
  let pop;
  let input;

  $: tags = $pageTags[tile.key] || [];
  $: shown = tags.slice(0, 2);
  $: book = tile.record.book;
  $: title = `${notebook ? `${notebook}, ` : ''}P${tile.pageId} · ${(tile.record.strokeCount || 0).toLocaleString()} strokes · ${tile.first ? writtenRange(tile.first, tile.last) : 'no dated ink'}${tile.transcribed ? ' · transcribed' : ''}${tags.length ? ` · ${tags.join(', ')}` : ''}`;
  $: if (selecting) popOpen = false;

  async function openPop() {
    popOpen = true;
    await tick();
    input && input.focus();
  }

  function onFocusOut(e) {
    if (pop && !pop.contains(e.relatedTarget)) popOpen = false;
  }
</script>

<div class="pt" class:sel={selected} class:selecting>
  <button type="button" class="pt-open" on:click={onClick} {title} aria-pressed={selecting ? selected : undefined}>
    <PageThumb {book} pageId={tile.pageId} height="150px" />
    <span class="pt-label">
      {#if notebook}<span class="pt-nb">{notebook}</span>{/if}
      <span class="pt-page">P{tile.pageId}</span>
      {#if tile.first}<span class="pt-date">{shortDay(tile.first)}{#if tile.days > 1}<span class="pt-more">+{tile.days - 1}</span>{/if}</span>{/if}
      {#if tile.transcribed}<span class="pt-tx" aria-label="transcribed">✓</span>{/if}
    </span>
    <span class="pt-tags">
      {#each shown as t (t)}<TagChip tag={t} />{/each}
      {#if tags.length > 2}<span class="pt-n">+{tags.length - 2}</span>{/if}
      {#if !tags.length}<span class="pt-none">no tags</span>{/if}
    </span>
  </button>

  {#if selecting}
    <span class="pt-tick" aria-hidden="true">{selected ? '✓' : ''}</span>
  {:else if $dataFolderReady}
    <button type="button" class="pt-add" class:shift={pending} on:click={openPop} title="Tag P{tile.pageId}">+ tag</button>
  {/if}
  {#if pending && !selecting}<span class="pt-dot" title="Suggested project number to review"></span>{/if}

  {#if popOpen}
    <div class="pt-pop" bind:this={pop} on:focusout={onFocusOut}>
      <TagInput
        bind:this={input}
        {tags}
        label="Tags for P{tile.pageId}"
        onAdd={(t) => setPageTagList(book, tile.pageId, [...tags, t])}
        onRemove={(t) => setPageTagList(book, tile.pageId, tags.filter((x) => x !== t))}
      />
    </div>
  {/if}
</div>

<style>
  .pt {
    position: relative;
    display: flex;
    min-width: 0;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fff;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .pt:hover, .pt:focus-within { border-color: #4a7cf7; box-shadow: 0 2px 8px rgba(74, 124, 247, 0.15); }
  .pt.sel { border-color: #4a7cf7; box-shadow: 0 0 0 2px #4a7cf7; }
  .pt-open {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: none;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    outline: none;
  }
  .pt-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px 0;
    border-top: 1px solid #f0f0f0;
    font-size: 12px;
    color: #444;
    white-space: nowrap;
    min-width: 0;
  }
  .pt-nb { color: #888; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .pt-page { font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .pt-date { padding: 1px 6px; border-radius: 8px; background: #f2f2f2; color: #666; flex-shrink: 0; }
  .pt-more { margin-left: 3px; color: #999; }
  .pt-tx { margin-left: auto; color: #2f7d4f; font-weight: 700; }
  .pt-tags { display: flex; flex-wrap: wrap; gap: 3px; min-height: 19px; padding: 4px 9px 7px; min-width: 0; }
  .pt-n { padding: 1px 6px; border-radius: 99px; background: rgba(0, 0, 0, 0.06); color: #666; font-size: 11px; }
  .pt-none { font-size: 11px; color: #bbb; }

  .pt-tick {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #fff;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.25);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
    color: #fff;
    font-size: 12px;
    pointer-events: none;
  }
  .pt.sel .pt-tick { background: #4a7cf7; }
  .pt-add {
    position: absolute;
    top: 6px;
    right: 6px;
    display: none;
    padding: 0 8px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.95);
    color: #444;
    font-size: 11px;
    cursor: pointer;
  }
  .pt-add.shift { right: 22px; }
  .pt:hover .pt-add, .pt-add:focus-visible { display: block; }
  .pt-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #e0a200;
    box-shadow: 0 0 0 2px #fff;
  }
  .pt-pop {
    position: absolute;
    top: 30px;
    right: 4px;
    left: 4px;
    z-index: 30;
    min-width: 200px;
    padding: 6px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }
</style>
