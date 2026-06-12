// electron/main.cjs
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const fsp = require('fs').promises;

let mainWindow;

// ===== Close / quit gate state =====
// rendererUnsaved mirrors the renderer's unsaved-changes flag (synced over IPC),
// so the close gate can show a visible warning before discarding work.
// isQuitting latches once the user has confirmed (or there was nothing to
// confirm) so the gate's second pass lets the window close.
let rendererUnsaved = false;
let isQuitting = false;

// ===== Bluetooth State =====
let isBluetoothDialogOpen = false;
let bluetoothCallback = null;
let discoveredDevices = [];

function createWindow() {
  isQuitting = false; // fresh window starts in the "not quitting" state
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,  // Security
      contextIsolation: true,  // Security
      enableRemoteModule: false, // Security
      webSecurity: true,
      // Enable Web Bluetooth API
      enableBlinkFeatures: 'WebBluetooth',
      // Preload script for IPC bridge
      preload: path.join(__dirname, 'preload.cjs')
    },
    backgroundColor: '#1a1a1a',
    show: false
  });

  // Development: Load from Vite dev server (vite-plugin-electron sets VITE_DEV_SERVER_URL)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  }
  // Production: Load built files
  else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ===== Close / quit gate =====
  // The single place that decides whether the window may close. Fires for the X
  // button directly, and for Ctrl+Q / menu Exit / Windows log-off via
  // before-quit → mainWindow.close(). We drive shutdown ourselves so we can
  // (1) show a real, visible unsaved-changes warning — Electron does NOT show a
  // prompt for a renderer beforeunload returnValue, it just silently cancels the
  // close — and (2) guarantee teardown even if the renderer is unresponsive:
  // mainWindow.destroy() force-closes without waiting on a (possibly pegged)
  // renderer, so the app can never get stuck open requiring Task Manager.
  mainWindow.on('close', (event) => {
    if (isQuitting) return; // already confirmed — allow the close to proceed

    event.preventDefault();
    if (!confirmDiscardUnsaved()) return; // user chose to stay

    isQuitting = true;

    // Ask the renderer to release the BLE GATT link (synchronous on its side).
    // A clean release is what stops the Windows Bluetooth stack from caching a
    // stale handle that blocks reconnection until a reboot.
    try {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('app-before-quit');
      }
    } catch (_) {
      // best-effort during teardown
    }

    // Destroy as soon as the renderer acks (renderer-disconnect-complete), or
    // unconditionally after a short grace period. Terminal either way, so a hung
    // or memory-pegged renderer can never trap the window open.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    }, 1200);
  });

  // ===== Web Bluetooth Device Selection (IPC-based) =====
  // Sends device info to renderer for custom Svelte dialog instead of native dialogs

  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault(); // Prevent auto-selection of first device

    // Store callback for later use
    bluetoothCallback = callback;

    // Merge new devices with existing (avoid duplicates by deviceId)
    devices.forEach(device => {
      const existingIndex = discoveredDevices.findIndex(d => d.deviceId === device.deviceId);
      if (existingIndex === -1) {
        discoveredDevices.push({
          deviceId: device.deviceId,
          deviceName: device.deviceName || 'Unknown Device'
        });
      }
    });

    // Send updated device list to renderer
    mainWindow.webContents.send('bluetooth-device-found', discoveredDevices);

    // Only signal dialog open once
    if (!isBluetoothDialogOpen) {
      isBluetoothDialogOpen = true;
      mainWindow.webContents.send('bluetooth-scanning-started');
    }
  });

  // Handle device selection from renderer
  ipcMain.on('bluetooth-device-selected', (event, deviceId) => {
    if (bluetoothCallback) {
      const cb = bluetoothCallback;
      bluetoothCallback = null; // Clear before calling to prevent double-invoke
      cb(deviceId);
    }
  });

  // Handle scan cancellation from renderer
  ipcMain.on('bluetooth-scan-cancelled', () => {
    if (bluetoothCallback) {
      const cb = bluetoothCallback;
      bluetoothCallback = null; // Clear before calling to prevent double-invoke
      cb(''); // Empty string cancels the request
    }
    resetBluetoothState();
  });

  // Handle Bluetooth pairing requests (required on Windows/Linux)
  mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
    // For smartpens, auto-confirm pairing (they typically don't require PIN)
    if (details.pairingKind === 'confirm') {
      callback({ confirmed: true });
    } else if (details.pairingKind === 'confirmPin') {
      // For PIN confirmation, auto-confirm (smartpens don't use PINs)
      callback({ confirmed: true });
    } else {
      // For other pairing kinds, auto-confirm
      callback({ confirmed: true });
    }
  });

  createMenu();
}

// ===== MyScript API Proxy =====
// Routes MyScript API calls through Node.js to preserve HTTP header casing.
// Electron's Chromium uses HTTP/2 which lowercases headers, but MyScript
// requires exact casing for 'applicationKey' and 'hmac' headers.

function generateHmac(appKey, hmacKey, body) {
  const key = appKey + hmacKey;
  return crypto.createHmac('sha512', key).update(body).digest('hex');
}

function myscriptRequest(appKey, hmac, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'cloud.myscript.com',
      path: '/api/v4.0/iink/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/vnd.myscript.jiix',
        'applicationKey': appKey,
        'hmac': hmac
      }
    };

    console.log('[MyScript] Request headers:', JSON.stringify(options.headers, null, 2));
    console.log('[MyScript] Body length:', body.length, 'bytes');

    const req = https.request(options, (res) => {
      console.log('[MyScript] Response status:', res.statusCode);
      console.log('[MyScript] Response headers:', JSON.stringify(res.headers, null, 2));
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.log('[MyScript] Error response body:', data);
        }
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      console.error('[MyScript] Request error:', err.message);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

ipcMain.handle('myscript-api-call', async (_event, { appKey, hmacKey, body }) => {
  // Trim whitespace/tabs from keys (common paste artifact)
  const cleanAppKey = (appKey || '').trim();
  const cleanHmacKey = (hmacKey || '').trim();

  console.log('[MyScript] === API Call via IPC ===');
  console.log('[MyScript] appKey:', cleanAppKey ? `${cleanAppKey.substring(0, 8)}...${cleanAppKey.substring(cleanAppKey.length - 4)}` : '(empty)');
  console.log('[MyScript] appKey trimmed:', appKey !== cleanAppKey ? `YES (was ${appKey.length} chars, now ${cleanAppKey.length})` : 'no (clean)');
  console.log('[MyScript] hmacKey:', cleanHmacKey ? `${cleanHmacKey.substring(0, 4)}...${cleanHmacKey.substring(cleanHmacKey.length - 4)} (${cleanHmacKey.length} chars)` : '(empty)');
  console.log('[MyScript] hmacKey trimmed:', hmacKey !== cleanHmacKey ? `YES (was ${hmacKey.length} chars, now ${cleanHmacKey.length})` : 'no (clean)');
  console.log('[MyScript] body length:', body ? body.length : 0);
  try {
    const hmac = generateHmac(cleanAppKey, cleanHmacKey, body);
    console.log('[MyScript] Generated HMAC:', hmac.substring(0, 16) + '...' + hmac.substring(hmac.length - 16));
    console.log('[MyScript] HMAC length:', hmac.length, '(expected: 128 hex chars)');
    const result = await myscriptRequest(cleanAppKey, hmac, body);
    console.log('[MyScript] Result status:', result.status);
    return result;
  } catch (err) {
    console.error('[MyScript] IPC handler error:', err.message);
    return { status: 0, body: err.message };
  }
});

// ===== Local Storage (v2.0 — replaces LogSeq HTTP API as the data layer) =====
// One JSON file per pen page at <dataRoot>/pages/B{book}/P{page}.json
// See docs/LOCAL-STORAGE-PIVOT-SPEC.md for the full design.

function pagesDir(root) {
  return path.join(root, 'pages');
}

function bookDir(root, book) {
  return path.join(pagesDir(root), `B${book}`);
}

function pagePath(root, book, page) {
  return path.join(bookDir(root, book), `P${page}.json`);
}

function aliasesPath(root) {
  return path.join(pagesDir(root), '_aliases.json');
}

// ----- "Publish to graph" target paths (JPI Tools plugin asset storage) -----
// The plugin (v1.9.66+) discovers pages from smartpen-index.json under its
// mandatory storages/<plugin-id>/ asset sub-folder. See the bridge module
// src/lib/storage/graph-index.js and the plugin's migrate-smartpen-assets.mjs.
const JPI_PLUGIN_ID = 'logseq-plugin-jpi-tools';

function graphAssetsDir(graphRoot) {
  return path.join(graphRoot, 'assets', 'storages', JPI_PLUGIN_ID);
}

function graphAssetPath(graphRoot, book, pageId) {
  return path.join(graphAssetsDir(graphRoot), `smartpen-B${book}-P${pageId}.json`);
}

function graphIndexPath(graphRoot) {
  return path.join(graphAssetsDir(graphRoot), 'smartpen-index.json');
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/** Atomic write: write to a .tmp sibling, fsync, then rename. */
async function writeFileAtomic(filePath, contents) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(contents, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, filePath);
}

/**
 * Build the 2-space-indented transcription text from transcript lines.
 * Mirrors the renderer-side builder in src/lib/storage/scan.js so the Data
 * Explorer and transcript search get identical text — without the renderer ever
 * having to load a page's strokes.
 */
function buildTranscriptionText(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return lines.map(l => '  '.repeat(l.indentLevel || 0) + (l.text || '')).join('\n');
}

/**
 * Count serialized stroke entries in the tail of a PageDoc (the slice starting
 * at the top-level "strokes" key). The hybrid serializer writes each stored
 * stroke on its own 4-space-indented line beginning with `{`, and full
 * pretty-print indents each array element's opening brace the same way, so this
 * matches both layouts. Used only when metadata.totalStrokes is missing.
 */
function countStrokeLines(tail) {
  const m = tail.match(/\n {4}\{/g);
  return m ? m.length : 0;
}

/**
 * Extract lightweight page metadata from a PageDoc's raw JSON WITHOUT parsing
 * the (potentially huge) strokes array — parsing 2.88M dot arrays across a large
 * library is what made opening the Saved Pages tab take seconds.
 *
 * The hybrid serializer always emits "strokes" as the final top-level key, so we
 * slice it off and parse just the document shell (version/pageInfo/metadata/
 * transcript), reading the stroke count from metadata.totalStrokes. Falls back to
 * a full parse if the layout is unexpected (older / hand-edited files).
 *
 * @returns {{strokeCount:number, lastUpdated:string|null, hasTranscription:boolean, transcriptLineCount:number, transcriptionText:string|null}}
 */
function extractPageMeta(raw) {
  const marker = '\n  "strokes":';
  const idx = raw.lastIndexOf(marker);
  if (idx !== -1) {
    // Close the shell cleanly: drop the trailing comma that preceded "strokes".
    const shell = raw.slice(0, idx).replace(/,\s*$/, '') + '\n}';
    try {
      const doc = JSON.parse(shell);
      const lines = doc?.transcript?.lines;
      let strokeCount = doc?.metadata?.totalStrokes;
      if (!Number.isFinite(strokeCount)) strokeCount = countStrokeLines(raw.slice(idx));
      return {
        strokeCount: strokeCount || 0,
        lastUpdated: doc?.metadata?.lastUpdated || null,
        hasTranscription: !!(lines && lines.length),
        transcriptLineCount: (lines && lines.length) || 0,
        transcriptionText: buildTranscriptionText(lines)
      };
    } catch {
      // fall through to a full parse
    }
  }
  const doc = JSON.parse(raw);
  const lines = doc?.transcript?.lines;
  return {
    strokeCount: Array.isArray(doc.strokes) ? doc.strokes.length : 0,
    lastUpdated: doc?.metadata?.lastUpdated || null,
    hasTranscription: !!(lines && lines.length),
    transcriptLineCount: (lines && lines.length) || 0,
    transcriptionText: buildTranscriptionText(lines)
  };
}

/** Walk pages/B*\/P*.json and return lightweight PageMeta entries. */
async function listAllPages(root) {
  const dir = pagesDir(root);
  let bookDirs;
  try {
    bookDirs = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const pages = [];
  for (const entry of bookDirs) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(/^B(\d+)$/);
    if (!m) continue;
    const book = parseInt(m[1], 10);
    const bookPath = path.join(dir, entry.name);

    let pageFiles;
    try {
      pageFiles = await fsp.readdir(bookPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const pf of pageFiles) {
      if (!pf.isFile()) continue;
      // Accept "P42.json" and letter-suffixed forms like "P151b.json"
      const pm = pf.name.match(/^P(\d+)([a-zA-Z]?)\.json$/);
      if (!pm) continue;
      const page = parseInt(pm[1], 10);
      const suffix = pm[2] || '';
      const pageId = `${page}${suffix}`;
      const filePath = path.join(bookPath, pf.name);

      try {
        const raw = await fsp.readFile(filePath, 'utf8');
        const meta = extractPageMeta(raw);
        pages.push({
          book,
          page,
          pageId,           // includes suffix if any (used as primary identifier)
          suffix,
          strokeCount: meta.strokeCount,
          lastUpdated: meta.lastUpdated,
          hasTranscription: meta.hasTranscription,
          transcriptLineCount: meta.transcriptLineCount,
          // Transcript text is tiny next to strokes; carrying it here keeps the
          // Data Explorer preview + full-text search working without the renderer
          // ever holding stroke arrays resident.
          transcriptionText: meta.transcriptionText,
          path: filePath
        });
      } catch (err) {
        console.warn(`[storage] skipping unreadable ${filePath}:`, err.message);
      }
    }
  }

  pages.sort((a, b) => (a.book - b.book) || (a.page - b.page) || a.suffix.localeCompare(b.suffix));
  return pages;
}

async function readPageDoc(root, book, page) {
  const fp = pagePath(root, book, page);
  try {
    const raw = await fsp.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writePageDoc(root, book, page, doc) {
  const fp = pagePath(root, book, page);
  const json = serializePageDoc(doc);
  await writeFileAtomic(fp, json);
  return fp;
}

/**
 * Hybrid serializer: pretty-prints the doc shell but inlines each stroke
 * onto one line. Cuts file size ~60% versus full pretty-print while keeping
 * structure human-readable and per-stroke diffs intact.
 */
function serializePageDoc(doc) {
  const { strokes, ...shell } = doc || {};
  const shellPretty = JSON.stringify(shell, null, 2);
  const closingBrace = shellPretty.lastIndexOf('}');
  const head = shellPretty.slice(0, closingBrace).trimEnd();
  const headWithComma = head.endsWith(',') ? head : head + ',';
  const strokeLines = (strokes || []).map(s => '    ' + JSON.stringify(s));
  const strokesBlock = strokeLines.length === 0
    ? '  "strokes": []'
    : '  "strokes": [\n' + strokeLines.join(',\n') + '\n  ]';
  return headWithComma + '\n' + strokesBlock + '\n}\n';
}

async function deletePageDoc(root, book, page) {
  const fp = pagePath(root, book, page);
  try {
    await fsp.unlink(fp);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function readAliases(root) {
  try {
    const raw = await fsp.readFile(aliasesPath(root), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeAliases(root, aliases) {
  await writeFileAtomic(aliasesPath(root), JSON.stringify(aliases, null, 2));
}

/** Wraps an IPC handler so thrown errors become `{ok:false, error}` responses. */
function ipcSafe(fn) {
  return async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, result };
    } catch (err) {
      console.error('[storage IPC] error:', err);
      return { ok: false, error: err.message || String(err) };
    }
  };
}

ipcMain.handle('storage:pickFolder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Smartpen data folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: true, result: null };
    }
    return { ok: true, result: result.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('storage:isAvailable', ipcSafe(async (root) => {
  if (!root) return false;
  try {
    const stat = await fsp.stat(root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}));

ipcMain.handle('storage:openInExplorer', ipcSafe(async (root) => {
  if (!root) throw new Error('No folder set');
  await shell.openPath(root);
  return true;
}));

ipcMain.handle('storage:listPages',   ipcSafe(async (root)              => listAllPages(root)));
ipcMain.handle('storage:getPage',     ipcSafe(async (root, book, page)  => readPageDoc(root, book, page)));
ipcMain.handle('storage:savePage',    ipcSafe(async (root, book, page, doc) => {
  const fp = await writePageDoc(root, book, page, doc);
  return {
    success: true,
    strokeCount: doc.strokes?.length || 0,
    lineCount: doc.transcript?.lines?.length || 0,
    path: fp
  };
}));
ipcMain.handle('storage:deletePage',  ipcSafe(async (root, book, page)  => { await deletePageDoc(root, book, page); return true; }));
ipcMain.handle('storage:getAliases',  ipcSafe(async (root)              => readAliases(root)));
ipcMain.handle('storage:setAlias',    ipcSafe(async (root, book, alias) => {
  const aliases = await readAliases(root);
  aliases[String(book)] = alias;
  await writeAliases(root, aliases);
  return aliases;
}));
ipcMain.handle('storage:removeAlias', ipcSafe(async (root, book) => {
  const aliases = await readAliases(root);
  delete aliases[String(book)];
  await writeAliases(root, aliases);
  return aliases;
}));

// ===== "Publish to graph" — mirror saved pages into a LogSeq graph folder =====
// Pure filesystem writes (no LogSeq runtime). The renderer (src/lib/storage/
// publish-graph.js) does the smartpen-specific building (PageDoc serialize +
// index upsert) and hands us already-serialized text; main only computes the
// convention paths from book/pageId (so a bad pageId can't escape the asset
// folder) and writes atomically, exactly like the page store.

async function requireGraphRoot(graphRoot) {
  if (!graphRoot || typeof graphRoot !== 'string') {
    throw new Error('No graph folder set');
  }
  let stat;
  try {
    stat = await fsp.stat(graphRoot);
  } catch {
    throw new Error(`Graph folder not found: ${graphRoot}`);
  }
  if (!stat.isDirectory()) throw new Error(`Graph folder is not a directory: ${graphRoot}`);
}

// Read the current smartpen-index.json (string), or null if it doesn't exist.
ipcMain.handle('storage:readGraphIndex', ipcSafe(async (graphRoot) => {
  await requireGraphRoot(graphRoot);
  try {
    return await fsp.readFile(graphIndexPath(graphRoot), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}));

// Write a page's asset + the (already-upserted) index manifest, atomically.
ipcMain.handle('storage:publishToGraph', ipcSafe(async (graphRoot, book, pageId, assetText, indexText) => {
  await requireGraphRoot(graphRoot);

  const bookNum = Number(book);
  if (!Number.isFinite(bookNum)) throw new Error(`Invalid book: ${book}`);

  // pageId is the bridge filename identifier: digits + an optional letter
  // suffix (e.g. "42", "151b"). Validate to keep the write inside the asset dir.
  const pid = String(pageId);
  if (!/^\d+[a-zA-Z]?$/.test(pid)) throw new Error(`Invalid pageId: ${pageId}`);

  if (typeof assetText !== 'string' || typeof indexText !== 'string') {
    throw new Error('publishToGraph: assetText and indexText must be strings');
  }

  const assetPath = graphAssetPath(graphRoot, bookNum, pid);
  const indexPath = graphIndexPath(graphRoot);

  // Asset first (the data), then the manifest that points discovery at it.
  await writeFileAtomic(assetPath, assetText);
  await writeFileAtomic(indexPath, indexText);

  return { assetPath, indexPath };
}));

function resetBluetoothState() {
  isBluetoothDialogOpen = false;
  bluetoothCallback = null;
  discoveredDevices = [];
}

// Expose reset function for connection completion
ipcMain.on('bluetooth-connection-complete', () => {
  resetBluetoothState();
});

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            // Reload throws away in-memory canvas/transcript state. It bypasses
            // the window 'close' gate, so confirm here too when there are
            // unsaved changes.
            if (mainWindow && confirmDiscardUnsaved()) mainWindow.reload();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Pen',
      submenu: [
        {
          label: 'Connect to Smartpen',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            // Trigger connection via IPC or web event
            mainWindow.webContents.send('trigger-pen-connect');
          }
        },
        {
          label: 'Fetch Offline Data',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            mainWindow.webContents.send('trigger-pen-fetch');
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Smartpen-LogSeq Bridge',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Smartpen-LogSeq Bridge',
              detail: `Version: ${app.getVersion()}\n\nA desktop application for connecting NeoSmartpen (Lamy Safari) devices to LogSeq.\n\nDeveloped by Josh Gannon`,
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App lifecycle
app.on('ready', createWindow);

// ===== Graceful shutdown =====
// Releasing the BLE GATT link cleanly before teardown stops the Windows
// Bluetooth stack from caching a stale handle that blocks reconnection until a
// reboot. The window 'close' gate (in createWindow) drives this; the handlers
// below keep its state current and funnel every quit path through that one gate.

// Keep the close gate's mirror of the renderer's unsaved-changes state current.
ipcMain.on('unsaved-state-changed', (_event, hasUnsaved) => {
  rendererUnsaved = !!hasUnsaved;
});

// Visible, native confirmation shown before discarding unsaved work. Returns
// true if it's OK to proceed (discard), false to abort. No dialog when clean,
// so a normal close stays one click.
function confirmDiscardUnsaved() {
  if (!rendererUnsaved) return true;
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Discard & Close'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Unsaved Changes',
    message: 'You have unsaved changes.',
    detail: 'Strokes or transcript edits you haven’t saved will be lost if you continue.'
  });
  return choice === 1; // index 1 = "Discard & Close"
}

// The renderer finished releasing the BLE link in response to 'app-before-quit'.
// Destroy now (faster than the gate's grace timer); window-all-closed then quits.
ipcMain.on('renderer-disconnect-complete', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
});

// Ctrl+Q, menu Exit, and Windows log-off arrive here. Route them through the
// same window 'close' gate so they get the unsaved-changes warning and the
// terminal teardown, rather than a separate path that could diverge.
app.on('before-quit', (event) => {
  if (isQuitting) return; // gate already ran — let the quit proceed
  if (!mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  mainWindow.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
