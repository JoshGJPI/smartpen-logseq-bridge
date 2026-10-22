<!--
  ConvertTaskBoxesDialog.svelte — Settings → Data Folder → Convert task boxes…

  The one-off conversion of pages transcribed before task boxes were parsed
  (v3.3.0): `☐ Call Troy` stored as text becomes `Call Troy` with TODO state.
  Opening it only reads: pages whose scan text can hold a marker are read and
  planned (`lib/storage/convert-task-boxes.js`), and the preview lists every
  line it would change. Nothing is written until Convert. Each page is then read
  again, converted from what is on disk now, and written through savePage();
  the reading views are refreshed once at the end.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { savedPages, log, viewerDirty } from '$stores';
  import { getPage, savePage } from '$lib/storage/local-store.js';
  import { refreshAfterSave } from '$lib/storage/refresh.js';
  import {
    mightHaveTaskBoxes, planPageConversion, applyPageConversion, summarizeConversion
  } from '$lib/storage/convert-task-boxes.js';
  import { compareBookKeys } from '$lib/volumes.js';

  export let open = false;

  const dispatch = createEventDispatcher();

  /** 'idle' | 'planning' | 'ready' | 'writing' | 'done' */
  let phase = 'idle';
  let plans = [];
  let summary = summarizeConversion([]);
  let result = null;

  $: if (open && phase === 'idle') plan();

  async function plan() {
    phase = 'planning';
    const candidates = get(savedPages).filter((r) => mightHaveTaskBoxes(r.transcriptionText));
    const next = [];
    for (const r of candidates) {
      try {
        const doc = await getPage(r.book, r.pageId);
        const p = planPageConversion(doc);
        if (p.changes.length || p.conflicts.length) next.push({ book: r.book, pageId: r.pageId, ...p });
      } catch (err) {
        log(`Convert task boxes: could not read B${r.book}/P${r.pageId}: ${err.message}`, 'error');
      }
    }
    next.sort((a, b) => compareBookKeys(a.book, b.book)
      || a.pageId.localeCompare(b.pageId, undefined, { numeric: true }));
    plans = next;
    summary = summarizeConversion(plans);
    phase = 'ready';
  }

  async function convert() {
    phase = 'writing';
    const written = [];
    let lines = 0, skipped = 0, failed = 0;
    for (const p of plans) {
      if (!p.changes.length) continue;
      try {
        const doc = await getPage(p.book, p.pageId);
        if (!doc) throw new Error('page not found');
        const r = applyPageConversion(doc, p.changes);
        skipped += r.skipped;
        if (!r.applied) continue;
        await savePage(p.book, p.pageId, r.doc);
        lines += r.applied;
        written.push({ book: p.book, pageId: p.pageId });
      } catch (err) {
        failed++;
        log(`Convert task boxes: B${p.book}/P${p.pageId} failed: ${err.message}`, 'error');
      }
    }
    if (written.length) await refreshAfterSave(written);
    result = { lines, pages: written.length, skipped, failed };
    log(`Converted ${lines} task line${lines === 1 ? '' : 's'} on ${written.length} page${written.length === 1 ? '' : 's'}`
      + (skipped ? `, ${skipped} skipped (changed since the preview)` : '')
      + (failed ? `, ${failed} page${failed === 1 ? '' : 's'} failed` : ''), failed ? 'warning' : 'success');
    phase = 'done';
  }

  function close() {
    if (phase === 'planning' || phase === 'writing') return;
    open = false;
    phase = 'idle';
    plans = [];
    result = null;
    dispatch('close');
  }

  function handleKeyDown(event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  const label = (checked) => (checked ? 'DONE' : 'TODO');
  $: conflictRows = plans.flatMap((p) => p.conflicts.map((c) => ({ book: p.book, pageId: p.pageId, ...c })));
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <div class="dialog-backdrop" on:click={close} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="convert-boxes-title">
    <div class="dialog-header">
      <h2 id="convert-boxes-title">Convert task boxes in saved transcripts</h2>
      <button class="close-btn" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="dialog-body">
      {#if phase === 'planning'}
        <p class="note">Reading transcripts…</p>
      {:else if phase === 'done' && result}
        <p class="note">
          Converted {result.lines} line{result.lines === 1 ? '' : 's'} on {result.pages} page{result.pages === 1 ? '' : 's'}.
          {#if result.skipped}{result.skipped} skipped because the line changed since the preview.{/if}
          {#if result.failed}{result.failed} page{result.failed === 1 ? '' : 's'} failed; see the Activity Log.{/if}
        </p>
      {:else if summary.lines === 0 && !conflictRows.length}
        <p class="note">No saved transcript has a task box left in its text.</p>
      {:else}
        <p class="note">
          Found {summary.lines} task line{summary.lines === 1 ? '' : 's'} on {summary.pages} page{summary.pages === 1 ? '' : 's'}
          whose box is still part of the text ({summary.todo} TODO, {summary.done} DONE). The box moves into the line's
          state; the rest of each transcript is untouched.
        </p>
        <ul class="rows">
          {#each summary.rows as r (r.book + '/' + r.pageId + '/' + r.lineId)}
            <li>
              <span class="where">B{r.book}/{r.pageId}</span>
              <span class="tag" class:done={r.checked}>{label(r.checked)}</span>
              <span class="old" title={r.oldText}>{r.oldText}</span>
              <span class="arrow">→</span>
              <span class="new" title={r.newText}>{r.newText}</span>
            </li>
          {/each}
        </ul>
        {#if conflictRows.length}
          <p class="note">
            Left alone: {conflictRows.length} line{conflictRows.length === 1 ? '' : 's'} already marked the other way.
            The state set earlier is kept and the box stays in the text, so you can see they disagree.
          </p>
          <ul class="rows">
            {#each conflictRows as r (r.book + '/' + r.pageId + '/' + r.lineId)}
              <li>
                <span class="where">B{r.book}/{r.pageId}</span>
                <span class="tag" class:done={r.checked}>{label(r.checked)}</span>
                <span class="old" title={r.text}>{r.text}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <div class="dialog-footer">
      {#if $viewerDirty && phase === 'ready' && summary.lines}
        <span class="footer-note">Save or discard the open transcript edit first.</span>
      {/if}
      {#if phase === 'done' || phase === 'planning' || summary.lines === 0}
        <button class="btn btn-secondary" on:click={close} disabled={phase === 'planning'}>Close</button>
      {:else}
        <button class="btn btn-secondary" on:click={close} disabled={phase === 'writing'}>Cancel</button>
        <button class="btn btn-primary" on:click={convert} disabled={phase !== 'ready' || $viewerDirty}>
          {phase === 'writing' ? 'Converting…' : `Convert ${summary.lines} line${summary.lines === 1 ? '' : 's'}`}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 1000;
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
  }

  .dialog-header,
  .dialog-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
  }

  .dialog-header { justify-content: space-between; border-bottom: 1px solid var(--border); }
  .dialog-footer { justify-content: flex-end; border-top: 1px solid var(--border); }
  .dialog-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 1rem;
  }

  .dialog-body { padding: 14px 20px; overflow-y: auto; }
  .note { margin: 0 0 10px; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.45; }
  .footer-note { margin-right: auto; color: var(--warning); font-size: 0.8rem; }

  .rows {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    font-size: 0.82rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .rows li {
    display: grid;
    grid-template-columns: 82px 48px minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
    padding: 5px 10px;
    border-top: 1px solid var(--border);
  }

  .rows li:first-child { border-top: none; }
  .where { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .old { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .new { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .arrow { color: var(--text-secondary); }

  .tag {
    font-size: 0.7rem;
    font-weight: 600;
    text-align: center;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .tag.done { color: var(--success); }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-secondary); }
  .btn-primary { background: var(--success); color: var(--bg-primary); }
  .btn-primary:hover:not(:disabled) { background: #16a34a; }
</style>
