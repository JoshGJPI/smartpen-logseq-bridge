<!--
  PageSpreadView.svelte — ONE page in the Library reader.

  Header (PageHeader: title, strokes, written-on ribbon, Load into Editor) over
  the page's content in one of three modes:
    strokes     PageInk
    transcript  TranscriptPane
    inktext     both: ink left / text right for a single page (`layout` 'side'),
                text under the ink in a spread ('stack')
  Zoom and Fit are driven for both pages by the shared spread toolbar
  (BookViewer → zoomBy() / fit()); rotation sits on the page's own corner.

  Ink + text links a hovered line to its ink only on pages whose stroke
  lineIds can be trusted (lib/viewer/ink-text.js); other pages sit side by
  side without linking. Nothing here writes lineIds or touches the merge.
  A global search hit (`readerFocus`) lights its matching line's ink and marks
  the line, on trusted pages only; elsewhere the page just opens.
-->
<script>
  import { tick } from 'svelte';
  import { setTimelineRange, navigateTo, setActiveTab, readerFocus } from '$stores';
  import { matchingLineId } from '$lib/global-search.js';
  import { getCachedPage } from '$lib/viewer/page-cache.js';
  import { pageDayGroups } from '$lib/viewer/page-sittings.js';
  import { isTrustworthyTranscript, strokesByLine } from '$lib/viewer/ink-text.js';
  import PageHeader from './PageHeader.svelte';
  import PageInk from './PageInk.svelte';
  import TranscriptPane from './TranscriptPane.svelte';
  import PageTurnButtons from './PageTurnButtons.svelte';

  /** store record: lightweight { book, page, pageId, strokeCount, ... } — NO strokes */
  export let record;
  export let bookAlias = '';
  export let contentMode = 'strokes'; // 'strokes' | 'transcript' | 'inktext'
  /** Ink + text arrangement: 'side' (single page) or 'stack' (spread). */
  export let layout = 'side';

  export let hasPrev = false;
  export let hasNext = false;
  export let onPrev = null;
  export let onNext = null;
  export let onTranscriptSaved = () => {};
  export let onLoadIntoEditor = () => {};
  export let onEditingChange = () => {};
  /** Out: the ink's zoom factor, or null when no ink is shown. */
  export let zoom = null;

  let ink = null;
  let inkZoom = 1;
  let dayHighlight = null;
  let lineHighlight = null;

  // The PageDoc (strokes + transcript) is loaded lazily: records carry no
  // strokes. The LRU page cache keeps turning a spread off the disk.
  let doc = null;
  let loadingDoc = false;
  let loadedKey = null;

  $: if (record) loadDoc(record);

  function idOf(rec) {
    return rec.pageId != null ? String(rec.pageId) : String(rec.page);
  }

  async function loadDoc(rec) {
    const key = `${rec.book}:${idOf(rec)}`;
    if (key === loadedKey) return; // already loaded/loading this exact page
    loadedKey = key;
    doc = null;
    loadingDoc = true;
    try {
      const d = await getCachedPage(rec.book, idOf(rec));
      if (loadedKey !== key) return; // a newer record won the race
      doc = d;
      await tick();
    } catch (e) {
      if (loadedKey === key) console.warn('Library: failed to load page', key, e);
    } finally {
      if (loadedKey === key) loadingDoc = false;
    }
  }

  // Reflect a transcript save back into the locally-held doc so display mode
  // shows the edits immediately (the parent also updates the store + cache).
  function handleSaved(b, p, savedLines) {
    if (doc) doc = { ...doc, transcript: { ...(doc.transcript || {}), lines: savedLines } };
    onTranscriptSaved(b, p, savedLines);
  }

  $: strokes = (doc && doc.strokes) || [];
  $: lines = (doc && doc.transcript && doc.transcript.lines) || [];
  // pageId is the unique-within-book file identifier (incl. suffix).
  $: pageId = record ? idOf(record) : '';
  $: pageKey = record ? `${record.book}:${pageId}` : '';
  $: title = `${bookAlias || `B${record?.book}`} — P${pageId}`;

  // Built once per page load and shared by the ribbon and the ink hover.
  $: dayModel = doc ? pageDayGroups(strokes) : null;

  $: showInk = contentMode !== 'transcript';
  $: showText = contentMode !== 'strokes';
  $: zoom = showInk && doc && strokes.length ? inkZoom : null;

  // Ink + text linking, decided per page load.
  $: linkable = contentMode === 'inktext' && doc ? isTrustworthyTranscript(doc) : false;
  $: lineInk = linkable ? strokesByLine(strokes, lines) : null;
  $: linkNote = contentMode === 'inktext' && doc && !linkable && lines.length
    ? 'Lines aren’t linked to ink on this page: its transcript predates the Aug 2026 line matching. Re-transcribing links it.'
    : '';
  $: if (!linkable) lineHighlight = null;

  // A search hit on this page: its line, where the page's links are trusted.
  $: focus = $readerFocus && record && $readerFocus.book === String(record.book) && $readerFocus.pageId === pageId ? $readerFocus : null;
  $: focusLineId = focus && doc && isTrustworthyTranscript(doc) ? matchingLineId(lines, focus.tokens) : null;
  $: focusInk = focusLineId ? strokesByLine(strokes, lines).get(focusLineId) : null;
  $: focusHighlight = focusInk && focusInk.length ? { strokes: focusInk } : null;

  function hoverLine(line) {
    const list = line && lineInk ? lineInk.get(line.id) : null;
    lineHighlight = list && list.length ? { strokes: list } : null;
  }

  export function zoomBy(factor) { ink && ink.zoomBy(factor); }
  export function fit() { ink && ink.fit(); }

  // A day chip or the day's ink: show that day in the Timeline, with the Dates
  // tab on the same one-day range. Guarded like every other way out of the
  // Library. setActiveTab, not revealLeftPanel: a collapsed panel stays so.
  function openTimelineDay(day) {
    if (!day) return;
    if (navigateTo('timeline') === 'cancelled') return;
    setTimelineRange(day, day);
    setActiveTab('dates');
  }
</script>

<div class="page-view">
  <PageHeader
    {title}
    strokeCount={record.strokeCount}
    groups={dayModel ? dayModel.groups : null}
    onHoverDay={(g) => (dayHighlight = g)}
    onOpenDay={openTimelineDay}
    {onLoadIntoEditor}
  />

  <div class="pv-area" class:inktext={contentMode === 'inktext'} class:stack={layout === 'stack'}>
    {#if !showInk}
      <PageTurnButtons {hasPrev} {hasNext} {onPrev} {onNext} belowToolbar />
    {/if}

    {#if showInk}
      <div class="pv-ink">
        <PageTurnButtons {hasPrev} {hasNext} {onPrev} {onNext} />
        {#if loadingDoc}
          <div class="pv-empty">Loading…</div>
        {:else if doc}
          <PageInk
            bind:this={ink}
            bind:zoom={inkZoom}
            book={record.book}
            {pageId}
            {strokes}
            {dayModel}
            highlight={dayHighlight || lineHighlight || focusHighlight}
            onOpenDay={openTimelineDay}
          />
        {/if}
      </div>
    {/if}
    {#if showText}
      <div class="pv-text">
        <TranscriptPane
          {lines}
          book={record.book}
          page={pageId}
          {pageKey}
          onSaved={handleSaved}
          {onEditingChange}
          onHoverLine={linkable ? hoverLine : null}
          {linkNote}
          {focusLineId}
          onTranscribe={doc && strokes.length ? onLoadIntoEditor : null}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .page-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .pv-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    min-height: 0;
    background: #f9f9f9;
  }
  .pv-ink,
  .pv-text {
    flex: 1;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .pv-ink { position: relative; }
  /* Ink + text: side by side for one page, text under the ink in a spread. */
  .pv-area.inktext .pv-text { border-left: 1px solid #e6e6e6; }
  .pv-area.inktext.stack { flex-direction: column; }
  .pv-area.inktext.stack .pv-ink { flex: 3 1 0; }
  .pv-area.inktext.stack .pv-text { flex: 2 1 0; border-left: none; border-top: 1px solid #e6e6e6; }

  .pv-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bbb;
    font-size: 14px;
  }
</style>
