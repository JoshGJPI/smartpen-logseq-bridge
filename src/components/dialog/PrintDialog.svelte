<!--
  PrintDialog.svelte — Print (v3.8.0): to a PDF or to a printer. Opened with
  openPrintDialog(pages) from a reader page's printer menu or a grid's Select
  bar, or on the print list (openPrintList) from the header.

  Left, every notebook as an accordion (PrintPagePicker): click a page to add or
  remove it. Right, the pages in print order (PrintPageList: drag, ↑ ↓, ✕) and the
  options (PrintOptions): what prints (Strokes | Transcript | Both), the paper, and
  how pages sit on a sheet. Auto picks "2 per sheet, side by side" when every page
  still prints at 80% or more in half a landscape sheet (A5 notebooks on Letter),
  else one per sheet; the sketch shows the first sheet. Save PDF asks where to
  save; Print opens the Windows print dialog preset to the sheet (printer, copies,
  two-sided are chosen there). The choices are remembered (stores/print.js).

  Selected strokes: while the Editor has strokes selected, the left panel's
  first section offers them, one item per pen page, beside the notebooks' pages
  (the header's Print has already added them). They print from memory, so
  unsaved ink prints too, always as ink (Strokes) whatever the content choice.

  Preview (v3.9.0, PrintPreview): the job's own PDF in a third column, redrawn
  as pages and options change; Enlarge gives it the whole dialog body.
-->
<script>
  import { get } from 'svelte/store';
  import { savedPages, log } from '$stores';
  import { selectedStrokes } from '$stores/selection.js';
  import { destination } from '$stores/viewer.js';
  import { selectionItems } from '$lib/print/print-selection.js';
  import {
    printDialog, printOptions, closePrintDialog, previewSheet, printPagesToPdf, printPagesToPrinter,
    printDocTitle, setDialogPages, addToPrintList, clearPrintList
  } from '$stores/print.js';
  import { addRefs, removeRefs, isSelectionItem } from '$lib/print/print-list.js';
  import { plural } from '$lib/plural.js';
  import PrintPageList from './PrintPageList.svelte';
  import PrintPagePicker from './PrintPagePicker.svelte';
  import PrintOptions from './PrintOptions.svelte';
  import PrintPreview from './PrintPreview.svelte';

  /** null | 'pdf' | 'printer' */
  let busy = null;
  let progress = '';
  let sheet = null;
  let sheetFor = '';
  let expanded = false;

  $: open = $printDialog.open;
  // Page refs, and selected-strokes items that carry their strokes (print-list.js).
  $: refs = $printDialog.pages;
  $: fromList = $printDialog.fromList;
  $: opts = $printOptions;
  $: if (open) updateSheet(refs, opts);
  $: if (!open) expanded = false;
  $: pageRefs = refs.filter((r) => !isSelectionItem(r));
  $: untranscribed = open ? countUntranscribed(pageRefs, $savedPages) : 0;
  // The Editor's selection, offered in the left panel (copied while the dialog is up).
  $: canvasItems = open && $destination === 'editor' && $selectedStrokes.length
    ? selectionItems($selectedStrokes).items : [];

  async function updateSheet(r, o) {
    const key = JSON.stringify([r.map((x) => (isSelectionItem(x) ? x.key : `${x.book}/${x.pageId}`)), o.paper, o.layout, o.labels]);
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

  // Escape steps back out of an enlarged preview first, then closes.
  function onKey(e) {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (expanded) expanded = false;
    else close();
  }

  $: subtitle = !refs.length
    ? 'No pages yet'
    : `${printDocTitle(refs)} · ${refs.length} ${plural(refs.length, 'page')}`;
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="dialog-backdrop" on:click={close} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="print-title">
    <div class="dialog-header">
      <h2 id="print-title">{fromList ? 'Print list' : 'Print'}</h2>
      <span class="sub">{subtitle}</span>
      <button class="close-btn" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="dialog-body" class:expanded>
      {#if !expanded}
        <PrintPagePicker pages={refs} selectionItems={canvasItems} disabled={!!busy}
          onAdd={(r) => setDialogPages(addRefs(get(printDialog).pages, r))}
          onRemove={(r) => setDialogPages(removeRefs(get(printDialog).pages, r))} />
      {/if}

      <div class="main" hidden={expanded}>
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

        <PrintOptions {opts} {sheet} {untranscribed} pageCount={pageRefs.length}
          selectionCount={refs.length - pageRefs.length} />
      </div>

      <PrintPreview items={refs} {opts} {expanded} onToggleExpand={() => (expanded = !expanded)} />
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
    width: min(1400px, calc(100vw - 48px)); height: min(820px, 90vh);
    display: flex; flex-direction: column; z-index: 1001;
  }
  .dialog-header, .dialog-footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .dialog-header { border-bottom: 1px solid var(--border); }
  .dialog-footer { justify-content: flex-end; border-top: 1px solid var(--border); }
  .dialog-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .sub { flex: 1; min-width: 0; color: var(--text-secondary); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close-btn { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
  .dialog-body { flex: 1; min-height: 0; padding: 16px 20px; display: grid; grid-template-columns: 250px minmax(0, 1fr) minmax(300px, 1fr); gap: 16px; }
  .dialog-body.expanded { grid-template-columns: minmax(0, 1fr); }
  .main[hidden] { display: none; }
  .main { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
  .hint-empty { margin: -6px 0 0; color: var(--text-secondary); font-size: 0.8rem; }

  .progress { margin-right: auto; color: var(--text-secondary); font-size: 0.8rem; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-secondary); }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
</style>
