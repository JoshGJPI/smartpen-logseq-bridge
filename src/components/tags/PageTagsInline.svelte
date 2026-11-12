<!--
  PageTagsInline.svelte — one page's tags as a single row, for the Editor:
  the Transcripts tab's page cards, the Edit Transcription dialog's footer,
  the Pages tab's cards (compact) and the canvas toolbar's Tags popover
  (v3.19.0, one row per page, labelled with `heading`).
  Shortens connect → fetch → transcribe → tag → save: no trip to the Library
  to tag a page just transcribed.

  The same rules as the reader's strip (PageTagsStrip): tags save as they
  change, straight to `_tags.json` through stores/tags.js (not an unsaved edit,
  no Save). Suggested project numbers come from the transcript lines passed in
  (the page's fresh MyScript result or the dialog's edited lines), minus the
  page's tags and its dismissals; ✓ tags the page, ✕ dismisses it for this page.
  Nothing is tagged without a click.

  A page tagged before its first save has its tags waiting in the sidecar; they
  show once the page is saved (a page never saved leaves them hidden, like a
  deleted page's).
-->
<script>
  import { pageTags, dismissedTags, setPageTagList, dismissSuggestion } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { tagKey, suggestProjectNumbers } from '$lib/tags.js';
  import TagChip from './TagChip.svelte';
  import TagInput from './TagInput.svelte';

  /** Book key (`"388"`, `"388v2"`). */
  export let book;
  /** Page id, with any letter suffix. */
  export let pageId;
  /** Transcript lines (`[{ id?, text }]`) or plain text, for suggestions. */
  export let lines = [];
  /** Open the type-ahead list above the field (a footer). */
  export let dropUp = false;
  /** Smaller, with no "Tags" label (the Pages tab's cards). */
  export let compact = false;
  /** Replaces the "Tags" label (the canvas popover names each page). */
  export let heading = '';

  $: key = tagKey(book, pageId);
  $: tags = (key && $pageTags[key]) || [];
  $: dismissed = (key && $dismissedTags[key]) || [];
  $: suggestions = key ? suggestProjectNumbers(lines, { exclude: [...tags, ...dismissed] }) : [];
  $: disabled = !$dataFolderReady || !key;

  const add = (t) => setPageTagList(book, pageId, [...tags, t]);
  const remove = (t) => setPageTagList(book, pageId, tags.filter((x) => x !== t));
  const dismiss = (t) => key && dismissSuggestion([key], t);
  const addAll = () => setPageTagList(book, pageId, [...tags, ...suggestions.map((s) => s.tag)]);
</script>

<div class="pti" class:compact data-own-keys>
  {#if heading}
    <span class="pti-label pti-heading">{heading}</span>
  {:else if !compact}
    <span class="pti-label">Tags</span>
  {/if}
  {#if !$dataFolderReady}
    <span class="pti-msg">Choose a data folder to tag pages.</span>
  {:else}
    <div class="pti-input">
      {#key key}
        <TagInput {tags} {disabled} {dropUp} onAdd={add} onRemove={remove} label="Add a tag to P{pageId}" />
      {/key}
    </div>
    {#if suggestions.length}
      <span class="pti-sug" aria-label="Suggested from transcript">
        {#each suggestions as s (s.tag)}
          <TagChip tag={s.tag} suggested title={`Suggested from: ${s.line}`} onAccept={() => add(s.tag)} onDismiss={() => dismiss(s.tag)} {disabled} />
        {/each}
        {#if suggestions.length > 1}
          <button type="button" class="pti-all" on:click={addAll} {disabled}>Add all</button>
        {/if}
      </span>
    {/if}
  {/if}
</div>

<style>
  .pti {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    min-width: 0;
  }
  .pti-label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .pti-heading {
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.02em;
    text-transform: none;
    min-width: 5.5em;
  }
  .pti-msg { font-size: 0.75rem; color: var(--text-secondary); }
  .pti.compact { gap: 4px 6px; }
  .pti.compact .pti-input { flex-basis: 160px; min-width: 140px; }
  .pti.compact .pti-input :global(.tagbox) { min-height: 26px; padding: 1px 5px; }
  .pti.compact .pti-msg { font-size: 0.6875rem; }
  .pti-input { flex: 1 1 220px; min-width: 180px; }
  .pti-input :global(.tagbox) { min-height: 30px; padding: 2px 6px; }
  .pti-sug { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .pti-all {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 4px;
  }
  .pti-all:hover:not(:disabled) { text-decoration: underline; }
  .pti-all:disabled { opacity: 0.5; cursor: default; }
</style>
