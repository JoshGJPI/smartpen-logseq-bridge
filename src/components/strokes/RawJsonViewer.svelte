<!--
  RawJsonViewer.svelte - Raw JSON data viewer
-->
<script>
  import { strokes, strokeCount } from '$stores';
  import { selectedStrokes, selectionCount } from '$stores';
  
  $: displayData = $selectionCount > 0 ? $selectedStrokes : $strokes;
  $: jsonText = $strokeCount > 0 
    ? JSON.stringify(displayData, null, 2)
    : '// Connect pen to see data structure';
</script>

<div class="json-viewer-container">
  {#if $strokeCount > 0}
    <div class="viewer-header">
      {#if $selectionCount > 0}
        Showing {$selectionCount} selected strokes
      {:else}
        Showing all {$strokeCount} strokes
      {/if}
    </div>
  {/if}
  
  <pre class="json-viewer">{jsonText}</pre>
</div>

<style>
  .json-viewer-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .viewer-header {
    font-size: 0.75rem;
    color: var(--text-secondary);
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 8px;
  }

  .json-viewer {
    background: var(--bg-primary);
    border-radius: 8px;
    padding: 15px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 0.8rem;
    overflow: auto;
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-primary);
    margin: 0;
  }
</style>
