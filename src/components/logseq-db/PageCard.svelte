<!--
  PageCard.svelte - Display a single smartpen page with import button

  Layout: a compact header row (icon · title · badge · expand arrow · Import button)
  with a collapsible transcript section beneath it (only when transcript data exists).
-->
<script>
  // v2.0: folder-backed Data Explorer (no more LogSeq calls)
  import { importStrokesFromFolder } from '$lib/storage/load-page.js';
  import { getPage } from '$lib/storage/local-store.js';
  import TranscriptionPreview from './TranscriptionPreview.svelte';
  import TranscriptionEditorModal from '../dialog/TranscriptionEditorModal.svelte';
  import SyncStatusBadge from './SyncStatusBadge.svelte';
  import {
    pageTranscriptions,
    clearPageTranscription,
    clearStrokeBlockUuids,
    getActiveStrokesForPageFromStore,
    log
  } from '$stores';

  export let page; // LogSeqPageData object

  let importing = false;
  let importProgress = { current: 0, total: 0 };
  let editedTranscription = page.transcriptionText || '';
  let showEditorModal = false;
  let editorLines = [];
  let loadingLines = false;
  let transcriptExpanded = false;

  // Update edited transcription when page changes
  $: editedTranscription = page.transcriptionText || '';

  // Convenience flag
  $: hasTranscription = !!(page.transcriptionText || editedTranscription);

  async function handleImport() {
    importing = true;
    importProgress = { current: 0, total: page.strokeCount || 0 };

    try {
      const result = await importStrokesFromFolder(page, (current, total) => {
        importProgress = { current, total };
      });
      console.log('Import complete:', result);
    } finally {
      importing = false;
      importProgress = { current: 0, total: 0 };
    }
  }

  function handleTranscriptionChange(event) {
    const newText = event.detail;
    editedTranscription = newText;

    const pageKey = `S0/O0/B${page.book}/P${page.page}`;

    let existingTranscription = null;
    for (const [key, trans] of $pageTranscriptions) {
      if (trans.pageInfo.book === page.book && trans.pageInfo.page === page.page) {
        existingTranscription = trans;
        break;
      }
    }

    const lines = newText.split('\n').map((line, index) => {
      const leadingSpaces = line.match(/^\s*/)[0].length;
      const indentLevel = Math.floor(leadingSpaces / 2);
      return {
        text: line.trimStart(),
        lineNumber: index,
        indentLevel,
        parent: null,
        children: []
      };
    });

    pageTranscriptions.update(pt => {
      const newMap = new Map(pt);
      if (existingTranscription) {
        newMap.set(pageKey, { ...existingTranscription, text: newText, lines });
      } else {
        newMap.set(pageKey, {
          text: newText,
          lines,
          pageInfo: { section: 0, owner: 0, book: page.book, page: page.page },
          strokeCount: page.strokeCount || 0,
          timestamp: Date.now()
        });
      }
      return newMap;
    });
  }

  async function handleOpenEditor() {
    loadingLines = true;
    try {
      // v2.0: read transcript directly from the PageDoc
      let doc = page.pageDoc;
      if (!doc) doc = await getPage(page.book, page.page);
      if (!doc || !doc.transcript || !doc.transcript.lines || doc.transcript.lines.length === 0) {
        alert('No transcription found for this page. Please transcribe it first.');
        return;
      }

      // Map TranscriptLine[] → editor's expected line shape.
      // blockUuid keeps the editor's existing semantics (stable line ID).
      editorLines = doc.transcript.lines.map(l => ({
        text: l.text || '',
        canonical: (l.text || '').trim().toLowerCase(),
        yBounds: l.yBounds || { minY: 0, maxY: 0 },
        indentLevel: l.indentLevel || 0,
        blockUuid: l.id,           // PageDoc TranscriptLine.id → editor blockUuid
        checked: l.checked,        // preserve TODO/DONE state
        parentId: l.parentId,
        syncStatus: 'synced'
      }));
      showEditorModal = true;
    } catch (error) {
      console.error('Failed to load transcript lines:', error);
      alert(`Failed to load transcription: ${error.message}`);
    } finally {
      loadingLines = false;
    }
  }

  /**
   * Reset transcript — strips blockUuid from all loaded strokes on this page
   * and clears any in-memory transcription entry so the page can be re-transcribed.
   * LogSeq blocks are not deleted; they will be overwritten on the next save.
   */
  function handleResetTranscript() {
    const pageStrokes = getActiveStrokesForPageFromStore(page.book, page.page);
    const timestamps = pageStrokes.map(s => s.startTime);

    if (timestamps.length > 0) {
      clearStrokeBlockUuids(timestamps);
    }

    for (const [key, trans] of $pageTranscriptions) {
      if (trans.pageInfo?.book === page.book && trans.pageInfo?.page === page.page) {
        clearPageTranscription(key);
        break;
      }
    }

    const strokeMsg = timestamps.length > 0
      ? `${timestamps.length} stroke(s) cleared for re-transcription`
      : 'no strokes loaded in session (import strokes first to clear block associations)';
    log(`Reset transcript for B${page.book}/P${page.page} — ${strokeMsg}`, 'info');
  }

  async function handleSaveEditor(event) {
    const { lines: editedLines } = event.detail;
    try {
      // v2.0: rewrite the PageDoc's transcript section and atomic-write the file.
      const doc = page.pageDoc || (await getPage(page.book, page.page));
      if (!doc) {
        alert(`Could not load page file for B${page.book}/P${page.page}`);
        return;
      }

      // Track which old line IDs survived so we can also fix up stroke.lineId
      // references when a line is merged into another (one survivor inherits).
      const oldLineIds = new Set((doc.transcript?.lines || []).map(l => l.id));

      // Build new TranscriptLine[] from editor output.
      // Editor's blockUuid is the stable line ID; preserve it for unchanged
      // lines so stroke.lineId references stay intact.
      const newLines = editedLines.map(l => ({
        id: l.blockUuid || randomId(),
        text: (l.text || '').trim(),
        indentLevel: l.indentLevel || 0,
        parentId: null, // recomputed below
        checked: l.checked ?? null,
        yBounds: l.yBounds && (l.yBounds.minY !== 0 || l.yBounds.maxY !== 0)
          ? { minY: l.yBounds.minY, maxY: l.yBounds.maxY }
          : null
      }));

      // Recompute parentId from indentLevel sequence (parent = nearest preceding
      // line with a lower indentLevel).
      for (let i = 0; i < newLines.length; i++) {
        const lvl = newLines[i].indentLevel;
        if (lvl === 0) {
          newLines[i].parentId = null;
        } else {
          for (let j = i - 1; j >= 0; j--) {
            if ((newLines[j].indentLevel || 0) < lvl) {
              newLines[i].parentId = newLines[j].id;
              break;
            }
          }
        }
      }

      // Handle merged lines: if an editor entry has blocksToDelete + survivor blockUuid,
      // redirect deleted-line strokes to the survivor.
      const lineIdRemap = new Map();
      for (const l of editedLines) {
        if (Array.isArray(l.blocksToDelete) && l.blockUuid) {
          for (const dead of l.blocksToDelete) {
            if (dead && dead !== l.blockUuid) lineIdRemap.set(dead, l.blockUuid);
          }
        }
      }

      // Apply lineId remap + scrub references to lines that no longer exist
      const liveIds = new Set(newLines.map(l => l.id));
      const updatedStrokes = (doc.strokes || []).map(s => {
        let lineId = s.lineId;
        if (lineId && lineIdRemap.has(lineId)) lineId = lineIdRemap.get(lineId);
        if (lineId && !liveIds.has(lineId)) lineId = null;
        return lineId === s.lineId ? s : { ...s, lineId };
      });

      const nextDoc = {
        ...doc,
        metadata: {
          ...(doc.metadata || {}),
          lastUpdated: new Date().toISOString()
        },
        transcript: {
          lastTranscribed: new Date().toISOString(),
          lines: newLines
        },
        strokes: updatedStrokes
      };

      // Editor edits already produced the final PageDoc shape, so we write
      // it directly via savePage (atomic) — bypassing savePageToFolder, which
      // would re-merge with on-disk content and clobber the handcrafted
      // transcript.
      const { savePage } = await import('$lib/storage/local-store.js');
      await savePage(page.book, page.page, nextDoc);

      page.pageDoc = nextDoc;
      editedTranscription = newLines.map(l => '  '.repeat(l.indentLevel || 0) + l.text).join('\n');
      page.syncStatus = 'synced';
      showEditorModal = false;
      log(`Updated transcript for B${page.book}/P${page.page}: ${newLines.length} line(s)`, 'success');
    } catch (error) {
      console.error('Failed to save transcription:', error);
      alert(`Failed to save: ${error.message}`);
    }
  }

  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const a = new Uint8Array(16);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(a) : a.fill(Math.floor(Math.random() * 256)));
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    const hex = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
</script>

<div class="page-card">

  <!-- ── Compact header row ─────────────────────────────────────────────── -->
  <div class="page-header">
    <span class="page-icon">📄</span>
    <span class="page-title">Page {page.page}</span>
    <SyncStatusBadge status={page.syncStatus} />
    <span class="spacer"></span>

    {#if hasTranscription}
      <button
        class="expand-btn"
        on:click={() => transcriptExpanded = !transcriptExpanded}
        title={transcriptExpanded ? 'Collapse transcript' : 'Expand transcript'}
        aria-expanded={transcriptExpanded}
      >
        {transcriptExpanded ? '▼' : '▶'}
      </button>
    {/if}

    <button
      class="import-btn"
      on:click={handleImport}
      disabled={importing}
    >
      {#if importing}
        <span class="spinner">⏳</span>
        {#if importProgress.total > 0}
          {importProgress.current}/{importProgress.total}
        {:else}
          Importing…
        {/if}
      {:else}
        Import Strokes
      {/if}
    </button>
  </div>

  <!-- ── Collapsible transcript section ────────────────────────────────── -->
  {#if transcriptExpanded && hasTranscription}
    <div class="transcription-section">
      <div class="section-header">
        <span class="section-label">Transcription:</span>
        <div class="section-actions">
          <button
            class="action-btn"
            on:click={handleOpenEditor}
            disabled={loadingLines}
            title="Edit line structure and merge/split lines"
          >
            {loadingLines ? '⏳' : 'Edit'}
          </button>
          <button
            class="action-btn action-btn--warning"
            on:click={handleResetTranscript}
            title="Reset transcript — removes block associations from strokes so this page can be re-transcribed (LogSeq blocks are not deleted)"
          >
            ↺ Reset
          </button>
        </div>
      </div>
      <TranscriptionPreview
        text={editedTranscription}
        on:change={handleTranscriptionChange}
      />
    </div>
  {/if}

</div>

<TranscriptionEditorModal
  bind:visible={showEditorModal}
  book={page.book}
  page={page.page}
  lines={editorLines}
  on:save={handleSaveEditor}
/>

<style>
  .page-card {
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    padding: 10px 14px;
  }

  .page-card:last-child {
    border-bottom: none;
  }

  /* ── Header row ─────────────────────────────────────────────────────── */

  .page-header {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .page-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .page-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spacer {
    flex: 1;
  }

  .expand-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 2px 5px;
    color: var(--text-tertiary);
    font-size: 0.65rem;
    cursor: pointer;
    border-radius: 3px;
    transition: color 0.15s, background 0.15s;
    line-height: 1;
  }

  .expand-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
  }

  .import-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    background: var(--accent-color, #2196f3);
    border: none;
    border-radius: 5px;
    color: white;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 500;
    transition: opacity 0.2s, transform 0.2s;
    white-space: nowrap;
  }

  .import-btn:hover:not(:disabled) {
    opacity: 0.88;
    transform: translateY(-1px);
  }

  .import-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* ── Transcript section ─────────────────────────────────────────────── */

  .transcription-section {
    margin-top: 8px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .section-label {
    font-size: 0.7rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: auto;
  }

  .section-actions {
    display: flex;
    gap: 5px;
  }

  .action-btn {
    padding: 3px 9px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 500;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
    border-color: rgba(255, 255, 255, 0.35);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-btn--warning {
    border-color: var(--warning, #f59e0b);
    color: var(--warning, #f59e0b);
  }

  .action-btn--warning:hover:not(:disabled) {
    background: var(--warning, #f59e0b);
    color: #1a1a1a;
    border-color: var(--warning, #f59e0b);
  }
</style>
