<!--
  DeletedInkChoice.svelte - "Ink of deleted lines": Not text (the default,
  decision 1 of docs/TRANSCRIPT-STRUCTURE-SPEC.md) or Transcribe it again next
  time (v3.20.0, lib/deleted-ink.js). Shown by the Edit Transcription dialog
  and Library Edit while a deleted line had ink; the choice applies to every
  deleted line in that save.
-->
<script>
  import { INK_TEXTLESS, INK_RETRY } from '$lib/deleted-ink.js';

  /** 'textless' | 'retry' */
  export let value = INK_TEXTLESS;
  /** How many deleted lines had ink (for the label). */
  export let count = 0;

  const name = `deleted-ink-${Math.random().toString(36).slice(2, 8)}`;
</script>

<fieldset class="dic" title="What happens to the handwriting of the lines you deleted. No stroke is deleted.">
  <legend>Ink of {count === 1 ? 'the deleted line' : `${count} deleted lines`}:</legend>
  <label><input type="radio" {name} bind:group={value} value={INK_TEXTLESS} /> Not text, never transcribe it</label>
  <label><input type="radio" {name} bind:group={value} value={INK_RETRY} /> Transcribe it again next time</label>
</fieldset>

<style>
  .dic {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    border: none;
    font-size: 12px;
    color: inherit;
  }
  .dic legend {
    float: left;
    padding: 0;
    margin-right: 4px;
    font-weight: 600;
  }
  .dic label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
</style>
