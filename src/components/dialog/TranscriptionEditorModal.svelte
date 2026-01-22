<!--
  TranscriptionEditorModal.svelte - Modal interface for editing and consolidating transcription lines
-->
<script>
  import { createEventDispatcher } from 'svelte';
  
  export let book;
  export let page;
  export let lines = []; // Array of line objects from MyScript
  export let visible = false;
  
  const dispatch = createEventDispatcher();
  
  // Local state for editing
  let editedLines = [];
  let selectedIndices = new Set();
  let history = [];
  let historyIndex = -1;
  
  // Initialize edited lines when modal opens
  $: if (visible && lines.length > 0) {
    initializeEditor();
  }
  
  function initializeEditor() {
    editedLines = lines.map((line, index) => ({
      ...line,
      id: `line-${index}`,
      originalIndex: index,
      userModified: false
    }));
    selectedIndices = new Set();
    history = [JSON.parse(JSON.stringify(editedLines))];
    historyIndex = 0;
  }
  
  // Add to history for undo/redo
  function addToHistory() {
    // Remove any future history if we're not at the end
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.parse(JSON.stringify(editedLines)));
    historyIndex++;
  }
  
  // Merge selected lines or adjacent lines
  function mergeLines(startIndex) {
    if (editedLines.length < 2) return;
    
    let indices;
    if (selectedIndices.size >= 2) {
      // Merge selected lines
      indices = Array.from(selectedIndices).sort((a, b) => a - b);
    } else {
      // Merge current line with next
      if (startIndex >= editedLines.length - 1) return;
      indices = [startIndex, startIndex + 1];
    }
    
    // Get lines to merge
    const linesToMerge = indices.map(i => editedLines[i]);
    
    // Create merged line
    const mergedLine = {
      text: linesToMerge.map(l => l.text).join(' '),
      canonical: linesToMerge.map(l => l.canonical).join(' '),
      yBounds: {
        minY: Math.min(...linesToMerge.map(l => l.yBounds.minY)),
        maxY: Math.max(...linesToMerge.map(l => l.yBounds.maxY))
      },
      mergedLineCount: linesToMerge.reduce((sum, l) => sum + (l.mergedLineCount || 1), 0),
      indentLevel: linesToMerge[0].indentLevel || 0,
      blockUuid: linesToMerge[0].blockUuid, // Preserve UUID of first block
      syncStatus: linesToMerge[0].syncStatus || 'synced',
      id: linesToMerge[0].id,
      originalIndex: linesToMerge[0].originalIndex,
      userModified: true,
      sourceLines: linesToMerge.map(l => l.originalIndex)
    };
    
    // Build new lines array
    const newLines = [];
    let merged = false;
    editedLines.forEach((line, index) => {
      if (indices.includes(index)) {
        if (!merged) {
          newLines.push(mergedLine);
          merged = true;
        }
      } else {
        newLines.push(line);
      }
    });
    
    editedLines = newLines;
    selectedIndices.clear();
    addToHistory();
  }
  
  // Split a line at cursor position
  function splitLine(index, splitText1, splitText2) {
    const line = editedLines[index];
    
    // Calculate proportional Y-bounds
    const midY = (line.yBounds.minY + line.yBounds.maxY) / 2;
    
    const line1 = {
      text: splitText1.trim(),
      canonical: splitText1.trim(),
      yBounds: {
        minY: line.yBounds.minY,
        maxY: midY
      },
      mergedLineCount: 1,
      indentLevel: line.indentLevel || 0,
      blockUuid: line.blockUuid, // Preserve UUID for first part
      syncStatus: line.syncStatus || 'synced',
      id: line.id,
      originalIndex: line.originalIndex,
      userModified: true
    };
    
    const line2 = {
      text: splitText2.trim(),
      canonical: splitText2.trim(),
      yBounds: {
        minY: midY,
        maxY: line.yBounds.maxY
      },
      mergedLineCount: 1,
      indentLevel: line.indentLevel || 0,
      // No blockUuid for second part - this will create a new block
      syncStatus: 'new',
      id: `${line.id}-split`,
      originalIndex: line.originalIndex,
      userModified: true
    };
    
    // Build new lines array
    editedLines = [
      ...editedLines.slice(0, index),
      line1,
      line2,
      ...editedLines.slice(index + 1)
    ];
    
    addToHistory();
  }
  
  // Undo last change
  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      editedLines = JSON.parse(JSON.stringify(history[historyIndex]));
      selectedIndices.clear();
    }
  }
  
  // Redo last undone change
  function redo() {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      editedLines = JSON.parse(JSON.stringify(history[historyIndex]));
      selectedIndices.clear();
    }
  }
  
  // Toggle line selection
  function toggleSelection(index) {
    if (selectedIndices.has(index)) {
      selectedIndices.delete(index);
    } else {
      selectedIndices.add(index);
    }
    selectedIndices = selectedIndices; // Trigger reactivity
  }
  
  // Select all lines
  function selectAll() {
    selectedIndices = new Set(editedLines.map((_, i) => i));
  }
  
  // Smart merge suggestions
  function detectMergeSuggestions() {
    const suggestions = [];
    
    for (let i = 0; i < editedLines.length - 1; i++) {
      const current = editedLines[i];
      const next = editedLines[i + 1];
      
      // Heuristics for auto-merge suggestion
      const sameLine = 
        current.indentLevel === next.indentLevel &&
        !current.text.match(/[.!?]$/) && // Current doesn't end with punctuation
        next.text.match(/^[a-z]/) && // Next starts with lowercase
        Math.abs(current.yBounds.maxY - next.yBounds.minY) < 20; // Close together
      
      if (sameLine) {
        suggestions.push({ indices: [i, i + 1], confidence: 0.8 });
      }
    }
    
    return suggestions;
  }
  
  // Apply smart merge suggestions
  function applySmartMerge() {
    const suggestions = detectMergeSuggestions();
    if (suggestions.length > 0) {
      // Apply first suggestion
      const indices = suggestions[0].indices;
      indices.forEach(i => selectedIndices.add(i));
      mergeLines(indices[0]);
    }
  }
  
  // Save changes and close modal
  function handleSave() {
    dispatch('save', {
      lines: editedLines,
      book,
      page
    });
    handleClose();
  }
  
  // Close modal without saving
  function handleClose() {
    visible = false;
    dispatch('close');
  }
  
  // Handle keyboard shortcuts
  function handleKeydown(event) {
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (event.key === 'z' && event.shiftKey || event.key === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'a') {
        event.preventDefault();
        selectAll();
      } else if (event.key === 'j') {
        event.preventDefault();
        if (selectedIndices.size >= 2) {
          mergeLines(Array.from(selectedIndices)[0]);
        }
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }
  
  // Format Y-bounds for display
  function formatBounds(yBounds) {
    return `Y: ${yBounds.minY.toFixed(0)}-${yBounds.maxY.toFixed(0)}`;
  }
  
  // Calculate statistics
  $: stats = {
    totalLines: editedLines.length,
    selected: selectedIndices.size,
    merged: editedLines.filter(l => l.mergedLineCount > 1).length,
    modified: editedLines.filter(l => l.userModified).length
  };
  
  $: mergeSuggestions = detectMergeSuggestions();
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
<div class="modal-backdrop" on:click={handleClose}>
  <div class="modal-container" on:click|stopPropagation>
    <div class="modal-header">
      <h2>Edit Transcription - B{book}/P{page}</h2>
      <button class="close-btn" on:click={handleClose} title="Close (Esc)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    
    <div class="modal-toolbar">
      <div class="toolbar-group">
        <button 
          class="tool-btn" 
          on:click={undo} 
          disabled={historyIndex <= 0}
          title="Undo (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button 
          class="tool-btn" 
          on:click={redo} 
          disabled={historyIndex >= history.length - 1}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷ Redo
        </button>
      </div>
      
      <div class="toolbar-group">
        <button 
          class="tool-btn" 
          on:click={selectAll}
          title="Select All (Ctrl+A)"
        >
          ☑ Select All
        </button>
        <button 
          class="tool-btn primary" 
          on:click={() => mergeLines(Array.from(selectedIndices)[0])} 
          disabled={selectedIndices.size < 2}
          title="Merge Selected (Ctrl+J)"
        >
          ⬇ Merge ({selectedIndices.size})
        </button>
      </div>
      
      {#if mergeSuggestions.length > 0}
      <div class="toolbar-group">
        <button 
          class="tool-btn suggest" 
          on:click={applySmartMerge}
          title="Apply smart merge suggestion"
        >
          💡 Smart Merge ({mergeSuggestions.length})
        </button>
      </div>
      {/if}
    </div>
    
    <div class="modal-body">
      <div class="editor-pane">
        <div class="pane-header">
          <h3>Lines</h3>
          <div class="stats">
            {stats.totalLines} lines • {stats.selected} selected • {stats.merged} merged
          </div>
        </div>
        
        <div class="lines-list">
          {#each editedLines as line, index}
          <div 
            class="line-item" 
            class:selected={selectedIndices.has(index)}
            class:merged={line.mergedLineCount > 1}
            class:modified={line.userModified}
          >
            <div class="line-header">
              <input 
                type="checkbox" 
                checked={selectedIndices.has(index)}
                on:change={() => toggleSelection(index)}
              />
              <span class="line-number">#{index + 1}</span>
              {#if line.mergedLineCount > 1}
              <span class="merge-badge" title="Merged from {line.mergedLineCount} lines">
                ✓ {line.mergedLineCount}
              </span>
              {/if}
              <span class="bounds-info">{formatBounds(line.yBounds)}</span>
            </div>
            
            <div class="line-content" style="padding-left: {line.indentLevel * 20}px">
              <input 
                type="text" 
                class="line-input"
                value={line.text}
                on:input={(e) => {
                  editedLines[index].text = e.target.value;
                  editedLines[index].canonical = e.target.value.trim();
                  editedLines[index].userModified = true;
                  editedLines = editedLines;
                }}
              />
            </div>
            
            <div class="line-actions">
              <button 
                class="action-btn" 
                on:click={() => mergeLines(index)}
                disabled={index >= editedLines.length - 1}
                title="Merge with next line"
              >
                ⬇ Merge
              </button>
              <button 
                class="action-btn" 
                on:click={() => {
                  const text = line.text;
                  const mid = Math.floor(text.length / 2);
                  splitLine(index, text.slice(0, mid), text.slice(mid));
                }}
                title="Split line in half"
              >
                ⬌ Split
              </button>
            </div>
          </div>
          {/each}
        </div>
      </div>
      
      <div class="preview-pane">
        <div class="pane-header">
          <h3>LogSeq Preview</h3>
        </div>
        
        <div class="preview-content">
          <div class="preview-section">## Transcribed Content #Display_No_Properties</div>
          
          {#each editedLines as line}
          <div class="preview-block" style="padding-left: {line.indentLevel * 20}px">
            <div class="preview-text">- {line.text}</div>
            <!-- Properties hidden by #Display_No_Properties tag in LogSeq -->
          </div>
          {/each}
        </div>
      </div>
    </div>
    
    <div class="modal-footer">
      <div class="footer-info">
        {#if stats.modified > 0}
        <span class="modified-warning">⚠ {stats.modified} lines modified</span>
        {/if}
      </div>
      <div class="footer-actions">
        <button class="btn btn-cancel" on:click={handleClose}>Cancel</button>
        <button class="btn btn-primary" on:click={handleSave}>💾 Save Changes</button>
      </div>
    </div>
  </div>
</div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }
  
  .modal-container {
    background: var(--bg-primary);
    border-radius: 12px;
    width: 90vw;
    max-width: 1400px;
    height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--border);
  }
  
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
  }
  
  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-primary);
  }
  
  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .modal-toolbar {
    display: flex;
    gap: 12px;
    padding: 12px 24px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  
  .toolbar-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .tool-btn {
    padding: 6px 12px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }
  
  .tool-btn:hover:not(:disabled) {
    background: var(--bg-primary);
    border-color: var(--accent);
  }
  
  .tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .tool-btn.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  
  .tool-btn.primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  .tool-btn.suggest {
    background: #f59e0b;
    color: white;
    border-color: #f59e0b;
  }
  
  .modal-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  
  .editor-pane, .preview-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .editor-pane {
    border-right: 1px solid var(--border);
  }
  
  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }
  
  .pane-header h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .stats {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }
  
  .lines-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  
  .line-item {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 8px;
    padding: 10px;
    transition: all 0.2s;
  }
  
  .line-item.selected {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  }
  
  .line-item.merged {
    border-left: 3px solid #22c55e;
  }
  
  .line-item.modified {
    border-right: 3px solid #f59e0b;
  }
  
  .line-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 0.75rem;
  }
  
  .line-number {
    color: var(--text-tertiary);
    font-weight: 500;
  }
  
  .merge-badge {
    background: #22c55e;
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  
  .bounds-info {
    color: var(--text-tertiary);
    margin-left: auto;
  }
  
  .line-content {
    margin-bottom: 8px;
  }
  
  .line-input {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
  }
  
  .line-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  .line-actions {
    display: flex;
    gap: 6px;
  }
  
  .action-btn {
    padding: 4px 10px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .action-btn:hover:not(:disabled) {
    background: var(--bg-primary);
  }
  
  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  .preview-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    font-family: 'Courier New', monospace;
    font-size: 0.85rem;
  }
  
  .preview-section {
    color: var(--text-secondary);
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  
  .preview-block {
    margin-bottom: 16px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 2px solid var(--border);
    border-radius: 4px;
  }
  
  .preview-text {
    color: var(--text-primary);
    margin-bottom: 6px;
    font-weight: 500;
  }
  
  .preview-properties {
    font-size: 0.7rem;
    color: var(--text-tertiary);
    padding-left: 10px;
  }
  
  .property {
    margin: 2px 0;
  }
  
  .merged-prop {
    color: #22c55e;
    font-weight: 600;
  }
  
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
  }
  
  .footer-info {
    font-size: 0.85rem;
  }
  
  .modified-warning {
    color: #f59e0b;
    font-weight: 500;
  }
  
  .footer-actions {
    display: flex;
    gap: 12px;
  }
  
  .btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-cancel {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-cancel:hover {
    background: var(--bg-primary);
  }
  
  .btn-primary {
    background: var(--accent);
    color: white;
  }
  
  .btn-primary:hover {
    opacity: 0.9;
  }
</style>
