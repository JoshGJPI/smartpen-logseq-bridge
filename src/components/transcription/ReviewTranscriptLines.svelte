<!--
  ReviewTranscriptLines.svelte — a transcription waiting in the Editor's Review,
  read as the Library reads a saved one (TranscriptLines), with the same hover
  copy: each top- and second-level line copies itself and everything under it,
  as LogSeq markdown (v3.10.0). The import → transcribe → copy flow no longer
  needs a save and a trip to the Library first.

  The lines are the run's own (or, after Edit Structure, the whole transcript
  the dialog returned), read through reviewLinesForCopy(): a drawn ☐ / ☑ or a
  typed TODO / DONE becomes the line's task state, as the save would make it,
  so the copy pastes `- TODO …`. Read only: these lines are not on disk, so no
  task box or ⋯ menu (task-state.js writes the PageDoc).
-->
<script>
  import { linesToLogseqMarkdown, subtreeLines, reviewLinesForCopy } from '$lib/viewer/transcript-markdown.js';
  import TranscriptLines from './TranscriptLines.svelte';

  /** Lines of one page's pending transcription (pageData.lines). */
  export let lines = [];
  /** For the log message only, e.g. "B388/P12". */
  export let label = '';

  $: shown = reviewLinesForCopy(lines);
  $: hasText = shown.some((l) => (l.text || '').trim() !== '');

  function copyBranch(i) {
    const branch = subtreeLines(shown, i);
    const n = branch.filter((l) => (l.text || '').trim() !== '').length;
    copyMarkdown(linesToLogseqMarkdown(branch),
      `"${(shown[i].text || '').trim()}" (${n} line${n === 1 ? '' : 's'}) from ${label}`);
  }
</script>

<script context="module">
  import { log as logMessage } from '$stores';

  /** Clipboard write with the log line the reader's copy writes too. */
  export async function copyMarkdown(md, what) {
    if (!md) {
      logMessage('Nothing to copy — transcript is empty', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(md);
      logMessage(`Copied ${what} to clipboard (LogSeq format)`, 'success');
    } catch {
      logMessage('Failed to copy to clipboard', 'error');
    }
  }
</script>

{#if hasText}
  <div class="review-lines">
    <TranscriptLines lines={shown} onCopyLine={copyBranch} />
  </div>
{:else}
  <p class="empty">No text</p>
{/if}

<style>
  .review-lines {
    max-height: 320px;
    overflow-y: auto;
    font-size: 0.85rem;
  }

  .empty {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
</style>
