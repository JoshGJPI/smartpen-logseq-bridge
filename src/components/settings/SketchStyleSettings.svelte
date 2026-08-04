<!--
  SketchStyleSettings.svelte — how sketch strokes are rendered.

  Controls the pressure → thickness mapping applied to every stroke flagged as a
  sketch (canvas header → "Mark as Sketch"). This is a display preference, so it
  restyles the whole notebook at once and never touches what is on disk.

  The live preview is the point of this panel: min/max/response are hard to reason
  about numerically but obvious to see, so every control redraws a synthetic
  stroke whose pressure ramps up, spikes, and tails off.
-->
<script>
  import {
    sketchProfile,
    sketchPresets,
    sketchPresetName,
    sketchProfileSummary,
    applySketchPreset,
    updateSketchProfile,
    resetSketchProfile,
    sketchStrokeCount
  } from '$stores';
  import { widthsForPressures } from '$lib/sketch-width.js';

  /**
   * Synthetic force series for the preview: a gentle start, a firm middle, an
   * abrupt spike (so the smoothing/spike controls visibly do something), then a
   * taper off the end.
   */
  const PREVIEW_PRESSURES = (() => {
    const out = [];
    const n = 120;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // Base arc from light to firm and back.
      let f = 120 + 620 * Math.sin(Math.PI * t);
      // A deliberate spike at ~62% — the thing "max thickness" and "spike
      // smoothing" exist to tame.
      if (i > n * 0.60 && i < n * 0.66) f = 1000;
      out.push(f);
    }
    return out;
  })();

  const PREVIEW_W = 320;
  const PREVIEW_H = 64;

  // Rebuilt whenever the profile changes.
  $: previewWidths = widthsForPressures(PREVIEW_PRESSURES, $sketchProfile);

  /**
   * The preview is drawn as a filled ribbon rather than a stroked path: a single
   * SVG path cannot vary its stroke-width, which is the same constraint the
   * canvas renderer works around by splitting into runs. A ribbon shows the
   * envelope exactly and needs one path.
   */
  $: previewPath = (() => {
    const n = previewWidths.length;
    if (n < 2) return '';

    const pad = 8;
    const usableW = PREVIEW_W - pad * 2;
    const midY = PREVIEW_H / 2;
    // mm → preview px. Scaled so the widest configurable line still fits.
    const pxPerMm = 7;

    const top = [];
    const bottom = [];
    for (let i = 0; i < n; i++) {
      const x = pad + (usableW * i) / (n - 1);
      // A shallow wave so the ribbon reads as a pen stroke, not a bar chart.
      const y = midY + Math.sin((i / (n - 1)) * Math.PI * 1.4) * 8;
      const half = (previewWidths[i] * pxPerMm) / 2;
      top.push(`${x.toFixed(1)} ${(y - half).toFixed(1)}`);
      bottom.push(`${x.toFixed(1)} ${(y + half).toFixed(1)}`);
    }
    bottom.reverse();
    return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
  })();

  $: minWidth = $sketchProfile.minWidth;
  $: maxWidth = $sketchProfile.maxWidth;

  /** Keep min ≤ max while dragging, without the sliders fighting each other. */
  function onMinWidth(event) {
    const value = Number(event.currentTarget.value);
    updateSketchProfile({ minWidth: value, maxWidth: Math.max(value, maxWidth) });
  }

  function onMaxWidth(event) {
    const value = Number(event.currentTarget.value);
    updateSketchProfile({ maxWidth: value, minWidth: Math.min(value, minWidth) });
  }

  /**
   * The response slider runs "Brush ← → Pencil" left-to-right, which is inverted
   * from gamma (low gamma = broadens readily = brush). Exposing gamma raw would
   * make the useful direction unguessable.
   */
  $: responseValue = $sketchProfile.gamma;
</script>

<div class="sketch-settings">
  <div class="summary-row">
    <span class="summary">{$sketchProfileSummary}</span>
    {#if $sketchStrokeCount > 0}
      <span class="count">{$sketchStrokeCount} sketch stroke{$sketchStrokeCount !== 1 ? 's' : ''} loaded</span>
    {/if}
  </div>

  <svg
    class="preview"
    viewBox="0 0 {PREVIEW_W} {PREVIEW_H}"
    width="100%"
    height={PREVIEW_H}
    role="img"
    aria-label="Preview of the current sketch line thickness"
  >
    <path d={previewPath} fill="currentColor" />
  </svg>

  <div class="presets">
    {#each sketchPresets as preset (preset.name)}
      <button
        class="preset-btn"
        class:active={$sketchPresetName === preset.name}
        on:click={() => applySketchPreset(preset.name)}
        title={preset.description}
      >
        {preset.label}
      </button>
    {/each}
  </div>

  <div class="control">
    <label for="sketch-min-width">
      Thinnest <span class="value">{minWidth.toFixed(2)} mm</span>
    </label>
    <input
      type="range"
      id="sketch-min-width"
      min="0.1" max="3" step="0.05"
      value={minWidth}
      on:input={onMinWidth}
    />
  </div>

  <div class="control">
    <label for="sketch-max-width">
      Thickest <span class="value">{maxWidth.toFixed(2)} mm</span>
    </label>
    <input
      type="range"
      id="sketch-max-width"
      min="0.1" max="6" step="0.05"
      value={maxWidth}
      on:input={onMaxWidth}
    />
  </div>

  <div class="control">
    <label for="sketch-gamma">
      Response <span class="value">{responseValue < 0.9 ? 'Brush' : responseValue > 1.2 ? 'Pencil' : 'Linear'} ({responseValue.toFixed(2)})</span>
    </label>
    <input
      type="range"
      id="sketch-gamma"
      min="0.4" max="2.5" step="0.05"
      value={responseValue}
      on:input={(e) => updateSketchProfile({ gamma: Number(e.currentTarget.value) })}
    />
    <p class="control-hint">
      Left broadens readily with light pressure (brush); right stays thin until you
      press hard (pencil).
    </p>
  </div>

  <div class="control">
    <label for="sketch-smoothing">
      Spike smoothing <span class="value">{$sketchProfile.smoothing <= 1 ? 'off' : `${$sketchProfile.smoothing} dots`}</span>
    </label>
    <input
      type="range"
      id="sketch-smoothing"
      min="0" max="15" step="1"
      value={$sketchProfile.smoothing}
      on:input={(e) => updateSketchProfile({ smoothing: Number(e.currentTarget.value) })}
    />
    <p class="control-hint">
      Averages pressure over neighbouring points, so a sudden jab widens the line
      gradually instead of bulging.
    </p>
  </div>

  <div class="control">
    <label for="sketch-slew">
      Max change per point <span class="value">{$sketchProfile.slewLimit <= 0 ? 'unlimited' : `${$sketchProfile.slewLimit.toFixed(2)} mm`}</span>
    </label>
    <input
      type="range"
      id="sketch-slew"
      min="0" max="1" step="0.02"
      value={$sketchProfile.slewLimit}
      on:input={(e) => updateSketchProfile({ slewLimit: Number(e.currentTarget.value) })}
    />
  </div>

  <details class="advanced">
    <summary>Pen calibration</summary>
    <p class="control-hint">
      The force range your pen actually produces. Anything at or below the floor
      draws at the thinnest width, at or above the ceiling at the thickest. If your
      sketches come out uniformly thin or uniformly fat, narrow this band around
      the range you really use.
    </p>

    <div class="control">
      <label for="sketch-floor">
        Force floor <span class="value">{$sketchProfile.pressureFloor}</span>
      </label>
      <input
        type="range"
        id="sketch-floor"
        min="0" max="1000" step="10"
        value={$sketchProfile.pressureFloor}
        on:input={(e) => updateSketchProfile({ pressureFloor: Number(e.currentTarget.value) })}
      />
    </div>

    <div class="control">
      <label for="sketch-ceil">
        Force ceiling <span class="value">{$sketchProfile.pressureCeil}</span>
      </label>
      <input
        type="range"
        id="sketch-ceil"
        min="10" max="2000" step="10"
        value={$sketchProfile.pressureCeil}
        on:input={(e) => updateSketchProfile({ pressureCeil: Number(e.currentTarget.value) })}
      />
    </div>

    <div class="control">
      <label for="sketch-flat">
        Width without pressure data <span class="value">{$sketchProfile.flatWidth.toFixed(2)} mm</span>
      </label>
      <input
        type="range"
        id="sketch-flat"
        min="0.1" max="3" step="0.05"
        value={$sketchProfile.flatWidth}
        on:input={(e) => updateSketchProfile({ flatWidth: Number(e.currentTarget.value) })}
      />
      <p class="control-hint">
        Used for pages saved before this app recorded pen pressure — there is no
        force data to vary, so they draw at one width.
      </p>
    </div>
  </details>

  <button class="btn btn-secondary" on:click={resetSketchProfile}>↺ Reset to defaults</button>

  <p class="hint">
    Applies to strokes marked with <strong>✏️ Mark as Sketch</strong> in the canvas
    header. Everything else renders as a uniform line.
  </p>
</div>

<style>
  .sketch-settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .summary {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary, #eee);
  }

  .count {
    font-size: 0.72rem;
    color: var(--text-secondary, #a0a0a0);
  }

  .preview {
    display: block;
    background: white;
    border-radius: 6px;
    /* The ribbon fills with currentColor so the ink reads as ink on the white
       preview card regardless of the surrounding theme. */
    color: #1a1a2e;
  }

  .presets {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .preset-btn {
    flex: 1 1 auto;
    padding: 5px 10px;
    font-size: 0.75rem;
    font-weight: 500;
    border: 1px solid var(--border, #333);
    border-radius: 4px;
    background: var(--bg-tertiary, #2a2a3e);
    color: var(--text-primary, #eee);
    cursor: pointer;
  }

  .preset-btn:hover {
    border-color: #7c5cff;
  }

  .preset-btn.active {
    background: #7c5cff;
    border-color: #7c5cff;
    color: white;
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .control label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    font-size: 0.78rem;
    color: var(--text-secondary, #a0a0a0);
  }

  .control .value {
    font-variant-numeric: tabular-nums;
    color: var(--text-primary, #eee);
    font-weight: 600;
  }

  .control input[type='range'] {
    width: 100%;
    accent-color: #7c5cff;
  }

  .control-hint,
  .hint {
    font-size: 0.72rem;
    color: var(--text-secondary, #a0a0a0);
    margin: 0;
    line-height: 1.4;
  }

  .advanced {
    border-top: 1px solid var(--border, #333);
    padding-top: 8px;
  }

  .advanced summary {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-primary, #eee);
    cursor: pointer;
    margin-bottom: 6px;
  }

  .advanced .control {
    margin-top: 8px;
  }
</style>
