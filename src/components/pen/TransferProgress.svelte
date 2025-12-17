<script>
  import { transferProgress, transferPercent } from '$stores';
  import { cancelOfflineTransfer } from '$lib/pen-sdk.js';
  
  function handleCancel() {
    cancelOfflineTransfer();
  }
  
  // Format status for display
  function getStatusText(status) {
    switch (status) {
      case 'requesting': return 'Requesting data...';
      case 'receiving': return 'Receiving strokes...';
      case 'processing': return 'Processing...';
      case 'waiting': return 'Preparing next book...';
      case 'complete': return 'Complete!';
      case 'cancelled': return 'Cancelled';
      case 'error': return 'Error';
      default: return status || 'Initializing...';
    }
  }
</script>

{#if $transferProgress.active}
  <div class="transfer-progress">
    <div class="progress-header">
      <span class="progress-title">
        📥 Importing Offline Data
      </span>
      {#if $transferProgress.canCancel}
        <button class="cancel-btn" on:click={handleCancel} title="Cancel transfer">
          ✕
        </button>
      {/if}
    </div>
    
    <div class="progress-info">
      <span class="book-info">
        Book {$transferProgress.currentBookIndex}/{$transferProgress.totalBooks}
        {#if $transferProgress.currentBook}
          ({$transferProgress.currentBook})
        {/if}
      </span>
      <span class="status">{getStatusText($transferProgress.status)}</span>
    </div>
    
    <div class="progress-bar-container">
      <div 
        class="progress-bar" 
        class:indeterminate={$transferProgress.expectedStrokes === 0}
        style="width: {$transferPercent}%"
      ></div>
    </div>
    
    <div class="progress-stats">
      {#if $transferProgress.expectedStrokes > 0}
        <span class="strokes">
          {$transferProgress.receivedStrokes} / {$transferProgress.expectedStrokes} strokes
          ({$transferPercent}%)
        </span>
      {:else if $transferProgress.receivedStrokes > 0}
        <span class="strokes">
          {$transferProgress.receivedStrokes} strokes received
        </span>
      {/if}
      <span class="elapsed">
        {$transferProgress.elapsedSeconds}s
      </span>
    </div>
  </div>
{/if}

<style>
  .transfer-progress {
    background: #1a1a2e;
    border: 1px solid #4a4a6a;
    border-radius: 8px;
    padding: 12px;
    margin: 8px 0;
  }
  
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  
  .progress-title {
    font-weight: 600;
    color: #e0e0e0;
    font-size: 0.9rem;
  }
  
  .cancel-btn {
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 0.8rem;
    transition: background 0.2s;
  }
  
  .cancel-btn:hover {
    background: #c82333;
  }
  
  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 0.85rem;
  }
  
  .book-info {
    color: #88ccff;
  }
  
  .status {
    color: #aaa;
  }
  
  .progress-bar-container {
    height: 8px;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  
  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50, #8BC34A);
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  
  .progress-bar.indeterminate {
    width: 30% !important;
    animation: indeterminate 1.5s infinite ease-in-out;
  }
  
  @keyframes indeterminate {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }
  
  .progress-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: #888;
  }
  
  .strokes {
    color: #4CAF50;
  }
  
  .elapsed {
    color: #888;
  }
</style>
