<!--
  TranscriptionPreview.svelte - a saved page's transcript text, read-only, with
  its indentation kept. Editing goes through the card's Edit (the Edit
  Transcription dialog), never here.
-->
<script>
  import { filterTranscriptionProperties } from '$utils/formatting.js';

  export let text; // Transcribed text with indentation

  // Filter out properties for display
  $: displayText = filterTranscriptionProperties(text);
</script>

<div class="transcription-preview">
  {#if !displayText}
    <div class="empty">No transcription text</div>
  {:else}
    <pre>{displayText}</pre>
  {/if}
</div>

<style>
  .transcription-preview {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 12px;
    max-height: 300px;
    overflow-y: auto;
    position: relative;
  }

  pre {
    margin: 0;
    font-family: 'Courier New', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .empty {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: 0.875rem;
  }
</style>
