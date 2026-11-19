<!--
  TranscriptEditorFooter.svelte - The Edit Transcription dialog's footer
  (TranscriptionEditorModal): the page's tags, the selection and modified
  counts, the ink choice for deleted lines (v3.20.0, while any deleted line had
  ink) and Cancel / Confirm. Writes nothing itself except page tags.
-->
<script>
  import PageTagsInline from '../tags/PageTagsInline.svelte';
  import DeletedInkChoice from './DeletedInkChoice.svelte';

  export let book;
  export let pageId;
  export let lines = [];
  /** { selected, modified } */
  export let stats;
  /** How many deleted lines had ink; the choice shows while it is above 0. */
  export let inkCount = 0;
  /** 'textless' | 'retry' (bound) */
  export let deletedInk;
  export let onCancel = () => {};
  export let onConfirm = () => {};
</script>

<div class="modal-footer">
  <div class="footer-tags">
    <PageTagsInline {book} {pageId} {lines} dropUp />
  </div>
  {#if inkCount > 0}
    <div class="footer-ink"><DeletedInkChoice bind:value={deletedInk} count={inkCount} /></div>
  {/if}
  <div class="footer-info">
    {#if stats.selected > 0}
      <span class="selection-info">{stats.selected} selected</span>
    {/if}
    {#if stats.modified > 0}
      <span class="modified-warning">{stats.modified} line{stats.modified !== 1 ? 's' : ''} modified</span>
    {/if}
  </div>
  <div class="footer-actions">
    <button class="btn btn-cancel" on:click={onCancel}>Cancel</button>
    <button class="btn btn-primary" on:click={onConfirm}>Confirm</button>
  </div>
</div>

<style>
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 24px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
  }

  .footer-tags {
    flex: 1;
    min-width: 0;
    margin-right: 4px;
  }

  .footer-ink {
    color: var(--text-primary);
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-tertiary);
  }

  .footer-info {
    display: flex;
    gap: 16px;
    font-size: 0.8rem;
  }

  .selection-info {
    color: var(--accent);
    font-weight: 500;
  }

  .modified-warning {
    color: #f59e0b;
    font-weight: 500;
  }

  .footer-actions {
    display: flex;
    gap: 10px;
  }

  .btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
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
