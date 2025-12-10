/**
 * Application State - Shared across modules
 */

export const state = {
  controller: null,
  authorized: false,
  penInfo: null,
  strokes: [],
  currentPageInfo: null,
  pages: new Map(), // Map<pageKey, Dot[]>
  
  // Selection state (supports multi-select)
  selectedStrokes: new Set(),
  lastSelectedIndex: null, // For shift+click range selection
  
  // Transcription result
  lastTranscription: null,
};

// Module instances - will be set during initialization
export const modules = {
  renderer: null,
  analyzer: null,
  logseqApi: null,
  myscriptApi: null,
};

// For backwards compatibility with imports expecting lastTranscription directly
export function getLastTranscription() {
  return state.lastTranscription;
}

export function setLastTranscription(value) {
  state.lastTranscription = value;
}
