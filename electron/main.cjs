// electron/main.cjs
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

let mainWindow;

// ===== Bluetooth State =====
let isBluetoothDialogOpen = false;
let bluetoothCallback = null;
let discoveredDevices = [];

function createWindow() {
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
      bluetoothCallback(deviceId);
      // Don't reset state yet - wait for connection result or cancel
    }
  });

  // Handle scan cancellation from renderer
  ipcMain.on('bluetooth-scan-cancelled', () => {
    if (bluetoothCallback) {
      bluetoothCallback(''); // Empty string cancels the request
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
            if (mainWindow) mainWindow.reload();
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
