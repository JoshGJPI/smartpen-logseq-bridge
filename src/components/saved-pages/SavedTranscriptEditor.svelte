<!--
  SavedTranscriptEditor.svelte — edit a SAVED page's transcript in the Edit
  Transcription dialog (TranscriptionEditorModal), and write it straight to the
  PageDoc. Moved out of PageCard (v3.30.0) so the Editor's Transcripts tab
  (RetranscribePages) can offer Edit beside Re-transcribe; the Pages tab's ✏️ uses
  it as before.

  `open()` reads the page and opens the dialog; Save rebuilds the transcript
  (lib/editor-lines.js buildEditedTranscript: task state from disk where the
  dialog didn't change it, merged-away lines' ink to the survivor), relinks the
  deleted lines' ink (lib/deleted-ink.js relinkAfterEdit), writes through
  savePage() (atomic), brings the canvas copy in step (syncCanvasAfterPageWrite)
  and refreshes the reading views (refreshAfterSave). It dispatches `saved` with
  `{ lines }`. While the dialog is open the page is held like any transcript
  editor (`transcriptEditorHold()`), so Claude's edits are refused on it.
-->
<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { getPage } from '$lib/storage/local-store.js';
  import { markerField } from '$lib/tasks.js';
  import { buildEditedTranscript } from '$lib/editor-lines.js';
  import { relinkAfterEdit } from '$lib/deleted-ink.js';
  import { withKindBounds } from '$lib/line-kinds.js';
  import { refreshAfterSave } from '$lib/storage/refresh.js';
  import { isViewerPageDirty, transcriptEditorHold, syncCanvasAfterPageWrite, log } from '$stores';
  import TranscriptionEditorModal from '../dialog/TranscriptionEditorModal.svelte';

  export let book;
  /** The integer NCode page */
  export let page;
  /** The page's id on disk (with any letter suffix, e.g. "151b") */
  export let pageId = page;
  /** Out: the page is being read for the dialog */
  export let loading = false;

  const dispatch = createEventDispatcher();
  let visible = false;
  let lines = [];
  /** transcript.lines when the dialog opened, for keepDiskTaskState */
  let base = [];

  const hold = transcriptEditorHold();
  $: hold.set(`${book}:${pageId}`, visible);
  onDestroy(() => hold.release());

  export async function open() {
    loading = true;
    try {
      const doc = await getPage(book, pageId);
      if (!doc || !doc.transcript || !doc.transcript.lines || doc.transcript.lines.length === 0) {
        alert('No transcription found for this page. Please transcribe it first.');
        return;
      }
      base = doc.transcript.lines;
      // TranscriptLine → the dialog's line shape; blockUuid is the line id.
      lines = doc.transcript.lines.map((l) => ({
        text: l.text || '',
        canonical: (l.text || '').trim().toLowerCase(),
        yBounds: l.yBounds || { minY: 0, maxY: 0 },
        indentLevel: l.indentLevel || 0,
        blockUuid: l.id,
        checked: l.checked,
        ...markerField(l),
        parentId: l.parentId,
        syncStatus: 'synced'
      }));
      visible = true;
    } catch (error) {
      log(`Could not load the transcript of B${book}/P${pageId}: ${error.message}`, 'error');
      alert(`Failed to load transcription: ${error.message}`);
    } finally {
      loading = false;
    }
  }

  async function save(event) {
    const { lines: editedLines, deletedLineIds, deletedInk } = event.detail;
    // A Library draft on this page would write its own copy over this one.
    if (isViewerPageDirty(String(book), String(pageId))) {
      alert(`B${book}/P${pageId} has unsaved transcript edits in the Library. Save or cancel them first.`);
      return;
    }
    try {
      const doc = await getPage(book, pageId);
      if (!doc) {
        alert(`Could not load page file for B${book}/P${pageId}`);
        return;
      }
      const { lines: newLines, lineIdRemap } = buildEditedTranscript(editedLines, base, doc.transcript?.lines || [], randomId);
      // lineId remap, the deleted lines' ink (Not text or unlinked), other dead links scrubbed
      const relinked = relinkAfterEdit(doc.strokes,
        { liveIds: new Set(newLines.map((l) => l.id)), remap: lineIdRemap, deletedLineIds, deletedInk });
      const now = new Date().toISOString();
      const nextDoc = {
        ...doc,
        metadata: { ...(doc.metadata || {}), lastUpdated: now },
        transcript: { lastTranscribed: now, lines: withKindBounds(newLines, relinked.strokes) },
        strokes: relinked.strokes
      };
      // The dialog's result is the final transcript, so it is written as is
      // (savePageToFolder would merge it with the disk's).
      const { savePage } = await import('$lib/storage/local-store.js');
      await savePage(book, pageId, nextDoc);
      syncCanvasAfterPageWrite(book, pageId, { strokes: relinked.strokes, textlessIds: relinked.textless, unlinkedIds: relinked.unlinked });
      refreshAfterSave([{ book, pageId }])
        .catch((e) => log(`Could not refresh the Library after the save: ${e.message}`, 'warning'));
      visible = false;
      log(`Updated transcript for B${book}/P${pageId}: ${newLines.length} line(s)`, 'success');
      dispatch('saved', { lines: newLines });
    } catch (error) {
      log(`Could not save the transcript of B${book}/P${pageId}: ${error.message}`, 'error');
      alert(`Failed to save: ${error.message}`);
    }
  }

  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const a = new Uint8Array(16);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(a) : a.fill(Math.floor(Math.random() * 256)));
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    const hex = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
</script>

<TranscriptionEditorModal bind:visible {book} {page} {pageId} {lines} on:save={save} />
