/**
 * NeoSmartpen → LogSeq Bridge
 * Main application entry point
 */

// Load polyfills first (required by web_pen_sdk)
import './polyfills.js';

import { state, modules } from './state.js';
import { elements } from './elements.js';
import { log } from './logger.js';
import { StrokeAnalyzer } from './stroke-analyzer.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { setupPenCallbacks } from './pen-handlers.js';
import { 
  handleConnect,
  handleDisconnect,
  handleFetchOffline,
  handleClearCanvas,
  handleTestLogseq,
  handleSendToLogseq,
  handleExportSvg,
  handleExportJson,
  handlePageFilter,
  handleTabSwitch,
  handleTranscribe,
  handleTestMyScript,
  handleKeyboardShortcuts
} from './button-handlers.js';
import { updateSelectionInfo } from './ui-updates.js';
import { saveSettings, loadSavedSettings } from './settings.js';

// ============================================================
// Initialization
// ============================================================
function init() {
  // Initialize modules
  modules.renderer = new CanvasRenderer(elements.strokeCanvas);
  modules.analyzer = new StrokeAnalyzer();
  
  // Setup pen SDK callbacks
  setupPenCallbacks();
  
  // Bind event handlers
  elements.btnConnect.addEventListener('click', handleConnect);
  elements.btnDisconnect.addEventListener('click', handleDisconnect);
  elements.btnFetchOffline.addEventListener('click', handleFetchOffline);
  elements.btnClearCanvas.addEventListener('click', handleClearCanvas);
  elements.btnTestLogseq.addEventListener('click', handleTestLogseq);
  elements.btnSendToLogseq.addEventListener('click', handleSendToLogseq);
  elements.btnExportSvg.addEventListener('click', handleExportSvg);
  elements.btnExportJson.addEventListener('click', handleExportJson);
  elements.btnTranscribe.addEventListener('click', handleTranscribe);
  elements.btnTestMyScript.addEventListener('click', handleTestMyScript);
  
  // Load saved API keys from localStorage
  loadSavedSettings();
  
  // Save settings when changed
  elements.myscriptAppKey.addEventListener('change', saveSettings);
  elements.myscriptHmacKey.addEventListener('change', saveSettings);
  elements.logseqHost.addEventListener('change', saveSettings);
  
  // Enable/disable transcribe button when credentials change
  elements.myscriptAppKey.addEventListener('input', updateSelectionInfo);
  elements.myscriptHmacKey.addEventListener('input', updateSelectionInfo);
  
  // Zoom controls
  elements.btnZoomIn.addEventListener('click', () => modules.renderer?.zoomIn());
  elements.btnZoomOut.addEventListener('click', () => modules.renderer?.zoomOut());
  elements.btnFitContent.addEventListener('click', () => modules.renderer?.fitToContent());
  elements.btnResetView.addEventListener('click', () => modules.renderer?.resetView());
  
  elements.pageSelect.addEventListener('change', handlePageFilter);
  elements.tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  
  // Handle window resize
  window.addEventListener('resize', () => modules.renderer?.resize());
  
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);
  
  log('Bridge initialized. Click "Connect Pen" to begin.', 'info');
  log('Make sure LogSeq HTTP API is enabled in Settings > Advanced', 'info');
}

// Start the app
init();
