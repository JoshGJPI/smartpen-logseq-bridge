<!--
  StripScroll.svelte — the activity strip's scroll bar (Nov 2026). A native
  scroll bar styled 6 px tall, over a spacer as wide as all the ink at the
  strip's zoom, so the browser shows the thumb only while zoomed in. Scrolling
  calls onPan(days); a scroll set here to follow the view is ignored.
-->
<script>
  import { tick } from 'svelte';

  export let start = 0;      // the view's first day offset
  export let span = 1;       // days the strip shows
  export let totalDays = 1;  // days of ink
  export let width = 0;      // the strip's width in px
  export let onPan = (days) => {};

  let el;

  // Nothing off screen → no spacer, so no bar (a fractional strip width
  // would otherwise overflow by a fraction of a pixel and show one).
  $: inner = span > 0 && span < totalDays ? Math.floor((width * totalDays) / span) : 0;
  $: if (el) follow(start, inner);

  async function follow(s, w) {
    await tick();
    const left = (s / totalDays) * w;
    if (el && Math.abs(el.scrollLeft - left) > 1) el.scrollTo({ left });
  }

  function scrolled() {
    if (!inner) return;
    const s = (el.scrollLeft / inner) * totalDays;
    if ((Math.abs(s - start) * width) / span < 1) return;
    onPan(s - start);
  }
</script>

<div class="ss" bind:this={el} on:scroll={scrolled} title="Scroll the strip; the wheel zooms">
  <div style:width={`${inner}px`}></div>
</div>

<style>
  .ss { height: 6px; margin-top: 1px; overflow-x: auto; overflow-y: hidden; }
  .ss > div { height: 1px; }
  .ss::-webkit-scrollbar { height: 6px; }
  .ss::-webkit-scrollbar-track { background: transparent; }
  .ss::-webkit-scrollbar-thumb { background: #cfd0d8; border-radius: 3px; }
  .ss::-webkit-scrollbar-thumb:hover { background: #a9abb7; }
</style>
