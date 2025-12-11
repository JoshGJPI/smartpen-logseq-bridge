<!--
  LogseqPreview.svelte - Preview of LogSeq formatted output
-->
<script>
  export let lines = [];
  
  // Convert lines to LogSeq markdown format
  $: logseqOutput = formatForLogseq(lines);
  
  function formatForLogseq(lines) {
    if (!lines || lines.length === 0) return '';
    
    return lines.map(line => {
      const indent = line.indentLevel || 0;
      const prefix = '  '.repeat(indent) + '- ';
      let text = line.text || line.content || '';
      
      // Add TODO prefix if detected
      if (line.isCommand && line.commandType === 'TODO') {
        text = `TODO ${text}`;
      } else if (line.isCommand && line.commandType === 'DONE') {
        text = `DONE ${text}`;
      }
      
      return prefix + text;
    }).join('\n');
  }
  
  function copyToClipboard() {
    navigator.clipboard.writeText(logseqOutput);
  }
</script>

{#if lines.length > 0}
  <section class="logseq-preview">
    <div class="header">
      <h3>LogSeq Preview</h3>
      <button class="copy-btn" on:click={copyToClipboard} title="Copy to clipboard">
        📋 Copy
      </button>
    </div>
    
    <pre class="preview-output">{logseqOutput}</pre>
    
    <p class="preview-note">
      This is how the text will appear when sent to LogSeq
    </p>
  </section>
{/if}

<style>
  .logseq-preview {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .header h3 {
    font-size: 0.9rem;
    color: var(--text-primary);
    margin: 0;
  }

  .copy-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: all 0.2s;
  }

  .copy-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .preview-output {
    background: var(--bg-primary);
    padding: 12px;
    border-radius: 6px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    max-height: 200px;
    overflow-y: auto;
    border-left: 3px solid var(--accent);
  }

  .preview-note {
    margin-top: 8px;
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
