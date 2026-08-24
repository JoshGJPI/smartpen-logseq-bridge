/**
 * Store Index - Export all stores from one place
 */

// Strokes
export {
  strokes,
  pages,
  strokeCount,
  canvasPageKeys,
  currentPageInfo,
  batchMode,
  addStroke,
  updateLastStroke,
  addOfflineStrokes,
  startBatchMode,
  endBatchMode,
  clearStrokes,
  removeStrokesByIndices,
  clearStrokeBlockUuids,
  getActiveStrokesForPageFromStore,
  // Sketch strokes (pressure-varying thickness)
  sketchStrokeCount,
  setStrokesSketch,
  markStrokesAsSketch,
  unmarkStrokesAsSketch,
  // Point editing (the one path that mutates captured geometry)
  removeStrokePoints,
  clearPointEditMarkers
} from './strokes.js';

// Point Edit mode (canvas point handles)
export {
  pointEditMode,
  pointEditStrokes,
  pointEditPointCount,
  selectedPoints,
  selectedPointCount,
  hasSelectedPoints,
  strayPoints,
  strayPointKeys,
  MAX_POINT_EDIT_STROKES,
  enterPointEditMode,
  exitPointEditMode,
  togglePointEditMode,
  selectPoint,
  selectPoints,
  clearPointSelection,
  selectStrayPoints,
  deleteSelectedPoints,
  deleteStrayPoints
} from './point-edit.js';

// Sketch render profile (pressure → thickness)
export {
  sketchProfile,
  sketchPresetName,
  sketchPresets,
  sketchProfileSummary,
  applySketchPreset,
  updateSketchProfile,
  resetSketchProfile,
  getSketchProfile
} from './sketch.js';

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
  selectFromBox,
  deselectIndices,
  selectIndices,
  adjustSelectionAfterDeletion
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
  setIsTranscribing,
  updatePageTranscriptionLines
} from './transcription.js';

// Settings
export {
  myscriptAppKey,
  myscriptHmacKey,
  hasMyScriptCredentials,
  getMyScriptCredentials,
  // v2.0 local-folder storage
  dataRoot,
  dataFolderReady,
  dataFolderStatusText,
  setDataFolderStatus,
  getDataRoot,
  // "Export to LogSeq" — publish curated strokes into a LogSeq graph
  graphRoot,
  graphFolderReady,
  graphFolderStatusText,
  setGraphFolderStatus,
  getGraphRoot
} from './settings.js';

// UI
export {
  activeTab,
  sidebarCollapsed,
  canvasZoom,
  showLineGuides,
  showFilteredStrokes,
  logMessages,
  showSearchTranscriptsDialog,
  showActivityLogDialog,
  log,
  setActiveTab,
  toggleSidebar,
  setCanvasZoom,
  toggleLineGuides,
  toggleFilteredStrokes,
  clearLog,
  openActivityLogDialog,
  closeActivityLogDialog,
  openSearchTranscriptsDialog,
  closeSearchTranscriptsDialog,
  svgExportDialog,
  openSvgExportDialog,
  closeSvgExportDialog
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
  isPageSaved,
  // v2.0 unsaved-changes indicator
  unsavedChanges,
  markUnsavedChanges,
  clearUnsavedChanges
} from './storage.js';

// Filtered Strokes
export {
  filteredStrokes,
  filterStats,
  setFilteredStrokes,
  clearFilteredStrokes,
  getFilteredStrokeByIndex
} from './filtered-strokes.js';

// Saved Pages (data-folder index)
export {
  savedPages,
  isScanning,
  lastScanTime,
  pagesByBook,
  bookIds,
  setSavedPages,
  setScanning,
  clearSavedPages,
  updatePageSyncStatus
} from './saved-pages.js';

// Viewer (Book View pane)
export {
  viewerMode,
  viewerDirty,
  recentViews,
  viewerSelection,
  setViewerMode,
  toggleViewerMode,
  markViewerDirtyPage,
  clearViewerDirtyPage,
  clearAllViewerDirty,
  recordRecentView,
  setViewerSelection,
  clearViewerSelection
} from './viewer.js';

// Book Aliases
export {
  bookAliases,
  knownBookIds,
  booksWithoutAliases,
  setBookAliases,
  setBookAlias,
  removeBookAlias,
  getBookAlias,
  registerBookId,
  registerBookIds,
  clearBookAliases
} from './book-aliases.js';

// Page Positions (Spatial Layout)
export {
  pagePositions,
  useCustomPositions,
  setPagePosition,
  movePageBy,
  getPagePosition,
  resetPagePositions,
  clearPagePositions,
  autoArrangePages
} from './page-order.js';

// Pending Changes (Deletions & Undo)
export {
  deletedIndices,
  deletedCount,
  hasPendingDeletions,
  canUndo,
  pendingChanges,
  hasPendingChanges,
  markStrokesDeleted,
  undoLastDeletion,
  clearDeletedIndices,
  isStrokeDeleted,
  getActiveStrokesForPage,
  getDeletedStrokeIdsForPage,
  getPendingChangesSummary,
  // On-disk stroke-id index (powers the additions diff without holding strokes resident)
  onDiskStrokeIds,
  noteOnDiskStrokeIds,
  forgetOnDiskStrokeIds
} from './pending-changes.js';

// Page Scales (Per-Page Resize)
export {
  pageScales,
  hasScaledPages,
  setPageScale,
  getPageScale,
  resetPageScale,
  resetAllPageScales,
  hasCustomScale
} from './page-scale.js';

// Clipboard
export {
  clipboardStrokes,
  hasClipboardContent,
  copyToClipboard,
  clearClipboard
} from './clipboard.js';

// Pasted Strokes
export {
  pastedStrokes,
  pastedSelection,
  pastedCount,
  selectedPastedStrokes,
  hasPastedSelection,
  duplicateStrokes,
  movePastedStrokes,
  deleteSelectedPasted,
  clearPastedStrokes,
  selectPastedStroke,
  clearPastedSelection,
  getPastedAsNewPage
} from './pasted-strokes.js';
