<!--
  ReaderInk.svelte — one reader page's ink (PageInk) with the sketch wiring
  (v3.24.0), so PageSpreadView stays its size:
    - sketch lines' ink: their stroke counts go to `readerSketches` for the
      transcript's SketchRows, and a hovered SketchRow (`sketchHover`) lights its
      ink, on any page (a sketch's links are made by hand, so they are exact);
    - in Ink + text, Mark sketch (SketchMarkLayer) and PageInk's box mode.
  zoomBy() / fit() and `zoom` pass straight through to PageInk.
-->
<script>
  import { onDestroy } from 'svelte';
  import { strokesByLine } from '$lib/viewer/ink-text.js';
  import { isKindLine } from '$lib/line-kinds.js';
  import { sketchHover, readerSketches, stopSketchMark } from '$stores/sketch-lines.js';
  import PageInk from './PageInk.svelte';
  import SketchMarkLayer from './SketchMarkLayer.svelte';

  export let book;
  export let pageId;
  export let doc = null;
  export let strokes = [];
  export let lines = [];
  export let dayModel = null;
  export let highlight = null;
  export let onOpenDay = () => {};
  /** Ink + text: Mark sketch and the box are offered. */
  export let inktext = false;
  export let zoom = 1;

  let ink = null;
  let markLayer = null;
  let boxMode = null;

  export function zoomBy(factor) { ink && ink.zoomBy(factor); }
  export function fit() { ink && ink.fit(); }

  $: key = `${book}:${pageId}`;
  $: kindInk = lines.some(isKindLine) ? strokesByLine(strokes, lines.filter(isKindLine)) : new Map();
  $: publish(key, kindInk, inktext);
  let published = null;
  function publish(k, inkMap, boxable) {
    readerSketches.update((m) => {
      const next = new Map(m);
      if (published && published !== k) next.delete(published);
      next.set(k, { counts: new Map([...inkMap].map(([id, list]) => [id, list.length])), boxable });
      return next;
    });
    published = k;
  }
  onDestroy(() => {
    if (published) readerSketches.update((m) => { const next = new Map(m); next.delete(published); return next; });
  });

  $: hovered = $sketchHover && $sketchHover.key === key ? kindInk.get($sketchHover.lineId) : null;
  $: shown = hovered && hovered.length ? { strokes: hovered } : highlight;
</script>

<PageInk
  bind:this={ink}
  bind:zoom
  {book}
  {pageId}
  {strokes}
  {dayModel}
  highlight={shown}
  {onOpenDay}
  {boxMode}
  onBox={(b) => markLayer && markLayer.pick(b)}
  onBoxCancel={stopSketchMark}
/>
{#if inktext}
  <SketchMarkLayer bind:this={markLayer} bind:boxMode {book} {pageId} {doc} />
{/if}
