<!--
  TaskBox.svelte — a task's tick box (v3.4.0): empty for TODO, ticked for
  DONE, dashed purple for WAITING, grey ✕ for CANCELLED. A click ticks /
  unticks (DONE ↔ TODO; a WAITING task is ticked DONE, a CANCELLED one reopens
  as TODO). `lock` (a reason) disables it with that
  tooltip: the page has an unsaved transcript draft.

  `variant="glyph"` draws it as the transcript's ☐ / ☑ / ◷ / ⊘ marker instead of
  a box, for the reader's read-only lines.
-->
<script>
  /** 'todo' | 'done' | 'waiting' | 'cancelled' */
  export let state = 'todo';
  /** () => void */
  export let onToggle = () => {};
  /** Why it can't be clicked, or '' */
  export let lock = '';
  /** 'box' | 'glyph' */
  export let variant = 'box';

  $: title = lock || (state === 'cancelled' ? 'Reopen as TODO' : state === 'done' ? 'Mark TODO' : 'Mark DONE');
  $: glyph = state === 'done' ? '☑' : state === 'waiting' ? '◷' : state === 'cancelled' ? '⊘' : '☐';
</script>

<button
  type="button"
  class="tb {variant}"
  class:done={state === 'done'}
  class:waiting={state === 'waiting'}
  class:cancelled={state === 'cancelled'}
  disabled={!!lock}
  role="checkbox"
  aria-checked={state === 'done'}
  aria-label={title}
  {title}
  on:click|stopPropagation={() => onToggle()}
>{#if variant === 'glyph'}{glyph}{:else if state === 'done'}✓{:else if state === 'cancelled'}✕{/if}</button>

<style>
  .tb {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .tb:disabled { cursor: not-allowed; opacity: 0.45; }

  .tb.box {
    width: 17px;
    height: 17px;
    margin-top: 1px;
    border: 2px solid #b8b8b8;
    border-radius: 4px;
    background: #fff;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }
  .tb.box:hover:not(:disabled) { border-color: #2f7d4f; }
  .tb.box.done { background: #2f7d4f; border-color: #2f7d4f; }
  .tb.box.waiting { border-color: #6d28d9; border-style: dashed; }
  .tb.box.cancelled { background: #9aa0a6; border-color: #9aa0a6; }

  .tb.glyph {
    width: 1.1em;
    border: none;
    background: none;
    color: #e07b00;
    font-size: 13px;
    text-align: center;
    border-radius: 3px;
  }
  .tb.glyph.done { color: #2e9e54; }
  .tb.glyph.waiting { color: #6d28d9; }
  .tb.glyph.cancelled { color: #8a8f98; }
  .tb.glyph:hover:not(:disabled) { background: #f1f1f4; transform: scale(1.15); }
  .tb:focus-visible { outline: 2px solid #4a7cf7; outline-offset: 1px; }
</style>
