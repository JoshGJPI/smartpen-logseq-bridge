<!--
  SelectionTranscriptMenu.svelte — the Editor's ⋯ for the selected strokes
  (v3.20.0), also opened by right-clicking the canvas (StrokeCanvas calls
  openAt): Leave out of transcripts / Include in transcripts, the "Not text"
  flag (stores/textless.js, docs/TRANSCRIPT-STRUCTURE-SPEC.md A.3).

  Left-out strokes are never sent to MyScript and are in no line; the flag is
  in the PageDoc, so it is an unsaved change until Save (a modification in the
  save dialog). Taking strokes back in leaves them unlinked, so the next
  Transcribe sends them.

  The menu is position: fixed, so the toolbar's scrolling strip can't clip it.
  Escape closes it before the canvas sees the key.
-->
<script>
  import { strokes } from '$stores/strokes.js';
  import { selectedIndices } from '$stores/selection.js';
  import { log } from '$stores/ui.js';
  import { setStrokesTextless, countTextless } from '$stores/textless.js';
  import { plural } from '$lib/plural.js';

  let btnEl;
  let menuEl;
  /** { x, y } of the open menu, else null */
  let at = null;

  $: counts = countTextless($strokes, $selectedIndices);
  $: hasSelection = counts.textless + counts.other > 0;

  /** Open at the pointer (the canvas's right-click). */
  export function openAt(e) {
    e.preventDefault();
    at = place(e.clientX, e.clientY);
  }

  function toggle() {
    if (at) { at = null; return; }
    const r = btnEl.getBoundingClientRect();
    at = place(r.left, r.bottom + 4);
  }

  // Kept on screen: the menu is ~240 × 80 px.
  function place(x, y) {
    return { x: Math.max(8, Math.min(x, window.innerWidth - 248)), y: Math.max(8, Math.min(y, window.innerHeight - 96)) };
  }

  function apply(on) {
    at = null;
    const n = setStrokesTextless($selectedIndices, on);
    if (n === 0) return;
    log(on
      ? `Left ${n} ${plural(n, 'stroke')} out of transcripts (Not text): Transcribe won't send ${n === 1 ? 'it' : 'them'}. Save to keep it.`
      : `Took ${n} ${plural(n, 'stroke')} back into transcripts: the next Transcribe sends ${n === 1 ? 'it' : 'them'}. Save to keep it.`, 'info');
  }

  function onWindowPointer(e) {
    if (at && !btnEl?.contains(e.target) && !menuEl?.contains(e.target)) at = null;
  }

  function onWindowKey(e) {
    if (!at || e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    at = null;
  }
</script>

<svelte:window
  on:pointerdown={onWindowPointer}
  on:keydown|capture={onWindowKey}
  on:scroll|capture={() => (at = null)}
  on:resize={() => (at = null)}
/>

<button
  type="button"
  class="stm-btn"
  class:open={!!at}
  bind:this={btnEl}
  on:click|stopPropagation={toggle}
  disabled={!hasSelection}
  title={hasSelection ? 'More for the selected strokes: leave them out of transcripts, or take them back in (also right-click the canvas)' : 'Select strokes first'}
  aria-haspopup="menu"
  aria-expanded={!!at}
>⋯</button>

{#if at}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="stm-menu" bind:this={menuEl} style="left: {at.x}px; top: {at.y}px;" role="menu" tabindex="-1" aria-label="Selected strokes"
    on:click|stopPropagation>
    <div class="stm-label">{hasSelection ? `${counts.textless + counts.other} selected ${plural(counts.textless + counts.other, 'stroke')}` : 'No strokes selected'}</div>
    <button class="stm-item" role="menuitem" on:click={() => apply(true)} disabled={counts.other === 0}
      title="Not text: never send these strokes to MyScript, and take them out of their transcript line">
      Leave out of transcripts{#if counts.other > 0}<span class="stm-n">{counts.other}</span>{/if}
    </button>
    <button class="stm-item" role="menuitem" on:click={() => apply(false)} disabled={counts.textless === 0}
      title="Send these strokes to MyScript again on the next Transcribe">
      Include in transcripts{#if counts.textless > 0}<span class="stm-n">{counts.textless}</span>{/if}
    </button>
  </div>
{/if}

<style>
  /* .tb-btn's look comes from StrokeCanvas's toolbar; repeated here because
     Svelte scopes styles per component. */
  .stm-btn {
    padding: 4px 10px;
    font-size: 0.85rem;
    line-height: 1;
    font-family: inherit;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
  }
  .stm-btn:hover:not(:disabled), .stm-btn.open { border-color: var(--text-secondary); background: var(--bg-secondary); }
  .stm-btn:disabled { opacity: 0.45; cursor: not-allowed; background: transparent; color: var(--text-secondary); }
  .stm-menu {
    position: fixed;
    z-index: 1000;
    min-width: 220px;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .stm-label {
    padding: 4px 8px 5px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .stm-item {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    font-size: 0.75rem;
    font-family: inherit;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  .stm-item:hover:not(:disabled) { background: var(--bg-tertiary); }
  .stm-item:disabled { opacity: 0.45; cursor: not-allowed; }
  .stm-n { color: var(--text-secondary); }
</style>
