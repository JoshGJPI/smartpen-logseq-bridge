<!--
  TagManagerDialog.svelte — the tag manager (TagManager) in its own dialog,
  opened from Settings → Tags. The table and its Rename / Merge into… / Delete
  actions need more width than the settings dropdown has, and a long tag list
  would push every setting below it out of view.
-->
<script>
  import TagManager from './TagManager.svelte';

  export let visible = false;

  function close() {
    visible = false;
  }

  // TagManager's rename field claims its own Escape (preventDefault), so the
  // first Escape cancels a rename and only the next one closes the dialog.
  function handleKeyDown(event) {
    if (event.key === 'Escape' && visible && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if visible}
  <div class="dialog-backdrop" on:click={close} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
    <div class="dialog-header">
      <h2 id="tag-manager-title">Manage tags</h2>
      <button class="close-btn" on:click={close} aria-label="Close">✕</button>
    </div>
    <div class="dialog-body">
      <TagManager />
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
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
    width: min(680px, calc(100vw - 48px));
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    z-index: 1001;
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translate(-50%, -48%); }
    to { opacity: 1; transform: translate(-50%, -50%); }
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

  .dialog-body {
    padding: 16px 24px 20px;
    overflow-y: auto;
  }
</style>
