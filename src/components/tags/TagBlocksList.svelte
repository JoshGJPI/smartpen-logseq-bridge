<!--
  TagBlocksList.svelte — "Blocks" on a Person or Project tag's page (v3.23.0,
  docs/TRANSCRIPT-STRUCTURE-SPEC.md D.2): every block the tag covers on the pages
  carrying it, newest page first, like a meeting history. Each shows its root
  line, the lines under it, the page and the days written; a click opens the
  page in the reader at that line. A page that names the tag nowhere is one
  "whole page" entry.

  Built from the scan records' transcript text and the hand corrections
  (lib/tag-scope.js tagBlockEntries; pages with corrections are read once by
  stores/tag-scope.js). No page is read until a block is opened.
-->
<script>
  import { bookAliases, libraryPageDates } from '$stores';
  import { tagInfo, tagBlocks } from '$stores/tags.js';
  import { scopeLines, openScopeLine } from '$stores/tag-scope.js';
  import { tagBlockEntries } from '$lib/tag-scope.js';
  import { writtenRange } from '$lib/library-home.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';

  export let tag;
  /** The scan records carrying the tag. */
  export let records = [];

  const FIRST = 12;
  let all = false;

  $: entries = tagBlockEntries(records, { tag, info: $tagInfo, blocks: $tagBlocks, scopeLines: $scopeLines, dates: $libraryPageDates });
  $: named = entries.filter((e) => !e.wholePage).length;
  $: shown = all ? entries : entries.slice(0, FIRST);

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));
  $: where = (r) => `${formatBookName(r.book, $bookAliases, 'alias-only') || `B${r.book}`} · p.${idOf(r)}`;

  function open(e) {
    if (e.wholePage) openScopeLine(e.record, null, '');
    else openScopeLine(e.record, e.root, e.rootText, e.rootId);
  }
</script>

{#if entries.length}
  <section class="tb" aria-label="Blocks">
    <h3>Blocks <span class="n">{named} {plural(named, 'block')}{named < entries.length ? ` · ${entries.length - named} whole ${plural(entries.length - named, 'page')}` : ''}</span></h3>
    <ol class="list">
      {#each shown as e (e.key + ':' + e.root)}
        <li>
          <button type="button" class="blk" class:whole={e.wholePage} on:click={() => open(e)}
            title={e.wholePage ? 'Open the page' : 'Open the page at this line'}>
            {#if e.wholePage}
              <span class="root dim">Named nowhere on this page: the tag covers the whole page</span>
            {:else}
              <span class="root">{e.rootText}</span>
              {#each e.children as c (c.index)}
                <span class="kid" style="padding-left: {Math.min(c.depth, 4) * 14}px">{c.text}</span>
              {/each}
              {#if e.more}<span class="kid dim">… {e.more} more {plural(e.more, 'line')}</span>{/if}
            {/if}
            <span class="meta">{where(e.record)}{#if e.first} · {writtenRange(e.first, e.last)}{/if}</span>
          </button>
        </li>
      {/each}
    </ol>
    {#if entries.length > FIRST}
      <button type="button" class="more" on:click={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${entries.length}`}</button>
    {/if}
  </section>
{/if}

<style>
  .tb { margin-top: 22px; max-width: 980px; }
  h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.06em; }
  .n { color: #999; font-weight: 400; letter-spacing: 0; text-transform: none; }
  .list { list-style: none; margin: 0; padding: 0; background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  li + li { border-top: 1px solid #f0f0f0; }
  .blk {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .blk:hover { background: #fafbff; }
  .blk:focus-visible { outline: 2px solid #4a7cf7; outline-offset: -2px; }
  .root { font-size: 13.5px; color: #222; font-weight: 500; overflow-wrap: anywhere; }
  .kid { font-size: 12.5px; color: #555; overflow-wrap: anywhere; }
  .dim { color: #999; font-weight: 400; }
  .meta { margin-top: 2px; font-size: 11.5px; color: #2c56c4; }
  .more { margin-top: 6px; padding: 0; border: none; background: none; color: #2c56c4; font-size: 12px; cursor: pointer; }
  .more:hover { text-decoration: underline; }
</style>
