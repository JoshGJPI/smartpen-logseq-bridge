<!--
  MakeSketchDialog.svelte — Make sketch (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md
  E.3, the mockup Josh approved 2026-11-20). Opened from the Editor's selection ⋯
  (stores/sketch-lines.js openMakeSketchFromSelection) or after a Mark sketch box
  in the Library reader (openMakeSketch).

  A label (empty = "Sketch"), the page's tags as chips that fill the label, Also
  draw with pen pressure (Pressure ink, `sketch: true`, off by default), a
  preview of the ink (v3.29.0: the whole page greyed with the sketch's strokes in
  orange and ink left in its line in blue, plus a close-up; it follows Leave /
  Take), and where the sketch line will go (lib/viewer/sketch-lines.js
  previewPlacement: under the nearest text line above its ink, one level deeper,
  on a page whose links can be trusted; else at the end). A selection over
  several pages makes one sketch per page, each with the same label.

  Selected strokes already in a text line or another sketch are offered per line
  with the reader box's warning (lib/viewer/sketch-lines.js selectionPick): Leave
  them in #N (the default) or Take them; only what is taken is written. From the
  reader (`decided`, v3.29.0) they start taken: they were picked there, stroke by
  stroke.

  Make sketch writes at once, page by page, through saveSketchLine (runSketch);
  nothing waits for Save.
-->
<script>
  import { get } from 'svelte/store';
  import { sketchDialog, closeSketchDialog, runSketch } from '$stores/sketch-lines.js';
  import { pageTags, tagInfo } from '$stores/tags.js';
  import { pageOrientations } from '$stores/orientation.js';
  import { getPage } from '$lib/storage/local-store.js';
  import { previewPlacement, selectionPick, inLineWarning } from '$lib/viewer/sketch-lines.js';
  import { generatePickSVG, pickFrame } from '$lib/viewer/page-svg.js';
  import { rotationFor } from '$lib/page-orientation.js';
  import { tagKey, tagLabel } from '$lib/tags.js';
  import { sketchLabel } from '$lib/line-kinds.js';
  import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';
  import { plural } from '$lib/plural.js';
  import TagChip from '../tags/TagChip.svelte';

  let label = '';
  let pressure = false;
  let busy = false;
  /** Per page: { book, pageId, ids, decided, doc, pick, rot, trusted, tags, error } */
  let pages = [];
  let openedFor = null;
  /** "<book>/<pageId>" → Set of line ids whose strokes the user takes into the sketch. */
  let taken = {};
  let field;

  $: if ($sketchDialog !== openedFor) open($sketchDialog);

  async function open(d) {
    openedFor = d;
    label = '';
    pressure = false;
    busy = false;
    pages = [];
    taken = {};
    if (!d) return;
    const out = [];
    const pre = {};
    for (const p of d.pages) {
      const rot = rotationFor(get(pageOrientations), p.book, p.pageId);
      const tags = get(pageTags)[tagKey(p.book, p.pageId)] || [];
      try {
        const doc = await getPage(p.book, p.pageId);
        if (!doc) { out.push({ ...p, tags, error: 'not found' }); continue; }
        const pick = selectionPick(doc, p.ids);
        // Picked stroke by stroke in the reader: its in-line strokes were taken there.
        if (p.decided) pre[keyOf(p)] = new Set(pick.inLines.map((g) => g.lineId));
        out.push({ ...p, tags, doc, rot, pick, trusted: isTrustworthyTranscript(doc) });
      } catch (err) {
        out.push({ ...p, tags, error: err?.message || String(err) });
      }
    }
    if (openedFor === d) {
      taken = pre;
      pages = out;
      setTimeout(() => field && field.focus(), 0);
    }
  }

  $: allTags = [...new Set(pages.flatMap((p) => p.tags || []))];
  const keyOf = (p) => `${p.book}/${p.pageId}`;
  /** The strokes a page's sketch takes: those in no line, plus the lines the user takes. */
  $: idsOf = (p) => (p.pick ? [...p.pick.take, ...p.pick.inLines.filter((g) => (taken[keyOf(p)] || new Set()).has(g.lineId)).flatMap((g) => g.ids)] : []);
  /** The preview (v3.29.0): the page greyed, the sketch's strokes orange, ink left in its line blue; and a close-up. */
  $: previewOf = (p) => {
    if (!p.doc) return null;
    const inSketch = new Set(idsOf(p));
    const left = new Set(((p.pick && p.pick.inLines) || []).flatMap((g) => g.ids).filter((id) => !inSketch.has(id)));
    const roleOf = (s) => (inSketch.has(s.id) ? 'taken' : left.has(s.id) ? 'offered' : null);
    const all = p.doc.strokes || [];
    const frame = pickFrame(all.filter((s) => inSketch.has(s.id) || left.has(s.id)));
    return {
      page: generatePickSVG(all, roleOf, 200, 260, p.rot),
      close: frame ? generatePickSVG(all, roleOf, 200, 260, p.rot, frame) : null,
      left: left.size
    };
  };
  $: placeOf = (p) => (p.doc && idsOf(p).length ? previewPlacement(p.doc, idsOf(p), p.rot) : null);
  function setTake(p, lineId, on) {
    const next = new Set(taken[keyOf(p)] || []);
    on ? next.add(lineId) : next.delete(lineId);
    taken = { ...taken, [keyOf(p)]: next };
  }
  $: shown = sketchLabel(label);

  function addTag(t) {
    const name = tagLabel(t, $tagInfo);
    label = label.trim() ? `${label.trim()} ${name}` : name;
    field && field.focus();
  }

  function placeText(p) {
    if (!p.trusted) return 'at the end of the transcript (this page’s lines aren’t linked to its ink, so its place can’t be told; move it in Library Edit)';
    const place = placeOf(p);
    if (!place) return 'at the start of the transcript (no text line above it)';
    const t = place.text.length > 50 ? `${place.text.slice(0, 49)}…` : place.text;
    return `under #${place.n} “${t}”, one level deeper`;
  }

  async function make() {
    if (busy) return;
    busy = true;
    const d = openedFor;
    let failed = 0;
    for (const p of pages) {
      if (p.error || !idsOf(p).length) continue;
      const r = await runSketch(p.book, p.pageId, { op: 'create', strokeIds: idsOf(p), label, pressure });
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
            {@const pv = previewOf(p)}
            <div class="msk-pair">
              <div class="msk-prev" role="img" aria-label="B{p.book}/P{p.pageId}: the sketch's strokes in orange on the page">
                {#if pv}{@html pv.page}{:else}<span class="msk-err">{p.error || '…'}</span>{/if}
              </div>
              {#if pv && pv.close}
                <div class="msk-prev" role="img" aria-label="Close-up of the sketch's strokes">{@html pv.close}</div>
              {/if}
            </div>
          {/each}
          <div class="msk-key"><span class="sw taken"></span>in the sketch{#if pages.some((p) => previewOf(p)?.left)}<span class="sw offered"></span>left in its line{/if}</div>
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
          <p>{#if pages.length > 1}<b>B{p.book}/P{p.pageId}</b> ({idsOf(p).length}): {/if}{#if !p.error && !idsOf(p).length}Nothing to take on this page: every stroke stays in its line.{:else}Goes in the transcript {p.error ? '(page could not be read)' : placeText(p)}, as <code>[sketch] {shown}</code>.{/if}</p>
          {#each (p.pick && p.pick.inLines) || [] as g (g.lineId)}
            <div class="msk-warn">
              <span>{inLineWarning(g)}. Leave them in that {g.sketch ? 'sketch' : 'line'}, or take them into the sketch?</span>
              <span class="msk-seg">
                <button type="button" class:sel={!(taken[keyOf(p)] || new Set()).has(g.lineId)} on:click={() => setTake(p, g.lineId, false)}>Leave in #{g.n}</button>
                <button type="button" class:sel={(taken[keyOf(p)] || new Set()).has(g.lineId)} on:click={() => setTake(p, g.lineId, true)}>Take them</button>
              </span>
            </div>
          {/each}
        {/each}
        <p>Its strokes are linked to it, so Transcribe never sends them. Saved at once, like a task tick.</p>
      </div>
      <div class="msk-actions">
        <button type="button" class="msk-btn" on:click={closeSketchDialog} disabled={busy}>Cancel</button>
        <button type="button" class="msk-btn primary" on:click={make} disabled={busy || !pages.some((p) => !p.error && idsOf(p).length)}>
          {busy ? 'Making…' : pages.length > 1 ? `Make ${pages.length} sketches` : 'Make sketch'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .msk-backdrop { position: fixed; inset: 0; z-index: 10040; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.4); }
  .msk {
    width: min(760px, 94vw); max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;
    padding: 18px 20px; border-radius: 12px; background: var(--bg-primary, #fff); color: var(--text-primary, #222);
    border: 1px solid var(--border, #ddd); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  }
  .msk-head { display: flex; align-items: baseline; gap: 12px; }
  .msk-head h2 { margin: 0; font-size: 1.05rem; }
  .msk-sub { margin-left: auto; font-size: 0.75rem; color: var(--text-secondary, #777); }
  .msk-body { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .msk-previews { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .msk-pair { display: flex; gap: 6px; }
  .msk-key { font-size: 0.72rem; color: var(--text-secondary, #777); display: flex; align-items: center; gap: 4px; }
  .msk-key .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: 6px; }
  .msk-key .sw:first-child { margin-left: 0; }
  .sw.taken { background: #e8590c; }
  .sw.offered { background: #3b82f6; }
  .msk-prev { width: 200px; height: 260px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #e3e3e3; border-radius: 6px; overflow: hidden; }
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
  .msk-warn { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 4px 0 6px; padding: 6px 8px; border-radius: 6px; background: rgba(245, 185, 66, 0.14); border: 1px solid rgba(245, 185, 66, 0.45); color: inherit; }
  .msk-seg { display: inline-flex; gap: 4px; }
  .msk-seg button { padding: 3px 9px; border: 1px solid var(--border, #ccc); border-radius: 5px; background: var(--bg-secondary, #fff); color: inherit; font-size: 0.75rem; cursor: pointer; }
  .msk-seg button.sel { border-color: #b7791f; background: #fdf0d2; color: #222; font-weight: 600; }
  .msk-actions { display: flex; justify-content: flex-end; gap: 10px; }
  .msk-btn { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border, #ccc); background: var(--bg-tertiary, #f2f2f2); color: inherit; font: inherit; cursor: pointer; }
  .msk-btn.primary { background: #e5546c; border-color: #e5546c; color: #fff; font-weight: 600; }
  .msk-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
