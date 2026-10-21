<!--
  ReaderTagsLayout.svelte — the Library reader's pages with the tag strip
  beside them (v3.1.0 page tags). Wide: pages, then the strip on the right.
  Narrow (under 900px of reader): the strip folds into one bar above the pages
  (PageTagsStrip's `@container reader` rules), so the handwriting keeps its
  width either way.
-->
<script>
  import PageTagsStrip from './PageTagsStrip.svelte';

  /** Scan records on screen (see PageTagsStrip). */
  export let records = [];
</script>

<div class="rtl-box">
  <div class="rtl">
    <div class="rtl-main"><slot /></div>
    <PageTagsStrip {records} />
  </div>
</div>

<style>
  .rtl-box { flex: 1; display: flex; min-width: 0; min-height: 0; container: reader / inline-size; }
  .rtl { flex: 1; display: flex; min-width: 0; min-height: 0; }
  .rtl-main { flex: 1; display: flex; min-width: 0; min-height: 0; }
  @container reader (max-width: 900px) {
    .rtl { flex-direction: column-reverse; }
  }
</style>
