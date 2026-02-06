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
