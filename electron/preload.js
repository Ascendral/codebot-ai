const { contextBridge, ipcRenderer } = require('electron');

let version = '2.9.0';
try { version = require('./package.json').version; } catch { /* asar path issue */ }

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: version,
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),
  onBackendStatus: (callback) => {
    ipcRenderer.on('backend-status', (event, data) => callback(data));
  },
});

window.addEventListener('error', (e) => {
  console.error('[renderer] Uncaught error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] Unhandled rejection:', e.reason);
});
