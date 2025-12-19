<!--
  SelectionInfo.svelte - Selection status hint (simplified)
  Main action buttons moved to canvas header
-->
<script>
  export let totalCount = 0;
</script>

<div class="selection-info">
  <span class="help-text">
    Drag to select • Ctrl/Shift to add/toggle • Alt+drag to pan • Ctrl+scroll to zoom
  </span>
</div>

<style>
  .selection-info {
    margin-top: 6px;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
