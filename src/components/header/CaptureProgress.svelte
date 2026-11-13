<!--
  CaptureProgress.svelte - ActionBar's progress popups: the Editor's
  transcription (stores/canvas-transcribe.js) and the pen's offline transfer
  (stores/pen.js). Drawn under the bar, whichever view it is in.
-->
<script>
  import { transferProgress, transferPercent } from '$stores';
  import { transcriptionProgress } from '$stores/canvas-transcribe.js';
  import { cancelOfflineTransfer } from '$lib/pen-sdk.js';

  $: t = $transcriptionProgress;
  $: transcribePercent = t.totalPages > 0 ? (t.currentPage / t.totalPages) * 100 : 0;
</script>

{#if t.active}
  <div class="progress-popup" role="status" aria-live="polite">
    <div class="popup-header">
      <span>✍️ Transcribing handwriting</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill transcribe" style="width: {transcribePercent}%"></div>
    </div>
    <div class="progress-stats">
      <span class="accent">
        Page {t.currentPage}/{t.totalPages}
        {#if t.currentPageNum > 0}
          · B{t.currentBook}/P{t.currentPageNum}
        {/if}
      </span>
      <span>{t.elapsedSeconds}s</span>
    </div>
    {#if t.successCount > 0 || t.errorCount > 0}
      <div class="progress-results">
        {#if t.successCount > 0}
          <span class="success-count">✓ {t.successCount}</span>
        {/if}
        {#if t.errorCount > 0}
          <span class="error-count">✗ {t.errorCount}</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if $transferProgress.active}
  <div class="progress-popup transfer" role="status" aria-live="polite">
    <div class="popup-header">
      <span>📥 Importing offline data</span>
      {#if $transferProgress.canCancel}
        <button class="cancel-btn" on:click={cancelOfflineTransfer} title="Cancel transfer" aria-label="Cancel transfer">✕</button>
      {/if}
    </div>
    <div class="progress-bar">
      {#if $transferProgress.expectedStrokes > 0}
        <div class="progress-fill transfer" style="width: {$transferPercent}%"></div>
      {:else}
        <div class="progress-fill transfer indeterminate"></div>
      {/if}
    </div>
    <div class="progress-stats">
      <span class="ok">
        {#if $transferProgress.currentBook > 0}
          Book {$transferProgress.currentBook}/{$transferProgress.totalBooks}
          {#if $transferProgress.expectedStrokes > 0}
            · {$transferProgress.currentBookStrokes}/{$transferProgress.expectedStrokes} strokes ({$transferPercent}%)
          {:else}
            · {$transferProgress.currentBookStrokes} strokes
          {/if}
        {:else}
          {$transferProgress.status === 'requesting' ? 'Requesting…' : 'Waiting…'}
        {/if}
      </span>
      <span>{$transferProgress.elapsedSeconds}s</span>
    </div>
  </div>
{/if}

<style>
  .progress-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 300px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .progress-popup.transfer {
    min-width: 280px;
  }

  .popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .progress-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .progress-fill.transcribe {
    background: linear-gradient(90deg, var(--accent), var(--accent-hover));
  }

  .progress-fill.transfer {
    background: linear-gradient(90deg, var(--success), #22c55e);
  }

  .progress-fill.indeterminate {
    width: 30% !important;
    animation: transfer-indeterminate 1.5s infinite ease-in-out;
  }

  @keyframes transfer-indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .progress-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .progress-stats .accent { color: var(--accent); }
  .progress-stats .ok { color: var(--success); }

  .progress-results {
    display: flex;
    gap: 12px;
    font-size: 0.8rem;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  .success-count {
    color: var(--success);
    font-weight: 600;
  }

  .error-count {
    color: var(--error);
    font-weight: 600;
  }

  .cancel-btn {
    background: var(--error);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s;
  }

  .cancel-btn:hover {
    background: #dc2626;
  }
</style>
