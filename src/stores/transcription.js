/**
 * Transcription Store - Manages transcription results from MyScript
 */
import { writable, derived } from 'svelte/store';

// Last transcription result
export const lastTranscription = writable(null);

// Is transcription in progress?
export const isTranscribing = writable(false);

// Derived: Transcribed text
export const transcribedText = derived(
  lastTranscription, 
  $t => $t?.text || ''
);

// Derived: Transcribed lines with hierarchy
export const transcribedLines = derived(
  lastTranscription, 
  $t => $t?.lines || []
);

// Derived: Detected commands (TODO, DEADLINE, etc.)
export const detectedCommands = derived(
  lastTranscription, 
  $t => $t?.commands || []
);

// Derived: Summary stats
export const transcriptionSummary = derived(
  lastTranscription,
  $t => $t?.summary || null
);

// Derived: Line metrics
export const lineMetrics = derived(
  lastTranscription,
  $t => $t?.lineMetrics || null
);

// Derived: Words with bounding boxes
export const transcribedWords = derived(
  lastTranscription,
  $t => $t?.words || []
);

// Derived: Has transcription data
export const hasTranscription = derived(
  lastTranscription,
  $t => $t !== null
);

/**
 * Set transcription result
 * @param {Object} result - Transcription result from MyScript
 */
export function setTranscription(result) {
  lastTranscription.set(result);
  isTranscribing.set(false);
}

/**
 * Clear transcription
 */
export function clearTranscription() {
  lastTranscription.set(null);
}

/**
 * Set transcribing state
 * @param {boolean} transcribing 
 */
export function setIsTranscribing(transcribing) {
  isTranscribing.set(transcribing);
}
