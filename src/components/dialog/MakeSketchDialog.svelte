<!--
  MakeSketchDialog.svelte — Make sketch (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md
  E.3, the mockup Josh approved 2026-11-20). Opened from the Editor's selection ⋯
  (stores/sketch-lines.js openMakeSketchFromSelection) or after a Mark sketch box
  in the Library reader (openMakeSketch).

  A label (empty = "Sketch"), the page's tags as chips that fill the label, Also
  draw with pen pressure (Pressure ink, `sketch: true`, off by default), a
  preview of the ink, and where the sketch line will go (lib/viewer/sketch-lines.js
  previewPlacement: under the nearest text line above its ink, one level deeper,
  on a page whose links can be trusted; else at the end). A selection over
  several pages makes one sketch per page, each with the same label.

  Make sketch writes at once, page by page, through saveSketchLine (runSketch);
  nothing waits for Save.
-->
<script>
  import { get } from 'svelte/store';
  import { sketchDialog, closeSketchDialog, runSketch } from '$stores/sketch-lines.js';
  import { pageTags, tagInfo } from '$stores/tags.js';
  import { pageOrientations } from '$stores/orientation.js';
  import { getPage } from '$lib/storage/local-store.js';
  import { previewPlacement } from '$lib/viewer/sketch-lines.js';
  import { generateThumbnailSVG } from '$lib/viewer/page-svg.js';
  import { rotationFor } from '$lib/page-orientation.js';
  import { tagKey, tagLabel } from '$lib/tags.js';
  import { sketchLabel } from '$lib/line-kinds.js';
  import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';
  import { plural } from '$lib/plural.js';
  import TagChip from '../tags/TagChip.svelte';

  let label = '';
  let pressure = false;
  let busy = false;
  /** Per page: { book, pageId, ids, svg, place, trusted, tags, error } */
  let pages = [];
  let openedFor = null;
  let field;

  $: if ($sketchDialog !== openedFor) open($sketchDialog);

  async function open(d) {
    openedFor = d;
    label = '';
    pressure = false;
    busy = false;
    pages = [];
    if (!d) return;
    const out = [];
    for (const p of d.pages) {
      const rot = rotationFor(get(pageOrientations), p.book, p.pageId);
      const tags = get(pageTags)[tagKey(p.book, p.pageId)] || [];
      try {
        const doc = await getPage(p.book, p.pageId);
        if (!doc) { out.push({ ...p, tags, error: 'not found' }); continue; }
        const want = new Set(p.ids);
        out.push({
          ...p, tags,
          svg: generateThumbnailSVG((doc.strokes || []).filter((s) => want.has(s.id)), 200, 160, undefined, rot),
          place: previewPlacement(doc, p.ids, rot),
          trusted: isTrustworthyTranscript(doc)
        });
      } catch (err) {
        out.push({ ...p, tags, error: err?.message || String(err) });
      }
    }
    if (openedFor === d) {
      pages = out;
      setTimeout(() => field && field.focus(), 0);
    }
  }

  $: allTags = [...new Set(pages.flatMap((p) => p.tags || []))];
  $: shown = sketchLabel(label);

  function addTag(t) {
    const name = tagLabel(t, $tagInfo);
    label = label.trim() ? `${label.trim()} ${name}` : name;
    field && field.focus();
  }

  function placeText(p) {
    if (!p.trusted) return 'at the end of the transcript (this page’s lines aren’t linked to its ink, so its place can’t be told; move it in Library Edit)';
    if (!p.place) return 'at the start of the transcript (no text line above it)';
    const t = p.place.text.length > 50 ? `${p.place.text.slice(0, 49)}…` : p.place.text;
    return `under #${p.place.n} “${t}”, one level deeper`;
  }

  async function make() {
    if (busy) return;
    busy = true;
    const d = openedFor;
    let failed = 0;
    for (const p of pages) {
      if (p.error) continue;
      const r = await runSketch(p.book, p.pageId, { op: 'create', strokeIds: p.ids, label, pressure });
      if (r.error) failed++;
    }
    busy = false;
    if (!failed && get(sketchDialog) === d) closeSketchDialog();
  }

  function onKey(e) {
    if (!$sketchDialog) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSketchDialog(); }
    else if (e.key === 'Enter' && !e.isComposing && e.target === field) { e.preventDefault(); make(); }
  }
</script>

<svelte:window on:keydown|capture={onKey} />

{#if $sketchDialog}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="msk-backdrop" on:click|self={closeSketchDialog}>
    <div class="msk" role="dialog" aria-modal="true" aria-labelledby="msk-title">
      <div class="msk-head">
        <h2 id="msk-title">Make sketch</h2>
        <span class="msk-sub">
          {#if $sketchDialog.pages.length === 1}
            B{$sketchDialog.pages[0].book}/P{$sketchDialog.pages[0].pageId} · {$sketchDialog.pages[0].ids.length} saved {plural($sketchDialog.pages[0].ids.length, 'stroke')}
          {:else}
            {$sketchDialog.pages.length} pages: one sketch per page
          {/if}
        </span>
      </div>
      <div class="msk-body">
        <div class="msk-previews">
          {#each pages as p (p.book + '/' + p.pageId)}
            <div class="msk-prev" role="img" aria-label="Preview of the selected strokes on B{p.book}/P{p.pageId}">
              {#if p.svg}{@html p.svg}{:else}<span class="msk-err">{p.error || '…'}</span>{/if}
            </div>
          {/each}
        </div>
        <div class="msk-form">
          <label for="msk-label">Label</label>
          <input id="msk-label" type="text" bind:this={field} bind:value={label} placeholder="Sketch" autocomplete="off" />
          {#if allTags.length}
            <div class="msk-small">From {pages.length > 1 ? 'these pages’' : 'this page’s'} tags</div>
            <div class="msk-chips">
              {#each allTags as t (t)}
                <button type="button" class="msk-chip" on:click={() => addTag(t)} title="Add {tagLabel(t, $tagInfo)} to the label"><TagChip tag={t} /></button>
              {/each}
            </div>
          {/if}
          <div class="msk-small">Empty label = “Sketch”. The label is searchable.</div>
        </div>
      </div>
      <label class="msk-check"><input type="checkbox" bind:checked={pressure} /> Also draw with pen pressure
        <span class="msk-small">(Pressure ink, off by default)</span></label>
      <div class="msk-where">
        {#each pages as p (p.book + '/' + p.pageId)}
          <p>{#if pages.length > 1}<b>B{p.book}/P{p.pageId}</b> ({p.ids.length}): {/if}Goes in the transcript {p.error ? '(page could not be read)' : placeText(p)}, as <code>[sketch] {shown}</code>.</p>
        {/each}
        <p>Its strokes are linked to it, so Transcribe never sends them. Saved at once, like a task tick.</p>
      </div>
      <div class="msk-actions">
        <button type="button" class="msk-btn" on:click={closeSketchDialog} disabled={busy}>Cancel</button>
        <button type="button" class="msk-btn primary" on:click={make} disabled={busy || !pages.some((p) => !p.error)}>
          {busy ? 'Making…' : pages.length > 1 ? `Make ${pages.length} sketches` : 'Make sketch'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .msk-backdrop { position: fixed; inset: 0; z-index: 10040; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.4); }
  .msk {
    width: min(620px, 94vw); max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
    padding: 18px 20px; border-radius: 12px; background: var(--bg-primary, #fff); color: var(--text-primary, #222);
    border: 1px solid var(--border, #ddd); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  }
  .msk-head { display: flex; align-items: baseline; gap: 12px; }
  .msk-head h2 { margin: 0; font-size: 1.05rem; }
  .msk-sub { margin-left: auto; font-size: 0.75rem; color: var(--text-secondary, #777); }
  .msk-body { display: flex; gap: 16px; align-items: flex-start; }
  .msk-previews { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .msk-prev { width: 200px; height: 160px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #e3e3e3; border-radius: 6px; overflow: hidden; }
  .msk-prev :global(svg) { max-width: 100%; max-height: 100%; }
  .msk-err { font-size: 0.75rem; color: #b45309; }
  .msk-form { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
  .msk-form label { font-size: 0.75rem; color: var(--text-secondary, #777); }
  .msk-form input[type='text'] { padding: 7px 9px; border: 1px solid var(--border, #ccc); border-radius: 6px; font: inherit; background: var(--bg-secondary, #fff); color: inherit; }
  .msk-small { font-size: 0.72rem; color: var(--text-secondary, #888); }
  .msk-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .msk-chip { padding: 0; border: none; background: none; cursor: pointer; }
  .msk-check { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
  .msk-where { padding: 8px 12px; border-radius: 8px; background: var(--bg-secondary, #f4f5f8); font-size: 0.8rem; line-height: 1.5; }
  .msk-where p { margin: 0 0 4px; }
  .msk-where p:last-child { margin: 0; color: var(--text-secondary, #777); }
  .msk-where code { font-size: 0.78rem; }
  .msk-actions { display: flex; justify-content: flex-end; gap: 10px; }
  .msk-btn { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border, #ccc); background: var(--bg-tertiary, #f2f2f2); color: inherit; font: inherit; cursor: pointer; }
  .msk-btn.primary { background: #e5546c; border-color: #e5546c; color: #fff; font-weight: 600; }
  .msk-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
