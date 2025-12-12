/**
 * Store Index - Export all stores from one place
 */

// Strokes
export { 
  strokes, 
  pages, 
  strokeCount, 
  currentPageInfo,
  addStroke,
  updateLastStroke,
  addOfflineStrokes,
  clearStrokes,
  getStroke
} from './strokes.js';

// Selection
export {
  selectedIndices,
  lastSelectedIndex,
  selectedStrokes,
  selectionCount,
  hasSelection,
  selectStroke,
  selectRange,
  selectAll,
  clearSelection,
  handleStrokeClick,
  selectFromBox
} from './selection.js';

// Pen
export {
  penConnected,
  penAuthorized,
  penInfo,
  penController,
  penReady,
  penBattery,
  penMemory,
  setPenConnected,
  setPenAuthorized,
  setPenInfo,
  setPenController
} from './pen.js';

// Transcription
export {
  lastTranscription,
  isTranscribing,
  transcribedText,
  transcribedLines,
  detectedCommands,
  transcriptionSummary,
  lineMetrics,
  transcribedWords,
  hasTranscription,
  setTranscription,
  clearTranscription,
  setIsTranscribing
} from './transcription.js';

// Settings
export {
  myscriptAppKey,
  myscriptHmacKey,
  logseqHost,
  logseqToken,
  logseqConnected,
  logseqStatusText,
  hasMyScriptCredentials,
  setLogseqStatus,
  getMyScriptCredentials,
  getLogseqSettings
} from './settings.js';

// UI
export {
  activeTab,
  sidebarCollapsed,
  canvasZoom,
  showLineGuides,
  logMessages,
  log,
  setActiveTab,
  toggleSidebar,
  setCanvasZoom,
  toggleLineGuides,
  clearLog
} from './ui.js';

// Storage
export {
  storageStatus,
  storageStats,
  storageStatusMessage,
  hasSavedPages,
  setStorageSaving,
  recordSuccessfulSave,
  recordStorageError,
  clearStorageStatus,
  isPageSaved
} from './storage.js';
