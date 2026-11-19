<!--
  TranscriptEditorHeader.svelte - The Edit Transcription dialog's title row
  (TranscriptionEditorModal): the page, the line counts by status, the stroke
  preview toggle and Close. Owns no state.
-->
<script>
  export let book;
  export let page;
  /** { totalLines, synced, newLines, modified } */
  export let stats;
  export let showPreview = true;
  export let onTogglePreview = () => {};
  export let onClose = () => {};
</script>

<div class="modal-header">
  <h2>Edit Transcription &mdash; B{book}/P{page}</h2>
  <div class="header-stats">
    {stats.totalLines} {stats.totalLines === 1 ? 'line' : 'lines'}
    {#if stats.synced > 0}<span class="stat-badge synced">{stats.synced} saved</span>{/if}
    {#if stats.newLines > 0}<span class="stat-badge new">{stats.newLines} new</span>{/if}
    {#if stats.modified > 0}<span class="stat-badge modified">{stats.modified} modified</span>{/if}
  </div>
  <button
    class="preview-toggle"
    class:active={showPreview}
    on:click={onTogglePreview}
    aria-pressed={showPreview}
    title={showPreview ? 'Hide the stroke preview' : 'Show the handwriting alongside the transcript'}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 17c3-6 6-9 9-9s4 3 3 6-3 4-4 2 1-6 4-8 4-1 6 1"/>
    </svg>
    {showPreview ? 'Hide strokes' : 'Show strokes'}
  </button>
  <button class="close-btn" on:click={onClose} title="Close (Esc)" aria-label="Close">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  </button>
</div>

<style>
  .modal-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .header-stats {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.8rem;
    color: var(--text-secondary);
    flex: 1;
  }

  .stat-badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .stat-badge.synced { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }
  .stat-badge.new { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .stat-badge.modified { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

  .preview-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .preview-toggle:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .preview-toggle.active {
    color: var(--text-primary);
    border-color: var(--accent);
    background: rgba(59, 130, 246, 0.12);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
