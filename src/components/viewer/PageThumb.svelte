<!--
  PageThumb.svelte — one page's ink as a small SVG, loaded only once it is on
  screen (reading-first package E). Used by the notebook cards' fan, the Recent
  row, a notebook's page grid and search results.

  Reads go through lib/viewer/thumbs.js, never the reader's page cache, so a
  screen of thumbnails cannot evict the spread you just left. Rotation follows
  the page's display rotation; a turned page redraws.

  With `lineId` (v3.24.0) it shows only that line's ink, cropped to it: a
  sketch's thumbnail (keyed by page + line id in thumbs.js).
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { pageOrientations } from '$stores/orientation.js';
  import { rotationFor } from '$lib/page-orientation.js';
  import { thumbs } from '$lib/viewer/thumbs.js';

  export let book;
  export let pageId;
  /** CSS height of the box; the SVG fits inside it. */
  export let height = '150px';
  /** A sketch line's id: only its ink, cropped to it. */
  export let lineId = null;
  /** Out (bind:linked): the page's transcript is linked to its ink (true / false), null until read. */
  export let linked = null;

  let el;
  let visible = false;
  let svg = null;
  let observer = null;
  let wanted = '';

  $: rotation = rotationFor($pageOrientations, book, pageId);
  $: key = `${book}/${pageId}@${rotation}#${lineId || ''}`;
  $: if (key !== wanted) {
    wanted = key;
    svg = thumbs.peekSvg(book, pageId, rotation, lineId);
    linked = thumbs.peekTrust(book, pageId);
  }
  $: if (visible && svg === null) load(key);

  async function load(k) {
    const out = await thumbs.get(book, pageId, rotation, lineId);
    if (k === wanted) {
      svg = out;
      linked = thumbs.peekTrust(book, pageId);
    }
  }

  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') {
      visible = true;
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible = true;
          observer.disconnect();
        }
      },
      { rootMargin: '150px' }
    );
    observer.observe(el);
  });

  onDestroy(() => observer && observer.disconnect());
</script>

<div class="thumb" bind:this={el} style="height: {height}" aria-hidden="true">
  {#if svg}{@html svg}{/if}
</div>

<style>
  .thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #fff;
    padding: 6px;
  }
  .thumb :global(svg) { max-width: 100%; max-height: 100%; }
</style>
