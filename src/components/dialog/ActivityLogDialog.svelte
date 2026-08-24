<!--
  ActivityLogDialog.svelte — the activity log, on demand.

  The log used to be a permanent top-level tab in the left panel, from an era
  when the app needed watching. It is a troubleshooting tool now, so it opens
  from Settings → Troubleshooting and gets the whole dialog instead of half a
  panel.

  Two things the tab could not offer and a diagnostic view should: a filter by
  level (an error is usually what you opened this for) and Copy, so the log can
  be pasted somewhere useful. `ActivityLog.svelte` stays as-is for its remaining
  in-panel use; this dialog renders the entries itself because it filters them.
-->
<script>
  import { logMessages, clearLog, showActivityLogDialog, closeActivityLogDialog } from '$stores';

  /** 'all' | 'error' | 'warning' | 'success' | 'info' */
  let filter = 'all';
  let copied = false;
  let copyTimer;

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'error', label: 'Errors' },
    { id: 'warning', label: 'Warnings' },
    { id: 'success', label: 'Success' },
    { id: 'info', label: 'Info' }
  ];

  $: entries = filter === 'all'
    ? $logMessages
    : $logMessages.filter(e => e.level === filter);

  // Counts drive the filter badges, so an error is visible without switching to it.
  $: counts = $logMessages.reduce((acc, e) => {
    acc[e.level] = (acc[e.level] || 0) + 1;
    return acc;
  }, {});

  function countFor(id) {
    return id === 'all' ? $logMessages.length : (counts[id] || 0);
  }

  async function handleCopy() {
    // Oldest first when copied — a log pasted into an issue reads forwards,
    // even though the panel shows newest first for scanning.
    const text = [...entries]
      .reverse()
      .map(e => `[${e.time}] ${e.level.toUpperCase()}: ${e.message}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1600);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  function handleClear() {
    clearLog();
    filter = 'all';
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && $showActivityLogDialog) {
      closeActivityLogDialog();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if $showActivityLogDialog}
  <div class="dialog-backdrop" on:click={closeActivityLogDialog} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="activity-log-title">
    <div class="dialog-header">
      <h2 id="activity-log-title">🩺 Activity Log</h2>
      <button class="close-btn" on:click={closeActivityLogDialog} aria-label="Close">✕</button>
    </div>

    <div class="dialog-toolbar">
      <div class="filters" role="group" aria-label="Filter by level">
        {#each FILTERS as f (f.id)}
          {@const n = countFor(f.id)}
          <button
            class="filter-btn level-{f.id}"
            class:active={filter === f.id}
            disabled={n === 0 && f.id !== 'all'}
            on:click={() => (filter = f.id)}
          >
            {f.label}<span class="filter-count">{n}</span>
          </button>
        {/each}
      </div>

      <div class="toolbar-actions">
        <button
          class="btn btn-secondary small"
          on:click={handleCopy}
          disabled={entries.length === 0}
          title={filter === 'all'
            ? 'Copy the whole log to the clipboard'
            : `Copy the ${entries.length} shown entr${entries.length === 1 ? 'y' : 'ies'}`}
        >
          {copied ? '✅ Copied' : '📋 Copy'}
        </button>
        <button
          class="btn btn-secondary small"
          on:click={handleClear}
          disabled={$logMessages.length === 0}
          title="Clear all log entries"
        >
          Clear
        </button>
      </div>
    </div>

    <div class="dialog-body">
      {#if entries.length === 0}
        <div class="log-empty">
          {#if $logMessages.length === 0}
            No activity yet.
          {:else}
            No {filter} entries — {$logMessages.length} total.
          {/if}
        </div>
      {:else}
        <div class="log-messages">
          {#each entries as entry (entry.id)}
            <div class="log-entry log-{entry.level}">
              <span class="log-time">{entry.time}</span>
              <span class="log-message">{entry.message}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="dialog-footer">
      <span class="footer-note">
        Newest first. The log keeps the last 50 entries.
      </span>
      <button class="btn btn-secondary" on:click={closeActivityLogDialog}>Close</button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 1000;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    width: min(760px, calc(100vw - 48px));
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    z-index: 1001;
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translate(-50%, -48%);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dialog,
    .dialog-backdrop {
      animation: none;
    }
  }

  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* Toolbar — filters left, actions right */
  .dialog-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .filter-btn:hover:not(:disabled):not(.active) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .filter-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .filter-btn.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  /* A non-zero count keeps its level colour even when the filter is inactive,
     so an error is findable without clicking through the filters. */
  .filter-btn.level-error:not(:disabled) { color: var(--error); }
  .filter-btn.level-warning:not(:disabled) { color: var(--warning); }
  .filter-btn.level-success:not(:disabled) { color: var(--success); }

  .filter-count {
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 0.7rem;
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 0 5px;
    min-width: 18px;
    text-align: center;
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
  }

  /* `.small` is a local convention in this app, not a global class — the
     global `.btn` padding is sized for header actions. */
  .toolbar-actions .small {
    padding: 6px 12px;
    font-size: 0.78rem;
    border-radius: 6px;
  }

  .dialog-body {
    padding: 16px 24px;
    overflow-y: auto;
    flex: 1;
    min-height: 180px;
  }

  .log-messages {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 0.78rem;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  .log-entry {
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 12px;
  }

  .log-entry:last-child {
    border-bottom: none;
  }

  .log-time {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .log-message {
    word-break: break-word;
  }

  .log-info { color: var(--text-primary); }
  .log-success { color: var(--success); }
  .log-warning { color: var(--warning); }
  .log-error { color: var(--error); }

  .log-empty {
    color: var(--text-secondary);
    text-align: center;
    padding: 40px 10px;
    font-size: 0.875rem;
  }

  .dialog-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 14px 24px;
    border-top: 1px solid var(--border);
  }

  .footer-note {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
</style>
