<!--
  ScopeToggles.svelte — "Block scope" in the reader's tag strip (v3.23.0,
  docs/TRANSCRIPT-STRUCTURE-SPEC.md D.4). One toggle per Person or Project tag on
  the page; picking one marks the lines it covers with a faint bar beside the
  transcript (TranscriptLines reads scopeTagShown). Each says how many blocks
  the tag heads on this page, or that it is named nowhere (the whole page).
  From the record's transcript text, or the lines read for a page with hand
  corrections (stores/tag-scope.js); no page read here.
-->
<script>
  import { tagInfo, tagBlocks } from '$stores/tags.js';
  import { scopeLines, scopeTagShown, toggleScopeTag } from '$stores/tag-scope.js';
  import { pageScopes, linesFromText } from '$lib/tag-scope.js';
  import { plural } from '$lib/plural.js';
  import TagChip from './TagChip.svelte';

  /** The page's scan record. */
  export let record;
  /** Its tag key and tags. */
  export let tagKeyOf = '';
  export let tags = [];

  $: lines = ($scopeLines.get(tagKeyOf)) || linesFromText(record && record.transcriptionText);
  $: scopes = pageScopes(lines, tags, $tagInfo, $tagBlocks[tagKeyOf] || {});
  $: list = Object.values(scopes);
  $: shown = $scopeTagShown && $scopeTagShown.key === tagKeyOf ? $scopeTagShown.tag : null;
</script>

{#if list.length && lines.length}
  <section class="sc">
    <h6><span>Block scope</span><span class="note">show in transcript</span></h6>
    {#each list as s (s.tag)}
      <div class="row">
        <TagChip tag={s.tag} on={shown === s.tag} onClick={() => toggleScopeTag(tagKeyOf, s.tag)}
          title={shown === s.tag ? 'Hide the lines it covers' : 'Mark the lines it covers in the transcript'} />
        <span class="what">{s.wholePage ? 'named nowhere: whole page' : `${s.blocks.length} ${plural(s.blocks.length, 'block')}`}</span>
      </div>
    {/each}
    <p class="hint">A line’s ⋯ menu: Tag this block…, Not this tag.</p>
  </section>
{/if}

<style>
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
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .what { font-size: 11.5px; color: #999; }
  .hint { margin: 4px 0 0; font-size: 11.5px; color: #999; }
  @container reader (max-width: 900px) {
    .sc { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    h6 { margin: 0; }
    .row { margin: 0; }
    .note, .hint, .what { display: none; }
  }
</style>
