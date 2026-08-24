<!--
  SketchStylePopover.svelte — the sketch render profile, next to the strokes it restyles.

  SketchStyleSettings used to live in the settings dropdown, where its live
  preview was the only thing you could see: the canvas was behind a panel on the
  other side of the window. Anchored to the canvas toolbar instead, the preview
  and the actual sketch strokes are on screen together, which is the whole point
  of a calibration control.

  Opens upward — the button sits on the bar below the canvas.
-->
<script>
  import { sketchProfileSummary, sketchStrokeCount } from '$stores';
  import SketchStyleSettings from '../settings/SketchStyleSettings.svelte';

  let isOpen = false;
  let wrapper;

  function toggle() {
    isOpen = !isOpen;
  }

  function close() {
    isOpen = false;
  }

  function handleWindowClick(event) {
    if (isOpen && wrapper && !wrapper.contains(event.target)) close();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation();
      close();
    }
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleKeydown} />

<div class="sketch-style" bind:this={wrapper}>
  <button
    class="style-btn"
    class:active={isOpen}
    on:click|stopPropagation={toggle}
    title={`Sketch line thickness — ${$sketchProfileSummary}`}
    aria-haspopup="dialog"
    aria-expanded={isOpen}
  >
    🎚 Style…
  </button>

  {#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="popover" on:click|stopPropagation role="dialog" aria-label="Sketch style">
      <div class="popover-head">
        <span class="popover-title">Sketch Style</span>
        <button class="close-btn" on:click={close} aria-label="Close">✕</button>
      </div>

      <SketchStyleSettings />

      <p class="popover-note">
        Affects how every sketch stroke is drawn — a display setting, never saved
        into your pages.
        {#if $sketchStrokeCount === 0}
          Mark some strokes as sketches to see it on the canvas.
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .sketch-style {
    position: relative;
    display: inline-flex;
  }

  .style-btn {
    padding: 6px 10px;
    font-size: 0.75rem;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .style-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .style-btn.active {
    border-color: var(--accent);
    background: var(--bg-tertiary);
  }

  .popover {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: 340px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    z-index: 200;
  }

  /* Keep it on screen when the button is near the right edge of the window. */
  @media (max-width: 900px) {
    .popover {
      left: auto;
      right: 0;
    }
  }

  .popover-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .popover-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .popover-note {
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 0.68rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
</style>
