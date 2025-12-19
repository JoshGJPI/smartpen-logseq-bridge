<!--
  TranscriptionPreview.svelte - Display transcribed text with preserved formatting
-->
<script>
  export let text; // Transcribed text with indentation
  
  // Split into lines and preserve whitespace
  $: lines = text ? text.split('\n') : [];
</script>

<div class="transcription-preview">
  {#if lines.length > 0}
    <pre>{text}</pre>
  {:else}
    <div class="empty">No transcription text</div>
  {/if}
</div>

<style>
  .transcription-preview {
    background: var(--bg-tertiary);
    border-radius: 6px;
    padding: 12px;
    max-height: 200px;
    overflow-y: auto;
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
