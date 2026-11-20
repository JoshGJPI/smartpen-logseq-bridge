<!--
  SaveChangeRow.svelte - One page in the save dialog (SaveConfirmDialog): its
  tick box and what saving it will change. A move source page is required and
  its box is locked (the dialog explains why).
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { volumeBadge, ncodeBookOf } from '$lib/volumes.js';

  /** A page preview: lib/storage/page-changes.js computePageChangesFolder plus pageKey, book, page, bookAlias, isMoveSource. */
  export let item;
  export let selected = false;

  const dispatch = createEventDispatcher();

  $: pageName = (() => {
    const badge = volumeBadge(item.book);
    const fallback = badge ? `Book ${ncodeBookOf(item.book)} ${badge}` : `Book ${item.book}`;
    return `${item.bookAlias || fallback} / Page ${item.page}`;
  })();
</script>

<div class="change-item" class:selected>
  <label class="checkbox-label">
    <input
      type="checkbox"
      checked={selected}
      disabled={item.isMoveSource}
      title={item.isMoveSource
        ? 'Required: this page still holds the strokes you moved to another volume'
        : ''}
      on:change={() => dispatch('toggle')}
    />
    <div class="page-name">
      📄 {pageName}
      {#if item.isMoveSource}
        <span class="required-tag" title="Must be saved so the moved strokes don't remain here too">required</span>
      {/if}
    </div>
  </label>
  <div class="change-stats">
    {#if item.strokeAdditions > 0}
      <span class="stat additions">+{item.strokeAdditions} strokes</span>
    {/if}
    {#if item.strokeEdits > 0}
      <span class="stat edits" title="Points deleted or snapped on strokes already saved — their stored point data will be rewritten">
        ✎ {item.strokeEdits} edited
      </span>
    {/if}
    {#if item.strokeModifications > 0}
      <span class="stat modifications" title="Pressure ink or Not text flag changed on strokes already saved">
        ✏️ {item.strokeModifications} restyled
      </span>
    {/if}
    {#if item.strokeRetimes > 0}
      <span class="stat retimes" title="Times changed on strokes already saved — rewritten at their new times, the copies at the old times removed">
        🕒 {item.strokeRetimes} retimed
      </span>
    {/if}
    {#if item.strokeMoves > 0}
      <span class="stat moves" title="Reassigned to another volume — kept there, removed from this page">
        → {item.strokeMoves} moved
      </span>
    {/if}
    {#if item.strokeDeletions > 0}
      <span class="stat deletions">-{item.strokeDeletions} strokes</span>
    {/if}
    {#if item.hasNewTranscription}
      <span class="stat transcription-new">✨ New transcription</span>
    {/if}
    {#if item.transcriptionChanged}
      <span class="stat transcription-changed">📝 Updated transcription</span>
    {/if}
  </div>
</div>

<style>
  .change-item {
    display: flex;
    flex-direction: column;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    transition: all 0.2s;
  }
  
  .change-item.selected {
    border-color: var(--accent);
    background: rgba(33, 150, 243, 0.05);
  }
  
  .change-item:hover {
    background: var(--bg-tertiary);
  }
  
  .change-item.selected:hover {
    background: rgba(33, 150, 243, 0.08);
  }
  
  .checkbox-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    cursor: pointer;
  }
  
  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    margin-right: 12px;
    cursor: pointer;
    flex-shrink: 0;
  }
  
  .page-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
    flex: 1;
  }
  
  .change-stats {
    display: flex;
    gap: 12px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  
  .stat {
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
  }
  
  .stat.additions {
    color: var(--success);
    background: rgba(34, 197, 94, 0.1);
  }
  
  .stat.edits {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
  }

  .stat.modifications {
    color: #06b6d4;
    background: rgba(6, 182, 212, 0.1);
  }

  .stat.retimes {
    color: #2dd4bf;
    background: rgba(45, 212, 191, 0.12);
  }

  .stat.moves {
    color: #8b5cf6;
    background: rgba(139, 92, 246, 0.1);
  }

  .stat.deletions {
    color: var(--error);
    background: rgba(239, 68, 68, 0.1);
  }

  .required-tag {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8b5cf6;
    background: rgba(139, 92, 246, 0.12);
  }
  
  .stat.transcription-new {
    color: #8b5cf6;
    background: rgba(139, 92, 246, 0.1);
  }
  
  .stat.transcription-changed {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
  }
</style>
