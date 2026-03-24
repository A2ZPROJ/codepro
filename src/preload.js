const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, version) => cb(version)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, version) => cb(version)),
  installUpdate: () => ipcRenderer.send('install-update'),
  checkUpdate: () => ipcRenderer.send('check-update'),
  appVersion: () => ipcRenderer.invoke('app-version')
});
