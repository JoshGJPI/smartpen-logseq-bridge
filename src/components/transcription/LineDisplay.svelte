<!--
  LineDisplay.svelte - Single line with hierarchy indicator
-->
<script>
  export let line;
  export let index;
  
  $: indentLevel = line.indentLevel || 0;
  $: text = line.text || line.content || '';
  $: isCommand = line.isCommand || false;
  $: hasChildren = line.children && line.children.length > 0;
</script>

<div 
  class="line-display" 
  class:command={isCommand}
  class:has-children={hasChildren}
  style="padding-left: {indentLevel * 20 + 8}px"
>
  <span class="line-number">{index + 1}</span>
  
  {#if indentLevel > 0}
    <span class="indent-indicator" title="Indent level {indentLevel}">
      {'  '.repeat(indentLevel)}└─
    </span>
  {/if}
  
  <span class="line-text">{text}</span>
  
  {#if hasChildren}
    <span class="children-badge" title="{line.children.length} child line(s)">
      {line.children.length}
    </span>
  {/if}
</div>

<style>
  .line-display {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-primary);
    border-radius: 4px;
    font-size: 0.85rem;
    transition: background 0.2s;
  }

  .line-display:hover {
    background: var(--bg-secondary);
  }

  .line-display.command {
    border-left: 3px solid var(--warning);
  }

  .line-display.has-children {
    font-weight: 500;
  }

  .line-number {
    color: var(--text-secondary);
    font-size: 0.7rem;
    min-width: 20px;
    text-align: right;
  }

  .indent-indicator {
    color: var(--text-secondary);
    font-family: monospace;
    opacity: 0.5;
  }

  .line-text {
    flex: 1;
    word-break: break-word;
  }

  .children-badge {
    font-size: 0.7rem;
    color: var(--accent);
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: 600;
  }
</style>
