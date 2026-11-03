<!--
  PrintPreview.svelte — the Print dialog's preview (v3.9.0): the job's actual
  PDF, built by main exactly as Save PDF builds it (renderPreviewPdf) and drawn
  with pdf.js (pdf-sheets.js), one sheet at a time with ‹ › to step through.

  It re-renders 350 ms after the pages or options stop changing; one render runs
  at a time and only the newest waiting one follows it. The pages themselves are
  read once per dialog (stores/print.js `loaded`), so a change of line width or
  layout only rebuilds the document. Enlarge gives the preview the whole dialog.
-->
<script>
  import { onDestroy } from 'svelte';
  import { renderPreviewPdf } from '$stores/print.js';
  import { PAPER_SIZES } from '$lib/print/print-layout.js';
  import { refKey } from '$lib/print/print-list.js';
  import { isTypingTarget } from '$lib/left-panel.js';
  import { openPdf, drawSheet } from './pdf-sheets.js';

  /** [{ book, pageId }], or Print selection…'s pages */
  export let items = [];
  /** normalizePrintOptions() shape */
  export let opts;
  export let selection = false;
  export let expanded = false;
  /** () => void */
  export let onToggleExpand = () => {};

  const DEBOUNCE_MS = 350;

  /** 'idle' | 'rendering' | 'ready' | 'error' */
  let status = 'idle';
  let error = '';
  let doc = null;
  let sheet = null;
  let count = 0;
  let index = 0;
  let boxW = 0;
  let boxH = 0;
  let canvas;

  let wantKey = '';
  let timer = null;
  let running = false;
  let queued = null;
  let drawSeq = 0;

  $: request(items, opts, selection);
  $: if (doc && canvas && boxW > 0 && boxH > 0) draw(doc, index, boxW, boxH);

  function request(list, o, sel) {
    // openWhenDone only matters to Save PDF; it doesn't change the document.
    const key = JSON.stringify([sel, list.map(refKey), { ...o, openWhenDone: null }]);
    if (key === wantKey) return;
    wantKey = key;
    clearTimeout(timer);
    if (!list.length) {
      setDoc(null);
      sheet = null;
      status = 'idle';
      return;
    }
    status = 'rendering';
    timer = setTimeout(() => run({ list, o, sel, key }), DEBOUNCE_MS);
  }

  async function run(job) {
    if (running) {
      queued = job;
      return;
    }
    running = true;
    try {
      const res = await renderPreviewPdf(job.list, job.o, job.sel);
      if (job.key !== wantKey) return;
      const next = await openPdf(res.pdf);
      if (job.key !== wantKey) {
        next.destroy();
        return;
      }
      setDoc(next);
      sheet = res.sheet;
      count = next.numPages;
      index = Math.min(index, count - 1);
      status = 'ready';
    } catch (err) {
      if (job.key === wantKey) {
        status = 'error';
        error = err?.message || String(err);
      }
    } finally {
      running = false;
      if (queued) {
        const q = queued;
        queued = null;
        run(q);
      }
    }
  }

  function setDoc(next) {
    if (doc) doc.destroy();
    doc = next;
    if (!next) count = 0;
  }

  async function draw(d, i, w, h) {
    const seq = ++drawSeq;
    try {
      await drawSheet(d, i + 1, canvas, w - 24, h - 24, () => seq !== drawSeq || d !== doc);
    } catch {
      /* a document replaced mid-draw: the next draw has it */
    }
  }

  function step(delta) {
    index = Math.max(0, Math.min(count - 1, index + delta));
  }

  function onKey(e) {
    if (!count || e.defaultPrevented || isTypingTarget(e.target)) return;
    if (e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
  }

  onDestroy(() => {
    clearTimeout(timer);
    wantKey = '';
    setDoc(null);
  });

  $: caption = sheet ? `${PAPER_SIZES[sheet.paper].label.split(' (')[0]}, ${sheet.landscape ? 'landscape' : 'portrait'}` : '';
</script>

<svelte:window on:keydown={onKey} />

<section class="pv" aria-label="Preview">
  <div class="pv-bar">
    <span class="pv-title">Preview</span>
    {#if count}
      <button type="button" class="nav" disabled={index === 0} on:click={() => step(-1)} aria-label="Previous sheet" title="Previous sheet (Page Up)">‹</button>
      <span class="pv-count">Sheet {index + 1} of {count}</span>
      <button type="button" class="nav" disabled={index >= count - 1} on:click={() => step(1)} aria-label="Next sheet" title="Next sheet (Page Down)">›</button>
    {/if}
    <span class="pv-cap">{caption}</span>
    <button type="button" class="pv-btn" on:click={onToggleExpand}>{expanded ? 'Back to options' : 'Enlarge'}</button>
  </div>
  <div class="pv-box" bind:clientWidth={boxW} bind:clientHeight={boxH}>
    {#if doc}
      <canvas bind:this={canvas} class:dim={status === 'rendering'}></canvas>
    {/if}
    {#if status === 'rendering'}
      <span class="pv-msg" role="status">Rendering…</span>
    {:else if status === 'error'}
      <span class="pv-msg err" role="alert">Preview failed: {error}</span>
    {:else if !items.length}
      <span class="pv-msg">Add pages to see them here.</span>
    {/if}
  </div>
</section>

<style>
  .pv { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .pv-bar { display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 10px; background: var(--bg-secondary); font-size: 0.8rem; }
  .pv-title { font-weight: 600; color: var(--text-primary); margin-right: 4px; }
  .pv-count { color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .pv-cap { flex: 1; min-width: 0; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav {
    width: 22px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: 5px;
    background: var(--bg-primary); color: var(--text-primary); cursor: pointer; line-height: 1;
  }
  .nav:disabled { opacity: 0.35; cursor: default; }
  .pv-btn {
    padding: 2px 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-primary);
    color: var(--text-primary); font-size: 0.75rem; cursor: pointer; white-space: nowrap;
  }
  .pv-box { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: var(--bg-tertiary); overflow: hidden; }
  canvas { display: block; background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); transition: opacity 0.15s; }
  canvas.dim { opacity: 0.55; }
  .pv-msg {
    position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 4px 10px; border-radius: 99px;
    background: var(--bg-primary); color: var(--text-secondary); font-size: 0.78rem; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .pv-msg.err { color: var(--error, #e66); max-width: 90%; }
</style>
