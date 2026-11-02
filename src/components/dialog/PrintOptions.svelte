<!--
  PrintOptions.svelte — the Print dialog's options and first-sheet sketch: what
  prints (Strokes | Transcript | Both), paper, layout, ink size, line weight,
  ruling, labels. Every choice writes straight to `printOptions` (remembered).

  `selection` (Print selection…, v3.8.0): content is locked to Strokes, since a
  saved transcript can't be matched to selected ink; the remembered choice is
  left as it is for the next page print.
-->
<script>
  import { setPrintOptions } from '$stores/print.js';
  import { PAPER_SIZES, PAPER_IDS, LAYOUTS, layoutLabel } from '$lib/print/print-layout.js';
  import { plural } from '$lib/plural.js';

  /** normalizePrintOptions() shape, already content-locked for a selection */
  export let opts;
  /** the resolved first sheet, or null while it is worked out */
  export let sheet = null;
  /** how many ink figures the job has (for the sketch) */
  export let pageCount = 0;
  /** pages with no transcript (for the warning beside Transcript / Both) */
  export let untranscribed = 0;
  export let selection = false;

  const CONTENT_CHOICES = [['strokes', 'Strokes'], ['transcript', 'Transcript'], ['both', 'Both']];

  // The sheet sketch: at most 120 px on its long side.
  $: sk = sheet ? 120 / Math.max(sheet.widthIn, sheet.heightIn) : 0;
  $: cols = sheet ? Array.from({ length: sheet.columns }, (_, i) => columnKind(i, opts.content, pageCount)) : [];
  function columnKind(i, content, n) {
    if (content === 'transcript') return 'text';
    if (content === 'both' && i === 1) return 'text';
    return i < n ? 'ink' : 'blank';
  }
</script>

<div class="opts">
  <div class="form">
    <div class="row">
      <span class="lbl" id="print-content">Print</span>
      {#if selection}
        <span class="fixed">The selected strokes, on their pages (no transcript)</span>
      {:else}
        <div class="seg" role="group" aria-labelledby="print-content">
          {#each CONTENT_CHOICES as [id, text] (id)}
            <button type="button" class:on={opts.content === id} aria-pressed={opts.content === id}
              on:click={() => setPrintOptions({ content: id })}>{text}</button>
          {/each}
        </div>
      {/if}
    </div>
    {#if opts.content !== 'strokes' && untranscribed}
      <p class="hint">{untranscribed} of {pageCount} {plural(pageCount, 'page')} {untranscribed === 1 ? 'has' : 'have'} no transcript{opts.content === 'both' ? ' and print ink only' : ''}.</p>
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

<style>
  .opts { display: flex; gap: 20px; align-items: flex-start; }
  .form { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: center; gap: 12px; }
  .lbl { width: 84px; flex-shrink: 0; color: var(--text-secondary); font-size: 0.85rem; }
  .fixed { color: var(--text-primary); font-size: 0.85rem; }
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
</style>
