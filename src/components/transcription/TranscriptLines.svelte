<!--
  TranscriptLines.svelte — a page's transcript as read (not edited) in the
  Library: indented lines with TODO/DONE markers, or the empty state.

  Extracted from TranscriptPane (reading-first package D), which keeps the
  editor. Ink + text passes `onHoverLine` on pages whose stroke links can be
  trusted (lib/viewer/ink-text.js), and each line then lights its ink on the
  page; on other pages `linkNote` explains why there is no linking.

  Empty state: "Transcribe in Editor" only when MyScript is configured
  (transcribing is an Editor action: the button loads the page there, and the
  capture bar's Transcribe does the rest); otherwise it says where to add a key.
-->
<script>
  import { hasMyScriptCredentials } from '$stores';

  export let lines = [];
  /** (line|null) => void, or null when lines can't be linked to ink. */
  export let onHoverLine = null;
  /** Shown under the lines in Ink + text when linking is off. */
  export let linkNote = '';
  export let onAddTranscript = () => {};
  /** Loads the page into the Editor to transcribe it; null hides the button. */
  export let onTranscribe = null;

  let hotId = null;

  $: hasContent = lines.some((l) => (l.text || '').trim() !== '');

  function markerSymbol(checked) {
    if (checked === true) return '☑';
    if (checked === false) return '☐';
    return '•';
  }

  function hover(line) {
    if (!onHoverLine) return;
    hotId = line ? line.id : null;
    onHoverLine(line);
  }
</script>

{#if hasContent}
  <div class="tl" class:linked={!!onHoverLine} role="list" on:mouseleave={() => hover(null)}>
    {#each lines as line (line.id)}
      <div
        role="listitem"
        class="tl-line"
        class:hot={hotId === line.id}
        style="padding-left: {(line.indentLevel || 0) * 1.5}rem"
        on:mouseenter={() => hover(line)}
      >
        <span class="tl-marker" class:todo={line.checked === false} class:done={line.checked === true}>{markerSymbol(line.checked)}</span>
        <span class="tl-text" class:done={line.checked === true}>{line.text}</span>
      </div>
    {/each}
    {#if linkNote}
      <p class="tl-note">{linkNote}</p>
    {/if}
  </div>
{:else}
  <div class="tl-empty">
    <p>No transcript for this page yet.</p>
    {#if $hasMyScriptCredentials}
      <div class="tl-actions">
        {#if onTranscribe}
          <button class="tl-btn primary" on:click={() => onTranscribe()}
            title="Load this page into the Editor, where Transcribe in the capture bar sends it to MyScript">Transcribe in Editor</button>
        {/if}
        <button class="tl-btn" on:click={onAddTranscript}>Type one</button>
      </div>
    {:else}
      <p class="tl-sub">To transcribe handwriting, add your MyScript keys in Settings (gear) → MyScript Configuration.</p>
      <button class="tl-btn" on:click={onAddTranscript}>Type one</button>
    {/if}
  </div>
{/if}

<style>
  .tl-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-top: 1px;
    border-radius: 4px;
  }
  .linked .tl-line { cursor: default; }
  .linked .tl-line.hot { background: #eef3ff; }
  .tl-marker {
    flex-shrink: 0;
    color: #bbb;
    font-size: 13px;
    width: 1.1em;
    text-align: center;
  }
  .tl-marker.todo { color: #e07b00; }
  .tl-marker.done { color: #2e9e54; }
  .tl-text.done { color: #999; text-decoration: line-through; }
  .tl-note { margin: 14px 0 0; font-size: 12px; color: #999; line-height: 1.4; }

  .tl-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #999;
    padding: 32px 12px;
    text-align: center;
  }
  .tl-empty p { margin: 0; font-size: 14px; }
  .tl-empty .tl-sub { font-size: 12px; max-width: 34ch; line-height: 1.45; }
  .tl-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .tl-btn {
    padding: 4px 12px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
  }
  .tl-btn:hover { background: #f2f2f2; border-color: #ccc; }
  .tl-btn.primary { background: #4a7cf7; border-color: #4a7cf7; color: #fff; }
  .tl-btn.primary:hover { background: #3a6ce7; }
</style>
