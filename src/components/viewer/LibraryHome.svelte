<!--
  LibraryHome.svelte — the Library with no page open: Recent pages and every
  notebook's pages as thumbnails. Extracted from BookViewer (reading-first
  package D); package E replaces it with notebook cards.

  Thumbnails render lazily from each PageDoc (through the LRU page cache, not
  held in the scan record); the small SVG strings are kept for the session,
  keyed by book, page id (P151 and P151b don't collide) and rotation, so a page
  turned in the reader redraws its thumbnail.
-->
<script>
  import { onMount } from 'svelte';
  import { savedPages, pagesByBook, bookIds, bookAliases, isScanning, recentViews } from '$stores';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { formatBookName } from '$utils/formatting.js';
  import { generateThumbnailSVG } from '$lib/viewer/page-svg.js';
  import { pageOrientations } from '$stores/orientation.js';
  import { rotationFor } from '$lib/page-orientation.js';
  import { getCachedPage, clearPageCache } from '$lib/viewer/page-cache.js';
  import { pageIdOf as idOf } from '$lib/viewer/page-reader.js';

  /** (record) => void */
  export let onOpen = () => {};

  // Book sections are collapsed by default so a long page list doesn't bury
  // the book you want.
  let expandedBooks = new Set();
  let recentOpen = true;
  const thumbCache = new Map();

  $: grouped = $pagesByBook;
  $: books = $bookIds;
  $: recentRecords = $recentViews
    .map((rv) => (grouped[rv.book] || []).find((p) => idOf(p) === rv.pageId))
    .filter(Boolean);

  // `book` is a book key, so volumes of one notebook are separate sections here.
  function aliasFor(book) {
    return formatBookName(book, $bookAliases, 'alias-only');
  }

  async function thumbAsync(record, rotation = 0) {
    const key = `${record.book}:${idOf(record)}@${rotation}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const doc = await getCachedPage(record.book, idOf(record));
    const svg = generateThumbnailSVG((doc && doc.strokes) || [], 240, 180, undefined, rotation);
    thumbCache.set(key, svg);
    return svg;
  }

  function toggleBook(book) {
    const next = new Set(expandedBooks);
    next.has(book) ? next.delete(book) : next.add(book);
    expandedBooks = next;
  }

  async function rescan() {
    thumbCache.clear();
    clearPageCache();
    await scanLocalPages();
  }

  onMount(() => {
    if ($savedPages.length === 0 && !$isScanning) scanLocalPages();
  });
</script>

<div class="bv-home">
  <div class="bv-home-head">
    <h2>Books &amp; Pages</h2>
    <button class="bv-rescan" on:click={rescan} disabled={$isScanning}>
      {$isScanning ? 'Scanning…' : 'Rescan'}
    </button>
  </div>

  {#if $isScanning && $savedPages.length === 0}
    <div class="bv-msg">Scanning data folder…</div>
  {:else if books.length === 0}
    <div class="bv-msg">
      <p>No saved pages found.</p>
      <p class="sub">Capture and save pages, or check your data folder in Settings.</p>
    </div>
  {:else}
    {#if recentRecords.length}
      <section class="bv-section">
        <button class="bv-section-header" on:click={() => (recentOpen = !recentOpen)}>
          <span class="bv-chevron" class:open={recentOpen}>▸</span>
          <span class="bv-section-title">Recent</span>
          <span class="bv-count">{recentRecords.length}</span>
        </button>
        {#if recentOpen}
          <div class="bv-grid">
            {#each recentRecords as r (`${r.book}:${idOf(r)}`)}
              <button class="bv-card" on:click={() => onOpen(r)} title="{aliasFor(r.book)} — P{idOf(r)}">
                <div class="bv-thumb">
                  {#await thumbAsync(r, rotationFor($pageOrientations, r.book, idOf(r))) then svg}{@html svg}{/await}
                </div>
                <div class="bv-label">{aliasFor(r.book)} — P{idOf(r)}</div>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    {#each books as b (b)}
      <section class="bv-section">
        <button class="bv-section-header" on:click={() => toggleBook(b)}>
          <span class="bv-chevron" class:open={expandedBooks.has(b)}>▸</span>
          <span class="bv-section-title">{aliasFor(b)}</span>
          <span class="bv-count">{grouped[b].length}</span>
        </button>
        {#if expandedBooks.has(b)}
          <div class="bv-grid">
            {#each grouped[b] as r (`${r.book}:${idOf(r)}`)}
              <button class="bv-card" on:click={() => onOpen(r)} title="P{idOf(r)} · {r.strokeCount} strokes">
                <div class="bv-thumb">
                  {#await thumbAsync(r, rotationFor($pageOrientations, r.book, idOf(r))) then svg}{@html svg}{/await}
                </div>
                <div class="bv-label">P{idOf(r)}</div>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  /* ---- home ---- */
  .bv-home {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  }
  .bv-home-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .bv-home-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
  }
  .bv-rescan {
    padding: 5px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
  }
  .bv-rescan:hover:not(:disabled) { background: #f0f0f0; }
  .bv-rescan:disabled { opacity: 0.5; cursor: not-allowed; }

  .bv-msg {
    color: #999;
    font-size: 14px;
    padding: 40px 0;
    text-align: center;
  }
  .bv-msg .sub { font-size: 12px; color: #bbb; margin-top: 6px; }

  .bv-section { margin-bottom: 8px; }
  .bv-section-header {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 9px 4px;
    background: none;
    border: none;
    border-bottom: 1px solid #ececec;
    cursor: pointer;
    text-align: left;
  }
  .bv-section-header:hover { background: #fafafa; }
  .bv-section-title {
    font-size: 16px;
    font-weight: 600;
    color: #333;
  }
  .bv-chevron {
    display: inline-block;
    color: #999;
    font-size: 12px;
    transition: transform 0.15s;
  }
  .bv-chevron.open { transform: rotate(90deg); }
  .bv-count {
    font-size: 11px;
    color: #888;
    font-weight: 500;
    background: #eee;
    border-radius: 10px;
    padding: 1px 9px;
  }

  .bv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
    margin: 12px 0 18px;
  }
  .bv-card {
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: all 0.15s;
  }
  .bv-card:hover {
    border-color: #4a7cf7;
    box-shadow: 0 2px 8px rgba(74, 124, 247, 0.15);
    transform: translateY(-1px);
  }
  .bv-thumb {
    height: 150px;
    background: #fafafa;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-bottom: 1px solid #f0f0f0;
    padding: 6px;
  }
  .bv-thumb :global(svg) { max-width: 100%; max-height: 100%; }
  .bv-label {
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 500;
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
