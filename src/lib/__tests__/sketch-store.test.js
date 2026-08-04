/**
 * Tests for stores/sketch.js and the sketch-flag helpers in stores/strokes.js.
 *
 * Coverage:
 *   - sketchProfile: sanitised on load, persisted, restored from localStorage
 *   - applySketchPreset / updateSketchProfile / resetSketchProfile, and the rule
 *     that any manual edit clears the active preset name
 *   - setStrokesSketch / markStrokesAsSketch / unmarkStrokesAsSketch: flag flips,
 *     unsaved-changes signalling, cached-width invalidation, no-op detection
 *   - sketchStrokeCount derived store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_SKETCH_PROFILE, SKETCH_PRESETS } from '../sketch-width.js';

describe('sketch profile store', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('starts from the shipped defaults with nothing persisted', async () => {
    const { sketchProfile, sketchPresetName } = await import('$stores/sketch.js');
    expect(get(sketchProfile)).toEqual(DEFAULT_SKETCH_PROFILE);
    expect(get(sketchPresetName)).toBe('');
  });

  it('persists edits and restores them on reload', async () => {
    const first = await import('$stores/sketch.js');
    first.updateSketchProfile({ maxWidth: 3.75 });

    vi.resetModules();
    const second = await import('$stores/sketch.js');
    expect(get(second.sketchProfile).maxWidth).toBe(3.75);
  });

  it('sanitises a persisted profile written by an older build', async () => {
    // Inverted bounds and a garbage gamma must not reach the renderer.
    localStorage.setItem(
      'smartpen-bridge-sketch-profile',
      JSON.stringify({ minWidth: 4, maxWidth: 1, gamma: 0, bogusField: 'x' })
    );
    const { sketchProfile } = await import('$stores/sketch.js');
    const p = get(sketchProfile);
    expect(p.minWidth).toBe(1);
    expect(p.maxWidth).toBe(4);
    expect(p.gamma).toBeGreaterThan(0);
    expect(p).not.toHaveProperty('bogusField');
  });

  it('survives corrupt persisted JSON', async () => {
    localStorage.setItem('smartpen-bridge-sketch-profile', '{not json');
    const { sketchProfile } = await import('$stores/sketch.js');
    expect(get(sketchProfile)).toEqual(DEFAULT_SKETCH_PROFILE);
  });

  it('applies a preset and records its name', async () => {
    const { sketchProfile, sketchPresetName, applySketchPreset } = await import('$stores/sketch.js');
    applySketchPreset('brush');
    expect(get(sketchProfile).maxWidth).toBe(SKETCH_PRESETS.brush.maxWidth);
    expect(get(sketchPresetName)).toBe('brush');
  });

  it('ignores an unknown preset name', async () => {
    const { sketchProfile, applySketchPreset } = await import('$stores/sketch.js');
    applySketchPreset('quill');
    expect(get(sketchProfile)).toEqual(DEFAULT_SKETCH_PROFILE);
  });

  it('clears the preset name on any manual edit', async () => {
    // Showing "Brush" as active after its numbers have been changed would lie.
    const { sketchPresetName, applySketchPreset, updateSketchProfile } = await import('$stores/sketch.js');
    applySketchPreset('brush');
    updateSketchProfile({ maxWidth: 1.1 });
    expect(get(sketchPresetName)).toBe('');
  });

  it('merges a patch rather than replacing the whole profile', async () => {
    const { sketchProfile, updateSketchProfile } = await import('$stores/sketch.js');
    updateSketchProfile({ gamma: 1.9 });
    const p = get(sketchProfile);
    expect(p.gamma).toBe(1.9);
    expect(p.minWidth).toBe(DEFAULT_SKETCH_PROFILE.minWidth);
  });

  it('resets back to defaults', async () => {
    const { sketchProfile, sketchPresetName, applySketchPreset, resetSketchProfile } = await import('$stores/sketch.js');
    applySketchPreset('marker');
    resetSketchProfile();
    expect(get(sketchProfile)).toEqual(DEFAULT_SKETCH_PROFILE);
    expect(get(sketchPresetName)).toBe('');
  });

  it('summarises the current look for the UI', async () => {
    const { sketchProfileSummary, applySketchPreset, updateSketchProfile } = await import('$stores/sketch.js');
    applySketchPreset('pen');
    expect(get(sketchProfileSummary)).toContain('Pen');
    updateSketchProfile({ maxWidth: 2 });
    expect(get(sketchProfileSummary)).toContain('Custom');
  });
});

describe('sketch flag helpers on the strokes store', () => {
  let strokesMod;
  let storageMod;

  const stroke = (startTime, extra = {}) => ({
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 42 },
    startTime,
    endTime: startTime + 100,
    dotArray: [{ x: 1, y: 2, f: 300 }, { x: 3, y: 4, f: 500 }],
    ...extra,
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    strokesMod = await import('$stores/strokes.js');
    storageMod = await import('$stores/storage.js');
    strokesMod.strokes.set([stroke(1000), stroke(2000), stroke(3000)]);
    storageMod.clearUnsavedChanges();
  });

  it('marks the given indices and leaves the rest alone', () => {
    const changed = strokesMod.markStrokesAsSketch([0, 2]);
    expect(changed).toBe(2);
    expect(get(strokesMod.strokes).map((s) => !!s.sketch)).toEqual([true, false, true]);
  });

  it('accepts a Set as well as an array (selection stores hold Sets)', () => {
    expect(strokesMod.markStrokesAsSketch(new Set([1]))).toBe(1);
    expect(get(strokesMod.strokes)[1].sketch).toBe(true);
  });

  it('unmarks previously marked strokes', () => {
    strokesMod.markStrokesAsSketch([0, 1, 2]);
    expect(strokesMod.unmarkStrokesAsSketch([1])).toBe(1);
    expect(get(strokesMod.strokes).map((s) => !!s.sketch)).toEqual([true, false, true]);
  });

  it('reports 0 changed when the flag is already in the requested state', () => {
    strokesMod.markStrokesAsSketch([0]);
    expect(strokesMod.markStrokesAsSketch([0])).toBe(0);
  });

  it('flags unsaved changes — the flag lives in the PageDoc', () => {
    expect(get(storageMod.unsavedChanges)).toBe(false);
    strokesMod.markStrokesAsSketch([0]);
    expect(get(storageMod.unsavedChanges)).toBe(true);
  });

  it('does not flag unsaved changes for a no-op', () => {
    strokesMod.markStrokesAsSketch([0]);
    storageMod.clearUnsavedChanges();
    strokesMod.markStrokesAsSketch([0]);
    expect(get(storageMod.unsavedChanges)).toBe(false);
  });

  it('drops the cached width array so the stroke re-measures', () => {
    // The renderer caches widths keyed only by the profile, so a mode flip has to
    // invalidate explicitly or the stroke keeps its old envelope.
    strokesMod.strokes.update((all) => {
      all[0]._sw = { key: 'stale', widths: [1, 1] };
      return all;
    });
    strokesMod.markStrokesAsSketch([0]);
    expect(get(strokesMod.strokes)[0]._sw).toBeUndefined();
  });

  it('ignores empty and out-of-range indices without throwing', () => {
    expect(strokesMod.markStrokesAsSketch([])).toBe(0);
    expect(strokesMod.markStrokesAsSketch(null)).toBe(0);
    expect(strokesMod.markStrokesAsSketch([99])).toBe(0);
  });

  it('tracks the flagged total in sketchStrokeCount', () => {
    expect(get(strokesMod.sketchStrokeCount)).toBe(0);
    strokesMod.markStrokesAsSketch([0, 1]);
    expect(get(strokesMod.sketchStrokeCount)).toBe(2);
    strokesMod.unmarkStrokesAsSketch([0]);
    expect(get(strokesMod.sketchStrokeCount)).toBe(1);
  });
});
