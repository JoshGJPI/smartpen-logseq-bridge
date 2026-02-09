<!--
  ExportSvgDialog.svelte - SVG export confirmation dialog
  Shows selected strokes grouped by page, lets user adjust stroke width,
  and exports separate SVG files per page.
-->
<script>
  import { svgExportDialog, closeSvgExportDialog } from '$stores';
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';

  export let renderer = null;

  // Stroke width setting (default 0.5, much thinner than the old hardcoded 2)
  let strokeWidth = 0.5;

  $: isOpen = $svgExportDialog.isOpen;
  $: pageGroups = $svgExportDialog.pageGroups;
  $: totalStrokes = $svgExportDialog.strokes.length;

  function handleExport() {
    if (!renderer || pageGroups.length === 0) return;

    if (pageGroups.length === 1) {
      // Single page - export one file
      const group = pageGroups[0];
      const svg = renderer.exportSVG(group.strokes, strokeWidth);
      const bookName = formatBookName(group.book, $bookAliases, 'alias-only') || `B${group.book}`;
      downloadFile(svg, `${bookName}_P${group.page}.svg`, 'image/svg+xml');
    } else {
      // Multiple pages - export one file per page
      for (const group of pageGroups) {
        const svg = renderer.exportSVG(group.strokes, strokeWidth);
        const bookName = formatBookName(group.book, $bookAliases, 'alias-only') || `B${group.book}`;
        downloadFile(svg, `${bookName}_P${group.page}.svg`, 'image/svg+xml');
      }
    }

    closeSvgExportDialog();
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCancel() {
    closeSvgExportDialog();
  }

  function formatPageName(group) {
    const bookName = formatBookName(group.book, $bookAliases, 'full');
    return `${bookName} / Page ${group.page}`;
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div class="dialog-backdrop" on:click={handleCancel}></div>

  <!-- Dialog -->
  <div class="dialog">
    <div class="dialog-header">
      <h2>Export SVG</h2>
      <button class="close-btn" on:click={handleCancel} title="Cancel">&times;</button>
    </div>

    <div class="dialog-body">
      <!-- Summary -->
      <div class="summary">
        <div class="summary-item">
          <span class="summary-label">Strokes</span>
          <span class="summary-value">{totalStrokes}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Pages</span>
          <span class="summary-value">{pageGroups.length}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Files</span>
          <span class="summary-value">{pageGroups.length}</span>
        </div>
      </div>

      <!-- Stroke Width Control -->
      <div class="width-control">
        <label class="width-label" for="stroke-width">Stroke Width</label>
        <div class="width-input-row">
          <input
            id="stroke-width"
            type="range"
            min="0.1"
            max="4"
            step="0.1"
            bind:value={strokeWidth}
          />
          <input
            type="number"
            min="0.1"
            max="4"
            step="0.1"
            bind:value={strokeWidth}
            class="width-number"
          />
        </div>
        <div class="width-preview">
          <svg width="200" height="24" viewBox="0 0 200 24">
            <path
              d="M 10 12 C 50 4, 80 20, 120 12 S 170 4, 190 12"
              stroke="var(--text-primary)"
              stroke-width={strokeWidth}
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </div>

      <!-- Page List -->
      <div class="page-list">
        {#each pageGroups as group}
          <div class="page-item">
            <span class="page-name">{formatPageName(group)}</span>
            <span class="page-strokes">{group.strokes.length} strokes</span>
          </div>
        {/each}
      </div>

      {#if pageGroups.length > 1}
        <div class="info">
          Each page will be exported as a separate SVG file.
        </div>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-cancel" on:click={handleCancel}>Cancel</button>
      <button class="btn btn-confirm" on:click={handleExport} disabled={totalStrokes === 0}>
        Export {pageGroups.length} {pageGroups.length === 1 ? 'File' : 'Files'}
      </button>
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
    background: rgba(0, 0, 0, 0.7);
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
    min-width: 420px;
    max-width: 560px;
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
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
  }

  .summary {
    display: flex;
    gap: 24px;
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    margin-bottom: 20px;
  }

  .summary-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .summary-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--text-secondary);
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .summary-value {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .width-control {
    margin-bottom: 20px;
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
  }

  .width-label {
    display: block;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
  }

  .width-input-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .width-input-row input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }

  .width-number {
    width: 60px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 0.9rem;
    text-align: center;
  }

  .width-preview {
    margin-top: 10px;
    display: flex;
    justify-content: center;
    padding: 4px 0;
  }

  .page-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 240px;
    overflow-y: auto;
  }

  .page-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .page-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .page-strokes {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-family: 'Courier New', monospace;
  }

  .info {
    margin-top: 12px;
    padding: 10px 14px;
    background: rgba(33, 150, 243, 0.08);
    border: 1px solid rgba(33, 150, 243, 0.2);
    border-radius: 6px;
    color: var(--accent);
    font-size: 0.85rem;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-cancel {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-cancel:hover {
    background: var(--bg-tertiary);
  }

  .btn-confirm {
    background: var(--accent);
    color: white;
  }

  .btn-confirm:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .btn-confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  /* Scrollbar styling */
  .page-list::-webkit-scrollbar,
  .dialog-body::-webkit-scrollbar {
    width: 8px;
  }

  .page-list::-webkit-scrollbar-track,
  .dialog-body::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .page-list::-webkit-scrollbar-thumb,
  .dialog-body::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }

  .page-list::-webkit-scrollbar-thumb:hover,
  .dialog-body::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
