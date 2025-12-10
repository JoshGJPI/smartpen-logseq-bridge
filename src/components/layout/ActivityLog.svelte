<!--
  ActivityLog.svelte - Activity/message log display
-->
<script>
  import { logMessages, clearLog } from '$stores';
</script>

<div class="log-container">
  <div class="log-messages">
    {#each $logMessages as entry (entry.id)}
      <div class="log-entry log-{entry.level}">
        <span class="log-time">{entry.time}</span>
        <span class="log-message">{entry.message}</span>
      </div>
    {:else}
      <div class="log-empty">No activity yet</div>
    {/each}
  </div>
  
  {#if $logMessages.length > 0}
    <button class="clear-btn" on:click={clearLog}>Clear</button>
  {/if}
</div>

<style>
  .log-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .log-messages {
    background: var(--bg-primary);
    border-radius: 8px;
    padding: 10px;
    flex: 1;
    overflow-y: auto;
    font-size: 0.75rem;
    font-family: 'Consolas', 'Monaco', monospace;
    max-height: 150px;
  }

  .log-entry {
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 10px;
  }

  .log-entry:last-child {
    border-bottom: none;
  }

  .log-time {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .log-message {
    word-break: break-word;
  }

  .log-info { color: var(--text-primary); }
  .log-success { color: var(--success); }
  .log-warning { color: var(--warning); }
  .log-error { color: var(--error); }

  .log-empty {
    color: var(--text-secondary);
    text-align: center;
    padding: 10px;
  }

  .clear-btn {
    margin-top: 8px;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    align-self: flex-end;
  }

  .clear-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }
</style>
