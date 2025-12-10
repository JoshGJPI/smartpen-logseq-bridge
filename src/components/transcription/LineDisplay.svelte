<!--
  LineDisplay.svelte - Single line with hierarchy indicator
-->
<script>
  export let line;
  export let index;
  
  $: indentLevel = line.indent || 0;
  $: text = line.text || line.content || '';
  $: isCommand = line.isCommand || false;
</script>

<div 
  class="line-display" 
  class:command={isCommand}
  style="padding-left: {indentLevel * 20 + 8}px"
>
  <span class="line-number">{index + 1}</span>
  
  {#if indentLevel > 0}
    <span class="indent-indicator">
      {'└─'.repeat(1)}
    </span>
  {/if}
  
  <span class="line-text">{text}</span>
  
  {#if line.confidence}
    <span class="confidence" title="Recognition confidence">
      {Math.round(line.confidence * 100)}%
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

  .confidence {
    font-size: 0.7rem;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 10px;
  }
</style>
