<!--
  TagSuggestionQueue.svelte — every unreviewed project-number suggestion in
  the Library, grouped by number (v3.1.0 page tags; mockup 6), reached from
  the home's Suggestions (n) entry.

  Each group: the number, how many pages, the first source line, and its
  pages' thumbnails (click opens the page; the corner tick leaves a page out).
  Tag all n adds the number to the ticked pages in one write; Dismiss all
  stops suggesting it on them. Re-check transcripts reruns the pass from
  scratch. Suggestions come from stored transcripts (stores/tag-suggestions.js),
  never a page read.
-->
<script>
  import { onDestroy } from 'svelte';
  import { savedPages, isScanning, searchRecords, bookAliases } from '$stores';
  import { addTagToPages, dismissSuggestion } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import {
    pendingSuggestions, suggestionsFound, suggestionScan, ensureSuggestionScan, cancelSuggestionScan
  } from '$stores/tag-suggestions.js';
  import { groupSuggestions } from '$lib/tag-suggestions.js';
  import { splitSuggestionLine } from '$lib/tags.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';
  import PageThumb from '../viewer/PageThumb.svelte';
  import TagChip from './TagChip.svelte';

  /** (record) => void */
  export let onOpen = () => {};

  /** tag → Set of page keys left out of Tag all / Dismiss all */
  let excluded = {};

  $: if ($savedPages && !$isScanning) ensureSuggestionScan();
  $: groups = groupSuggestions($pendingSuggestions, $suggestionsFound, $searchRecords);
  $: pageCount = $pendingSuggestions.size;

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));
  const nameOf = (book) => formatBookName(book, $bookAliases, 'alias-only');

  function ticked(g, ex) {
    const out = ex[g.tag] || new Set();
    return g.keys.filter((k) => !out.has(k));
  }

  function toggle(tag, key) {
    const s = new Set(excluded[tag] || []);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    excluded = { ...excluded, [tag]: s };
  }

  onDestroy(() => {
    if ($suggestionScan.running) cancelSuggestionScan();
  });
</script>

<div class="sq">
  <div class="sq-head">
    <h2>Suggested project numbers</h2>
    {#if groups.length}<span class="sq-sum">{pageCount} {plural(pageCount, 'page')} · {groups.length} {plural(groups.length, 'number')}</span>{/if}
    <span class="grow"></span>
    {#if $suggestionScan.running}
      <span class="sq-prog" role="status">Checking transcripts {$suggestionScan.done} / {$suggestionScan.total}…</span>
      <button type="button" class="btn" on:click={cancelSuggestionScan}>Stop</button>
    {:else}
      <button type="button" class="btn" disabled={!$dataFolderReady || $isScanning} on:click={() => ensureSuggestionScan({ force: true })}>↻ Re-check transcripts</button>
    {/if}
  </div>
  <p class="sq-note">Numbers like P2026-141 and 2327-018 found in transcripts. Nothing is tagged until you choose; a dismissed number stays dismissed for that page (Settings → Tags can reset them).</p>

  {#if !groups.length}
    <div class="sq-empty">
      {#if $suggestionScan.running}Checking transcripts…{:else}All caught up. New suggestions appear after you transcribe more pages.{/if}
    </div>
  {:else}
    <div class="sq-list">
      {#each groups as g (g.tag)}
        {@const keys = ticked(g, excluded)}
        {@const parts = g.source ? splitSuggestionLine(g.source, 110) : null}
        <section class="sq-row" aria-label="Suggested {g.tag}">
          <div class="sq-main">
            <div class="sq-title"><TagChip tag={g.tag} suggested /><span>{g.pages.length} {plural(g.pages.length, 'page')}</span></div>
            {#if parts}<div class="ev">{parts.before}<b>{parts.match}</b>{parts.after}</div>{/if}
            <div class="sq-pages">
              {#each g.pages as r, i (g.keys[i])}
                {@const out = excluded[g.tag] && excluded[g.tag].has(g.keys[i])}
                <div class="sq-page" class:out>
                  <button type="button" class="sq-thumb" title="Open {nameOf(r.book)}, P{idOf(r)}" on:click={() => onOpen(r)}>
                    <PageThumb book={r.book} pageId={idOf(r)} height="78px" />
                  </button>
                  <button type="button" class="sq-tick" aria-pressed={!out} title={out ? 'Include this page' : 'Leave this page out'} on:click={() => toggle(g.tag, g.keys[i])}>{out ? '' : '✓'}</button>
                  <span class="sq-lab"><b>P{idOf(r)}</b>{nameOf(r.book)}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="sq-acts">
            <button type="button" class="btn pri" disabled={!keys.length || !$dataFolderReady} on:click={() => addTagToPages(keys, g.tag)}>Tag all {keys.length}</button>
            <button type="button" class="btn" disabled={!keys.length || !$dataFolderReady} on:click={() => dismissSuggestion(keys, g.tag)}>Dismiss all</button>
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sq { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .sq-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
  .sq-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .sq-sum, .sq-prog { font-size: 13px; color: #888; }
  .grow { flex: 1; }
  .sq-note { margin: 6px 0 14px; font-size: 12px; color: #999; }
  .btn { padding: 4px 11px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #555; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .btn:hover:not(:disabled) { background: #f0f0f0; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.pri { background: #4a7cf7; border-color: #4a7cf7; color: #fff; }
  .btn.pri:hover:not(:disabled) { background: #3b6be0; }
  .sq-empty { padding: 40px; text-align: center; color: #999; font-size: 14px; }
  .sq-list { border: 1px solid #e6e6e6; border-radius: 8px; background: #fff; }
  .sq-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 12px; border-bottom: 1px solid #f0f0f0; }
  .sq-row:last-child { border-bottom: 0; }
  .sq-main { min-width: 0; }
  .sq-title { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 12px; color: #888; }
  .ev {
    margin-bottom: 8px;
    padding: 4px 8px;
    border-left: 3px solid #e0b84a;
    border-radius: 0 5px 5px 0;
    background: #fafafa;
    color: #777;
    font-size: 11.5px;
  }
  .ev b { padding: 0 2px; border-radius: 2px; background: #fff3b0; color: #222; font-weight: 600; }
  .sq-pages { display: flex; flex-wrap: wrap; gap: 8px; }
  .sq-page { position: relative; width: 72px; font-size: 10.5px; color: #777; text-align: center; }
  .sq-page.out .sq-thumb { opacity: 0.35; }
  .sq-thumb { display: block; width: 100%; padding: 0; border: 1px solid #e0e0e0; border-radius: 4px; background: #fff; cursor: pointer; overflow: hidden; }
  .sq-thumb:hover { border-color: #4a7cf7; }
  .sq-thumb :global(.thumb) { padding: 3px; }
  .sq-tick {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #4a7cf7;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
    color: #fff;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }
  .sq-page.out .sq-tick { background: rgba(0, 0, 0, 0.25); }
  .sq-lab { display: block; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .sq-lab b { display: block; color: #444; font-weight: 600; }
  .sq-acts { display: flex; flex-direction: column; gap: 6px; }
</style>
