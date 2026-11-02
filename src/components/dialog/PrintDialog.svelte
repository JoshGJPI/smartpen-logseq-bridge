<!--
  PrintDialog.svelte — Print (v3.8.0): to a PDF or to a printer. Opened with
  openPrintDialog(pages) from a reader page's printer menu or a grid's Select
  bar, or on the print list (openPrintList) from the header.

  Left, every notebook as an accordion (PrintPagePicker): click a page to add or
  remove it. Right, the pages in print order (PrintPageList: drag, ↑ ↓, ✕) and the
  options: what prints (Strokes | Transcript | Both), the paper, and how pages
  sit on a sheet. Auto picks "2 per sheet, side by side" when every page still
  prints at 80% or more in half a landscape sheet (A5 notebooks on Letter), else
  one per sheet; the sketch shows the first sheet. Save PDF asks where to save;
  Print opens the Windows print dialog preset to the sheet (printer, copies,
  two-sided are chosen there). The choices are remembered (stores/print.js).
-->
<script>
  import { get } from 'svelte/store';
  import { savedPages, log } from '$stores';
  import {
    printDialog, printOptions, setPrintOptions, closePrintDialog, previewSheet, printPagesToPdf, printPagesToPrinter,
    printDocTitle, setDialogPages, addToPrintList, clearPrintList
  } from '$stores/print.js';
  import { PAPER_SIZES, PAPER_IDS, LAYOUTS, layoutLabel } from '$lib/print/print-layout.js';
  import { addRefs, removeRefs } from '$lib/print/print-list.js';
  import { plural } from '$lib/plural.js';
  import PrintPageList from './PrintPageList.svelte';
  import PrintPagePicker from './PrintPagePicker.svelte';

  const CONTENT_CHOICES = [['strokes', 'Strokes'], ['transcript', 'Transcript'], ['both', 'Both']];

  /** null | 'pdf' | 'printer' */
  let busy = null;
  let progress = '';
  let sheet = null;
  let sheetFor = '';

  $: open = $printDialog.open;
  $: refs = $printDialog.pages;
  $: fromList = $printDialog.fromList;
  $: opts = $printOptions;
  $: if (open) updateSheet(refs, opts);
  $: untranscribed = open ? countUntranscribed(refs, $savedPages) : 0;

  async function updateSheet(r, o) {
    const key = JSON.stringify([r, o.paper, o.layout, o.labels]);
    sheetFor = key;
    try {
      const s = await previewSheet(r, o);
      if (sheetFor === key) sheet = s;
    } catch {
      if (sheetFor === key) sheet = null;
    }
  }

  function countUntranscribed(r, records) {
    const done = new Set((records || []).filter((x) => x.transcribed).map((x) => `${x.book}/${x.pageId}`));
    return r.filter((x) => !done.has(`${x.book}/${x.pageId}`)).length;
  }

  const onProgress = (done, total) => {
    progress = total > 1 ? `Reading page ${Math.min(done + 1, total)} of ${total}…` : 'Preparing…';
  };

  async function run(kind) {
    busy = kind;
    progress = 'Preparing…';
    const n = `${refs.length} ${plural(refs.length, 'page')}`;
    try {
      if (kind === 'pdf') {
        const res = await printPagesToPdf(refs, get(printOptions), onProgress);
        if (res && res.canceled) return;
        log(`Saved PDF of ${n}: ${res.path}`, 'success');
        closePrintDialog();
      } else {
        progress = 'Waiting for the print dialog…';
        const res = await printPagesToPrinter(refs, get(printOptions), onProgress);
        if (res.printed) {
          log(`Sent ${n} to the printer`, 'success');
          closePrintDialog();
        } else if (res.reason !== 'cancelled') {
          log(`Printing failed: ${res.reason}`, 'error');
        }
      }
    } catch (err) {
      log(`${kind === 'pdf' ? 'Print to PDF' : 'Printing'} failed: ${err?.message || err}`, 'error');
    } finally {
      busy = null;
      progress = '';
    }
  }

  function close() {
    if (!busy) closePrintDialog();
  }

  function onKey(e) {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  // The sheet sketch: at most 120 px on its long side.
  $: sk = sheet ? 120 / Math.max(sheet.widthIn, sheet.heightIn) : 0;
  $: cols = sheet ? Array.from({ length: sheet.columns }, (_, i) => columnKind(i)) : [];
  function columnKind(i) {
    if (opts.content === 'transcript') return 'text';
    if (opts.content === 'both' && i === 1) return 'text';
    return i < refs.length ? 'ink' : 'blank';
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="dialog-backdrop" on:click={close} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="print-title">
    <div class="dialog-header">
      <h2 id="print-title">{fromList ? 'Print list' : 'Print'}</h2>
      <span class="sub">{refs.length ? `${printDocTitle(refs)} · ${refs.length} ${plural(refs.length, 'page')}` : 'No pages yet'}</span>
      <button class="close-btn" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="dialog-body">
      <PrintPagePicker pages={refs} disabled={!!busy}
        onAdd={(r) => setDialogPages(addRefs(get(printDialog).pages, r))}
        onRemove={(r) => setDialogPages(removeRefs(get(printDialog).pages, r))} />

      <div class="main">
        <PrintPageList pages={refs} disabled={!!busy} onChange={setDialogPages}>
          {#if fromList}
            <button type="button" disabled={!!busy || !refs.length} on:click={clearPrintList}>Clear list</button>
          {:else}
            <button type="button" disabled={!!busy || !refs.length} title="Keep these pages in the header's Print list for later"
              on:click={() => addToPrintList(refs)}>Save as print list</button>
          {/if}
        </PrintPageList>
        {#if !refs.length}
          <p class="hint-empty">Pick pages from the notebooks on the left.</p>
        {/if}

        <div class="opts">
          <div class="form">
            <div class="row">
              <span class="lbl" id="print-content">Print</span>
              <div class="seg" role="group" aria-labelledby="print-content">
                {#each CONTENT_CHOICES as [id, text] (id)}
                  <button type="button" class:on={opts.content === id} aria-pressed={opts.content === id}
                    on:click={() => setPrintOptions({ content: id })}>{text}</button>
                {/each}
              </div>
            </div>
            {#if opts.content !== 'strokes' && untranscribed}
              <p class="hint">{untranscribed} of {refs.length} {plural(refs.length, 'page')} {untranscribed === 1 ? 'has' : 'have'} no transcript{opts.content === 'both' ? ' and print ink only' : ''}.</p>
            {/if}

            <label class="row">
              <span class="lbl">Paper</span>
              <select value={opts.paper} on:change={(e) => setPrintOptions({ paper: e.currentTarget.value })}>
                {#each PAPER_IDS as id (id)}<option value={id}>{PAPER_SIZES[id].label}</option>{/each}
              </select>
            </label>

            <label class="row">
              <span class="lbl">Layout</span>
              <select value={opts.layout} on:change={(e) => setPrintOptions({ layout: e.currentTarget.value })}>
                {#each LAYOUTS as l (l.id)}
                  <option value={l.id}>{l.id === 'auto' && sheet ? `Auto (${layoutLabel(sheet.layout)})` : l.label}</option>
                {/each}
              </select>
            </label>

            {#if opts.content !== 'transcript'}
              <label class="row">
                <span class="lbl">Ink size</span>
                <select value={opts.inkScale} on:change={(e) => setPrintOptions({ inkScale: e.currentTarget.value })}>
                  <option value="fit">Fit to the space</option>
                  <option value="actual">Actual size (smaller only if it won't fit)</option>
                </select>
              </label>
              <label class="row">
                <span class="lbl">Line weight</span>
                <select value={opts.lineWeight} on:change={(e) => setPrintOptions({ lineWeight: e.currentTarget.value })}>
                  <option value="fine">Fine</option>
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </label>
              <label class="check">
                <input type="checkbox" checked={opts.background} on:change={(e) => setPrintOptions({ background: e.currentTarget.checked })} />
                Print the notebook's ruling (page background)
              </label>
            {/if}
            <label class="check">
              <input type="checkbox" checked={opts.labels} on:change={(e) => setPrintOptions({ labels: e.currentTarget.checked })} />
              Label each page (notebook, page, date written)
            </label>
            <label class="check">
              <input type="checkbox" checked={opts.openWhenDone} on:change={(e) => setPrintOptions({ openWhenDone: e.currentTarget.checked })} />
              Open the PDF when it's saved
            </label>
          </div>

          {#if sheet}
            <figure class="sketch" aria-label="First sheet">
              <div class="sheet" style="width:{sheet.widthIn * sk}px;height:{sheet.heightIn * sk}px;padding:{sheet.marginIn * sk}px;gap:{sheet.gutterIn * sk}px">
                {#each cols as kind, i (i)}
                  <div class="col {kind}">{#if kind === 'text'}{#each Array(9) as _, j (j)}<i style="width:{55 + ((j * 37) % 40)}%"></i>{/each}{/if}</div>
                {/each}
              </div>
              <figcaption>{PAPER_SIZES[sheet.paper].label.split(' (')[0]}, {sheet.landscape ? 'landscape' : 'portrait'}</figcaption>
            </figure>
          {/if}
        </div>
      </div>
    </div>

    <div class="dialog-footer">
      {#if busy}<span class="progress" role="status">{progress}</span>{/if}
      <button class="btn btn-secondary" on:click={close} disabled={!!busy}>Cancel</button>
      <button class="btn btn-secondary" on:click={() => run('printer')} disabled={!!busy || !refs.length}
        title="Opens the Windows print dialog: choose the printer, copies and two-sided there">{busy === 'printer' ? 'Printing…' : 'Print…'}</button>
      <button class="btn btn-primary" on:click={() => run('pdf')} disabled={!!busy || !refs.length}>{busy === 'pdf' ? 'Saving…' : 'Save PDF…'}</button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 1000; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: var(--bg-primary); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    width: min(980px, calc(100vw - 48px)); height: min(760px, 88vh);
    display: flex; flex-direction: column; z-index: 1001;
  }
  .dialog-header, .dialog-footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .dialog-header { border-bottom: 1px solid var(--border); }
  .dialog-footer { justify-content: flex-end; border-top: 1px solid var(--border); }
  .dialog-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .sub { flex: 1; min-width: 0; color: var(--text-secondary); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close-btn { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
  .dialog-body { flex: 1; min-height: 0; padding: 16px 20px; display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 18px; }
  .main { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
  .opts { display: flex; gap: 20px; align-items: flex-start; }
  .hint-empty { margin: -6px 0 0; color: var(--text-secondary); font-size: 0.8rem; }
  .form { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: center; gap: 12px; }
  .lbl { width: 84px; flex-shrink: 0; color: var(--text-secondary); font-size: 0.85rem; }
  select {
    flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg-secondary); color: var(--text-primary); font-size: 0.85rem;
  }
  .seg { display: flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
  .seg button {
    padding: 5px 14px; border: none; background: var(--bg-secondary); color: var(--text-secondary);
    font-size: 0.85rem; cursor: pointer;
  }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button:hover { color: var(--text-primary); }
  .seg button.on { background: var(--selected-bg); color: var(--text-primary); box-shadow: inset 0 -2px 0 var(--selected-line); }
  .check { display: flex; align-items: center; gap: 8px; color: var(--text-primary); font-size: 0.85rem; cursor: pointer; }
  .hint { margin: -4px 0 0 96px; color: var(--warning); font-size: 0.78rem; }

  .sketch { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; }
  .sketch figcaption { color: var(--text-secondary); font-size: 0.75rem; }
  .sheet { box-sizing: border-box; display: flex; background: #fff; border-radius: 2px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); }
  .col { flex: 1; min-width: 0; }
  .col.ink { background: #d9dce6; border-radius: 2px; }
  .col.text { display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }
  .col.text i { display: block; height: 3px; background: #b5bac8; border-radius: 1px; }

  .progress { margin-right: auto; color: var(--text-secondary); font-size: 0.8rem; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-secondary); }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
</style>
