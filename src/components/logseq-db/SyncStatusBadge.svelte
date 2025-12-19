<!--
  SyncStatusBadge.svelte - Shows sync status for a page
-->
<script>
  export let status; // 'clean' | 'unsaved' | 'in-canvas'
  
  $: badge = getBadge(status);
  
  function getBadge(status) {
    switch (status) {
      case 'unsaved':
        return { emoji: '🟡', text: 'Unsaved local changes', class: 'warning' };
      case 'in-canvas':
        return { emoji: '🔵', text: 'In canvas', class: 'info' };
      default:
        return null;
    }
  }
</script>

{#if badge}
  <span class="sync-badge {badge.class}">
    <span class="emoji">{badge.emoji}</span>
    {badge.text}
  </span>
{/if}

<style>
  .sync-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 500;
  }
  
  .sync-badge.warning {
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }
  
  .sync-badge.info {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
  }
  
  .emoji {
    font-size: 0.875rem;
  }
</style>
