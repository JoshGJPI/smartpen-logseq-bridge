/**
 * Store Index - Export all stores from one place
 */

// Strokes
export { 
  strokes, 
  pages, 
  strokeCount, 
  currentPageInfo,
  batchMode,
  addStroke,
  updateLastStroke,
  addOfflineStrokes,
  startBatchMode,
  endBatchMode,
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
  transferProgress,
  transferPercent,
  setPenConnected,
  setPenAuthorized,
  setPenInfo,
  setPenController,
  updateTransferProgress,
  resetTransferProgress
} from './pen.js';

// Transcription
export {
  lastTranscription,
  pageTranscriptions,
  selectedPagesForImport,
  isTranscribing,
  transcribedText,
  transcribedLines,
  detectedCommands,
  transcriptionSummary,
  lineMetrics,
  transcribedWords,
  hasTranscription,
  transcriptionSourcePages,
  transcriptionByPage,
  pageTranscriptionsArray,
  pageTranscriptionCount,
  hasPageTranscriptions,
  setTranscription,
  setPageTranscription,
  togglePageSelection,
  selectAllPages,
  deselectAllPages,
  clearTranscription,
  clearPageTranscription,
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
  showFilteredStrokes,
  logMessages,
  log,
  setActiveTab,
  toggleSidebar,
  setCanvasZoom,
  toggleLineGuides,
  toggleFilteredStrokes,
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

// Filtered Strokes
export {
  filteredStrokes,
  filterStats,
  setFilteredStrokes,
  clearFilteredStrokes,
  getFilteredStrokeByIndex
} from './filtered-strokes.js';
