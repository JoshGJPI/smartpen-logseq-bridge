// electron/preload.cjs
// Provides secure IPC bridge between Electron main process and Svelte renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Bluetooth device picker
  onBluetoothScanStarted: (callback) => {
    ipcRenderer.on('bluetooth-scanning-started', callback);
  },
  onBluetoothDeviceFound: (callback) => {
    ipcRenderer.on('bluetooth-device-found', (_, devices) => callback(devices));
  },
  onBluetoothConnectionResult: (callback) => {
    ipcRenderer.on('bluetooth-connection-result', (_, result) => callback(result));
  },
  selectBluetoothDevice: (deviceId) => {
    ipcRenderer.send('bluetooth-device-selected', deviceId);
  },
  cancelBluetoothScan: () => {
    ipcRenderer.send('bluetooth-scan-cancelled');
  },
  notifyBluetoothConnectionComplete: () => {
    ipcRenderer.send('bluetooth-connection-complete');
  },

  // Cleanup listeners (call on component unmount)
  removeBluetoothListeners: () => {
    ipcRenderer.removeAllListeners('bluetooth-scanning-started');
    ipcRenderer.removeAllListeners('bluetooth-device-found');
    ipcRenderer.removeAllListeners('bluetooth-connection-result');
  },

  // MyScript API proxy (routes through Node.js to preserve header casing)
  myscriptApiCall: (appKey, hmacKey, body) => {
    return ipcRenderer.invoke('myscript-api-call', { appKey, hmacKey, body });
  }
});

// ===== v2.0 Local Storage API =====
// Each call returns { ok, result } | { ok: false, error }.
// See docs/LOCAL-STORAGE-PIVOT-SPEC.md.
contextBridge.exposeInMainWorld('storageAPI', {
  pickFolder:       ()                       => ipcRenderer.invoke('storage:pickFolder'),
  isAvailable:      (root)                   => ipcRenderer.invoke('storage:isAvailable', root),
  openInExplorer:   (root)                   => ipcRenderer.invoke('storage:openInExplorer', root),
  listPages:        (root)                   => ipcRenderer.invoke('storage:listPages', root),
  getPage:          (root, book, page)       => ipcRenderer.invoke('storage:getPage', root, book, page),
  savePage:         (root, book, page, doc)  => ipcRenderer.invoke('storage:savePage', root, book, page, doc),
  deletePage:       (root, book, page)       => ipcRenderer.invoke('storage:deletePage', root, book, page),
  getAliases:       (root)                   => ipcRenderer.invoke('storage:getAliases', root),
  setAlias:         (root, book, alias)      => ipcRenderer.invoke('storage:setAlias', root, book, alias),
  removeAlias:      (root, book)             => ipcRenderer.invoke('storage:removeAlias', root, book),
});
