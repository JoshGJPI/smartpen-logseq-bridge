/**
 * Sketch Store — the pressure → thickness profile for sketch strokes.
 *
 * This is a *render* preference, not stroke data: it changes how flagged strokes
 * look, never what is on disk. So it persists to localStorage alongside the other
 * UI settings rather than into the PageDoc. Re-tuning it restyles every sketch in
 * the notebook at once, which is the intent — you pick a look, not a per-stroke
 * width.
 *
 * The mapping itself lives in `$lib/sketch-width.js`; this module only owns the
 * chosen values and their persistence.
 */

import { writable, derived, get } from 'svelte/store';
import {
  DEFAULT_SKETCH_PROFILE,
  SKETCH_PRESETS,
  normalizeProfile,
  profileFromPreset
} from '$lib/sketch-width.js';

const STORAGE_KEY = 'smartpen-bridge-sketch-profile';

/** Which preset the current values came from, for UI highlighting. */
const PRESET_KEY = 'smartpen-bridge-sketch-preset';

function loadProfile() {
  if (typeof window === 'undefined') return normalizeProfile(DEFAULT_SKETCH_PROFILE);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // normalizeProfile sanitises whatever comes back, so a profile written by an
    // older build with different fields still loads rather than throwing.
    if (stored) return normalizeProfile(JSON.parse(stored));
  } catch (e) {
    console.warn('Failed to load sketch profile:', e);
  }
  return normalizeProfile(DEFAULT_SKETCH_PROFILE);
}

function loadPresetName() {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(PRESET_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * The active profile. Always a fully-populated, sanitised SketchProfile — every
 * consumer can read fields directly without defaulting.
 */
export const sketchProfile = writable(loadProfile());

/** Name of the preset last applied, or '' once values are hand-edited. */
export const sketchPresetName = writable(loadPresetName());

sketchProfile.subscribe(value => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (e) {
    console.warn('Failed to persist sketch profile:', e);
  }
});

sketchPresetName.subscribe(value => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PRESET_KEY, value || '');
  } catch {
    /* non-critical */
  }
});

/** Preset definitions, as an array for `{#each}`. */
export const sketchPresets = Object.entries(SKETCH_PRESETS).map(([name, preset]) => ({
  name,
  label: preset.label,
  description: preset.description
}));

/**
 * Human-readable summary of the current look, for the settings header and the
 * canvas toolbar button's tooltip.
 */
export const sketchProfileSummary = derived(
  [sketchProfile, sketchPresetName],
  ([$profile, $preset]) => {
    const band = `${$profile.minWidth.toFixed(2)}–${$profile.maxWidth.toFixed(2)} mm`;
    const label = $preset && SKETCH_PRESETS[$preset] ? SKETCH_PRESETS[$preset].label : 'Custom';
    return `${label} · ${band}`;
  }
);

/**
 * Apply a named preset, replacing all values.
 * @param {string} name - key in SKETCH_PRESETS
 */
export function applySketchPreset(name) {
  if (!SKETCH_PRESETS[name]) return;
  sketchProfile.set(profileFromPreset(name));
  sketchPresetName.set(name);
}

/**
 * Change one or more profile fields.
 *
 * Any edit clears the preset name — the values no longer match a named look, and
 * showing a preset as active while its numbers have been changed is worse than
 * showing "Custom".
 * @param {Partial<import('$lib/sketch-width.js').SketchProfile>} patch
 */
export function updateSketchProfile(patch) {
  sketchProfile.update(current => normalizeProfile({ ...current, ...patch }));
  sketchPresetName.set('');
}

/** Restore the shipped defaults. */
export function resetSketchProfile() {
  sketchProfile.set(normalizeProfile(DEFAULT_SKETCH_PROFILE));
  sketchPresetName.set('');
}

/**
 * Current profile (one-time read), for non-reactive callers.
 * @returns {import('$lib/sketch-width.js').SketchProfile}
 */
export function getSketchProfile() {
  return get(sketchProfile);
}
