<!--
  CommandList.svelte - List of detected commands
-->
<script>
  export let commands = [];
  
  const commandIcons = {
    TODO: '☐',
    DONE: '✓',
    WAITING: '⏳',
    DEADLINE: '📅',
    SCHEDULED: '📆',
    PRIORITY: '⚡',
    DEFAULT: '📌'
  };
  
  function getIcon(type) {
    return commandIcons[type?.toUpperCase()] || commandIcons.DEFAULT;
  }
</script>

{#if commands.length > 0}
  <section class="command-list">
    <h3>Detected Commands ({commands.length})</h3>
    
    <div class="commands">
      {#each commands as cmd, i (i)}
        <div class="command-item">
          <span class="command-icon">{getIcon(cmd.type)}</span>
          <span class="command-type">{cmd.type}</span>
          {#if cmd.value}
            <span class="command-value">{cmd.value}</span>
          {/if}
          <span class="command-line">Line {cmd.line + 1}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .command-list {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px;
  }

  .command-list h3 {
    font-size: 0.9rem;
    margin-bottom: 10px;
    color: var(--text-primary);
  }

  .commands {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .command-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-primary);
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .command-icon {
    font-size: 1rem;
  }

  .command-type {
    font-weight: 600;
    color: var(--warning);
    text-transform: uppercase;
    font-size: 0.75rem;
  }

  .command-value {
    flex: 1;
    color: var(--text-secondary);
    font-size: 0.8rem;
  }

  .command-line {
    font-size: 0.7rem;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 4px;
  }
</style>
