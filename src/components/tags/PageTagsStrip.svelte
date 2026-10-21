<!--
  PageTagsStrip.svelte — the Library reader's tag strip (v3.1.0 page tags;
  mockups 1 and 2). Beside the page or spread; on a narrow reader it folds into
  one bar above the pages (ReaderTagsLayout's container query).

  One page at a time: in a spread, P12 | P13 picks which page the strip edits
  (the left page by default). Tags save as they change, straight to
  `_tags.json` through stores/tags.js: not an unsaved edit, no Save.

  Suggested project numbers come from the page's stored transcript, the
  record's `transcriptionText` (no page read), minus the page's tags and its
  dismissals; ✓ tags this page only, ✕ dismisses for this page and stays
  dismissed. Nothing is tagged without a click.
-->
<script>
  import { pageTags, dismissedTags, setPageTagList, dismissSuggestion } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { recordTagKey, suggestProjectNumbers, splitSuggestionLine } from '$lib/tags.js';
  import TagChip from './TagChip.svelte';
  import TagInput from './TagInput.svelte';

  /** Scan records on screen: one page, or both pages of a spread (nulls ignored). */
  export let records = [];

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

  let focusKey = null;
  $: shown = (records || []).filter(Boolean);
  $: keys = shown.map(recordTagKey);
  $: if (!keys.includes(focusKey)) focusKey = keys[0] || null;
  $: record = shown[keys.indexOf(focusKey)] || null;
  $: tags = (focusKey && $pageTags[focusKey]) || [];
  $: dismissed = (focusKey && $dismissedTags[focusKey]) || [];
  $: suggestions = record && record.transcriptionText
    ? suggestProjectNumbers(record.transcriptionText, { exclude: [...tags, ...dismissed] })
    : [];
  $: disabled = !$dataFolderReady || !focusKey;

  function add(t) {
    if (record) setPageTagList(record.book, idOf(record), [...tags, t]);
  }
  function remove(t) {
    if (record) setPageTagList(record.book, idOf(record), tags.filter((x) => x !== t));
  }
  function dismiss(t) {
    if (focusKey) dismissSuggestion([focusKey], t);
  }
</script>

<aside class="pts" aria-label="Page tags">
  {#if shown.length > 1}
    <div class="pts-pages" role="group" aria-label="Which page to tag">
      {#each shown as r, i (keys[i])}
        <button type="button" class:on={keys[i] === focusKey} aria-pressed={keys[i] === focusKey} on:click={() => (focusKey = keys[i])}>P{idOf(r)}</button>
      {/each}
    </div>
  {/if}

  <section class="pts-tags">
    <h6><span>Tags</span><span class="note">saved as you go</span></h6>
    {#if !$dataFolderReady}
      <p class="msg">Choose a data folder (Settings → Data Folder) to tag pages.</p>
    {:else}
      {#key focusKey}
        <TagInput {tags} {disabled} onAdd={add} onRemove={remove} label="Add a tag to P{record ? idOf(record) : ''}" />
      {/key}
      <p class="hint">Enter adds · Backspace removes the last · a keyword, or a project number.</p>
    {/if}
  </section>

  {#if $dataFolderReady}
    <section class="pts-sug">
      <h6><span>Suggested from transcript</span></h6>
      {#each suggestions as s (s.tag)}
        {@const parts = splitSuggestionLine(s)}
        <div class="sug" title={s.line}>
          <TagChip tag={s.tag} suggested onAccept={() => add(s.tag)} onDismiss={() => dismiss(s.tag)} {disabled} />
          <div class="ev">{parts.before}<b>{parts.match}</b>{parts.after}</div>
        </div>
      {:else}
        <p class="msg">
          {#if !record?.transcriptionText}No transcript on this page.{:else}No project numbers to suggest.{/if}
          {#if dismissed.length}<span class="dim">Dismissed ones stay hidden.</span>{/if}
        </p>
      {/each}
    </section>
  {/if}
</aside>

<style>
  .pts {
    flex: 0 0 270px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    padding: 12px 14px;
    border-left: 1px solid #e0e0e0;
    background: #fff;
    overflow-y: auto;
  }
  h6 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #888;
  }
  .note { text-transform: none; letter-spacing: 0; font-weight: 400; color: #aaa; }
  .hint { margin: 6px 0 0; font-size: 11.5px; color: #999; }
  .msg { margin: 0; font-size: 12px; color: #999; }
  .dim { display: block; margin-top: 2px; color: #bbb; }

  .pts-pages { display: inline-flex; align-self: flex-start; border: 1px solid #ddd; border-radius: 7px; overflow: hidden; }
  .pts-pages button {
    padding: 3px 12px;
    border: none;
    background: #fff;
    color: #666;
    font-size: 12px;
    cursor: pointer;
  }
  .pts-pages button + button { border-left: 1px solid #ddd; }
  .pts-pages button.on { background: #262650; color: #fff; box-shadow: inset 0 -2px 0 #4a7cf7; }

  .sug { margin-bottom: 10px; }
  .ev {
    margin-top: 5px;
    padding: 4px 8px;
    border-left: 3px solid #e0b84a;
    border-radius: 0 5px 5px 0;
    background: #fafafa;
    color: #777;
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
  .ev b { padding: 0 2px; border-radius: 2px; background: #fff3b0; color: #222; font-weight: 600; }

  /* Narrow reader: one bar above the pages (ReaderTagsLayout is the container). */
  @container reader (max-width: 900px) {
    .pts {
      flex: 0 0 auto;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
      padding: 6px 12px;
      border-left: none;
      border-bottom: 1px solid #e0e0e0;
      overflow: visible;
    }
    section { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
    .pts-tags { flex: 1 1 320px; }
    .pts-tags :global(.tagbox) { flex: 1; min-height: 30px; padding: 2px 6px; }
    h6 { margin: 0; }
    .note, .hint, .ev, .dim { display: none; }
    .sug { margin: 0; }
  }
</style>
