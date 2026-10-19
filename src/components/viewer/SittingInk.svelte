<!--
  SittingInk.svelte — the hovered sitting, redrawn in ink over the page's SVG.

  Rendered inside PageSpreadView's <svg>, after the page's own paths. While a
  sitting is hovered the page greys its paths by CSS (one class on the SVG, no
  re-render) and this draws just that sitting's strokes on top in ink — so a
  hover costs one sitting's paths, not the page's 1,000–2,000.
-->
<svelte:options namespace="svg" />

<script>
  import { DEFAULT_STROKE_WIDTH, strokeToPathD, strokeToWidthRuns } from '$lib/viewer/page-svg.js';
  import { sketchProfile } from '$stores';

  /** The hovered sitting (from SittingHover), or null. */
  export let sitting = null;
  /** { minX, minY } the page's SVG is drawn from. */
  export let viewBounds = null;

  const INK = '#1a1a2e';
</script>

{#if sitting && viewBounds}
  <g class="sitting-ink" pointer-events="none">
    {#each sitting.strokes as stroke}
      {#if stroke.sketch}
        {#each strokeToWidthRuns(stroke, viewBounds, $sketchProfile) as run}
          <path d={run.d} stroke={INK} stroke-width={run.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
        {/each}
      {:else}
        <path d={strokeToPathD(stroke, viewBounds)} stroke={INK} stroke-width={DEFAULT_STROKE_WIDTH} fill="none" stroke-linecap="round" stroke-linejoin="round" />
      {/if}
    {/each}
  </g>
{/if}
