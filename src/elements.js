/**
 * DOM Element References
 */

export const elements = {
  // Status
  penStatus: document.getElementById('penStatus'),
  penStatusText: document.getElementById('penStatusText'),
  logseqStatus: document.getElementById('logseqStatus'),
  logseqStatusText: document.getElementById('logseqStatusText'),
  
  // Buttons
  btnConnect: document.getElementById('btnConnect'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  btnFetchOffline: document.getElementById('btnFetchOffline'),
  btnClearCanvas: document.getElementById('btnClearCanvas'),
  btnTestLogseq: document.getElementById('btnTestLogseq'),
  btnSendToLogseq: document.getElementById('btnSendToLogseq'),
  btnExportSvg: document.getElementById('btnExportSvg'),
  btnExportJson: document.getElementById('btnExportJson'),
  btnTranscribe: document.getElementById('btnTranscribe'),
  btnTestMyScript: document.getElementById('btnTestMyScript'),
  
  // Zoom controls
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnFitContent: document.getElementById('btnFitContent'),
  btnResetView: document.getElementById('btnResetView'),
  zoomLevel: document.getElementById('zoomLevel'),
  
  // Pen Info
  penInfo: document.getElementById('penInfo'),
  penModel: document.getElementById('penModel'),
  penBattery: document.getElementById('penBattery'),
  penMemory: document.getElementById('penMemory'),
  penMac: document.getElementById('penMac'),
  
  // Canvas
  strokeCanvas: document.getElementById('strokeCanvas'),
  strokeCount: document.getElementById('strokeCount'),
  pageSelect: document.getElementById('pageSelect'),
  selectionInfo: document.getElementById('selectionInfo'),
  
  // Data
  strokeList: document.getElementById('strokeList'),
  jsonViewer: document.getElementById('jsonViewer'),
  analysisViewer: document.getElementById('analysisViewer'),
  messageLog: document.getElementById('messageLog'),
  
  // MyScript settings
  myscriptAppKey: document.getElementById('myscriptAppKey'),
  myscriptHmacKey: document.getElementById('myscriptHmacKey'),
  
  // Settings
  logseqHost: document.getElementById('logseqHost'),
  logseqToken: document.getElementById('logseqToken'),
  
  // Shape detection
  shapePreview: document.getElementById('shapePreview'),
  detectedShapes: document.getElementById('detectedShapes'),
  
  // Tabs
  tabs: document.querySelectorAll('.tab'),
  tabStrokes: document.getElementById('tabStrokes'),
  tabRaw: document.getElementById('tabRaw'),
  tabAnalysis: document.getElementById('tabAnalysis'),
  tabTranscription: document.getElementById('tabTranscription'),
  transcriptionResult: document.getElementById('transcriptionResult'),
};
